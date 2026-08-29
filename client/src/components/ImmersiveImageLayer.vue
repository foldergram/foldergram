<template>
  <Teleport to="body">
    <div
      v-if="target"
      class="immersive-image"
      role="dialog"
      aria-modal="true"
      :aria-label="t('post.immersive.imageLabel')"
      :style="backdropStyle"
    >
      <div class="immersive-image__toolbar">
        <button
          class="immersive-image__button"
          type="button"
          :aria-label="t('post.immersive.close')"
          :title="t('post.immersive.close')"
          @click="store.close()"
        >
          <span class="i-fluent-arrow-left-20-filled h-5 w-5" aria-hidden="true" />
        </button>

        <div class="immersive-image__toolbar-group">
          <button
            class="immersive-image__button"
            :class="{ 'immersive-image__button--active': zoom.isZoomed.value }"
            type="button"
            :aria-label="t('post.immersive.zoom')"
            :title="t('post.immersive.zoom')"
            :aria-pressed="zoom.isZoomed.value"
            @click="zoom.toggleZoom"
          >
            <span
              class="h-5 w-5"
              :class="zoom.isZoomed.value ? 'i-fluent-zoom-out-20-regular' : 'i-fluent-zoom-in-20-regular'"
              aria-hidden="true"
            />
          </button>
          <a
            class="immersive-image__button"
            :href="downloadUrl"
            :aria-label="t('post.viewer.downloadOriginalFile')"
            :title="t('post.viewer.downloadOriginalFile')"
            download
          >
            <span class="i-fluent-arrow-download-20-regular h-5 w-5" aria-hidden="true" />
          </a>
          <button
            class="immersive-image__button"
            :class="{ 'immersive-image__button--active': detailsOpen }"
            type="button"
            :aria-label="t('post.immersive.details')"
            :title="t('post.immersive.details')"
            :aria-pressed="detailsOpen"
            @click.stop="detailsOpen = !detailsOpen"
          >
            <span
              class="h-5 w-5"
              :class="detailsOpen ? 'i-fluent-info-16-filled' : 'i-fluent-info-16-regular'"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <Transition name="immersive-image-details">
        <div v-if="detailsOpen" class="immersive-image__details">
          <ImmersiveDetailsPanel
            :id="target.id"
            media-type="image"
            :filename="target.filename"
            :width="target.width"
            :height="target.height"
            @close="detailsOpen = false"
            @deleted="handleDeleted"
          />
        </div>
      </Transition>

      <div
        class="immersive-image__stage"
        @pointercancel="zoom.onPointercancel"
        @pointerdown="zoom.onPointerdown"
        @pointermove="zoom.onPointermove"
        @pointerup="zoom.onPointerup"
        @wheel="zoom.onWheel"
      >
        <img
          class="immersive-image__media"
          :class="{ 'immersive-image__media--panning': zoom.isPanning.value }"
          :src="displayedSrc"
          :alt="target.filename"
          :style="{ transform: zoom.transform.value }"
          draggable="false"
        />
      </div>

      <div v-if="captionText" class="immersive-image__caption">
        <p class="immersive-image__caption-text">{{ captionText }}</p>
        <p class="immersive-image__caption-meta">{{ metaText }}</p>
      </div>
      <div v-else class="immersive-image__caption">
        <p class="immersive-image__caption-meta">{{ metaText }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useImmersiveImageStore } from '../stores/immersive-image';
import { usePinchZoom } from '../composables/usePinchZoom';
import { getOriginalMediaDownloadUrl } from '../utils/original-media';
import ImmersiveDetailsPanel from './ImmersiveDetailsPanel.vue';

const { t } = useI18n();
const store = useImmersiveImageStore();
const fullImageReady = ref(false);
const detailsOpen = ref(false);

function handleDeleted() {
  detailsOpen.value = false;
  store.close();
}

const target = computed(() => store.target);
const downloadUrl = computed(() => (target.value ? getOriginalMediaDownloadUrl(target.value.id) : '#'));
const captionText = computed(() => target.value?.caption?.trim() || '');
const metaText = computed(() => {
  const current = target.value;
  if (!current) return '';

  const dimensions = current.width > 0 && current.height > 0 ? `${current.width} x ${current.height}` : '';
  return [current.filename, dimensions].filter(Boolean).join('  ·  ');
});

// The thumbnail is already decoded, so showing it first avoids a blank frame while
// the full-size file arrives.
const displayedSrc = computed(() => {
  const current = target.value;
  if (!current) return '';
  return fullImageReady.value ? current.fullUrl : current.thumbnailUrl;
});

const zoom = usePinchZoom({
  onDismiss: () => store.close()
});

const backdropStyle = computed(() => {
  if (zoom.isZoomed.value || zoom.offset.value.y === 0) {
    return undefined;
  }

  const travel = Math.min(Math.abs(zoom.offset.value.y), 240);
  return { background: `rgba(0, 0, 0, ${(1 - (travel / 240) * 0.5).toFixed(3)})` };
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    store.close();
  }
}

function lockScroll() {
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

watch(
  () => store.target?.fullUrl ?? null,
  (fullUrl) => {
    fullImageReady.value = false;
    if (!fullUrl || typeof Image === 'undefined') {
      return;
    }

    const loader = new Image();
    loader.decoding = 'async';
    loader.addEventListener('load', () => {
      if (store.target?.fullUrl === fullUrl) {
        fullImageReady.value = true;
      }
    });
    loader.src = fullUrl;
  },
  { immediate: true }
);

watch(
  () => store.isOpen,
  (isOpen) => {
    if (isOpen) {
      zoom.reset();
      detailsOpen.value = false;
      lockScroll();
      document.addEventListener('keydown', handleKeydown);
      return;
    }

    unlockScroll();
    document.removeEventListener('keydown', handleKeydown);
  }
);

onBeforeUnmount(() => {
  unlockScroll();
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.immersive-image {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.94);
  overscroll-behavior: contain;
  touch-action: none;
}

.immersive-image__toolbar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: max(0.65rem, env(safe-area-inset-top)) 0.85rem 0.65rem;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 100%);
}

.immersive-image__toolbar-group {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.immersive-image__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.35rem;
  height: 2.35rem;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.42);
  color: white;
  cursor: pointer;
  text-decoration: none;
}

.immersive-image__button--active {
  color: #38bdf8;
}

.immersive-image__details {
  position: absolute;
  top: max(3.6rem, calc(env(safe-area-inset-top) + 3.2rem));
  right: 0.85rem;
  z-index: 3;
}

.immersive-image-details-enter-active,
.immersive-image-details-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.immersive-image-details-enter-from,
.immersive-image-details-leave-to {
  opacity: 0;
  transform: translateY(-0.4rem);
}

.immersive-image__stage {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
}

.immersive-image__media {
  max-width: 100%;
  max-height: 100%;
  /* Long press must reach the browser so "save image" still works. */
  user-select: none;
  transition: transform 0.18s ease-out;
  will-change: transform;
}

.immersive-image__media--panning {
  transition: none;
}

.immersive-image__caption {
  padding: 0.75rem 1rem max(0.9rem, env(safe-area-inset-bottom));
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0) 100%);
  color: rgba(255, 255, 255, 0.92);
}

.immersive-image__caption-text {
  margin: 0 0 0.25rem;
  font-size: 0.9rem;
  line-height: 1.4;
}

.immersive-image__caption-meta {
  margin: 0;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.66);
}
</style>
