<template>
  <div
    ref="padElement"
    class="pattern-pad"
    role="application"
    :aria-label="ariaLabel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <svg
      ref="svgElement"
      class="pattern-pad__canvas"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <line
        v-for="(segment, index) in trailSegments"
        :key="`line-${index}`"
        :x1="segment.x1"
        :y1="segment.y1"
        :x2="segment.x2"
        :y2="segment.y2"
      />
      <circle
        v-for="(dot, index) in dots"
        :key="`dot-${index}`"
        class="pattern-pad__dot"
        :class="{ 'pattern-pad__dot--active': dot.active, 'pattern-pad__dot--error': showError }"
        :cx="dot.x"
        :cy="dot.y"
        :r="dot.active ? 4.4 : 3.2"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
/**
 * Android-style 3x3 pattern pad. Pure presentation + gesture capture: the drawn
 * sequence is emitted as `start-end` dot indices (row-major, 0-8) and the parent
 * decides whether it is a login attempt, a first entry or a confirmation entry.
 */
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    ariaLabel?: string;
    showError?: boolean;
    disabled?: boolean;
  }>(),
  {
    ariaLabel: '',
    showError: false,
    disabled: false
  }
);

const emit = defineEmits<{
  complete: [pattern: string];
}>();

interface Dot {
  x: number;
  y: number;
  active: boolean;
}

// Grid centers in percentage coordinates of the square pad.
const gridCenters: { x: number; y: number }[] = [0, 1, 2].flatMap((row) =>
  [0, 1, 2].map((column) => ({ x: (column + 0.5) * 100 / 3, y: (row + 0.5) * 100 / 3 }))
);

const dots = computed<Dot[]>(() => gridCenters.map((center, index) => ({ ...center, active: activeDots.value.includes(index) })));

const padElement = ref<HTMLElement | null>(null);
const svgElement = ref<SVGSVGElement | null>(null);
const activeDots = ref<number[]>([]);
const pointerTrail = ref<{ x: number; y: number } | null>(null);
let drawing = false;

const trailSegments = computed(() => {
  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 1; i < activeDots.value.length; i += 1) {
    const from = gridCenters[activeDots.value[i - 1]!];
    const to = gridCenters[activeDots.value[i]!];
    segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }
  if (activeDots.value.length > 0 && pointerTrail.value) {
    const last = gridCenters[activeDots.value[activeDots.value.length - 1]!];
    segments.push({ x1: last.x, y1: last.y, x2: pointerTrail.value.x, y2: pointerTrail.value.y });
  }
  return segments;
});

function clientToPad(clientX: number, clientY: number): { x: number; y: number } | null {
  const svg = svgElement.value;
  if (!svg) {
    return null;
  }

  const ctm = svg.getScreenCTM();
  if (!ctm) {
    return null;
  }

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function hitTestDot(clientX: number, clientY: number): number | null {
  const local = clientToPad(clientX, clientY);
  if (!local) {
    return null;
  }

  const radius = 14;
  let closest: number | null = null;
  let closestDistance = radius;

  gridCenters.forEach((center, index) => {
    const distance = Math.hypot(local.x - center.x, local.y - center.y);
    if (distance <= radius && (closest === null || distance < closestDistance)) {
      closest = index;
      closestDistance = distance;
    }
  });

  return closest;
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled) {
    return;
  }
  drawing = true;
  padElement.value?.setPointerCapture(event.pointerId);
  activeDots.value = [];
  enterDot(event.clientX, event.clientY);
}

function onPointerMove(event: PointerEvent) {
  if (!drawing || props.disabled) {
    return;
  }
  enterDot(event.clientX, event.clientY);
  pointerTrail.value = clientToPad(event.clientX, event.clientY);
}

function enterDot(clientX: number, clientY: number) {
  const index = hitTestDot(clientX, clientY);
  if (index !== null && !activeDots.value.includes(index)) {
    activeDots.value = [...activeDots.value, index];
  }
}

function onPointerUp() {
  if (!drawing) {
    return;
  }
  drawing = false;
  pointerTrail.value = null;
  const pattern = activeDots.value.join('-');
  activeDots.value = [];
  if (pattern.includes('-')) {
    emit('complete', pattern);
  }
}
</script>

<style scoped>
.pattern-pad {
  position: relative;
  width: min(18.5rem, 100%);
  aspect-ratio: 1;
  margin-inline: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.pattern-pad__canvas {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.pattern-pad__canvas line {
  stroke: var(--accent, #0095f6);
  stroke-width: 2.2;
  stroke-linecap: round;
  opacity: 0.85;
}

.pattern-pad__dot {
  fill: color-mix(in srgb, var(--muted, #8a8f98) 55%, transparent);
}

.pattern-pad__dot--active {
  fill: var(--accent, #0095f6);
}

.pattern-pad__dot--error {
  fill: #c0392b;
}
</style>
