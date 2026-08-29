<template>
  <article class="reel-player-card">
    <div class="reel-player-card__stage">
      <div
        class="reel-player-card__surface"
        :aria-label="active ? t('post.immersive.open') : undefined"
        :role="active ? 'button' : undefined"
        :tabindex="active ? 0 : -1"
        @click="handleSurfaceClick"
        @keydown="handleSurfaceKeydown"
        @pointercancel="holdSeek.onPointercancel"
        @pointerdown="holdSeek.onPointerdown"
        @pointerup="holdSeek.onPointerup"
      >
        <media-player
          ref="playerElement"
          class="reel-player-card__player"
          :src.prop="videoSource"
          :title.prop="item.filename"
          :fullscreenOrientation.prop="'landscape'"
          :playsInline.prop="true"
          :muted.prop="appStore.videoMuted"
          :loop.prop="true"
          :load="playerLoadMode"
          :preload="playerPreloadMode"
        >
          <media-provider />
          <media-poster
            :src.prop="item.thumbnailUrl"
            :alt.prop="item.filename"
          />
          <!-- TikTok-style bottom seek bar -->
          <div class="reel-player-card__seekbar-shell">
            <media-time-slider
              class="reel-player-card__seekbar"
              aria-label="Seek video"
              @click.stop
              @pointerdown.stop
              @pointerup.stop
            >
              <div class="reel-player-card__seekbar-track" />
              <div class="reel-player-card__seekbar-track reel-player-card__seekbar-progress" />
              <div class="reel-player-card__seekbar-track reel-player-card__seekbar-fill" />
              <div class="reel-player-card__seekbar-thumb" />
            </media-time-slider>
          </div>
        </media-player>

        <div
          v-if="showPausedIndicator"
          class="reel-player-card__pause-indicator"
          aria-hidden="true"
        >
          <span class="reel-player-card__pause-icon i-fluent-play-20-filled" />
        </div>

        <div
          v-if="holdSeek.direction.value"
          class="reel-player-card__hold-indicator"
          aria-hidden="true"
        >
          <span
            class="reel-player-card__hold-icon"
            :class="holdSeek.direction.value === 'forward' ? 'i-fluent-fast-forward-20-filled' : 'i-fluent-rewind-20-filled'"
          />
          <span>{{ holdSeek.direction.value === 'forward' ? '+3s' : '-3s' }}</span>
        </div>

        <div class="reel-player-card__bottom-fade" aria-hidden="true" />

        <div
          class="reel-player-card__overlay"
          :class="{ 'reel-player-card__overlay--visible': active }"
        >
          <div class="reel-player-card__copy">
            <RouterLink
              class="reel-player-card__folder-row reel-player-card__folder-link"
              :to="{ name: 'folder', params: { slug: item.folderSlug } }"
              aria-label="Open folder"
              @click.stop
            >
              <Avatar
                class="reel-player-card__avatar"
                :name="displayFolderTitle"
                :src="folder?.avatarUrl ?? null"
              />
              <div class="reel-player-card__text">
                <strong class="reel-player-card__folder-name">
                  {{ displayFolderTitle }}
                </strong>
                <p class="reel-player-card__folder-description">
                  {{ folderDescription }}
                </p>
              </div>
            </RouterLink>
          </div>

          <div class="reel-player-card__controls">
            <div
              v-if="$slots['mobile-action-rail']"
              class="reel-player-card__mobile-actions"
            >
              <slot name="mobile-action-rail" />
            </div>

            <button
              class="reel-player-card__playback-button"
              type="button"
              :aria-label="t('post.viewer.togglePlayback')"
              :title="t('post.viewer.togglePlayback')"
              @click.stop="togglePlayback"
            >
              <span
                class="reel-player-card__sound-icon"
                :class="isPaused ? 'i-fluent-play-16-filled' : 'i-fluent-pause-16-filled'"
                aria-hidden="true"
              />
            </button>

            <button
              class="reel-player-card__sound-button"
              type="button"
              :aria-label="appStore.videoMuted ? 'Enable sound' : 'Mute sound'"
              @click.stop="toggleSound"
            >
              <span
                class="reel-player-card__sound-icon"
                :class="
                  appStore.videoMuted
                    ? 'i-fluent-speaker-mute-16-regular'
                    : 'i-fluent-speaker-2-16-regular'
                "
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import 'vidstack/bundle';

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { PlayerSrc } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';

