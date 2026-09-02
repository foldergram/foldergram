<template>
  <div
    class="video-media-player relative h-full w-full overflow-hidden bg-black select-none"
    :class="{ 'video-media-player--capture-touch-gestures': captureTouchGestures }"
    role="button"
    tabindex="0"
    @click="handleSurfaceClick"
    @contextmenu.prevent
    @keydown="handleSurfaceKeydown"
    @pointercancel="handleHoldPointercancel"
    @pointerdown="handleHoldPointerdown"
    @pointermove="handleHoldPointermove"
    @pointerup="handleHoldPointerup"
  >
    <media-player
      ref="playerElement"
      class="video-media-player__player h-full w-full object-contain"
      :class="`video-media-player__player--${variant}`"
      :src.prop="computedSource"
      :title.prop="title || alt || ''"
      :fullscreenOrientation.prop="fullscreenOrientation"
      :playsInline.prop="playsinline"
      :muted.prop="effectiveMuted"
      :autoPlay.prop="autoplay"
      :loop.prop="loop"
      :load="load"
      :preload="preload"
      :keyDisabled.prop="true"
      @fullscreen-change="handleFullscreenChange"
      @auto-play-fail="handleAutoplayFail"
    >
      <media-provider />
      <media-poster
        v-if="poster"
        class="video-media-player__poster"
        :src.prop="poster"
        :alt.prop="alt || title || ''"
      />
      <VideoProgressFooter
        v-if="showControls"
        :variant="variant"
        :time-label="computedTimeLabel"
        :seek-orientation="progressOrientation"
        :current-time="currentTimeSec"
        :duration="durationSec"
        data-swipe-ignore="true"
        @seek="seekTo"
        @seek-preview="previewSeekTo"
      >
        <template #leading>
          <div class="video-media-player__controls-group" data-swipe-ignore="true">
            <media-play-button
              class="video-media-player__control"
              :aria-label="t('post.viewer.togglePlayback')"
              data-swipe-ignore="true"
            >
              <span
                class="video-media-player__control-icon video-media-player__play-icon video-media-player__play-icon--play i-fluent-play-16-filled"
                aria-hidden="true"
              />
              <span
                class="video-media-player__control-icon video-media-player__play-icon video-media-player__play-icon--pause i-fluent-pause-16-filled"
                aria-hidden="true"
              />
            </media-play-button>
          </div>
        </template>
        <template #trailing>
          <div class="video-media-player__controls-group" data-swipe-ignore="true">
            <button
              class="video-media-player__control"
              type="button"
              data-test="mute-toggle"
              :aria-label="t('post.viewer.toggleSound')"
              data-swipe-ignore="true"
              @click.stop="handleMuteClick"
            >
              <span
                class="video-media-player__control-icon"
                :class="muted ? 'i-fluent-speaker-mute-16-regular' : 'i-fluent-speaker-2-16-regular'"
                aria-hidden="true"
              />
            </button>

            <media-fullscreen-button
              v-if="showFullscreenControl"
              class="video-media-player__control"
              :aria-label="t('post.viewer.toggleFullscreen')"
              target="media"
              data-swipe-ignore="true"
            >
              <span
                class="video-media-player__control-icon video-media-player__fullscreen-icon video-media-player__fullscreen-icon--enter i-fluent-full-screen-maximize-16-regular"
                aria-hidden="true"
              />
              <span
                class="video-media-player__control-icon video-media-player__fullscreen-icon video-media-player__fullscreen-icon--exit i-fluent-full-screen-minimize-16-regular"
                aria-hidden="true"
              />
            </media-fullscreen-button>
          </div>
        </template>
      </VideoProgressFooter>
    </media-player>

    <img
      v-if="poster && !hasRenderedFrame"
      class="video-media-player__first-frame"
      :src="poster"
      :alt="alt || title || ''"
      decoding="async"
      aria-hidden="true"
    />

    <div
      v-if="showPausedIndicator"
      class="video-media-player__pause-indicator absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white pointer-events-none transition-opacity"
      aria-hidden="true"
    >
      <span class="i-fluent-play-20-filled h-8 w-8" />
    </div>

    <div
      v-if="holdSpeed.isFastForwarding.value"
      class="video-media-player__hold-indicator"
      aria-hidden="true"
    >
      <span class="h-5 w-5 i-fluent-fast-forward-20-filled" />
      <span>{{ holdSpeed.rate }}x</span>
    </div>

    <div
      v-else-if="holdSpeed.isScrubbing.value"
      class="video-media-player__hold-indicator"
      aria-hidden="true"
    >
      <span>{{ scrubLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MediaPlayerElement } from 'vidstack/elements';
import type { MediaFullscreenChangeEvent, MediaLoadingStrategy, PlayerSrc } from 'vidstack';

import { useAppStore } from '../stores/app';
import {
  resolveVideoFallbackSource,
  resolveVideoSource,
  seekMediaPlayerAndWait,
  toPlayerSrc,
  useBundledHlsLibrary,
  warmVideoStream,
  type ResolvedVideoSource,
  type VideoPlaybackMedia
} from '../utils/video-playback';
import { useHoldToSpeed } from '../composables/useHoldToSpeed';
import { resolveGesturePoint } from '../utils/gesture-coordinates';
import VideoProgressFooter from './VideoProgressFooter.vue';
import {
  safeMediaPlayerGetCurrentTime,
  safeMediaPlayerPause,
  safeMediaPlayerPlay,
  safeMediaPlayerSetCurrentTime,
  safeMediaPlayerSetMuted
} from '../utils/safe-media-player';

const props = withDefaults(
  defineProps<{
    src: string | PlayerSrc;
    /**
     * When present the component owns source selection: it honours the global
     * playback quality setting, streams through HLS when the file needs
     * transcoding, and falls back to the other mode on a playback error.
     */
    media?: VideoPlaybackMedia | null;
    originalUrl?: string;
    playbackStrategy?: 'preview' | 'original' | null;
    width?: number | null;
    height?: number | null;
    poster?: string;
    alt?: string;
    title?: string;
    muted?: boolean;
    loop?: boolean;
    autoplay?: boolean;
    playsinline?: boolean;
    load?: MediaLoadingStrategy;
    preload?: 'none' | 'metadata' | 'auto';
    variant?: 'feed' | 'viewer';
    showControls?: boolean;
    /** Hosts that own a fullscreen affordance hide the footer's duplicate. */
    showFullscreenControl?: boolean;
    timeLabel?: string;
    /**
     * `toggle` pauses on tap (classic player). `immersive` leaves the decision to
     * the host, which is how feed surfaces open the fullscreen layer instead.
     */
    surfaceMode?: 'toggle' | 'immersive';
    fullscreenOrientation?: 'none' | 'landscape' | 'portrait';
    /** Source already active on the surface handing playback to this player. */
    sourceOverride?: ResolvedVideoSource | null;
    /** Seconds to resume from once metadata is ready. */
    startTime?: number;
    /** Enables press-and-hold fast playback and drag scrubbing on the frame. */
    holdToSeek?: boolean;
    /** Prevents the browser from cancelling gestures owned by an immersive host. */
    captureTouchGestures?: boolean;
    /** Orientation used to map hold/scrub gestures to the video's local axes. */
    gestureOrientation?: 'normal' | 'rotated';
    /** Enables a transformed-stage-safe seek bar for the immersive player. */
    progressOrientation?: 'normal' | 'rotated' | null;
  }>(),
  {
    media: null,
    originalUrl: '',
    playbackStrategy: null,
    width: null,
    height: null,
    poster: '',
    alt: '',
    title: '',
    muted: true,
    loop: true,
    autoplay: false,
    playsinline: true,
    load: 'eager',
    preload: 'metadata',
    variant: 'viewer',
    showControls: true,
    showFullscreenControl: true,
    timeLabel: '',
    surfaceMode: 'toggle',
    fullscreenOrientation: 'none',
    sourceOverride: null,
    startTime: 0,
    holdToSeek: false,
    captureTouchGestures: false,
    gestureOrientation: 'normal',
    progressOrientation: null
  }
);

const emit = defineEmits<{
  'toggle-mute': [];
  'autoplay-muted': [];
  'toggle-playback': [];
  'surface-click': [];
  'fullscreen-change': [isFullscreen: boolean];
  'loaded-metadata': [payload: { naturalWidth: number; naturalHeight: number; duration: number }];
  'time-update': [payload: { currentTime: number; duration: number }];
  'surface-gesture-start': [];
  'surface-gesture-end': [];
}>();

const { t } = useI18n();
const appStore = useAppStore();
const playerElement = ref<MediaPlayerElement | null>(null);
const fallbackSource = ref<ResolvedVideoSource | null>(null);
const durationSec = ref(0);
const currentTimeSec = ref(0);
const previewTimeSec = ref<number | null>(null);
const pendingSeekTargetSec = ref<number | null>(null);
const isPaused = ref(false);
const showPausedIndicator = ref(false);
/**
 * Browsers refuse audible autoplay until the page has seen a user gesture. That
 * verdict belongs to the document, not to one element, so it is tracked globally in
 * the app store: every player, feed card and immersive layer then agrees on whether
 * sound is currently possible. `props.muted` stays the owner's stored preference.
 */
const audioBlocked = computed(() => appStore.audibleAutoplayBlocked);
const effectiveMuted = computed(() => props.muted || audioBlocked.value);
let pendingRestoreState: { currentTime: number; wasPaused: boolean } | null = null;
let hidePausedTimer: NodeJS.Timeout | null = null;
let removeEventListeners: (() => void) | null = null;
let appliedStartTime = false;
let autoplayCancelled = false;
/**
 * Vidstack tears `<media-poster>` down the moment a provider attaches, which is long
 * before the first frame of a handover has decoded. Holding our own copy of the
 * thumbnail until the clock actually moves is what stops the immersive layer from
 * flashing black over a clip the inline card was already showing.
 */
const hasRenderedFrame = ref(false);
/** A handover lands on a keyframe, so an exact match is not expected. */
const START_TIME_TOLERANCE_SEC = 1.5;

/**
 * How far the clock has to move before playback counts as genuinely running.
 *
 * "Running" used to mean `currentTime > 0.05`, which is only true for a clip that
 * starts at zero. A handover opens at the position the inline card reached, so that
 * test passed the instant the seek landed and the stall retry loop stood down while the
 * picture was still frozen. Progress is measured against where playback was asked to
 * begin instead.
 */
const PLAYBACK_PROGRESS_EPSILON_SEC = 0.05;
let playbackBaselineSec = 0;

function hasPlaybackAdvanced(player: MediaPlayerElement): boolean {
  return (player.currentTime || 0) > playbackBaselineSec + PLAYBACK_PROGRESS_EPSILON_SEC;
}

function nativeVideoHasPaintedFrame(player: MediaPlayerElement): boolean {
  const videos = [player.querySelector('video'), player.shadowRoot?.querySelector('video')];
  for (const video of videos) {
    if (
      video instanceof HTMLVideoElement &&
      video.videoWidth > 0 &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return true;
    }
  }
  return false;
}

function markFrameRendered(player: MediaPlayerElement) {
  // A handover can decode the head of the clip before the seek lands. That frame is
  // not the one the viewer was watching, so the thumbnail stays until the clock
  // actually reaches the start position or moves past it.
  if (props.startTime > 0 && !appliedStartTime) {
    return;
  }

  if (hasPlaybackAdvanced(player) || (appliedStartTime && nativeVideoHasPaintedFrame(player)) || (props.startTime <= 0 && nativeVideoHasPaintedFrame(player))) {
    hasRenderedFrame.value = true;
  }
}

// A stream the NAS is still transcoding can refuse to start or stall on its first
// segments, and it never recovers on its own here: the provider has already committed
// to a source that is not ready yet. Retrying on a backoff is what the reels deck
// already does, and it is why swiping there always starts playing.
const STALL_RETRY_BASE_DELAY_MS = 160;
const MAX_STALL_RETRY_DELAY_MS = 1_200;
const MAX_STALL_RETRIES = 8;
const STARTUP_FALLBACK_MS = 2_000;
let stallRetryAttempts = 0;
let stallRetryTimer = 0;
let startupFallbackTimer = 0;
let lastSurfaceTapAt = 0;

function clearStallRetry() {
  if (stallRetryTimer !== 0) {
    window.clearTimeout(stallRetryTimer);
    stallRetryTimer = 0;
  }
}

function clearStartupFallback() {
  if (startupFallbackTimer !== 0) {
    window.clearTimeout(startupFallbackTimer);
    startupFallbackTimer = 0;
  }
}

function resetStallRetry() {
  clearStallRetry();
  stallRetryAttempts = 0;
}

function scheduleStartupFallback() {
  const player = playerElement.value;
  if (!player || !props.autoplay || autoplayCancelled || fallbackSource.value) {
    return;
  }

  clearStartupFallback();
  startupFallbackTimer = window.setTimeout(() => {
    startupFallbackTimer = 0;
    const current = playerElement.value;
    if (!current || !props.autoplay || autoplayCancelled || fallbackSource.value) {
      return;
    }

    // play() can resolve on a source that never paints a frame. That is the black
    // screen: metadata arrived, the poster was already gone, and no error fired.
    if (hasPlaybackAdvanced(current) || nativeVideoHasPaintedFrame(current)) {
      return;
    }

    switchToFallbackSource();
  }, STARTUP_FALLBACK_MS);
}

function scheduleStallRetry() {
  const player = playerElement.value;
  if (!player || !props.autoplay || autoplayCancelled || stallRetryTimer !== 0 || stallRetryAttempts >= MAX_STALL_RETRIES) {
    return;
  }

  stallRetryAttempts += 1;
  stallRetryTimer = window.setTimeout(
    () => {
      stallRetryTimer = 0;
      const current = playerElement.value;
      if (!current || !props.autoplay || autoplayCancelled) {
        return;
      }

      // A viewer-initiated pause must survive the retry loop, so only a player that is
      // still stuck where playback was asked to begin is nudged.
      if (!current.paused && hasPlaybackAdvanced(current)) {
        resetStallRetry();
        return;
      }

      void safeMediaPlayerPlay(current)
        .then((started) => {
          if (!started) {
            scheduleStallRetry();
            return;
          }
          if (hasPlaybackAdvanced(current)) {
            resetStallRetry();
          } else {
            scheduleStallRetry();
          }
        })
        .catch(() => {
          scheduleStallRetry();
        });
    },
    Math.min(STALL_RETRY_BASE_DELAY_MS * stallRetryAttempts, MAX_STALL_RETRY_DELAY_MS)
  );
}

/**
 * Asks the NAS for the segments around a seek target before the player requests them.
 * Jumping into a cold part of a stream is the one case where the transcode start-up
 * cost is fully exposed, so the request goes out the moment the target is known.
 */
function warmSeekTarget(seconds: number) {
  const media = props.media;
  if (!media || !Number.isFinite(seconds) || seconds <= 0) {
    return;
  }

  warmVideoStream(media, appStore.videoPlaybackQuality, {
    fromSeconds: seconds,
    segments: 2
  });
}

const holdSpeed = useHoldToSpeed({
  canStart: (event) => !isInteractiveTarget(event.target),
  getCurrentTime: getScrubStartTime,
  getDuration: () => playerElement.value?.duration ?? 0,
  seekTo,
  previewSeek: (seconds) => {
    const player = playerElement.value;
    if (!player) return;
    currentTimeSec.value = seconds;
    try {
      safeMediaPlayerSetCurrentTime(player, seconds);
    } catch {
      // Seeking before the provider is attached is a no-op.
    }
  },
  getPlaybackRate: () => playerElement.value?.playbackRate ?? 1,
  setPlaybackRate: (rate) => {
    const player = playerElement.value;
    if (!player) return;
    try {
      player.playbackRate = rate;
    } catch {
      // Rate changes before the provider is attached are a no-op.
    }
  },
  play: () => {
    if (playerElement.value) void safeMediaPlayerPlay(playerElement.value);
  },
  // Measured in the picture's own frame. A host that turns the surface with a CSS
  // rotation reports `gestureOrientation`, so the sideways drag the viewer makes while
  // holding the phone sideways still scrubs, and their downward swipe still dismisses.
  getGesturePoint: (event) => resolveGesturePoint(event, props.gestureOrientation),
  // Ownership of the gesture is decided on these deltas, so they have to live in the
  // same frame as the picture. Reading raw screen coordinates here is what used to make
  // a landscape sideways drag look vertical, hand the gesture to the host as a dismiss,
  // and leave the timeline unscrubbable.
  getScrubPoint: (event) => resolveGesturePoint(event, props.gestureOrientation),
  // Relative scrubbing from the press time. Absolute finger-to-timeline mapping made
  // a second swipe restart from the finger's X instead of continuing from 5:00.
  onGestureStart: () => emit('surface-gesture-start'),
  onScrub: warmSeekTarget,
  onGestureEnd: () => emit('surface-gesture-end')
});

const scrubLabel = computed(() => {
  const seconds = holdSpeed.scrubSeconds.value;
  if (seconds === null) return '';
  return `${formatTime(seconds)} / ${formatTime(durationSec.value)}`;
});

const basePreviewUrl = computed<string>(() => {
  if (typeof props.src === 'string') {
    return props.src;
  }
  if (Array.isArray(props.src)) {
    const first = props.src[0];
    if (typeof first === 'string') return first;
    return (first && typeof first === 'object' && 'src' in first && typeof (first as any).src === 'string') ? (first as any).src : '';
  }
  if (props.src && typeof props.src === 'object' && 'src' in props.src && typeof (props.src as any).src === 'string') {
    return (props.src as any).src;
  }
  return '';
});

const managedPreferredSource = computed<ResolvedVideoSource | null>(() => {
  if (!props.media) {
    return null;
  }

  if (props.sourceOverride && !props.sourceOverride.isStream) {
    return props.sourceOverride;
  }

  return resolveVideoSource(props.media, appStore.videoPlaybackQuality);
});

const managedActiveSource = computed<ResolvedVideoSource | null>(
  () => fallbackSource.value ?? managedPreferredSource.value
);

const activeVideoUrl = computed<string>(() => {
  if (managedActiveSource.value) {
    return managedActiveSource.value.src;
  }
  return basePreviewUrl.value;
});

const computedSource = computed<PlayerSrc>(() => {
  if (managedActiveSource.value) {
    return toPlayerSrc(managedActiveSource.value);
  }

  return {
    src: activeVideoUrl.value,
    type: 'video/mp4'
  };
});

function switchToFallbackSource() {
  const media = props.media;
  const failed = managedActiveSource.value;
  if (!media || !failed || fallbackSource.value) {
    return;
  }

  const fallback = resolveVideoFallbackSource(media, failed);
  if (!fallback) {
    return;
  }

  fallbackSource.value = fallback;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const computedTimeLabel = computed(() => {
  if (props.timeLabel) return props.timeLabel;
  return `${formatTime(previewTimeSec.value ?? currentTimeSec.value)} / ${formatTime(durationSec.value)}`;
});

function handleFullscreenChange(event: MediaFullscreenChangeEvent) {
  emit('fullscreen-change', Boolean(event.detail));
}

function handleMuteClick() {
  emit('toggle-mute');
}

async function handleAutoplayFail() {
  const player = playerElement.value;
  if (!player || !props.autoplay || effectiveMuted.value) return;

  // Browsers commonly reject audible autoplay. Record the document-wide verdict and
  // fall back to muted playback; the stored preference stays audible so the next tap
  // (which is a user gesture) can still bring the sound back.
  const blocked = appStore.reportAudibleAutoplayBlocked();
  syncPlayerMuted(player, blocked ? true : effectiveMuted.value);
  emit('autoplay-muted');
  await nextTick();
  await safeMediaPlayerPlay(player).then((started) => {
    if (started) {
      syncPlayerMuted(player, effectiveMuted.value);
    }
  });
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-swipe-ignore="true"]') ||
    target.closest('button, input, select, textarea, a, media-play-button, media-mute-button, media-fullscreen-button, media-time-slider')
  );
}

