<template>
  <div
    class="video-media-player relative h-full w-full overflow-hidden bg-black select-none"
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
        data-swipe-ignore="true"
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
                :class="effectiveMuted ? 'i-fluent-speaker-mute-16-regular' : 'i-fluent-speaker-2-16-regular'"
                aria-hidden="true"
              />
            </button>

            <button
              v-if="hasHdOption"
              class="video-media-player__control"
              :class="{ 'video-media-player__control--active': isHd }"
              type="button"
              data-test="hd-toggle"
              :aria-label="isHd ? t('post.viewer.switchToPreviewQuality') : t('post.viewer.switchToHdOriginal')"
              :aria-pressed="isHd"
              :title="isHd ? t('post.viewer.previewQuality') : t('post.viewer.hdOriginal')"
              data-swipe-ignore="true"
              @click.stop="toggleHd"
            >
              <span
                class="video-media-player__control-icon"
                :class="isHd ? 'i-fluent-hd-16-filled' : 'i-fluent-hd-16-regular'"
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
import { videoPreviewWouldDownscale } from '../utils/media';
import {
  resolveVideoFallbackSource,
  resolveVideoSource,
  toPlayerSrc,
  useBundledHlsLibrary,
  warmVideoStream,
  type ResolvedVideoSource,
  type VideoPlaybackMedia
} from '../utils/video-playback';
import { useHoldToSpeed } from '../composables/useHoldToSpeed';
import VideoProgressFooter from './VideoProgressFooter.vue';

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
    /** Seconds to resume from once metadata is ready. */
    startTime?: number;
    /** Enables press-and-hold fast playback and drag scrubbing on the frame. */
    holdToSeek?: boolean;
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
    startTime: 0,
    holdToSeek: false
  }
);

const emit = defineEmits<{
  'toggle-mute': [];
  'autoplay-muted': [];
  'toggle-hd': [isHd: boolean];
  'toggle-playback': [];
  'surface-click': [];
  'fullscreen-change': [isFullscreen: boolean];
  'loaded-metadata': [payload: { naturalWidth: number; naturalHeight: number; duration: number }];
  'time-update': [payload: { currentTime: number; duration: number }];
}>();

const { t } = useI18n();
const appStore = useAppStore();
const playerElement = ref<MediaPlayerElement | null>(null);
const fallbackSource = ref<ResolvedVideoSource | null>(null);
const durationSec = ref(0);
const currentTimeSec = ref(0);
const isPaused = ref(false);
const showPausedIndicator = ref(false);
const isHd = ref(false);
/**
 * Browsers refuse audible autoplay until the page has seen a user gesture. That is a
 * property of this element right now, not a change of preference, so it is recorded
 * locally and cleared on the next gesture instead of being written to the store.
 */
const audioBlocked = ref(false);
const effectiveMuted = computed(() => props.muted || audioBlocked.value);
let pendingRestoreState: { currentTime: number; wasPaused: boolean } | null = null;
let hidePausedTimer: NodeJS.Timeout | null = null;
let removeEventListeners: (() => void) | null = null;
let appliedStartTime = false;
/** A handover lands on a keyframe, so an exact match is not expected. */
const START_TIME_TOLERANCE_SEC = 1.5;

// A stream the NAS is still transcoding can refuse to start or stall on its first
// segments, and it never recovers on its own here: the provider has already committed
// to a source that is not ready yet. Retrying on a backoff is what the reels deck
// already does, and it is why swiping there always starts playing.
const STALL_RETRY_BASE_DELAY_MS = 160;
const MAX_STALL_RETRY_DELAY_MS = 1_200;
const MAX_STALL_RETRIES = 8;
let stallRetryAttempts = 0;
let stallRetryTimer = 0;

function clearStallRetry() {
  if (stallRetryTimer !== 0) {
    window.clearTimeout(stallRetryTimer);
    stallRetryTimer = 0;
  }
}

function resetStallRetry() {
  clearStallRetry();
  stallRetryAttempts = 0;
}