import { useHoldToSeek } from '../composables/useHoldToSeek';
import { useAppStore } from '../stores/app';
import { useImmersiveVideoStore } from '../stores/immersive-video';
import type { FeedItem, FolderSummary } from '../types/api';
import { formatFolderTitle } from '../utils/folder-titles';
import {
  resolveVideoFallbackSource,
  resolveVideoSource,
  toPlayerSrc,
  useBundledHlsLibrary,
  warmVideoStream,
  type ResolvedVideoSource
} from '../utils/video-playback';
import Avatar from './Avatar.vue';

const props = withDefaults(
  defineProps<{
    item: FeedItem;
    folder: FolderSummary | null;
    active: boolean;
    /** The next card warms its buffer so swiping starts playing immediately. */
    prefetch?: boolean;
  }>(),
  {
    prefetch: false
  }
);

const { t } = useI18n();
const appStore = useAppStore();
const immersiveVideoStore = useImmersiveVideoStore();
const playerElement = ref<MediaPlayerElement | null>(null);
const isPaused = ref(false);
const fallbackSource = ref<ResolvedVideoSource | null>(null);
const playerLoadMode = computed(() => (props.active || props.prefetch ? 'eager' : 'visible'));
// Buffering the neighbour is what removes the stall on the first frame after a swipe.
const playerPreloadMode = computed(() => (props.active || props.prefetch ? 'auto' : 'metadata'));
const preferredSource = computed<ResolvedVideoSource>(() =>
  resolveVideoSource(props.item, appStore.videoPlaybackQuality)
);
const activeSource = computed<ResolvedVideoSource>(() => fallbackSource.value ?? preferredSource.value);
const currentVideoSrc = computed(() => activeSource.value.src);
const videoSource = computed<PlayerSrc>(() => toPlayerSrc(activeSource.value));
const showPausedIndicator = computed(() => props.active && isPaused.value);
const displayFolderTitle = computed(() => formatFolderTitle(props.folder ?? props.item, appStore.nestedFolderTitleFormat));
const folderDescription = computed(() => {
  const normalizedFolderPath = props.item.folderPath.replace(/\\/g, '/');
  const folderSegments = normalizedFolderPath.split('/').filter(Boolean);
  const currentFolderName = folderSegments.at(-1);

  return currentFolderName ? `${currentFolderName}/${props.item.filename}` : props.item.filename;
});

let muteSyncToken = 0;
let removePlayerEventListeners: (() => void) | null = null;
let autoplayRetryAttempts = 0;
let autoplayRetryTimer = 0;

const AUTOPLAY_RETRY_DELAY_MS = 140;
const MAX_AUTOPLAY_RETRIES = 3;

function clearAutoplayRetry() {
  if (autoplayRetryTimer !== 0) {
    window.clearTimeout(autoplayRetryTimer);
    autoplayRetryTimer = 0;
  }
}

function resetAutoplayRetry() {
  clearAutoplayRetry();
  autoplayRetryAttempts = 0;
}

function scheduleAutoplayRetry() {
  if (!props.active || autoplayRetryTimer !== 0 || autoplayRetryAttempts >= MAX_AUTOPLAY_RETRIES) {
    return;
  }

  autoplayRetryAttempts += 1;
  autoplayRetryTimer = window.setTimeout(() => {
    autoplayRetryTimer = 0;
    void syncPlayback();
  }, AUTOPLAY_RETRY_DELAY_MS * autoplayRetryAttempts);
}

function switchToFallbackSource() {
  if (fallbackSource.value) {
    return;
  }

  const fallback = resolveVideoFallbackSource(props.item, activeSource.value);
  if (!fallback) {
    return;
  }

  resetAutoplayRetry();
  fallbackSource.value = fallback;
}

function syncMuted(player: MediaPlayerElement, muted: boolean) {
  const token = ++muteSyncToken;
  player.muted = muted;

  requestAnimationFrame(() => {
    if (muteSyncToken === token) {
      muteSyncToken = 0;
    }
  });
}