function handleSurfaceClick(event: MouseEvent) {
  if (isInteractiveTarget(event.target)) return;
  if (holdSpeed.shouldSuppressClick()) return;

  const now = Date.now();
  if (now - lastSurfaceTapAt <= 320) {
    lastSurfaceTapAt = 0;
    appStore.activateVideoSoundFromUserGesture();
    void togglePlayback();
    return;
  }
  lastSurfaceTapAt = now;

  if (props.surfaceMode === 'immersive') {
    appStore.activateVideoSoundFromUserGesture();
    emit('surface-click');
  }
}

function handleHoldPointerdown(event: PointerEvent) {
  if (!props.holdToSeek) return;
  holdSpeed.onPointerdown(event);
}

function handleHoldPointermove(event: PointerEvent) {
  if (!props.holdToSeek) return;
  holdSpeed.onPointermove(event);
}

function handleHoldPointerup(event: PointerEvent) {
  holdSpeed.onPointerup(event);
}

function handleHoldPointercancel() {
  holdSpeed.onPointercancel();
}

function seekBy(deltaSeconds: number) {
  const player = playerElement.value;
  if (!player) return;

  const duration = player.duration;
  const next = (player.currentTime || 0) + deltaSeconds;
  const upperBound = Number.isFinite(duration) && duration > 0 ? duration - 0.25 : next;
  try {
    safeMediaPlayerSetCurrentTime(player, Math.min(Math.max(next, 0), Math.max(upperBound, 0)));
  } catch {
    // Seeking before the provider is attached is a no-op.
  }
}

