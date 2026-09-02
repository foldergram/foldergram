<template>
  <div class="rail-viewer fixed inset-0 z-[80] bg-black" @click.self="emit('close')">
    <button
      class="rail-viewer__close"
      type="button"
      aria-label="Close viewer"
      data-swipe-ignore="true"
      @click="emit('close')"
    >
      <svg class="rail-viewer__close-icon" viewBox="0 0 24 24" role="presentation">
        <path
          d="m7 7 10 10M17 7 7 17"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
        />
      </svg>
    </button>

    <section class="story-overlay">
      <div class="story-preview-slot story-preview-slot--left">
        <button
          v-if="previousCapsule"
          class="story-preview-button"
          type="button"
          :aria-label="`Open ${previousCapsule.title}`"
          @click="openCapsule(previousCapsule.id, { fromPreview: true })"
        >
          <article class="story-side-card" :style="getPreviewTransitionStyle(previousCapsule.id)">
            <ResilientImage
              class="story-side-card__image"
              :src="previousCapsule.coverImage.mediaType === 'video' ? previousCapsule.coverImage.thumbnailUrl : previousCapsule.coverImage.previewUrl"
              :alt="previousCapsule.title"
              loading="lazy"
              :retry-while="appStore.isInitialScan"
            />
            <div class="story-side-card__shade" />
            <div class="story-side-card__meta">
              <strong class="block truncate text-[0.92rem]">{{ previousCapsule.title }}</strong>
              <span class="block truncate text-[0.78rem] text-white/68">{{ formatRailItemCount(previousCapsule.imageCount) }}</span>
            </div>
          </article>
        </button>
      </div>

      <div class="story-stage-shell">
        <button
          class="story-stage__pager story-stage__pager--left"
          type="button"
          aria-label="Previous post"
          :disabled="!canGoPreviousImage"
          @click="showPreviousImage"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" role="presentation">
            <path
              d="m14.5 6.5-5 5 5 5"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
        </button>

        <article
          class="story-stage"
          :class="{ 'story-stage--capsule-switching': isCapsuleSwitching }"
          @pointercancel="swipeNavigation.onPointercancel"
          @pointerdown="swipeNavigation.onPointerdown"
          @pointermove="swipeNavigation.onPointermove"
          @pointerup="swipeNavigation.onPointerup"
        >
          <div class="story-stage__progress">
            <span
              v-for="(_, index) in progressMarkers"
              :key="index"
              class="story-stage__progress-track"
            >
              <span class="story-stage__progress-fill" :style="{ transform: `scaleX(${segmentProgress(index)})` }" />
            </span>
          </div>

          <header class="story-stage__header">
            <div class="story-stage__header-main">
              <div class="story-stage__ring">
                <div class="story-stage__ring-inner">
                  <Avatar
                    class="h-[2.55rem] w-[2.55rem]"
                    :name="activeCapsule?.title ?? railSingularLabel"
                    :src="activeCapsule?.coverImage.thumbnailUrl ?? null"
                  />
                </div>
              </div>
              <div class="min-w-0">
                <strong class="block truncate text-[0.95rem]">{{ activeCapsule?.title ?? 'Loading…' }}</strong>
                <p class="m-0 truncate text-[0.78rem] text-white/68">{{ activeCapsuleMeta }}</p>
              </div>
            </div>

            <div class="story-stage__controls">
              <a
                v-if="downloadOriginalMediaUrl"
                class="story-stage__control-button"
                :href="downloadOriginalMediaUrl"
                download
                aria-label="Download original file"
                title="Download original file"
                data-swipe-ignore="true"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" role="presentation">
                  <path
                    d="M12 4.75v9.5m0 0 3.5-3.5M12 14.25l-3.5-3.5M5.75 16.75v1.5A1.75 1.75 0 0 0 7.5 20h9a1.75 1.75 0 0 0 1.75-1.75v-1.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.8"
                  />
                </svg>
              </a>
              <button
                class="story-stage__control-button"
                type="button"
                :aria-label="isPaused ? 'Resume playback' : 'Pause playback'"
                data-swipe-ignore="true"
                @click="togglePaused"
              >
                <svg v-if="isPaused" class="h-4 w-4" viewBox="0 0 24 24" role="presentation">
                  <path d="M8 6.5v11l8.5-5.5Z" fill="currentColor" />
                </svg>
                <svg v-else class="h-4 w-4" viewBox="0 0 24 24" role="presentation">
                  <path d="M8 6.75h2.75v10.5H8zm5.25 0H16v10.5h-2.75z" fill="currentColor" />
                </svg>
              </button>
              <span class="story-stage__counter">{{ imagePositionLabel }}</span>
            </div>
          </header>

          <button
            class="story-stage__image-nav story-stage__image-nav--left"
            type="button"
            aria-label="Previous post"
            :disabled="!canGoPreviousImage"
            @click="showPreviousImage"
          />
          <button
            class="story-stage__image-nav story-stage__image-nav--right"
            type="button"
            aria-label="Next post"
            :disabled="!canGoNextImage"
            @click="showNextImage"
          />

          <div class="story-stage__surface" :style="activeStageTransitionStyle">
            <video
              v-if="displayImage?.mediaType === 'video'"
              :key="`video-${displayImage.id}`"
              ref="videoElement"
              class="story-stage__video"
              :src="displayImage.previewUrl"
              :poster="displayImage.thumbnailUrl"
              :muted="appStore.videoEffectivelyMuted"
              autoplay
              playsinline
              preload="metadata"
              @ended="handleStoryVideoEnded"
              @loadedmetadata="handleStoryVideoLoadedMetadata"
              @pause="handleStoryVideoPause"
              @play="handleStoryVideoPlay"
              @timeupdate="handleStoryVideoTimeUpdate"
            />
            <ResilientImage
              v-else-if="displayImage"
              :key="`image-${displayImage.id}`"
              class="story-stage__image"
              :src="displayImage.previewUrl"
              :alt="displayImage.filename"
              loading="eager"
              :retry-while="appStore.isInitialScan"
            />
            <div v-else class="story-stage__empty">
              Loading {{ railSingularLabel.toLowerCase() }}…
            </div>
          </div>

          <footer class="story-stage__footer">
            <div v-if="currentError" class="story-stage__error" role="alert">
              <span>{{ currentError }}</span>
              <button
                class="story-stage__error-button"
                type="button"
                data-swipe-ignore="true"
                @click="retryCurrentCapsule"
              >
                Retry
              </button>
            </div>
            <div class="grid gap-[0.18rem]">
              <strong class="text-[0.92rem]">{{ activeCapsule?.title ?? displayFolderTitle }}</strong>
              <p class="m-0 text-[0.8rem] text-white/70">{{ footerMeta }}</p>
            </div>
          </footer>
        </article>

        <button
          class="story-stage__pager story-stage__pager--right"
          type="button"
          aria-label="Next post"
          :disabled="!canGoNextImage"
          @click="showNextImage"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" role="presentation">
            <path
              d="m9.5 6.5 5 5-5 5"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
        </button>
      </div>

      <div class="story-preview-slot story-preview-slot--right">
        <button
          v-for="capsule in nextCapsules"
          :key="capsule.id"
          class="story-preview-button"
          type="button"
          :aria-label="`Open ${capsule.title}`"
          @click="openCapsule(capsule.id, { fromPreview: true })"
        >
          <article class="story-side-card story-side-card--compact" :style="getPreviewTransitionStyle(capsule.id)">
            <ResilientImage
              class="story-side-card__image"
              :src="capsule.coverImage.mediaType === 'video' ? capsule.coverImage.thumbnailUrl : capsule.coverImage.previewUrl"
              :alt="capsule.title"
              loading="lazy"
              :retry-while="appStore.isInitialScan"
            />
            <div class="story-side-card__shade" />
            <div class="story-side-card__meta">
              <strong class="block truncate text-[0.9rem]">{{ capsule.title }}</strong>
              <span class="block truncate text-[0.76rem] text-white/68">{{ formatRailItemCount(capsule.imageCount) }}</span>
            </div>
          </article>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { useHorizontalSwipe } from '../composables/useHorizontalSwipe';