function scheduleStallRetry() {
  const player = playerElement.value;
  if (!player || !props.autoplay || stallRetryTimer !== 0 || stallRetryAttempts >= MAX_STALL_RETRIES) {
    return;
  }

  stallRetryAttempts += 1;
  stallRetryTimer = window.setTimeout(
    () => {
      stallRetryTimer = 0;
      const current = playerElement.value;
      if (!current || !props.autoplay) {
        return;
      }

      // A viewer-initiated pause must survive the retry loop, so only a player that is
      // still stuck at the very start is nudged.
      if (!current.paused && (current.currentTime || 0) > 0.05) {
        resetStallRetry();
        return;
      }

      void current
        .play()
        .then(() => {
          if ((current.currentTime || 0) > 0.05) {
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

  warmVideoStream(media, isHd.value ? 'original' : appStore.videoPlaybackQuality, {
    fromSeconds: seconds,
    segments: 2
  });
}

const holdSpeed = useHoldToSpeed({
  canStart: (event) => !isInteractiveTarget(event.target),
  getCurrentTime: () => playerElement.value?.currentTime ?? 0,
  getDuration: () => playerElement.value?.duration ?? 0,
  seekTo: (seconds) => {
    const player = playerElement.value;
    if (!player) return;
    warmSeekTarget(seconds);
    try {
      player.currentTime = seconds;
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
    void playerElement.value?.play().catch(() => {});
  }
});

const scrubLabel = computed(() => {
  const seconds = holdSpeed.scrubSeconds.value;
  if (seconds === null) return '';
  return `${formatTime(seconds)} / ${formatTime(durationSec.value)}`;
});

const hasHdOption = computed(() => {
  if (props.media) {
    // Upgrading only means something when the default source is a transcoded stream.
    return Boolean(props.media.streamUrl) && (isHd.value || managedPreferredSource.value?.isStream === true);
  }

  return (
    props.playbackStrategy === 'original' &&
    Boolean(props.originalUrl) &&
    videoPreviewWouldDownscale(props.width, props.height)
  );
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

  return resolveVideoSource(props.media, isHd.value ? 'original' : appStore.videoPlaybackQuality);
});

const managedActiveSource = computed<ResolvedVideoSource | null>(
  () => fallbackSource.value ?? managedPreferredSource.value
);

const activeVideoUrl = computed<string>(() => {
  if (managedActiveSource.value) {
    return managedActiveSource.value.src;
  }
  if (isHd.value && props.originalUrl) {
    return props.originalUrl;
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
  return `${formatTime(currentTimeSec.value)} / ${formatTime(durationSec.value)}`;
});

function handleFullscreenChange(event: MediaFullscreenChangeEvent) {
  emit('fullscreen-change', Boolean(event.detail));
}

function handleMuteClick() {
  if (audioBlocked.value) {
    // The press itself is the gesture the browser was waiting for, so retry audible
    // playback rather than flipping the stored preference the wrong way.
    audioBlocked.value = false;

    const player = playerElement.value;
    if (player && !props.muted) {
      player.muted = false;
      void player.play().catch(() => {});
      return;
    }
  }

  emit('toggle-mute');
}

async function handleAutoplayFail() {
  const player = playerElement.value;
  if (!player || !props.autoplay || effectiveMuted.value) return;

  // Browsers commonly reject audible autoplay. Fall back to muted playback for this
  // element only: the stored preference stays audible so the next card (or the next
  // tap here) can still play with sound.
  audioBlocked.value = true;
  player.muted = true;
  emit('autoplay-muted');
  await nextTick();
  await player.play().catch(() => {});
}

async function toggleHd() {
  const player = playerElement.value;
  const current = player?.currentTime ?? 0;
  const wasPaused = player?.paused ?? true;

  fallbackSource.value = null;
  isHd.value = !isHd.value;
  pendingRestoreState = { currentTime: current, wasPaused };
  emit('toggle-hd', isHd.value);
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

  if (props.surfaceMode === 'immersive') {
    emit('surface-click');
    return;
  }

  togglePlayback();
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
    player.currentTime = Math.min(Math.max(next, 0), Math.max(upperBound, 0));
  } catch {
    // Seeking before the provider is attached is a no-op.
  }
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
    // A tap is a user gesture, so an earlier audible rejection no longer applies.
    if (audioBlocked.value) {
      audioBlocked.value = false;
      player.muted = props.muted;
    }

    await player.play().catch(() => {});
    isPaused.value = false;
    showPausedIndicator.value = false;
    if (hidePausedTimer) clearTimeout(hidePausedTimer);
  } else {
    // The pause was asked for, so the retry loop must not undo it.
    resetStallRetry();
    player.pause();
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
function applyStartTime(player: MediaPlayerElement) {
  if (appliedStartTime || props.startTime <= 0) {
    return;
  }

  const target = props.startTime;
  const duration = player.duration || 0;
  if (duration > 0 && target >= duration - 0.25) {
    appliedStartTime = true;
    return;
  }

  try {
    player.currentTime = target;
  } catch {
    return;
  }

  if (Math.abs((player.currentTime || 0) - target) <= START_TIME_TOLERANCE_SEC) {
    appliedStartTime = true;
  }
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
function enforceMuted(player: MediaPlayerElement) {
  if (effectiveMuted.value && !player.muted) {
    player.muted = true;
  }
}

function setupListeners() {
  const player = playerElement.value;
  if (!player) return;

  enforceMuted(player);

  const onLoadedMetadata = async () => {
    enforceMuted(player);
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
        player.currentTime = currentTime;
        if (!wasPaused) {
          await player.play().catch(() => {});
        }
      } catch {}
      return;
    }

    applyStartTime(player);
  };

  const onCanPlay = () => {
    enforceMuted(player);
    // HLS providers regularly ignore a seek issued at `loaded-metadata` because the
    // media source has no buffered range yet, so confirm the handover once the
    // provider reports it can play.
    applyStartTime(player);

    if (props.autoplay && player.paused) {
      scheduleStallRetry();
    }
  };

  const onSeeking = () => {
    // Covers the seeks this component does not own: the footer slider, keyboard steps
    // and the provider's own recovery jumps.
    warmSeekTarget(player.currentTime || 0);
  };

  const onStall = () => {
    if (props.autoplay && (player.currentTime || 0) <= 0.05) {
      scheduleStallRetry();
    }
  };

  const onTimeUpdate = () => {
    if ((player.currentTime || 0) > 0.05) {
      resetStallRetry();
    }

    currentTimeSec.value = player.currentTime || 0;
    durationSec.value = player.duration || 0;
    emit('time-update', {
      currentTime: player.currentTime || 0,
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
    enforceMuted(player);
  };

  const onError = () => {
    switchToFallbackSource();
  };

  const removeHlsLibraryBinding = useBundledHlsLibrary(player);

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
});

onBeforeUnmount(() => {
  if (playerElement.value) {
    try {
      playerElement.value.pause();
    } catch {}
  }
  if (removeEventListeners) removeEventListeners();
  if (hidePausedTimer) clearTimeout(hidePausedTimer);
  clearStallRetry();
  holdSpeed.stop();
});

watch([basePreviewUrl, () => props.media?.id ?? null], () => {
  // A source swap tears the provider down, so any hold in flight can no longer be
  // released by the element it started on.
  holdSpeed.stop();
  resetStallRetry();
  isHd.value = false;
  audioBlocked.value = false;
  fallbackSource.value = null;
  pendingRestoreState = null;
  appliedStartTime = false;
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
  () => props.muted,
  (muted) => {
    // Switching the preference to audible is a deliberate act, so it also clears a
    // stale block; if the browser refuses again `handleAutoplayFail` re-arms it.
    if (!muted) {
      audioBlocked.value = false;
    }

    const player = playerElement.value;
    if (player) {
      player.muted = muted;
    }
  }
);

defineExpose({
  playerElement,
  audioBlocked,
  effectiveMuted,
  togglePlayback,
  toggleHd,
  isHd,
  hasHdOption,
  seekBy,
  currentTime: () => playerElement.value?.currentTime ?? 0,
  paused: () => playerElement.value?.paused ?? true,
  play: () => playerElement.value?.play(),
  pause: () => playerElement.value?.pause()
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
  object-fit: contain;
  background: black;
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
