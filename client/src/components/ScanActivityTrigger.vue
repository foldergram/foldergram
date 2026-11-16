<template>
  <button
    type="button"
    :class="[mobile ? 'mobile-nav__item' : 'sidebar-item w-full', 'scan-activity-trigger relative text-accent-strong']"
    :aria-label="label"
    :title="mobile ? undefined : label"
    aria-haspopup="dialog"
    :aria-expanded="expanded"
    :aria-controls="expanded ? 'scan-activity-details' : undefined"
    @click="$emit('activate', $event)"
  >
    <span class="relative inline-flex shrink-0" aria-hidden="true">
      <span class="h-[1.45rem] w-[1.45rem]" :class="[
        paused ? 'i-fluent-pause-20-regular' : stopping ? 'i-fluent-stop-20-regular' : 'i-fluent-arrow-sync-20-regular',
        { 'scan-activity-trigger__running': running }
      ]" />
      <span v-if="attention" class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#d28221] ring-2 ring-bg" />
    </span>
    <span v-if="!mobile" class="max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100">{{ t('scanActivity.title') }}</span>
  </button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ mobile?: boolean; label: string; expanded: boolean; running: boolean; paused: boolean; stopping: boolean; attention: boolean }>();
defineEmits<{ activate: [event: MouseEvent] }>();
const { t } = useI18n();
</script>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .scan-activity-trigger__running {
    animation: scan-activity-rotate 3s linear infinite;
  }
}

@keyframes scan-activity-rotate {
  to { transform: rotate(360deg); }
}
</style>