import { i18n } from '../locales';
import type { FeedItem, RailCapsule, RailViewerStoreContract } from '../types/api';
import { useAppStore } from '../stores/app';
import { formatFolderTitle } from '../utils/folder-titles';
import { getOriginalMediaDownloadUrl } from '../utils/original-media';
import Avatar from './Avatar.vue';
import ResilientImage from './ResilientImage.vue';

const STORY_IMAGE_AUTO_ADVANCE_MS = 4200;
const CAPSULE_SWITCH_ANIMATION_MS = 360;
const CAPSULE_VIEW_TRANSITION_NAME = 'rail-highlight-stage';

const props = defineProps<{
  items: RailCapsule[];
  initialId: string;
  railSingularLabel: string;
  store: RailViewerStoreContract;
}>();

const emit = defineEmits<{
  close: [];
}>();

function getCurrentLocale() {
  return i18n.global.locale.value;
}

function formatRailItemCount(count: number) {
  return count === 1
    ? i18n.global.t('common.railViewer.itemCountOne', { count })
    : i18n.global.t('common.railViewer.itemCountOther', { count });
}

function formatCapsuleDateContext(capsule: RailCapsule) {
  if (capsule.latestActivityTimestamp === null) {
    return i18n.global.t('common.railViewer.noRecentActivity');
  }

  if (typeof capsule.latestActivityTimestamp === 'number' && Number.isFinite(capsule.latestActivityTimestamp) && capsule.latestActivityTimestamp > 0) {
    const date = new Intl.DateTimeFormat(getCurrentLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(capsule.latestActivityTimestamp));

    return i18n.global.t('common.railViewer.latestDate', { date });
  }

  return capsule.dateContext;
}