function seekTo(seconds: number) {
  const player = playerElement.value;
  if (!player || !Number.isFinite(seconds)) return;

  const duration = player.duration;
  const upperBound = Number.isFinite(duration) && duration > 0 ? duration - 0.25 : seconds;
  const next = Math.min(Math.max(seconds, 0), Math.max(upperBound, 0));
  previewTimeSec.value = null;
  currentTimeSec.value = next;
  warmSeekTarget(next);
  pendingSeekTargetSec.value = next;
  return seekMediaPlayerAndWait(player, next).finally(() => {
    if (pendingSeekTargetSec.value === next) {
      pendingSeekTargetSec.value = null;
    }
  });
}

function getScrubStartTime(): number {
  if (pendingSeekTargetSec.value !== null) {
    return pendingSeekTargetSec.value;
  }

  if (previewTimeSec.value !== null) {
    return previewTimeSec.value;
  }

  if (Number.isFinite(currentTimeSec.value) && currentTimeSec.value > 0) {
    return currentTimeSec.value;
  }

  return playerElement.value ? safeMediaPlayerGetCurrentTime(playerElement.value) : 0;
}

function previewSeekTo(seconds: number) {
  if (!Number.isFinite(seconds)) return;
  previewTimeSec.value = seconds;
}

function handleSurfaceKeydown(event: KeyboardEvent) {
  if (isInteractiveTarget(event.target)) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.stopPropagation();
    }
    return;
  }

  if (event.key === ' ' || event.key === 'k') {
    event.preventDefault();
    togglePlayback();
  }
}

