<template>
  <canvas
    v-if="capturedFrame"
    ref="canvasElement"
    class="video-first-frame"
    :aria-label="alt"
    role="img"
  />
  <video
    v-else
    ref="videoElement"
    class="video-first-frame__probe"
    :src="src"
    muted
    playsinline
    preload="metadata"
    aria-hidden="true"
    @loadeddata="captureFrame"
    @seeked="captureFrame"
    @error="handleError"
  />
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{ src: string; alt: string }>();
const videoElement = ref<HTMLVideoElement | null>(null);
const canvasElement = ref<HTMLCanvasElement | null>(null);
const capturedFrame = ref(false);
let captureAttempted = false;
let bitmap: HTMLCanvasElement | null = null;

function captureFrame() {
  const video = videoElement.value;
  if (!video || captureAttempted || video.videoWidth <= 0 || video.videoHeight <= 0) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return;

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    captureAttempted = true;
    bitmap = canvas;
    capturedFrame.value = true;
    void nextTick(() => {
      const target = canvasElement.value;
      if (!target || !bitmap) return;
      target.width = bitmap.width;
      target.height = bitmap.height;
      target.getContext('2d')?.drawImage(bitmap, 0, 0);
    });
  } catch {
    // Unsupported/cross-origin media keeps the normal poster/player fallback.
  }
}

function handleError() {
  captureAttempted = true;
}

function reset() {
  captureAttempted = false;
  bitmap = null;
  capturedFrame.value = false;
}

watch(() => props.src, reset);
onBeforeUnmount(() => videoElement.value?.pause());
</script>

<style scoped>
.video-first-frame {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-first-frame__probe {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