const appStore = useAppStore();
const activeCapsuleId = ref(props.initialId);
const activeImageIndex = ref(0);
const activeSlideDurationMs = ref(STORY_IMAGE_AUTO_ADVANCE_MS);
const activeSlideElapsedMs = ref(0);
const isPaused = ref(false);
const activeCapsuleTransitionId = ref<string | null>(null);
const transitionPending = ref(false);
const isCapsuleSwitching = ref(false);
const videoElement = ref<HTMLVideoElement | null>(null);

let previousBodyOverflow = '';
let animationFrameId = 0;
let imageAutoplayStartedAt = 0;

const activeCapsuleIndex = computed(() => props.items.findIndex((item) => item.id === activeCapsuleId.value));
const activeCapsule = computed(() => {
  if (props.store.currentCapsule?.id === activeCapsuleId.value) {
    return props.store.currentCapsule;
  }

  return props.items.find((item) => item.id === activeCapsuleId.value) ?? null;
});
const activeImages = computed(() =>
  props.store.currentCapsule?.id === activeCapsuleId.value ? props.store.currentImages : []
);
const displayImage = computed<FeedItem | null>(() => activeImages.value[activeImageIndex.value] ?? activeCapsule.value?.coverImage ?? null);
const displayFolderTitle = computed(() =>
  displayImage.value ? formatFolderTitle(displayImage.value, appStore.nestedFolderTitleFormat) : ''
);
const downloadOriginalMediaUrl = computed(() =>
  displayImage.value ? getOriginalMediaDownloadUrl(displayImage.value.id) : null
);
const totalImageCount = computed(() => Math.max(activeCapsule.value?.imageCount ?? activeImages.value.length, 1));
const previousCapsule = computed(() => {
  const index = activeCapsuleIndex.value;
  return index > 0 ? props.items[index - 1] : null;
});
const nextCapsule = computed(() => {
  const index = activeCapsuleIndex.value;
  return index >= 0 ? props.items[index + 1] ?? null : null;
});
const nextCapsules = computed(() => {
  const index = activeCapsuleIndex.value;
  return index >= 0 ? props.items.slice(index + 1, index + 3) : [];
});
const activeStageTransitionStyle = computed(() =>
  activeCapsuleTransitionId.value !== null && activeCapsuleId.value === activeCapsuleTransitionId.value
    ? { viewTransitionName: CAPSULE_VIEW_TRANSITION_NAME }
    : undefined
);
const progressMarkers = computed(() => Array.from({ length: totalImageCount.value }));
const imagePositionLabel = computed(() => `${Math.min(activeImageIndex.value + 1, totalImageCount.value)}/${totalImageCount.value}`);
const activeCapsuleMeta = computed(() => {
  if (!activeCapsule.value) {
    return '';
  }

  return `${formatRailItemCount(activeCapsule.value.imageCount)} · ${formatCapsuleDateContext(activeCapsule.value)}`;
});
const currentError = computed(() => props.store.currentError ?? null);
const footerMeta = computed(() => {
  if (!displayImage.value) {
    return '';
  }

  return new Intl.DateTimeFormat(getCurrentLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(displayImage.value.takenAt ?? displayImage.value.sortTimestamp));
});
const canGoPreviousImage = computed(() => !transitionPending.value && activeImages.value.length > 0 && activeImageIndex.value > 0);
const canGoNextImage = computed(
  () =>
    !transitionPending.value &&
    activeImages.value.length > 0 &&
    (activeImageIndex.value < activeImages.value.length - 1 || props.store.currentHasMore || nextCapsule.value !== null)
);
const swipeNavigation = useHorizontalSwipe({
  canStart: canStartStageSwipe,
  isEnabled: () => !transitionPending.value && activeImages.value.length > 0,
  onSwipeLeft: () => {
    void showNextImage();
  },
  onSwipeRight: () => {
    void showPreviousImage();
  }
});