async function togglePlayback() {
  const player = playerElement.value;
  if (!player) return;

  if (player.paused) {
    autoplayCancelled = false;
    // Playing from a real tap lifts a previous autoplay-only restriction for every
    // surface. This is intentionally global, not a local player workaround.
    appStore.activateVideoSoundFromUserGesture();
    syncPlayerMuted(player, effectiveMuted.value);

    await safeMediaPlayerPlay(player);
    isPaused.value = false;
    showPausedIndicator.value = false;
    if (hidePausedTimer) clearTimeout(hidePausedTimer);
  } else {
    // The pause was asked for, so the retry loop must not undo it.
    resetStallRetry();
    autoplayCancelled = true;
    safeMediaPlayerPause(player);
    isPaused.value = true;
    showPausedIndicator.value = true;
    if (hidePausedTimer) clearTimeout(hidePausedTimer);
    hidePausedTimer = setTimeout(() => {
      showPausedIndicator.value = false;
    }, 1500);
  }
  emit('toggle-playback');
}

/**
 * Continues the clip where the previous surface left off. Called from both
 * `loaded-metadata` and `can-play`: the earlier event is enough for a progressive
 * file, while HLS only honours the seek once a segment is attached. The tolerance
 * check keeps it idempotent so an already-applied handover is never re-seeked.
 */