async function syncPlayback() {
  const player = playerElement.value;
  if (!player) {
    return;
  }

  // The immersive layer plays the same clip, so the deck copy stays paused while
  // it is open instead of decoding twice.
  if (!props.active || immersiveVideoStore.isOpen) {
    resetAutoplayRetry();
    isPaused.value = false;
    void player.pause().catch(() => {
      // Ignore pause rejections before the provider is ready.
    });
    syncMuted(player, appStore.videoMuted);
    return;
  }

  syncMuted(player, appStore.videoMuted);

  try {
    await player.play();
    resetAutoplayRetry();
    isPaused.value = false;
    return;
  } catch {
    if (appStore.videoMuted) {
      if (!fallbackSource.value && autoplayRetryAttempts >= MAX_AUTOPLAY_RETRIES) {
        switchToFallbackSource();
        return;
      }

      scheduleAutoplayRetry();
      return;
    }
  }
}

function bindPlayerEventListeners(player: MediaPlayerElement | null) {
  removePlayerEventListeners?.();
  removePlayerEventListeners = null;

  if (!player) {
    return;
  }

  const handleReady = () => {
    void syncPlayback();
  };
  const handleError = () => {
    switchToFallbackSource();
  };
  const handlePlay = () => {
    isPaused.value = false;
    if (!props.active) {
      void player.pause().catch(() => {
        // Ignore pause rejections before the provider is ready.
      });
    }
  };
  const handlePause = () => {
    isPaused.value = props.active;
  };

  const removeHlsLibraryBinding = useBundledHlsLibrary(player);

  player.addEventListener('loaded-metadata', handleReady);
  player.addEventListener('can-play', handleReady);
  player.addEventListener('play', handlePlay);
  player.addEventListener('pause', handlePause);
  player.addEventListener('error', handleError);

  removePlayerEventListeners = () => {
    removeHlsLibraryBinding();
    player.removeEventListener('loaded-metadata', handleReady);
    player.removeEventListener('can-play', handleReady);
    player.removeEventListener('play', handlePlay);
    player.removeEventListener('pause', handlePause);
    player.removeEventListener('error', handleError);
  };

  if (player.hasAttribute('data-can-play')) {
    void syncPlayback();
  }
}

async function toggleSound() {
  const nextMuted = !appStore.videoMuted;
  appStore.setVideoMuted(nextMuted);

  const player = playerElement.value;
  if (!player || !props.active) {
    return;
  }

  syncMuted(player, nextMuted);

  if (player.paused) {
    await syncPlayback();
  }
}

const holdSeek = useHoldToSeek({
  canStart: (event) => props.active && !isInteractiveTarget(event.target),
  getCurrentTime: () => playerElement.value?.currentTime ?? 0,
  getDuration: () => playerElement.value?.duration ?? 0,
  seekTo: (seconds) => {
    const player = playerElement.value;
    if (!player) {
      return;
    }

    try {
      player.currentTime = seconds;
    } catch {
      // Seeking before the provider is attached is a no-op.
    }
  }
});

async function togglePlayback() {
  const player = playerElement.value;
  if (!player || !props.active) {
    return;
  }

  if (player.paused) {
    await syncPlayback();
    return;
  }

  isPaused.value = true;
  void player.pause().catch(() => {
    // Ignore pause rejections before the provider is ready.
  });
}

function openImmersiveVideo() {
  const player = playerElement.value;
  const currentTime = Number.isFinite(player?.currentTime) ? player?.currentTime ?? 0 : 0;

  void player?.pause().catch(() => {
    // Ignore pause rejections before the provider is ready.
  });

  immersiveVideoStore.open(
    {
      id: props.item.id,
      filename: props.item.filename,
      thumbnailUrl: props.item.thumbnailUrl,
      previewUrl: props.item.previewUrl,
      originalUrl: props.item.originalUrl,
      streamUrl: props.item.streamUrl,
      playbackStrategy: props.item.playbackStrategy,
      width: props.item.width,
      height: props.item.height,
      durationMs: props.item.durationMs
    },
    { startTime: currentTime }
  );
}

function handleSurfaceClick(event?: MouseEvent) {
  if (event && isInteractiveTarget(event.target)) {
    return;
  }

  if (holdSeek.shouldSuppressClick() || !props.active) {
    return;
  }

  // Tapping the frame opens the immersive layer; pausing lives on its own button.
  openImmersiveVideo();
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('a, button, media-time-slider'));
}

function handleSurfaceKeydown(event: KeyboardEvent) {
  if (isInteractiveTarget(event.target)) {
    return;
  }

  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  void togglePlayback();
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      resetAutoplayRetry();
    }

    void syncPlayback();
  }
);

watch(
  () => props.item.id,
  () => {
    resetAutoplayRetry();
    fallbackSource.value = null;
    isPaused.value = false;
  }
);