watch(
  () => props.initialId,
  async (id) => {
    await openCapsule(id);
  }
);

watch(
  () => [displayImage.value?.id ?? null, activeCapsuleId.value] as const,
  () => {
    syncAutoplayForCurrentImage();
    void nextTick(() => {
      syncMediaPlayback();
    });
  }
);

watch(
  () => activeImages.value.length,
  (length) => {
    if (length === 0) {
      activeImageIndex.value = 0;
      return;
    }

    if (activeImageIndex.value >= length) {
      activeImageIndex.value = length - 1;
    }
  }
);

function segmentProgress(index: number) {
  if (index < activeImageIndex.value) {
    return 1;
  }

  if (index > activeImageIndex.value) {
    return 0;
  }

  if (activeSlideDurationMs.value <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(activeSlideElapsedMs.value / activeSlideDurationMs.value, 1));
}

function stopAutoplay() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
}

function resolveStoryDurationMs(image: FeedItem | null) {
  if (!image) {
    return STORY_IMAGE_AUTO_ADVANCE_MS;
  }

  if (image.mediaType === 'video' && typeof image.durationMs === 'number' && image.durationMs > 0) {
    return image.durationMs;
  }

  return STORY_IMAGE_AUTO_ADVANCE_MS;
}

function syncStoryVideoTiming(player: HTMLVideoElement | null = videoElement.value) {
  if (!player || displayImage.value?.mediaType !== 'video') {
    return;
  }

  const durationMs = Number.isFinite(player.duration) && player.duration > 0
    ? player.duration * 1000
    : resolveStoryDurationMs(displayImage.value);

  activeSlideDurationMs.value = durationMs;

  if (Number.isFinite(player.currentTime) && player.currentTime >= 0) {
    activeSlideElapsedMs.value = Math.min(durationMs, player.currentTime * 1000);
  }
}