function applyStartTime(player: MediaPlayerElement): boolean {
  if (appliedStartTime || props.startTime <= 0) {
    return appliedStartTime || props.startTime <= 0;
  }

  const target = props.startTime;
  const duration = player.duration || 0;
  if (duration > 0 && target >= duration - 0.25) {
    appliedStartTime = true;
    return true;
  }

  // Progress is judged from here on, so a stall at the handover position is still
  // recognised as "not playing yet".
  playbackBaselineSec = target;

  // hls.js was handed the same position through `startPosition`, so the stream usually
  // opens already parked there. Re-seeking would drop the fragment it just buffered and
  // reintroduce the stall this path exists to avoid. A clock still sitting at zero is
  // not a match: that is a provider that ignored the hint.
  const clock = safeMediaPlayerGetCurrentTime(player);
  if (clock > 0.05 && Math.abs(clock - target) <= START_TIME_TOLERANCE_SEC) {
    appliedStartTime = true;
    return true;
  }

  try {
    safeMediaPlayerSetCurrentTime(player, target);
  } catch {
    return false;
  }

  if (Math.abs((player.currentTime || 0) - target) <= START_TIME_TOLERANCE_SEC) {
    appliedStartTime = true;
  }

  return appliedStartTime;
}

function requestAutoplayAfterReady(player: MediaPlayerElement) {
  if (!props.autoplay || autoplayCancelled || !player.paused) {
    return;
  }

  // Keep ordinary autoplay on the existing delayed retry path. A handoff is different:
  // the new player has already been positioned at a non-zero start time, so waiting for
  // a further stall event leaves the immersive layer visibly frozen.
  if (props.startTime <= 0) {
    scheduleStallRetry();
    return;
  }

  clearStallRetry();
  void safeMediaPlayerPlay(player)
    .then((started) => {
      if (!started) {
        scheduleStallRetry();
        return;
      }
      if (!player.paused && hasPlaybackAdvanced(player)) {
        resetStallRetry();
        return;
      }

      scheduleStallRetry();
    })
    .catch(() => {
      scheduleStallRetry();
    });
}

