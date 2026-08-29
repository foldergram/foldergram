<template>
  <Teleport to="body">
    <div
      v-if="target"
      ref="layerElement"
      class="immersive-video"
      :class="{
        'immersive-video--dragging': isDragging,
        'immersive-video--rotated': isRotated
      }"
      role="dialog"
      aria-modal="true"
      :aria-label="t('post.immersive.label')"
      :style="layerStyle"
      @click.self="void requestClose()"
      @pointercancel="onPointercancel"
      @pointerdown="onPointerdown"
      @pointermove="onPointermove"
      @pointerup="onPointerup"
    >
      <div class="immersive-video__rotator">
      <div class="immersive-video__toolbar" data-swipe-ignore="true">
        <button
          class="immersive-video__button"
          type="button"
          :aria-label="t('post.immersive.close')"
          :title="t('post.immersive.close')"
          @click.stop="void requestClose()"
        >
          <span class="i-fluent-arrow-left-20-filled h-5 w-5" aria-hidden="true" />
        </button>

        <div class="immersive-video__toolbar-group">
          <button
            class="immersive-video__button"
            :class="{ 'immersive-video__button--active': isRotated }"
            type="button"
            :aria-label="t('post.immersive.rotate')"
            :title="t('post.immersive.rotate')"
            :aria-pressed="isRotated"
            @click.stop="toggleOrientation"
          >
            <span class="i-fluent-rotate-left-20-regular h-5 w-5" aria-hidden="true" />
          </button>
          <button
            class="immersive-video__button"
            :class="{ 'immersive-video__button--active': isNativeFullscreen }"
            type="button"
            :aria-label="t('post.immersive.fullscreen')"
            :title="t('post.immersive.fullscreen')"
            :aria-pressed="isNativeFullscreen"
            @click.stop="toggleFullscreen"
          >
            <span
              class="h-5 w-5"
              :class="isNativeFullscreen ? 'i-fluent-full-screen-minimize-20-regular' : 'i-fluent-full-screen-maximize-20-regular'"
              aria-hidden="true"
            />
          </button>
          <button
            class="immersive-video__button"
            :class="{ 'immersive-video__button--active': detailsOpen }"
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

      <Transition name="immersive-video-details">
        <div v-if="detailsOpen" class="immersive-video__details" data-swipe-ignore="true">
          <ImmersiveDetailsPanel
            :id="target.id"
            media-type="video"
            :filename="target.filename"
            :width="target.width"
            :height="target.height"
            :duration-ms="target.durationMs"
            @close="detailsOpen = false"
            @deleted="handleDeleted"
          />
        </div>
      </Transition>

      <div ref="stageElement" class="immersive-video__stage">
        <VideoMediaPlayer
          ref="playerComponent"
          class="immersive-video__player"
          :src="target.previewUrl ?? ''"
          :media="target"
          :original-url="target.originalUrl"
          :playback-strategy="target.playbackStrategy"
          :width="target.width"
          :height="target.height"
          :poster="target.thumbnailUrl"
          :alt="target.filename"
          :title="target.filename"
          :muted="appStore.videoMuted"
          :autoplay="!store.startPaused"
          :start-time="store.startTime"
          fullscreen-orientation="landscape"
          hold-to-seek
          :show-fullscreen-control="false"
          variant="viewer"
          @toggle-mute="appStore.setVideoMuted(!appStore.videoMuted)"
        />
      </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAppStore } from '../stores/app';
import { useImmersiveVideoStore } from '../stores/immersive-video';
import { useVerticalDismiss } from '../composables/useVerticalDismiss';
import {
  exitDocumentFullscreen,
  isDocumentFullscreen,
  requestElementFullscreen,
  unlockScreenOrientation
} from '../utils/fullscreen';
import ImmersiveDetailsPanel from './ImmersiveDetailsPanel.vue';
import VideoMediaPlayer from './VideoMediaPlayer.vue';

