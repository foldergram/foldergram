import { useAppStore } from '../stores/app';
import type { VideoPlaybackQuality } from './video-playback';

/**
 * Adaptive playback quality for a *fixed* HLS rendition that the pipe cannot
 * hold — a hand-picked 1080p on a 3 Mbps WAN link, for example.
 *
 * `auto` and `original` stay off this ladder. Auto on the WAN already loads the
 * HLS master, and hls.js climbs 480p → 720p → 1080p on that same source. A slow
 * original Range is handled by `adaptivePreferStream`, which also keeps the
 * master instead of swapping in a fixed rendition.
 *
 * Nothing here is persisted. A per-device manual override wins — the controller
 * never fights an explicit user choice.
 */

export const QUALITY_TIER_MBPS: Record<VideoPlaybackQuality, number> = {
  auto: 6,
  original: 6,
  '1080p': 3.6,
  '720p': 1.8,
  '480p': 0.86
};

/** HLS rungs, worst to best. One step at a time — never 480p straight to 1080p. */
const STEPS: Exclude<VideoPlaybackQuality, 'auto' | 'original'>[] = ['480p', '720p', '1080p'];

export interface AdaptiveDecision {
  next: VideoPlaybackQuality | null;
  reason: 'downgrade' | 'upgrade' | 'none';
}

const DOWNGRADE_HEADROOM = 1.3;
// 1.4 × 720p (1.8 Mbps) = 2.52, so a 3 Mbps WAN can step up. 2 × used to
// demand 3.6 Mbps and skipped 720p entirely.
const UPGRADE_HEADROOM = 1.4;
const ORIGINAL_RANGE_MIN_BYTES = 100 * 1024;
const ORIGINAL_RANGE_MIN_MBPS = 2.5;
const ORIGINAL_RANGE_SLOW_SAMPLES = 3;
const SUSTAINED_UPGRADE_MS = 30_000;
const CHANGE_COOLDOWN_MS = 20_000;

function asStep(quality: VideoPlaybackQuality): number {
  return STEPS.indexOf(quality as (typeof STEPS)[number]);
}

function nextLowerTier(current: VideoPlaybackQuality): VideoPlaybackQuality | null {
  const index = asStep(current);
  return index > 0 ? STEPS[index - 1]! : null;
}

function nextHigherTier(current: VideoPlaybackQuality, configured: VideoPlaybackQuality): VideoPlaybackQuality | null {
  const ceiling = configured === 'auto' || configured === 'original' ? '1080p' : configured;
  const ceilingIndex = asStep(ceiling);
  const currentIndex = asStep(current);
  if (ceilingIndex < 0 || currentIndex < 0) {
    return null;
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex > ceilingIndex || nextIndex >= STEPS.length) {
    return null;
  }

  return STEPS[nextIndex]!;
}

/**
 * Pure decision core so the thresholds are unit-testable.
 *
 * @param effective  tier currently in use (already including any adaptive step)
 * @param configured tier the user actually chose (the upgrade ceiling)
 * @param measuredMbps sustained HLS throughput estimate in megabits per second
 */
export function decideAdaptiveQuality(
  effective: VideoPlaybackQuality,
  configured: VideoPlaybackQuality,
  measuredMbps: number,
  options: { goodSinceMs: number | null; lastChangeMs: number | null; nowMs: number } = {
    goodSinceMs: null,
    lastChangeMs: null,
    nowMs: 0
  }
): AdaptiveDecision {
  const { goodSinceMs, lastChangeMs, nowMs } = options;
  const sinceLastChange = lastChangeMs === null ? Number.POSITIVE_INFINITY : nowMs - lastChangeMs;

  // Downgrade: the current tier costs more bandwidth than we can reliably supply.
  const downgradeTarget = nextLowerTier(effective);
  if (downgradeTarget !== null && measuredMbps < QUALITY_TIER_MBPS[effective] * DOWNGRADE_HEADROOM) {
    return { next: downgradeTarget, reason: 'downgrade' };
  }

  // Upgrade: plenty of headroom for the next tier, sustained long enough.
  const upgradeTarget = nextHigherTier(effective, configured);
  if (
    upgradeTarget !== null &&
    measuredMbps > QUALITY_TIER_MBPS[upgradeTarget] * UPGRADE_HEADROOM &&
    goodSinceMs !== null &&
    nowMs - goodSinceMs >= SUSTAINED_UPGRADE_MS &&
    sinceLastChange >= CHANGE_COOLDOWN_MS
  ) {
    return { next: upgradeTarget, reason: 'upgrade' };
  }

  return { next: null, reason: 'none' };
}
interface AdaptiveController {
  stop(): void;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Wires the controller to HLS resource timings. Safe to call once per app. */
export function startAdaptiveVideoQuality(): AdaptiveController | null {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return null;
  }

  const appStore = useAppStore();
  const recentSamples: { mbps: number; at: number }[] = [];
  let lastChangeAt: number | null = null;
  let goodSinceAt: number | null = null;
  let slowOriginalSamples = 0;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const resource = entry as PerformanceResourceTiming;
      const durationMs = resource.duration;
      if (!Number.isFinite(durationMs) || durationMs <= 0 || !resource.transferSize) {
        continue;
      }

      const mbps = (resource.transferSize * 8) / (durationMs / 1000) / 1_000_000;
      const now = Date.now();

      if (resource.name.includes('/originals/') && resource.transferSize >= ORIGINAL_RANGE_MIN_BYTES) {
        if (mbps < ORIGINAL_RANGE_MIN_MBPS) {
          slowOriginalSamples += 1;
          if (slowOriginalSamples >= ORIGINAL_RANGE_SLOW_SAMPLES) {
            appStore.setAdaptivePreferStream(true);
          }
        } else {
          slowOriginalSamples = 0;
        }
        continue;
      }

      if (!resource.name.includes('/hls/')) {
        continue;
      }

      recentSamples.push({ mbps, at: now });
      while (recentSamples.length > 0 && now - recentSamples[0]!.at > 20_000) {
        recentSamples.shift();
      }

      const window = recentSamples.filter((sample) => now - sample.at <= 10_000);
      if (window.length < 3) {
        continue;
      }

      const medianMbps = median(window.map((sample) => sample.mbps));

      if (appStore.videoPlaybackQualityOverride !== null) {
        if (appStore.adaptiveVideoQualityOverride !== null) {
          appStore.setAdaptiveVideoQualityOverride(null);
        }
        goodSinceAt = null;
        continue;
      }

      const configured = appStore.savedVideoPlaybackQuality;
      // Auto already uses the HLS master; swapping in a fixed rendition would
      // reload the source. Leave ABR to hls.js.
      if (configured === 'auto' || configured === 'original') {
        continue;
      }

      const effective = appStore.videoPlaybackQuality;
      const decision = decideAdaptiveQuality(effective, configured, medianMbps, {
        goodSinceMs: goodSinceAt,
        lastChangeMs: lastChangeAt,
        nowMs: now
      });

      if (decision.next === null) {
        goodSinceAt = medianMbps >= QUALITY_TIER_MBPS[effective] * UPGRADE_HEADROOM ? (goodSinceAt ?? now) : null;
        continue;
      }

      if (decision.next !== effective) {
        appStore.setAdaptiveVideoQualityOverride(decision.next);
        lastChangeAt = now;
        goodSinceAt = decision.reason === 'upgrade' ? now : null;
      }
    }
  });

  observer.observe({ type: 'resource', buffered: true });

  return {
    stop() {
      observer.disconnect();
      appStore.setAdaptiveVideoQualityOverride(null);
      appStore.setAdaptivePreferStream(false);
    }
  };
}