/**
 * `:muted.prop` lands on the element before vidstack upgrades it, so the library's
 * own default (audible) overwrites it and the immersive layer used to open with the
 * sound on even though the feed was muted. Re-asserting the preference on every
 * lifecycle point that resets media state keeps the element, the icon and the stored
 * value telling the same story.
 *
 * Deliberately one-directional: it only ever mutes. Un-muting is an explicit owner
 * decision handled by the prop watcher, which also leaves the muted autoplay
 * fallback intact instead of immediately fighting it.
 */
function syncPlayerMuted(player: MediaPlayerElement, muted: boolean) {
  safeMediaPlayerSetMuted(player, muted);

  const videos = [
    player.querySelector('video'),
    player.shadowRoot?.querySelector('video')
  ];
  for (const video of videos) {
    if (video instanceof HTMLVideoElement) {
      video.muted = muted;
    }
  }
}

function setupListeners() {
  const player = playerElement.value;
  if (!player) return;

  syncPlayerMuted(player, effectiveMuted.value);

  const onLoadedMetadata = async () => {
    syncPlayerMuted(player, effectiveMuted.value);
    durationSec.value = player.duration || 0;
    const video = player.querySelector('video');
    emit('loaded-metadata', {
      naturalWidth: video?.videoWidth || 0,
      naturalHeight: video?.videoHeight || 0,
      duration: player.duration || 0
    });

    if (pendingRestoreState) {
      const { currentTime, wasPaused } = pendingRestoreState;
      pendingRestoreState = null;
      try {
        safeMediaPlayerSetCurrentTime(player, currentTime);
        if (!wasPaused) {
          await safeMediaPlayerPlay(player);
        }
      } catch {}
      return;
    }

    applyStartTime(player);
    requestAutoplayAfterReady(player);
    scheduleStartupFallback();
  };

  const onCanPlay = () => {
    syncPlayerMuted(player, effectiveMuted.value);
    // HLS providers regularly ignore a seek issued at `loaded-metadata` because the
    // media source has no buffered range yet, so confirm the handover once the
    // provider reports it can play.
    applyStartTime(player);
    // `can-play` is not a painted frame. HEVC and on-demand HLS often report it
    // while the surface is still black, so the thumbnail stays until the clock
    // moves or a native video actually has pixels.
    markFrameRendered(player);
    requestAutoplayAfterReady(player);
    scheduleStartupFallback();
  };

  const onSeeking = () => {
    // Covers the seeks this component does not own: the footer slider, keyboard steps
    // and the provider's own recovery jumps.
    warmSeekTarget(player.currentTime || 0);
  };

  const onStall = () => {
    if (props.autoplay && !autoplayCancelled) {
      scheduleStallRetry();
    }
  };

  const onTimeUpdate = () => {
    if (hasPlaybackAdvanced(player) || nativeVideoHasPaintedFrame(player)) {
      resetStallRetry();
      clearStartupFallback();
      hasRenderedFrame.value = true;
    }

    const currentTime = player.currentTime || 0;
    if (
      pendingSeekTargetSec.value !== null &&
      Math.abs(currentTime - pendingSeekTargetSec.value) > 1.5
    ) {
      return;
    }
    pendingSeekTargetSec.value = null;
    currentTimeSec.value = currentTime;
    durationSec.value = player.duration || 0;
    emit('time-update', {
      currentTime,
      duration: player.duration || 0
    });
  };

  const onPlay = () => {
    isPaused.value = false;
    showPausedIndicator.value = false;
  };

  const onPause = () => {
    isPaused.value = true;
  };

  const onVolumeChange = () => {
    syncPlayerMuted(player, effectiveMuted.value);
  };

  const onError = () => {
    switchToFallbackSource();
  };

  // A handover position has to reach hls.js before it picks its first fragment,
  // otherwise it buffers the head of the clip and the seek that follows throws that
  // work away. `appliedStartTime` guards the case where the viewer has already moved
  // on: a provider re-attach must not drag them back to the handover point.
  const removeHlsLibraryBinding = useBundledHlsLibrary(player, {
    getStartPosition: () => (appliedStartTime ? 0 : props.startTime)
  });

  player.addEventListener('loaded-metadata', onLoadedMetadata);
  player.addEventListener('can-play', onCanPlay);
  player.addEventListener('volume-change', onVolumeChange);
  player.addEventListener('time-update', onTimeUpdate);
  player.addEventListener('play', onPlay);
  player.addEventListener('pause', onPause);
  player.addEventListener('error', onError);
  player.addEventListener('waiting', onStall);
  player.addEventListener('stalled', onStall);
  player.addEventListener('seeking', onSeeking);

  removeEventListeners = () => {
    removeHlsLibraryBinding();
    player.removeEventListener('loaded-metadata', onLoadedMetadata);
    player.removeEventListener('can-play', onCanPlay);
    player.removeEventListener('volume-change', onVolumeChange);
    player.removeEventListener('time-update', onTimeUpdate);
    player.removeEventListener('play', onPlay);
    player.removeEventListener('pause', onPause);
    player.removeEventListener('error', onError);
    player.removeEventListener('waiting', onStall);
    player.removeEventListener('stalled', onStall);
    player.removeEventListener('seeking', onSeeking);
  };
}