const { t } = useI18n();
const appStore = useAppStore();
const store = useImmersiveVideoStore();
const layerElement = ref<HTMLElement | null>(null);
const stageElement = ref<HTMLElement | null>(null);
const layerSize = ref<{ width: number; height: number } | null>(null);
let layerSizeObserver: ResizeObserver | null = null;
const playerComponent = ref<InstanceType<typeof VideoMediaPlayer> | null>(null);
const isRotated = ref(false);
const isNativeFullscreen = ref(false);
const detailsOpen = ref(false);

const target = computed(() => store.target);

const { dragOffset, isDragging, onPointercancel, onPointerdown, onPointermove, onPointerup, reset } =
  useVerticalDismiss({
    canStart: (event) => !isInteractiveTarget(event.target),
    // Rotated, the picture's "down" runs across the screen, so the swipe that closes
    // the layer has to be measured on the other axis.
    getAxis: () => (isRotated.value ? 'horizontal' : 'vertical'),
    onDismiss: () => {
      void requestClose();
    }
  });

const layerStyle = computed<Record<string, string> | undefined>(() => {
  // Published as custom properties so the rotated box can size itself against the
  // layer's real dimensions. Container query units were the first attempt and did not
  // resolve reliably on a transformed container.
  const sizeVariables: Record<string, string> = layerSize.value
    ? {
        '--immersive-layer-width': `${layerSize.value.width}px`,
        '--immersive-layer-height': `${layerSize.value.height}px`
      }
    : {};

  if (!isDragging.value || dragOffset.value === 0) {
    return Object.keys(sizeVariables).length > 0 ? sizeVariables : undefined;
  }

  // Following the finger is what makes the layer feel attached to the gesture. The
  // offset arrives in the picture's frame, so rotated it has to be played back along
  // the screen axis the finger actually travelled.
  const travel = Math.min(Math.abs(dragOffset.value), 240);
  const shift = isRotated.value
    ? `translateX(${-dragOffset.value}px)`
    : `translateY(${dragOffset.value}px)`;

  return {
    ...sizeVariables,
    transform: `${shift} scale(${1 - (travel / 240) * 0.08})`,
    opacity: String(1 - (travel / 240) * 0.35)
  };
});

function isInteractiveTarget(node: EventTarget | null): boolean {
  return (
    node instanceof Element &&
    Boolean(
      node.closest('[data-swipe-ignore="true"]') ||
        node.closest('button, a, input, media-time-slider, media-play-button, media-mute-button, media-fullscreen-button')
    )
  );
}

function getVideoElement(): HTMLVideoElement | null {
  const player = playerComponent.value?.playerElement ?? null;
  if (!player) return null;

  const direct = player.querySelector('video');
  if (direct instanceof HTMLVideoElement) return direct;

  const shadow = player.shadowRoot?.querySelector('video');
  return shadow instanceof HTMLVideoElement ? shadow : null;
}

// Rotating the picture rather than asking the platform to rotate the screen. An
// orientation lock is silently refused on iOS and only granted to a fullscreen
// document on Android, so the button used to do nothing visible and then surprise
// the viewer with a turned layout later. Turning the stage ourselves always works;
// the viewer holds the phone sideways.
function toggleOrientation() {
  isRotated.value = !isRotated.value;
}

async function toggleFullscreen() {
  if (isNativeFullscreen.value || isDocumentFullscreen()) {
    await exitDocumentFullscreen();
    isNativeFullscreen.value = false;
    return;
  }

  const entered = await requestElementFullscreen(stageElement.value, getVideoElement());
  isNativeFullscreen.value = entered && isDocumentFullscreen();

  if (!entered) {
    // No native fullscreen available: the layer already covers the viewport, so
    // rotating is the only thing left to widen the picture.
    isRotated.value = true;
  }
}

function handleDeleted() {
  detailsOpen.value = false;
  // The clip no longer exists, so there is nothing to resume behind the layer.
  store.close(null);
}

