<template>
  <div
    class="relative h-full w-full overflow-hidden bg-surface-alt outline-none select-none"
    :style="{ aspectRatio }"
    role="group"
    aria-roledescription="carousel"
    :aria-label="t('post.carousel.label', { count: items.length })"
    tabindex="0"
    @keydown.left="handleKeyLeft"
    @keydown.right="handleKeyRight"
    @pointercancel.stop="cancelPointer"
    @pointerdown.stop="startPointer"
    @pointerup.stop="finishPointer"
  >
    <template v-for="(item, index) in items" :key="item.imageId">
      <VideoMediaPlayer
        v-if="item.mediaType === 'video' && index === activeIndex"
        class="h-full w-full object-contain bg-black"
        :src="item.previewUrl"
        :media="toVideoPlaybackMedia(item)"
        :original-url="item.originalUrl"
        :playback-strategy="item.playbackStrategy"
        :width="item.width"
        :height="item.height"
        :poster="item.thumbnailUrl"
        :alt="item.filename"
        :muted="appStore.videoMuted"
        :autoplay="autoplay"
        variant="viewer"
        @toggle-mute="appStore.setVideoMuted(!appStore.videoMuted)"
      />
      <ResilientImage
        v-else-if="index === activeIndex"
        class="h-full w-full object-contain cursor-zoom-in"
        :src="item.isAnimated ? item.previewUrl : (preferPreview ? item.previewUrl : item.thumbnailUrl)"
        :fallback-src="item.originalUrl"
        :alt="item.filename"
        :width="item.width"
        :height="item.height"
        :loading="loading"
        :retry-while="retryWhile"
        draggable="false"
        @click="openImmersiveImage(item)"
      />
    </template>

    <button
      v-if="activeIndex > 0"
      class="absolute left-3 top-1/2 z-2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-black/55 text-white shadow-lg cursor-pointer"
      type="button"
      :aria-label="t('post.carousel.previousItem')"
      data-swipe-ignore="true"
      @click.stop="previous"
    >
      <span class="i-fluent-chevron-left-20-filled h-5 w-5" aria-hidden="true" />
    </button>
    <button
      v-if="activeIndex < items.length - 1"
      class="absolute right-3 top-1/2 z-2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-black/55 text-white shadow-lg cursor-pointer"
      type="button"
      :aria-label="t('post.carousel.nextItem')"
      data-swipe-ignore="true"
      @click.stop="next"
    >
      <span class="i-fluent-chevron-right-20-filled h-5 w-5" aria-hidden="true" />
    </button>

    <div
      class="absolute right-3 top-3 z-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white"
      aria-live="polite"
      data-swipe-ignore="true"
    >
      {{ t('post.carousel.position', { current: activeIndex + 1, count: items.length }) }}
    </div>
    <div
      v-if="items.length <= 10"
      class="absolute inset-x-0 bottom-3 z-2 flex justify-center gap-1.5 pointer-events-none"
      aria-hidden="true"
    >
      <span
        v-for="(_, index) in items"
        :key="index"
        class="h-1.5 w-1.5 rounded-full shadow"
        :class="index === activeIndex ? 'bg-white' : 'bg-white/45'"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { PostMediaItem } from '../types/api';
import { useAppStore } from '../stores/app';
import { useImmersiveImageStore } from '../stores/immersive-image';
import { getOriginalMediaUrl } from '../utils/original-media';
import type { VideoPlaybackMedia } from '../utils/video-playback';
import ResilientImage from './ResilientImage.vue';
import VideoMediaPlayer from './VideoMediaPlayer.vue';

const props = withDefaults(
  defineProps<{
    items: PostMediaItem[];
    modelValue?: number;
    preferPreview?: boolean;
    retryWhile?: boolean;
    loading?: 'eager' | 'lazy';
    muted?: boolean;
    autoplay?: boolean;
  }>(),
  {
    modelValue: 0,
    preferPreview: false,
    retryWhile: false,
    loading: 'lazy',
    muted: true,
    autoplay: false
  }
);

const emit = defineEmits<{
  'update:modelValue': [index: number];
}>();

const { t } = useI18n();
const appStore = useAppStore();
const immersiveImageStore = useImmersiveImageStore();
const pointerId = ref<number | null>(null);
const pointerStartX = ref(0);

const activeIndex = computed(() => Math.min(Math.max(props.modelValue, 0), Math.max(props.items.length - 1, 0)));
const frameItem = computed(() => props.items[0]);
const aspectRatio = computed(() =>
  frameItem.value
    ? `${Math.max(frameItem.value.width, 1)} / ${Math.max(frameItem.value.height, 1)}`
    : '1 / 1'
);

function toVideoPlaybackMedia(item: PostMediaItem): VideoPlaybackMedia {
  return {
    id: item.imageId,
    filename: item.filename,
    playbackStrategy: item.playbackStrategy,
    streamUrl: item.streamUrl,
    originalUrl: item.originalUrl,
    previewUrl: item.previewUrl,
    previewFileUrl: item.previewFileUrl
  };
}

function openImmersiveImage(item: PostMediaItem) {
  immersiveImageStore.open({
    id: item.imageId,
    filename: item.filename,
    thumbnailUrl: item.thumbnailUrl,
    fullUrl: item.originalUrl ?? getOriginalMediaUrl(item.imageId),
    width: item.width,
    height: item.height
  });
}

function isGestureIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-swipe-ignore="true"]') ||
    target.closest('button, input, select, textarea, a, media-play-button, media-mute-button, media-fullscreen-button, media-time-slider')
  );
}

function setIndex(index: number) {
  const nextIndex = Math.min(Math.max(index, 0), Math.max(props.items.length - 1, 0));
  if (nextIndex !== activeIndex.value) emit('update:modelValue', nextIndex);
}

function previous() {
  setIndex(activeIndex.value - 1);
}

function next() {
  setIndex(activeIndex.value + 1);
}

function handleKeyLeft(event: KeyboardEvent) {
  if (isGestureIgnored(event.target)) {
    event.stopPropagation();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  previous();
}

function handleKeyRight(event: KeyboardEvent) {
  if (isGestureIgnored(event.target)) {
    event.stopPropagation();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  next();
}

function startPointer(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (isGestureIgnored(event.target)) return;
  pointerId.value = event.pointerId;
  pointerStartX.value = event.clientX;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function finishPointer(event: PointerEvent) {
  if (pointerId.value !== event.pointerId) return;
  const distance = event.clientX - pointerStartX.value;
  if (Math.abs(distance) >= 48) distance > 0 ? previous() : next();
  cancelPointer();
}

function cancelPointer() {
  pointerId.value = null;
}

watch(
  () => props.items.map((item) => item.imageId).join(','),
  () => {
    if (activeIndex.value >= props.items.length) emit('update:modelValue', 0);
  }
);
</script>