function startImageAutoplay() {
  stopAutoplay();

  if (!displayImage.value || displayImage.value.mediaType !== 'image' || isPaused.value) {
    return;
  }

  imageAutoplayStartedAt = performance.now() - activeSlideElapsedMs.value;

  const tick = async (now: number) => {
    activeSlideElapsedMs.value = Math.min(activeSlideDurationMs.value, now - imageAutoplayStartedAt);

    if (activeSlideElapsedMs.value >= activeSlideDurationMs.value) {
      stopAutoplay();
      await showNextImageFromAutoplay();
      return;
    }

    animationFrameId = requestAnimationFrame(tick);
  };

  animationFrameId = requestAnimationFrame(tick);
}

function syncAutoplayForCurrentImage() {
  stopAutoplay();
  activeSlideElapsedMs.value = 0;
  activeSlideDurationMs.value = resolveStoryDurationMs(displayImage.value);

  if (displayImage.value?.mediaType === 'image') {
    startImageAutoplay();
  }
}

function togglePaused() {
  if (!displayImage.value) {
    return;
  }

  isPaused.value = !isPaused.value;

  if (isPaused.value) {
    stopAutoplay();
    syncMediaPlayback();
    return;
  }

  if (displayImage.value.mediaType === 'image') {
    startImageAutoplay();
  }

  syncMediaPlayback();
}

function canStartStageSwipe(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return true;
  }

  return !target.closest('[data-swipe-ignore="true"]');
}

function supportsViewTransitions() {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

function getPreviewTransitionStyle(capsuleId: string) {
  if (activeCapsuleTransitionId.value === capsuleId && activeCapsuleId.value !== capsuleId) {
    return {
      viewTransitionName: CAPSULE_VIEW_TRANSITION_NAME
    };
  }

  return undefined;
}

async function ensureCapsuleLoaded(id: string, reset = true) {
  stopAutoplay();
  activeCapsuleId.value = id;

  if (reset) {
    activeImageIndex.value = 0;
  }

  await loadCapsuleData(id, reset);
}

async function loadCapsuleData(id: string, reset = true) {
  transitionPending.value = true;

  try {
    await props.store.loadCapsule(id, reset);
  } finally {
    transitionPending.value = false;
  }
}

async function runCapsuleTransition(id: string) {
  activeCapsuleTransitionId.value = id;

  if (!supportsViewTransitions()) {
    isCapsuleSwitching.value = true;
    stopAutoplay();
    activeCapsuleId.value = id;
    activeImageIndex.value = 0;
    await nextTick();
    window.setTimeout(() => {
      isCapsuleSwitching.value = false;
      activeCapsuleTransitionId.value = null;
    }, CAPSULE_SWITCH_ANIMATION_MS);
    await loadCapsuleData(id, true);
    return;
  }

  const transition = (document as Document & {
    startViewTransition: (updateCallback: () => Promise<void> | void) => { finished: Promise<void> };
  }).startViewTransition(async () => {
    stopAutoplay();
    activeCapsuleId.value = id;
    activeImageIndex.value = 0;
    await nextTick();
  });

  const clearTransitionVisuals = () => {
    activeCapsuleTransitionId.value = null;
  };

  transition.finished.then(clearTransitionVisuals).catch(clearTransitionVisuals);
  await loadCapsuleData(id, true);
}

async function openCapsule(id: string, options: { fromPreview?: boolean } = {}) {
  if (transitionPending.value) {
    return;
  }

  if (id === activeCapsuleId.value && activeImages.value.length > 0) {
    return;
  }

  if (options.fromPreview) {
    await runCapsuleTransition(id);
    return;
  }

  await ensureCapsuleLoaded(id, true);
}

async function showNextImage() {
  await showNextImageInternal(false);
}

async function showNextImageFromAutoplay() {
  await showNextImageInternal(true);
}

async function showNextImageInternal(fromAutoplay: boolean) {
  if (transitionPending.value) {
    return;
  }

  if (activeImageIndex.value < activeImages.value.length - 1) {
    activeImageIndex.value += 1;
    return;
  }

  if (props.store.currentHasMore) {
    transitionPending.value = true;
    stopAutoplay();
    const previousLength = activeImages.value.length;

    try {
      await props.store.loadCapsule(activeCapsuleId.value, false);
    } finally {
      transitionPending.value = false;
    }

    if (activeImages.value.length > previousLength) {
      activeImageIndex.value = previousLength;
      return;
    }
  }

  if (nextCapsule.value) {
    await openCapsule(nextCapsule.value.id, { fromPreview: true });
    return;
  }

  if (fromAutoplay) {
    activeSlideElapsedMs.value = activeSlideDurationMs.value;
  }
}

async function showPreviousImage() {
  if (transitionPending.value) {
    return;
  }

  if (activeImageIndex.value > 0) {
    activeImageIndex.value -= 1;
  }
}

async function retryCurrentCapsule() {
  if (transitionPending.value) {
    return;
  }

  await loadCapsuleData(activeCapsuleId.value, activeImages.value.length === 0);
}

async function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    await showNextImage();
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    await showPreviousImage();
    return;
  }

  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    togglePaused();
  }
}

