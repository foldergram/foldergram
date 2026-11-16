<template>
  <div v-if="scan?.isScanning" class="grid min-w-0 gap-2">
    <p class="m-0 font-semibold text-text" :class="{ 'text-[0.88rem]': compact }" :role="announce ? 'status' : undefined">{{ activeState ? activeState + ' · ' + phase : phase }}</p>
    <p v-if="!compact" class="m-0 text-[0.85rem] text-muted">{{ summary }}</p>
    <div
      v-if="!compact"
      class="relative h-2 overflow-hidden rounded-full bg-surface-alt"
      role="progressbar"
      :aria-label="phase"
      :aria-valuenow="bar.indeterminate ? undefined : bar.percent"
    >
      <span
        class="absolute inset-y-0 left-0 rounded-full bg-accent"
        :class="{ 'scan-progress__indeterminate w-2/5': bar.indeterminate, 'scan-progress__moving': bar.indeterminate && moving }"
        :style="bar.indeterminate ? undefined : { width: bar.percent + '%' }"
      />
    </div>
    <p class="m-0 text-[0.8rem] text-muted">{{ metrics }}</p>
    <p v-if="!compact && action" class="m-0 break-all text-[0.8rem] text-muted">{{ action }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import type { ScanProgress } from '../types/api';
import { getActiveScanStateLabel, getScanActionLine, getScanBarState, getScanMetricLine, getScanOperationLabel, getScanPhaseLabel, getScanSummary } from '../utils/scan-progress';

const props = defineProps<{ scan: ScanProgress | null; compact?: boolean; announce?: boolean }>();
const authStore = useAuthStore();
const appStore = useAppStore();
const activeState = computed(() => getActiveScanStateLabel(props.scan));
const moving = computed(() => !activeState.value && !appStore.scanStatusUnavailable);
const phase = computed(() => getScanPhaseLabel(props.scan));
const summary = computed(() => getScanSummary(props.scan));
const bar = computed(() => getScanBarState(props.scan));
const metrics = computed(() => getScanMetricLine(props.scan));
const action = computed(() => authStore.canAccessSettings ? getScanActionLine(props.scan) : getScanOperationLabel(props.scan));
</script>

<style scoped>
.scan-progress__indeterminate {
  left: 30%;
}

@media (prefers-reduced-motion: no-preference) {
  .scan-progress__moving {
    left: 0;
    animation: scan-progress-slide 1.4s ease-in-out infinite alternate;
  }
}

@keyframes scan-progress-slide {
  from { transform: translateX(-55%); }
  to { transform: translateX(205%); }
}
</style>