onMounted(() => {
  setupListeners();
  scheduleStartupFallback();
});

onBeforeUnmount(() => {
  if (playerElement.value) {
    try {
    safeMediaPlayerPause(playerElement.value);
    } catch {}
  }
  if (removeEventListeners) removeEventListeners();
  if (hidePausedTimer) clearTimeout(hidePausedTimer);
  clearStallRetry();
  clearStartupFallback();
  holdSpeed.stop();
});

watch([basePreviewUrl, () => props.media?.id ?? null], () => {
  // A source swap tears the provider down, so any hold in flight can no longer be
  // released by the element it started on.
  holdSpeed.stop();
  resetStallRetry();
  clearStartupFallback();
  fallbackSource.value = null;
  pendingRestoreState = null;
  appliedStartTime = false;
  autoplayCancelled = false;
  playbackBaselineSec = 0;
  hasRenderedFrame.value = false;
});

watch(
  () => appStore.videoPlaybackQuality,
  () => {
    fallbackSource.value = null;
  }
);

watch(playerElement, () => {
  if (removeEventListeners) removeEventListeners();
  setupListeners();
});

// The mute button now reports to the owning store instead of flipping the player
// itself, so the element follows the prop in both directions.
watch(
  () => [effectiveMuted.value, appStore.videoSoundGeneration] as const,
  ([muted]) => {
    const player = playerElement.value;
    if (player) {
      syncPlayerMuted(player, muted);
    }
  }
);