function syncMediaPlayback() {
  const player = videoElement.value;
  if (!player || displayImage.value?.mediaType !== 'video') {
    return;
  }

  syncStoryVideoMuted(player, appStore.videoEffectivelyMuted);

  if (isPaused.value) {
    player.pause();
    return;
  }

  void player.play().catch(() => {
    // An audible autoplay refusal is a document-wide verdict, so it is recorded in
    // the store and the story retries muted instead of silently staying stuck.
    if (appStore.videoEffectivelyMuted) {
      return;
    }

    const blocked = appStore.reportAudibleAutoplayBlocked();
    player.muted = blocked ? true : appStore.videoEffectivelyMuted;
    void player.play().then(() => {
      syncStoryVideoMuted(player, appStore.videoEffectivelyMuted);
    }).catch(() => {
      // Ignore autoplay rejections so the viewer can continue advancing.
    });
  });
}

function syncStoryVideoMuted(player: HTMLVideoElement, muted: boolean) {
  player.muted = muted;
}

watch(
  () => [appStore.videoEffectivelyMuted, appStore.videoSoundGeneration] as const,
  ([effectivelyMuted]) => {
    const player = videoElement.value;
    if (player) {
      syncStoryVideoMuted(player, effectivelyMuted);
    }
  }
);

function handleStoryVideoLoadedMetadata() {
  syncStoryVideoTiming();
}

function handleStoryVideoTimeUpdate() {
  syncStoryVideoTiming();
}

function handleStoryVideoPlay() {
  isPaused.value = false;
  syncStoryVideoTiming();
}

function handleStoryVideoPause() {
  if (displayImage.value?.mediaType !== 'video') {
    return;
  }

  if (videoElement.value?.ended) {
    return;
  }

  isPaused.value = true;
  syncStoryVideoTiming();
}

async function handleStoryVideoEnded() {
  if (displayImage.value?.mediaType !== 'video') {
    return;
  }

  activeSlideElapsedMs.value = activeSlideDurationMs.value;
  await showNextImageFromAutoplay();
}

function lockBodyScroll() {
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  document.body.style.overflow = previousBodyOverflow;
}

onMounted(async () => {
  lockBodyScroll();
  window.addEventListener('keydown', handleKeydown);
  await ensureCapsuleLoaded(props.initialId, true);
  await nextTick();
  syncAutoplayForCurrentImage();
  syncMediaPlayback();
});