watch(
  () => appStore.videoPlaybackQuality,
  () => {
    fallbackSource.value = null;
  }
);

watch(
  () => appStore.videoMuted,
  (videoMuted) => {
    const player = playerElement.value;
    if (!player) {
      return;
    }

    syncMuted(player, videoMuted);
  }
);

watch(playerElement, (player) => {
  bindPlayerEventListeners(player);
});

watch(
  () => immersiveVideoStore.isOpen,
  async (isOpen) => {
    if (!props.active) {
      return;
    }

    if (isOpen) {
      await syncPlayback();
      return;
    }

    const exitState = immersiveVideoStore.consumeExitState(props.item.id);
    const player = playerElement.value;
    if (exitState && player) {
      try {
        player.currentTime = exitState.currentTime;
      } catch {
        // Seeking before the provider is attached is a no-op.
      }
    }

    await syncPlayback();
  }
);

watch(
  currentVideoSrc,
  () => {
    if (!props.active) {
      return;
    }

    void syncPlayback();
  }
);

watch(
  () => props.prefetch,
  (prefetch) => {
    if (prefetch) {
      warmVideoStream(props.item, appStore.videoPlaybackQuality);
    }
  },
  { immediate: true }
);

onMounted(() => {
  void syncPlayback();
  if (props.active) {
    scheduleAutoplayRetry();
  }
});

onBeforeUnmount(() => {
  holdSeek.stop();
  clearAutoplayRetry();
  removePlayerEventListeners?.();
  removePlayerEventListeners = null;
  void playerElement.value?.pause().catch(() => {
    // Ignore pause rejections before the provider is ready.
  });
});
</script>

<style scoped>
.reel-player-card {
  --reel-stage-gap: 0.75rem;
  --reel-stage-inline-gap: 1.25rem;
  --reel-stage-max-width: 24.4rem;
  --reel-stage-max-height: calc(var(--reel-stage-max-width) * 16 / 9);
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: calc(var(--reel-stage-gap) / 2) 0;
}

.reel-player-card__stage {
  position: relative;
  justify-self: center;
  align-self: center;
  width: min(100%, var(--reels-desktop-stage-width, var(--reel-stage-max-width)));
  height: min(
    calc(100% - var(--reel-stage-gap)),
    var(--reels-desktop-stage-height, var(--reel-stage-max-height))
  );
  max-height: 100%;
  max-width: calc(100% - var(--reel-stage-inline-gap));
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border-radius: 0.6rem;
  background: #000;
  box-shadow: none;
}

.reel-player-card__surface {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.reel-player-card__player {
  display: block;
  width: 100%;
  height: 100%;
  color: #fff;
  background: #000;
}

.reel-player-card__player :deep(media-provider),
.reel-player-card__player :deep(media-poster),
.reel-player-card__player :deep(video),
.reel-player-card__player :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
}

.reel-player-card__player :deep(video),
.reel-player-card__player :deep(img) {
  object-fit: contain;
  background: #000;
}

.reel-player-card__pause-indicator {
  position: absolute;
  inset: 50% auto auto 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 4.25rem;
  height: 4.25rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.48);
  color: #fff;
  pointer-events: none;
  transform: translate(-50%, -50%);
  z-index: 1;
}

.reel-player-card__pause-icon {
  width: 1.45rem;
  height: 1.45rem;
}

.reel-player-card__bottom-fade {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 38%;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.76) 100%);
  pointer-events: none;
}

.reel-player-card__overlay {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 1rem 1rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.reel-player-card__overlay--visible {
  opacity: 1;
  pointer-events: auto;
}

.reel-player-card__copy {
  min-width: 0;
  max-width: calc(100% - 3.3rem);
}

.reel-player-card__controls {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: flex-end;
  justify-content: flex-end;
}

.reel-player-card__mobile-actions {
  display: none;
}

.reel-player-card__folder-row {
  display: flex;
  align-items: center;
  gap: 0.78rem;
  min-width: 0;
  width: 100%;
}

.reel-player-card__folder-link {
  color: inherit;
  text-decoration: none;
}

.reel-player-card__text {
  flex: 1 1 auto;
  min-width: 0;
}

.reel-player-card__folder-link:hover .reel-player-card__folder-name,
.reel-player-card__folder-link:focus-visible .reel-player-card__folder-name {
  text-decoration: underline;
}

.reel-player-card__folder-link:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.72);
  outline-offset: 0.25rem;
  border-radius: 0.85rem;
}

