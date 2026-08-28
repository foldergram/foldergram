<template>
  <div
    class="video-media-player relative h-full w-full overflow-hidden bg-black select-none"
    role="button"
    tabindex="0"
    @click="handleSurfaceClick"
    @keydown="handleSurfaceKeydown"
  >
    <media-player
      ref="playerElement"
      class="video-media-player__player h-full w-full object-contain"
      :class="`video-media-player__player--${variant}`"
      :src.prop="computedSource"
      :title.prop="title || alt || ''"
      :fullscreenOrientation.prop="'none'"
      :playsInline.prop="playsinline"
      :muted.prop="muted"
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
            <media-mute-button
              class="video-media-player__control"
              :aria-label="t('post.viewer.toggleSound')"
              data-swipe-ignore="true"
              @click.stop="handleMuteClick"
            >
              <span
                class="video-media-player__control-icon video-media-player__mute-icon video-media-player__mute-icon--on i-fluent-speaker-2-16-regular"
                aria-hidden="true"
              />
              <span
                class="video-media-player__control-icon video-media-player__mute-icon video-media-player__mute-icon--off i-fluent-speaker-mute-16-regular"
                aria-hidden="true"
              />
            </media-mute-button>

            <button
              v-if="hasHdOption"
              class="video-media-player__control"
              :class="{ 'video-media-player__control--active': isHd }"
              type="button"
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
  type ResolvedVideoSource,
  type VideoPlaybackMedia
} from '../utils/video-playback';
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
    timeLabel?: string;
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
    timeLabel: ''
  }
);

const emit = defineEmits<{
  'toggle-mute': [];
  'autoplay-muted': [];
  'toggle-hd': [isHd: boolean];
  'toggle-playback': [];
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
let pendingRestoreState: { currentTime: number; wasPaused: boolean } | null = null;
let hidePausedTimer: NodeJS.Timeout | null = null;
let removeEventListeners: (() => void) | null = null;

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
  emit('toggle-mute');
}

async function handleAutoplayFail() {
  const player = playerElement.value;
  if (!player || !props.autoplay || props.muted) return;

  // Browsers commonly reject audible autoplay. Keep carousel playback automatic
  // by retrying muted and persist that state through the owning app store.
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
  togglePlayback();
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
    await player.play().catch(() => {});
    isPaused.value = false;
    showPausedIndicator.value = false;
    if (hidePausedTimer) clearTimeout(hidePausedTimer);
  } else {
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

function setupListeners() {
  const player = playerElement.value;
  if (!player) return;

  const onLoadedMetadata = async () => {
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
    }
  };

  const onTimeUpdate = () => {
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

  const onError = () => {
    switchToFallbackSource();
  };

  const removeHlsLibraryBinding = useBundledHlsLibrary(player);

  player.addEventListener('loaded-metadata', onLoadedMetadata);
  player.addEventListener('time-update', onTimeUpdate);
  player.addEventListener('play', onPlay);
  player.addEventListener('pause', onPause);
  player.addEventListener('error', onError);

  removeEventListeners = () => {
    removeHlsLibraryBinding();
    player.removeEventListener('loaded-metadata', onLoadedMetadata);
    player.removeEventListener('time-update', onTimeUpdate);
    player.removeEventListener('play', onPlay);
    player.removeEventListener('pause', onPause);
    player.removeEventListener('error', onError);
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
});

watch([basePreviewUrl, () => props.media?.id ?? null], () => {
  isHd.value = false;
  fallbackSource.value = null;
  pendingRestoreState = null;
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

defineExpose({
  playerElement,
  togglePlayback,
  toggleHd,
  isHd,
  hasHdOption,
  play: () => playerElement.value?.play(),
  pause: () => playerElement.value?.pause()
});
</script>

<style scoped>
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