async function requestClose() {
  const exitState = target.value
    ? {
        id: target.value.id,
        currentTime: playerComponent.value?.currentTime() ?? 0,
        paused: playerComponent.value?.paused() ?? true
      }
    : null;

  // Tearing down a decoding video while the browser is still leaving fullscreen is
  // what made the return to the feed stutter. Stopping playback and releasing
  // fullscreen first leaves only a detach for the frame that unmounts the layer.
  void Promise.resolve(playerComponent.value?.pause()).catch(() => {
    // Pausing before the provider is attached is a no-op.
  });

  unlockScreenOrientation();
  isRotated.value = false;

  if (isNativeFullscreen.value || isDocumentFullscreen()) {
    await exitDocumentFullscreen();
    isNativeFullscreen.value = false;
  }

  store.close(exitState);
}

function handleFullscreenChange() {
  isNativeFullscreen.value = isDocumentFullscreen();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !isDocumentFullscreen()) {
    event.preventDefault();
    void requestClose();
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

/**
 * The rotated box is sized in pixels taken from the layer itself, so the layer's own
 * size has to be observed: on a phone the viewport changes when the URL bar hides, and
 * a stale width is exactly what makes a turned picture cover half the screen.
 */
function observeLayerSize() {
  const element = layerElement.value;
  if (!element || typeof ResizeObserver === 'undefined') {
    layerSize.value = element
      ? { width: element.clientWidth, height: element.clientHeight }
      : null;
    return;
  }

  layerSizeObserver?.disconnect();
  layerSizeObserver = new ResizeObserver(() => {
    layerSize.value = { width: element.clientWidth, height: element.clientHeight };
  });
  layerSizeObserver.observe(element);
  layerSize.value = { width: element.clientWidth, height: element.clientHeight };
}

function stopObservingLayerSize() {
  layerSizeObserver?.disconnect();
  layerSizeObserver = null;
  layerSize.value = null;
}

watch(
  () => store.isOpen,
  async (isOpen) => {
    if (isOpen) {
      isRotated.value = false;
      isNativeFullscreen.value = false;
      detailsOpen.value = false;
      lockScroll();
      document.addEventListener('keydown', handleKeydown);
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      await nextTick();
      observeLayerSize();
      return;
    }

    stopObservingLayerSize();

    reset();
    unlockScroll();
    unlockScreenOrientation();
    await exitDocumentFullscreen();
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }
);

onBeforeUnmount(() => {
  stopObservingLayerSize();
  unlockScroll();
  unlockScreenOrientation();
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
});
</script>

<style scoped>
.immersive-video {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: #000;
  overscroll-behavior: contain;
  touch-action: none;
  transition: transform 0.22s ease, opacity 0.22s ease;
}

/* Everything the viewer sees lives in here so the toolbar and the details panel turn
   with the picture. Rotating only the stage left the controls upright and pushed the
   layout off-centre. */
.immersive-video__rotator {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.immersive-video--dragging {
  transition: none;
}

.immersive-video__toolbar {
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

.immersive-video__toolbar-group {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.immersive-video__button {
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
}

.immersive-video__button--active {
  color: #38bdf8;
}

.immersive-video__details {
  position: absolute;
  top: max(3.6rem, calc(env(safe-area-inset-top) + 3.2rem));
  right: 0.85rem;
  z-index: 3;
}

.immersive-video-details-enter-active,
.immersive-video-details-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.immersive-video-details-enter-from,
.immersive-video-details-leave-to {
  opacity: 0;
  transform: translateY(-0.4rem);
}

.immersive-video__stage {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
}

.immersive-video__player {
  width: 100%;
  height: 100%;
}

/* Landscape without touching the device orientation: the whole layer takes the
   viewport's swapped dimensions and turns a quarter, so the picture fills the screen
   edge to edge once the phone is held sideways and the controls come along with it.

   The swapped dimensions come from a measurement rather than `100cqh`/`100cqw`. The
   layer carries the drag transform, and a transformed size container did not resolve
   those units on every engine, which is what left the turned picture sitting on half
   the screen. `--immersive-layer-*` is written by a ResizeObserver on the layer. */
.immersive-video--rotated .immersive-video__rotator {
  top: 50%;
  left: 50%;
  right: auto;
  bottom: auto;
  width: var(--immersive-layer-height, 100%);
  height: var(--immersive-layer-width, 100%);
  transform: translate(-50%, -50%) rotate(90deg);
  transform-origin: center;
}
</style>