defineExpose({
  playerElement,
  getPlayerElement: () => playerElement.value,
  audioBlocked,
  effectiveMuted,
  togglePlayback,
  seekBy,
  seekTo,
  currentTime: () => playerElement.value ? safeMediaPlayerGetCurrentTime(playerElement.value) : 0,
  paused: () => playerElement.value?.paused ?? true,
  play: () => playerElement.value ? safeMediaPlayerPlay(playerElement.value) : Promise.resolve(false),
  pause: () => { if (playerElement.value) safeMediaPlayerPause(playerElement.value); },
  cancelHoldGesture: () => holdSpeed.stop(),
  isHoldGestureActive: () => holdSpeed.isFastForwarding.value || holdSpeed.isScrubbing.value
});
</script>

<style scoped>
/* iOS shows a text-selection loupe on a long press unless the callout is refused,
   and the hold gesture must not turn into a native drag or selection. */
.video-media-player {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  touch-action: pan-y;
}

.video-media-player.video-media-player--capture-touch-gestures {
  touch-action: none;
}

.video-media-player__player {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  color: white;
  background: black;
}

.video-media-player__player :deep(media-provider) {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.video-media-player__player :deep(video) {
  display: block;
  width: 100%;
  height: 100%;
  /* Vidstack's provider stylesheet otherwise wins with `cover`, cropping a
     landscape source when the immersive viewport is portrait. */
  object-fit: contain !important;
  background: black;
}

.video-media-player__first-frame {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  pointer-events: none;
}

.video-media-player__poster {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  background: black;
  transition: opacity 0.2s ease-out;
}

.video-media-player__poster[data-visible] {
  opacity: 1;
}

.video-media-player__poster[data-hidden] {
  display: none;
}

.video-media-player__poster :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border: 0;
  pointer-events: none;
  user-select: none;
}

.video-media-player__hold-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  transform: translate(-50%, -50%);
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.62);
  color: white;
  font-size: 0.82rem;
  font-weight: 600;
  pointer-events: none;
}

.video-media-player__controls-group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.video-media-player__control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: white;
  cursor: pointer;
  outline: none;
  opacity: 0.85;
  transition: opacity 0.15s ease, transform 0.1s ease;
}

.video-media-player__control:hover {
  opacity: 1;
}

.video-media-player__control--active {
  color: #38bdf8;
  opacity: 1;
}

.video-media-player__control-icon {
  width: 1.125rem;
  height: 1.125rem;
}

/* The loupe suppression has to reach vidstack's own elements, including the video
   inside the shadow root, or a long press on the picture still raises it. */
.video-media-player,
.video-media-player *,
.video-media-player :deep(*) {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

media-player[data-paused] .video-media-player__play-icon--pause,
media-player:not([data-paused]) .video-media-player__play-icon--play {
  display: none;
}

media-player[data-muted] .video-media-player__mute-icon--on,
media-player:not([data-muted]) .video-media-player__mute-icon--off {
  display: none;
}

media-player[data-fullscreen] .video-media-player__fullscreen-icon--enter,
media-player:not([data-fullscreen]) .video-media-player__fullscreen-icon--exit {
  display: none;
}
</style>