onUnmounted(() => {
  stopAutoplay();
  unlockBodyScroll();
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.rail-viewer {
  background: #000;
  backdrop-filter: none;
  min-height: 100vh;
  min-height: 100dvh;
}

.rail-viewer__close {
  position: absolute;
  top: max(1rem, env(safe-area-inset-top));
  right: max(1rem, env(safe-area-inset-right));
  z-index: 6;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 34px rgba(0, 0, 0, 0.28);
  color: #fff;
  transition: transform 150ms ease, background-color 150ms ease, border-color 150ms ease;
}

.rail-viewer__close:hover {
  background: rgba(0, 0, 0, 0.58);
  border-color: rgba(255, 255, 255, 0.24);
  transform: translateY(-1px);
}

.rail-viewer__close-icon {
  width: 1.3rem;
  height: 1.3rem;
}

.story-overlay {
  display: grid;
  height: 100%;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
  padding: 1.25rem;
  grid-template-columns: minmax(0, 1fr);
}

.story-preview-slot {
  display: none;
  min-height: 0;
}

.story-preview-slot--right {
  justify-content: flex-start;
  gap: 1rem;
}

.story-preview-button {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  transition: transform 180ms ease, opacity 180ms ease;
}

.story-preview-button:hover {
  transform: scale(1.02);
}

.story-side-card {
  position: relative;
  width: 11rem;
  height: 19rem;
  overflow: hidden;
  border-radius: 0.9rem;
  opacity: 0.82;
}

.story-side-card--compact {
  width: 9rem;
  height: 16rem;
}

.story-side-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.story-side-card__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.72));
}

.story-side-card__meta {
  position: absolute;
  inset: auto 0 0 0;
  padding: 0.9rem;
}

.story-stage-shell {
  display: grid;
  width: min(100%, 34rem);
  justify-self: center;
  align-items: center;
  grid-template-columns: minmax(0, 1fr);
}

.story-stage {
  position: relative;
  justify-self: center;
  width: min(100%, 28rem);
  height: min(calc(100vh - 2.5rem), 44rem);
  height: min(calc(100dvh - 2.5rem), 44rem);
  overflow: hidden;
  border-radius: 1rem;
  background: #000;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.56);
  touch-action: pan-y pinch-zoom;
}

.story-stage--capsule-switching {
  animation: capsule-stage-switch 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

.story-stage__pager {
  display: none;
  align-items: center;
  justify-content: center;
  width: 2.85rem;
  height: 2.85rem;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  cursor: pointer;
  transition: opacity 150ms ease, transform 150ms ease, background-color 150ms ease;
}

.story-stage__pager:hover {
  background: rgba(255, 255, 255, 0.26);
  transform: scale(1.04);
}

.story-stage__pager:disabled {
  opacity: 0.24;
  cursor: default;
  transform: none;
}

.story-stage__surface {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.story-stage__image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.story-stage__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.story-stage__empty {
  color: rgba(255, 255, 255, 0.62);
}

.story-stage__progress {
  position: absolute;
  left: 0.9rem;
  right: 0.9rem;
  top: 0.9rem;
  z-index: 3;
  display: flex;
  gap: 0.35rem;
}

.story-stage__progress-track {
  height: 0.2rem;
  flex: 1;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}

.story-stage__progress-fill {
  display: block;
  height: 100%;
  width: 100%;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.98);
  transform-origin: left center;
}

.story-stage__header {
  position: absolute;
  inset: 1.55rem 0.95rem auto 0.95rem;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.9rem;
}

.story-stage__header-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.75rem;
}

.story-stage__controls {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.story-stage__control-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: rgba(0, 0, 0, 0.26);
  color: #fff;
  cursor: pointer;
  transition: background-color 150ms ease, opacity 150ms ease;
}

.story-stage__control-button:hover {
  background: rgba(0, 0, 0, 0.4);
}

.story-stage__counter {
  flex-shrink: 0;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.68);
  letter-spacing: 0.01em;
}

.story-stage__ring {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px;
  background: var(--story-ring);
}

.story-stage__ring-inner {
  border-radius: 999px;
  padding: 2px;
  background: #050608;
}

