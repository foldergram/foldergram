<template>
  <div
    class="video-progress-footer"
    :class="`video-progress-footer--${variant}`"
    data-swipe-ignore="true"
    @pointerdown.stop
    @pointermove.stop
    @pointerup.stop
    @pointercancel.stop
  >
    <div class="video-progress-footer__meta">
      <div class="video-progress-footer__slot video-progress-footer__slot--leading">
        <slot name="leading" />
        <span class="video-progress-footer__time">{{ timeLabel }}</span>
      </div>
      <div class="video-progress-footer__slot video-progress-footer__slot--trailing">
        <slot name="trailing" />
      </div>
    </div>

    <div class="video-progress-footer__timeline-shell">
      <div
        v-if="seekOrientation"
        ref="controlledSlider"
        class="vds-slider vds-time-slider video-progress-footer__slider"
        role="slider"
        tabindex="0"
        aria-label="Seek video"
        :aria-valuemin="0"
        :aria-valuemax="Math.max(duration, 0)"
        :aria-valuenow="Math.min(Math.max(displayedTime, 0), Math.max(duration, 0))"
        @keydown="handleControlledSliderKeydown"
        @pointercancel="cancelControlledSeek"
        @pointerdown="beginControlledSeek"
        @pointermove="moveControlledSeek"
        @pointerup="endControlledSeek"
      >
        <div class="vds-slider-track video-progress-footer__track" />
        <div
          class="vds-slider-track vds-slider-progress video-progress-footer__track-progress"
          :style="controlledFillStyle"
        />
        <div
          class="vds-slider-track vds-slider-track-fill video-progress-footer__track-fill"
          :style="controlledFillStyle"
        />
        <div
          class="vds-slider-thumb video-progress-footer__thumb"
          :style="controlledThumbStyle"
        />
      </div>
      <media-time-slider
        v-else
        class="vds-slider vds-time-slider video-progress-footer__slider"
        aria-label="Seek video"
      >
        <div class="vds-slider-track video-progress-footer__track" />
        <div class="vds-slider-track vds-slider-progress video-progress-footer__track-progress" />
        <div class="vds-slider-track vds-slider-track-fill video-progress-footer__track-fill" />
        <div class="vds-slider-thumb video-progress-footer__thumb" />
      </media-time-slider>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    timeLabel: string;
    variant?: 'feed' | 'viewer';
    /** A rotated CSS stage needs its seek axis mapped from screen Y, not screen X. */
    seekOrientation?: 'normal' | 'rotated' | null;
    currentTime?: number;
    duration?: number;
  }>(),
  {
    variant: 'feed',
    seekOrientation: null,
    currentTime: 0,
    duration: 0
  }
);

const emit = defineEmits<{
  seek: [seconds: number];
  'seek-preview': [seconds: number];
}>();

const controlledSlider = ref<HTMLElement | null>(null);
const previewTime = ref<number | null>(null);
let activePointerId: number | null = null;

const displayedTime = computed(() => previewTime.value ?? props.currentTime);

const controlledRatio = computed(() => {
  const duration = Math.max(props.duration, 0);
  return duration > 0 ? Math.min(Math.max(displayedTime.value / duration, 0), 1) : 0;
});

const controlledFillStyle = computed(() => ({ width: `${controlledRatio.value * 100}%` }));
const controlledThumbStyle = computed(() => ({ left: `${controlledRatio.value * 100}%` }));

function getSeekPosition(event: PointerEvent): number | null {
  const slider = controlledSlider.value;
  const duration = Math.max(props.duration, 0);
  if (!slider || duration <= 0) return null;

  const bounds = slider.getBoundingClientRect();
  const axisStart = props.seekOrientation === 'rotated' ? bounds.top : bounds.left;
  const axisLength = props.seekOrientation === 'rotated' ? bounds.height : bounds.width;
  if (axisLength <= 0) return null;

  const pointerPosition = props.seekOrientation === 'rotated' ? event.clientY : event.clientX;
  const ratio = Math.min(Math.max((pointerPosition - axisStart) / axisLength, 0), 1);
  return ratio * duration;
}

function previewSeekFromPointer(event: PointerEvent) {
  const seconds = getSeekPosition(event);
  if (seconds === null) return;
  previewTime.value = seconds;
  emit('seek-preview', seconds);
}

function commitSeekFromPointer(event: PointerEvent) {
  const seconds = getSeekPosition(event);
  if (seconds === null) return;
  previewTime.value = null;
  emit('seek', seconds);
}

function beginControlledSeek(event: PointerEvent) {
  event.preventDefault();
  activePointerId = event.pointerId;
  controlledSlider.value?.setPointerCapture(event.pointerId);
  previewSeekFromPointer(event);
}

function moveControlledSeek(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  event.preventDefault();
  previewSeekFromPointer(event);
}

function endControlledSeek(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  commitSeekFromPointer(event);
  if (controlledSlider.value?.hasPointerCapture(event.pointerId)) {
    controlledSlider.value.releasePointerCapture(event.pointerId);
  }
  activePointerId = null;
}

function cancelControlledSeek(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  previewTime.value = null;
  if (controlledSlider.value?.hasPointerCapture(event.pointerId)) {
    controlledSlider.value.releasePointerCapture(event.pointerId);
  }
  activePointerId = null;
}

function handleControlledSliderKeydown(event: KeyboardEvent) {
  const duration = Math.max(props.duration, 0);
  if (duration <= 0) return;

  const step = Math.min(5, Math.max(duration / 100, 0.25));
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault();
    emit('seek', Math.max(0, props.currentTime - step));
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault();
    emit('seek', Math.min(duration, props.currentTime + step));
  }
}

</script>
