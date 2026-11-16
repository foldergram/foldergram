<template>
  <ScanProgressContent v-if="scan?.isScanning" :scan="scan" announce />
  <ScanControls :allow-cancel="showRemote" />

  <div v-if="appStore.scanStatusUnavailable" class="flex flex-wrap items-center justify-between gap-2" role="status">
    <span class="text-[0.88rem] font-semibold">{{ t('scanActivity.unavailable') }}</span>
    <button class="btn-ghost" type="button" @click="appStore.refreshScanProgress()">{{ t('common.retry') }}</button>
  </div>

  <section v-if="showRemote && remoteSources.length" class="grid gap-2">
    <h3 class="m-0 text-[0.95rem]">{{ t('scanActivity.synchronizing') }}</h3>
    <ul class="m-0 grid list-none gap-1 p-0 text-[0.85rem] text-muted">
      <li v-for="source in remoteSources" :key="source.id">{{ source.name }}</li>
    </ul>
    <RouterLink v-if="authStore.canAccessSettings" class="scan-activity-link" :to="{ name: 'settings', hash: '#sources' }" @click="$emit('navigate')">
      {{ t('scanActivity.openSources') }}
    </RouterLink>
  </section>

  <section v-if="result && showResult && result.id !== issue?.id" class="grid min-w-0 gap-2">
    <p class="m-0 text-[0.9rem] font-semibold" role="status">{{ getScanResultLabel(result) }}</p>
    <p v-if="authStore.canAccessSettings && result.finished_at" class="m-0 text-[0.8rem] text-muted">{{ d(new Date(result.finished_at), { dateStyle: 'medium', timeStyle: 'short' }) }}</p>
    <RouterLink v-if="authStore.canAccessSettings" class="scan-activity-link" :to="{ name: 'settings', hash: '#status' }" @click="$emit('navigate')">
      {{ t('scanActivity.openStatus') }}
    </RouterLink>
  </section>

  <section v-if="issue" class="grid min-w-0 gap-2">
    <p v-if="scan?.isScanning || (result && result.id !== issue.id)" class="m-0 text-[0.8rem] font-semibold text-muted">
      {{ t('scanActivity.earlierIssue') }}
    </p>
    <p class="m-0 text-[0.9rem] font-semibold" role="status">{{ getScanResultLabel(issue) }}</p>
    <p v-if="issues.length > 1" class="m-0 text-[0.8rem] text-muted">{{ t('scanActivity.similarResults', { count: issues.length }) }}</p>
    <time class="text-[0.8rem] text-muted" :datetime="issue.started_at">{{ d(new Date(issue.started_at), { dateStyle: 'medium', timeStyle: 'short' }) }}</time>
    <div class="flex flex-wrap items-center gap-2">
      <RouterLink class="scan-activity-link" :to="issueLink" @click="$emit('navigate')">
        {{ t('scanActivity.openIssue') }}
      </RouterLink>
      <button
        class="btn-ghost"
        type="button"
        @click="appStore.acknowledgeScanResults(issues)"
      >{{ issues.length > 1 ? t('scanActivity.acknowledgeResults', { count: issues.length }) : t('scanActivity.acknowledge') }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ScanRunSummary } from '../types/api';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useSourcesStore } from '../stores/sources';
import { getScanResultLabel } from '../utils/scan-progress';
import ScanControls from './ScanControls.vue';
import ScanProgressContent from './ScanProgressContent.vue';

const props = withDefaults(defineProps<{ showRemote?: boolean; showResult?: boolean; heldResult?: ScanRunSummary | null }>(), { showResult: true });
defineEmits<{ navigate: [] }>();
const { t, d } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const sourcesStore = useSourcesStore();
const scan = computed(() => appStore.stats?.scan ?? null);
const issues = computed(() => authStore.canAccessSettings ? appStore.unacknowledgedScanResults : []);
const issue = computed(() => issues.value[0] ?? null);
const result = computed(() => props.heldResult ?? (!scan.value?.isScanning
  ? (authStore.canAccessSettings ? appStore.scanCompletion?.result : null) ?? scan.value?.lastCompletedScan
  : null));
const issueLink = computed(() => ({
  name: 'settings',
  hash: '#status',
  ...(issue.value && issue.value.id !== scan.value?.lastCompletedScan?.id ? { query: { scan: String(issue.value.id) } } : {})
}));
const remoteSources = computed(() => sourcesStore.items.filter(source => source.kind === 'immich' && source.syncing));
</script>

<style scoped>
.scan-activity-link {
  color: var(--accent-strong);
  font-size: 0.85rem;
  font-weight: 600;
}
</style>