.story-stage__image-nav {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 32%;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.story-stage__image-nav:disabled {
  cursor: default;
}

.story-stage__image-nav--left {
  left: 0;
}

.story-stage__image-nav--right {
  right: 0;
}

.story-stage__footer {
  position: absolute;
  inset: auto 0 0 0;
  z-index: 3;
  padding: 5rem 1rem 1rem;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.8) 44%, rgba(0, 0, 0, 0.96));
}

.story-stage__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(255, 122, 122, 0.3);
  border-radius: 0.9rem;
  background: rgba(133, 20, 20, 0.34);
  color: rgba(255, 235, 235, 0.96);
  font-size: 0.8rem;
  line-height: 1.45;
}

.story-stage__error-button {
  flex-shrink: 0;
  border: 0;
  border-radius: 999px;
  padding: 0.45rem 0.8rem;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.story-stage__error-button:hover {
  background: rgba(255, 255, 255, 0.22);
}

@media (max-width: 768px) {
  .rail-viewer__close {
    top: max(0.2rem, env(safe-area-inset-top));
    right: max(0.35rem, env(safe-area-inset-right));
    left: auto;
    width: 2.3rem;
    height: 2.3rem;
  }

  .rail-viewer__close-icon {
    width: 0.98rem;
    height: 0.98rem;
  }

  .story-overlay {
    padding:
      max(1.95rem, calc(env(safe-area-inset-top) + 2.2rem))
      0.9rem
      max(0.8rem, env(safe-area-inset-bottom))
      0.9rem;
  }

  .story-stage__progress {
    top: 0.68rem;
  }

  .story-stage__header {
    inset: 1.22rem 0.85rem auto 0.85rem;
  }
}

@media (min-width: 1024px) and (orientation: landscape) {
  .story-overlay {
    grid-template-columns: minmax(0, 11rem) minmax(0, 34rem) minmax(0, 22rem);
  }

  .story-preview-slot {
    display: flex;
  }

  .story-preview-slot--left {
    justify-content: flex-end;
  }

  .story-stage-shell {
    grid-template-columns: 2.85rem minmax(0, 28rem) 2.85rem;
    gap: 0.85rem;
  }

  .story-stage__pager {
    display: inline-flex;
  }
}

@media (min-width: 769px) and (orientation: portrait) {
  .story-overlay {
    grid-template-columns: clamp(4.5rem, 11vw, 6.75rem) minmax(0, 1fr) clamp(4.5rem, 11vw, 6.75rem);
    gap: clamp(0.8rem, 1.8vw, 1.35rem);
    padding:
      clamp(1.25rem, 2.6vh, 2.25rem)
      clamp(0.55rem, 1.8vw, 1rem);
  }

  .story-preview-slot {
    display: flex;
    align-items: center;
    overflow: hidden;
  }

  .story-preview-slot--left {
    justify-content: flex-end;
  }

  .story-preview-slot--right {
    justify-content: flex-start;
    gap: 0.75rem;
  }

  .story-stage-shell {
    width: min(100%, 40rem);
    grid-template-columns: 2.5rem minmax(0, 1fr) 2.5rem;
    gap: 0.55rem;
  }

  .story-stage {
    width: min(100%, 34rem, 52vh, calc(100vw - 11rem));
    width: min(100%, 34rem, 52dvh, calc(100vw - 11rem));
    height: auto;
    aspect-ratio: 9 / 16;
  }

  .story-stage__pager {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
  }

  .story-side-card {
    width: 14.25rem;
    height: 25.35rem;
  }

  .story-side-card--compact {
    width: 12rem;
    height: 21.3rem;
  }
}

@keyframes capsule-stage-switch {
  0% {
    opacity: 0.3;
    transform: scale(0.9);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}

:global(::view-transition-group(rail-highlight-stage)) {
  animation-duration: 420ms;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}

:global(::view-transition-old(rail-highlight-stage)),
:global(::view-transition-new(rail-highlight-stage)) {
  border-radius: 1rem;
  overflow: clip;
}
</style>