.reel-player-card__avatar {
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.reel-player-card__folder-name {
  display: block;
  overflow: hidden;
  font-size: 0.96rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.98);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reel-player-card__folder-description {
  display: block;
  margin: 0.18rem 0 0;
  overflow: hidden;
  font-size: 0.8rem;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.72);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reel-player-card__hold-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  pointer-events: none;
}

.reel-player-card__hold-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.reel-player-card__sound-button,
.reel-player-card__playback-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(230, 233, 239, 0.22);
  color: rgba(255, 255, 255, 0.96);
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    opacity 0.18s ease,
    transform 0.15s ease;
}

.reel-player-card__sound-button:hover,
.reel-player-card__playback-button:hover {
  color: #fff;
  background: rgba(230, 233, 239, 0.3);
  opacity: 0.9;
  transform: translateY(-1px);
}

.reel-player-card__sound-icon {
  width: 1rem;
  height: 1rem;
}

@media (max-width: 768px) {
  .reel-player-card {
    --reel-stage-gap: 0;
    padding: 0;
  }

  .reel-player-card__stage {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
  }

  .reel-player-card__overlay {
    display: block;
    padding: 0 4.85rem 1rem 1rem;
  }

  .reel-player-card__pause-indicator {
    width: 3.9rem;
    height: 3.9rem;
  }

  .reel-player-card__copy {
    max-width: 100%;
  }

  .reel-player-card__controls {
    position: absolute;
    right: 1rem;
    bottom: 1rem;
    display: grid;
    gap: 0.78rem;
    align-items: end;
    justify-items: center;
  }

  .reel-player-card__mobile-actions {
    display: block;
  }

  .reel-player-card__avatar {
    width: 2.15rem;
    height: 2.15rem;
  }

  .reel-player-card__sound-button,
  .reel-player-card__playback-button {
    width: 1.9rem;
    height: 1.9rem;
  }
}

/* ── Bottom seek bar ──────────────────────────────────────── */

.reel-player-card__seekbar-shell {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 4;
  pointer-events: none;
}

.reel-player-card__seekbar {
  position: relative;
  display: block;
  width: 100%;
  /* tall hit-target for comfortable scrubbing */
  height: 1.25rem;
  cursor: pointer;
  touch-action: none;
  pointer-events: auto;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

/* shared track base */
.reel-player-card__seekbar-track {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  top: auto;
  height: 2.5px;
  border-radius: 0;
  transform: none;
  transition: height 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* expand on hover/drag */
.reel-player-card__seekbar-shell:hover .reel-player-card__seekbar-track,
.reel-player-card__seekbar[data-active] .reel-player-card__seekbar-track,
.reel-player-card__seekbar[data-dragging] .reel-player-card__seekbar-track {
  height: 6px;
}

/* track layers */
.reel-player-card__seekbar .reel-player-card__seekbar-track:first-child {
  z-index: 0;
  background: rgba(255, 255, 255, 0.22);
}

.reel-player-card__seekbar-progress {
  z-index: 1;
  width: var(--slider-progress, 0%);
  background: rgba(255, 255, 255, 0.40);
  will-change: width;
}

.reel-player-card__seekbar-fill {
  z-index: 2;
  width: var(--slider-fill, 0%);
  background: #fff;
  will-change: width;
}

/* thumb — only visible on hover/drag/focus */
.reel-player-card__seekbar-thumb {
  position: absolute;
  bottom: 0;
  top: auto;
  left: var(--slider-fill, 0%);
  z-index: 3;
  width: 0.78rem;
  height: 0.78rem;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.32);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 50%);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  will-change: left;
}

.reel-player-card__seekbar-shell:hover .reel-player-card__seekbar-thumb,
.reel-player-card__seekbar[data-active] .reel-player-card__seekbar-thumb,
.reel-player-card__seekbar[data-dragging] .reel-player-card__seekbar-thumb,
.reel-player-card__seekbar[data-focus] .reel-player-card__seekbar-thumb,
.reel-player-card__seekbar:focus-visible .reel-player-card__seekbar-thumb {
  opacity: 1;
  transform: translate(-50%, 40%);
}

.reel-player-card__seekbar[data-focus] .reel-player-card__seekbar-track,
.reel-player-card__seekbar:focus-visible .reel-player-card__seekbar-track {
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.16);
}
</style>
