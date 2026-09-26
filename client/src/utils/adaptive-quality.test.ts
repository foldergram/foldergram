import { describe, expect, it } from 'vitest';

import { decideAdaptiveQuality, QUALITY_TIER_MBPS } from './adaptive-quality';

const BASE = { goodSinceMs: null, lastChangeMs: null, nowMs: 0 };

describe('decideAdaptiveQuality', () => {
  it('leaves auto and original to the HLS master instead of swapping a fixed rendition', () => {
    expect(decideAdaptiveQuality('auto', 'auto', 2, BASE)).toEqual({ next: null, reason: 'none' });
    expect(decideAdaptiveQuality('original', 'auto', 1, BASE)).toEqual({ next: null, reason: 'none' });
  });

  it('steps 480p up to 720p on a 3 Mbps pipe, not straight to 1080p', () => {
    expect(
      decideAdaptiveQuality('480p', 'auto', 3, { goodSinceMs: 0, lastChangeMs: 0, nowMs: 60_000 })
    ).toEqual({ next: '720p', reason: 'upgrade' });
  });

  it('does not climb from 720p to 1080p on a 3 Mbps pipe', () => {
    expect(
      decideAdaptiveQuality('720p', 'auto', 3, { goodSinceMs: 0, lastChangeMs: 0, nowMs: 60_000 })
    ).toEqual({ next: null, reason: 'none' });
  });

  it('steps 720p down to 480p on a very thin pipe', () => {
    expect(decideAdaptiveQuality('720p', 'auto', 1, BASE)).toEqual({ next: '480p', reason: 'downgrade' });
  });

  it('never downgrades below 480p', () => {
    expect(decideAdaptiveQuality('480p', 'auto', 0.1, BASE)).toEqual({ next: null, reason: 'none' });
  });

  it('does nothing while bandwidth comfortably covers the current tier', () => {
    expect(decideAdaptiveQuality('auto', 'auto', 20, BASE)).toEqual({ next: null, reason: 'none' });
  });

  it('upgrades back toward the configured tier only after sustained good bandwidth', () => {
    // 720p active, auto configured, 10 Mbps sustained for 31s → step up to 1080p.
    expect(
      decideAdaptiveQuality('720p', 'auto', 10, { goodSinceMs: 0, lastChangeMs: 1_000, nowMs: 31_000 })
    ).toEqual({ next: '1080p', reason: 'upgrade' });
  });

  it('requires the good-bandwidth period before upgrading', () => {
    expect(
      decideAdaptiveQuality('720p', 'auto', 10, { goodSinceMs: 20_000, lastChangeMs: 1_000, nowMs: 31_000 })
    ).toEqual({ next: null, reason: 'none' });
  });

  it('respects the configured tier as the upgrade ceiling', () => {
    // User configured 720p; even with abundant bandwidth the controller must not
    // go beyond it — and with the configured tier already active it stays put.
    expect(
      decideAdaptiveQuality('480p', '720p', 50, { goodSinceMs: 0, lastChangeMs: 0, nowMs: 60_000 })
    ).toEqual({ next: '720p', reason: 'upgrade' });
    expect(
      decideAdaptiveQuality('720p', '720p', 50, { goodSinceMs: 0, lastChangeMs: 0, nowMs: 60_000 })
    ).toEqual({ next: null, reason: 'none' });
  });

  it('never leaves the HLS ladder (original stays a manual/auto concept)', () => {
    // Recovering from a downgrade returns through 1080p on a fixed rendition.
    // Auto/original stay on the HLS master and are not this controller's job.
    expect(QUALITY_TIER_MBPS.original).toBeGreaterThan(QUALITY_TIER_MBPS['1080p']);
  });
});
