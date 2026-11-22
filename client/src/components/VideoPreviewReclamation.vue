<template>
  <section
    v-if="canStart || completion"
    :id="canStart ? 'video-playback-status' : undefined"
    class="card grid gap-3 p-5 sm:px-8"
    :aria-label="t(canStart ? 'streamingVideo.maintenance.title' : 'streamingVideo.maintenance.result')"
    tabindex="-1"
  >
    <div v-if="canStart" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div>
        <h2 class="m-0 text-[1rem]">{{ t('streamingVideo.maintenance.title') }}</h2>
        <p class="m-0 mt-0.5 text-sm text-muted" aria-live="polite">{{ statusMessage }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button v-if="canCheckRemaining" ref="remainingPreviewsButton" type="button" class="btn-ghost min-h-9 px-3 text-sm" @click="manualCheckOpen = true">
          {{ t('streamingVideo.maintenance.checkRemaining') }}
        </button>
        <span class="rounded-lg bg-surface-alt px-2.5 py-1 text-sm font-semibold text-text">
          {{ t(generating ? 'streamingVideo.maintenance.previews' : 'streamingVideo.maintenance.streaming') }}
        </span>
      </div>
    </div>
    <div
      v-if="completion"
      class="flex items-start gap-2.5 rounded-lg bg-accent-soft py-2 pl-3 pr-1.5"
    >
      <span class="i-fluent-checkmark-20-regular mt-1.5 h-5 w-5 shrink-0 text-accent-strong" aria-hidden="true" />
      <div class="min-w-0 flex-1 py-1 text-sm" role="status">
        <p class="m-0 font-semibold">
          {{ !generating && completion.bytes ? t('streamingVideo.reclamation.spaceFreed', { bytes: formatBytes(completion.bytes) })
            : t('streamingVideo.reclamation.status.complete') }}
        </p>
        <p class="m-0 text-muted">{{ formatResult(completion, true) }}</p>
        <p v-if="completion.skipped" class="mt-1 mb-0 text-muted">{{ describeReasons(completion.reasons) }}</p>
      </div>
      <button
        type="button"
        class="inline-grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        :aria-label="t(generating ? 'streamingVideo.generation.dismissResult' : 'streamingVideo.reclamation.dismissResult')"
        @click="dismissCompletion"
      >
        <span class="i-fluent-dismiss-20-regular h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  </section>

  <section v-if="showCard" class="card grid gap-4 p-5 sm:p-8" :aria-labelledby="headingId" tabindex="-1">
    <div class="flex items-center justify-between gap-3">
      <h2 :id="headingId" class="m-0 text-[1.18rem]">{{ title }}</h2>
      <button
        v-if="canCloseCheck"
        type="button"
        class="btn-ghost shrink-0 px-3 text-sm"
        :disabled="busy"
        @click="closeManualCheck"
      >{{ t('streamingVideo.maintenance.closeCheck') }}</button>
    </div>
    <p v-if="showActions" class="m-0 text-muted">
      <template v-if="generating">{{ t('streamingVideo.generation.description', { count: streamingCount.toLocaleString(locale) }, streamingCount) }}</template>
      <template v-else>
        {{ t('streamingVideo.reclamation.description') }}
        {{ t('streamingVideo.reclamation.preserved') }}
        {{ t('streamingVideo.reclamation.playbackNote') }}
      </template>
    </p>
    <div v-if="showActions" class="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label class="grid min-w-0 flex-1 gap-1.5">
        <span class="text-sm font-semibold">{{ t('streamingVideo.reclamation.source') }}</span>
        <span class="relative block">
          <select
            v-model="source"
            class="source-select block h-11 w-full cursor-pointer appearance-none rounded-lg border border-[color-mix(in_srgb,var(--border)_65%,var(--text)_35%)] bg-surface-alt pl-3 pr-10 text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="busy || running"
          >
            <option class="bg-surface text-text" value="">{{ t('streamingVideo.reclamation.allSources') }}</option>
            <option v-for="item in sources" :key="item.id" class="bg-surface text-text" :value="String(item.id)">{{ item.name }}</option>
          </select>
          <span class="i-fluent-chevron-down-20-regular pointer-events-none absolute right-3 top-1/2 block h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
        </span>
      </label>
      <button ref="assessButton" type="button" class="btn-ghost min-h-11 px-4" :disabled="busy || running || !sources.length" @click="assess">
        {{ t(generating ? 'streamingVideo.generation.assess' : 'streamingVideo.reclamation.assess') }}
      </button>
    </div>
    <div v-if="showActions && job?.state === 'ready'" class="grid gap-3">
      <div class="grid gap-3 rounded-xl border border-border bg-surface-alt p-3.5 sm:p-4" role="status">
        <dl v-if="hasCandidates" class="m-0 grid grid-cols-2 gap-x-4 gap-y-3" :class="{ 'sm:grid-cols-3': !generating }">
          <div v-if="!generating" class="col-span-2 flex min-w-0 flex-col-reverse justify-end gap-1 sm:col-span-1">
            <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.estimatedSavings') }}</dt>
            <dd class="m-0 break-words text-[1.65rem] font-semibold leading-tight tabular-nums text-accent-strong">{{ formatBytes(job.assessment.bytes) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col-reverse justify-end gap-1">
            <dt class="text-xs text-muted">{{ t(generating ? 'streamingVideo.generation.previewsToGenerate' : 'streamingVideo.reclamation.previewsToRemove') }}</dt>
            <dd class="m-0 break-words text-xl font-semibold leading-tight tabular-nums">{{ job.assessment.files.toLocaleString(locale) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col-reverse justify-end gap-1">
            <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.videosToSwitch') }}</dt>
            <dd class="m-0 break-words text-xl font-semibold leading-tight tabular-nums">{{ job.assessment.videos.toLocaleString(locale) }}</dd>
          </div>
        </dl>
        <p v-else class="m-0 text-sm font-semibold">{{ t(generating ? 'streamingVideo.generation.noEligibleVideos' : 'streamingVideo.reclamation.noEligibleVideos') }}</p>
        <div class="grid gap-1 border-t border-border pt-2.5 text-xs text-muted">
          <p class="m-0 break-words">{{ scope }}</p>
          <p v-if="job.assessment.skipped" class="m-0">{{ describeReasons(job.assessment.reasons) }}</p>
        </div>
      </div>
      <button
        v-if="hasCandidates"
        type="button"
        class="btn-primary justify-self-start"
        :disabled="busy"
        @click="confirmation = true"
      >{{ t(generating ? 'streamingVideo.generation.confirmAction' : 'streamingVideo.reclamation.action') }}</button>
    </div>
    <div v-else-if="job && (running || canRetry)" class="grid gap-2 text-sm">
      <div class="grid gap-2" role="status">
        <p class="m-0 break-words">{{ scope }}</p>
        <p class="m-0">{{ t(generating && running ? 'streamingVideo.generation.' + job.state : 'streamingVideo.reclamation.status.' + job.state) }}</p>
        <template v-if="!job.confirmed">
          <p class="m-0">{{ estimate }}</p>
          <p v-if="job.assessment.skipped" class="m-0 text-muted">{{ describeReasons(job.assessment.reasons) }}</p>
        </template>
        <template v-else>
          <p class="m-0">{{ formatResult(job.result) }}</p>
          <p v-if="job.result.skipped || job.result.deferred || job.result.failed" class="m-0 text-muted">
            {{ describeReasons(job.result.reasons) }}
          </p>
          <ul v-if="job.failedVideos?.length" class="m-0 list-disc break-words pl-5 text-muted">
            <li v-for="(filename, index) in job.failedVideos" :key="index">{{ filename }}</li>
          </ul>
        </template>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="running"
          type="button"
          class="btn-ghost"
          :disabled="busy || job.cancelRequested"
          @click="run('cancel')"
        >{{ t('streamingVideo.reclamation.cancel') }}</button>
        <button v-if="canRetry" type="button" class="btn-ghost" :disabled="busy" @click="run('retry')">
          {{ t('streamingVideo.reclamation.resume') }}
        </button>
      </div>
    </div>
    <p v-if="error" class="m-0 text-muted" role="alert">{{ error }}</p>
    <ConfirmDialog
      v-if="showActions && confirmation && job"
      wide
      :title="t(generating ? 'streamingVideo.generation.confirmTitle' : 'streamingVideo.reclamation.confirmTitle')"
      :confirm-label="t(generating ? 'streamingVideo.generation.confirmAction' : 'streamingVideo.reclamation.confirmAction')"
      :loading-label="t(generating ? 'streamingVideo.generation.running' : 'streamingVideo.reclamation.confirmPending')"
      :loading="busy"
      @confirm="run('confirm')"
      @cancel="confirmation = false"
    >
      <template #details>
        <div class="grid gap-3 text-sm">
          <p class="m-0 break-words font-semibold">{{ scope }}</p>
          <dl class="m-0 grid gap-3 rounded-lg border border-border bg-surface-alt p-3 sm:p-4" :class="generating ? 'grid-cols-2' : 'grid-cols-3'">
            <div class="flex min-w-0 flex-col-reverse justify-end gap-1 break-words">
              <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.videosToSwitch') }}</dt>
              <dd class="m-0 text-lg font-semibold leading-tight tabular-nums">{{ job.assessment.videos.toLocaleString(locale) }}</dd>
            </div>
            <div class="flex min-w-0 flex-col-reverse justify-end gap-1 break-words">
              <dt class="text-xs text-muted">{{ t(generating ? 'streamingVideo.generation.previewsToGenerate' : 'streamingVideo.reclamation.previewsToRemove') }}</dt>
              <dd class="m-0 text-lg font-semibold leading-tight tabular-nums">{{ job.assessment.files.toLocaleString(locale) }}</dd>
            </div>
            <div v-if="!generating" class="flex min-w-0 flex-col-reverse justify-end gap-1 break-words">
              <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.estimatedSavings') }}</dt>
              <dd class="m-0 text-lg font-semibold leading-tight tabular-nums">{{ formatBytes(job.assessment.bytes) }}</dd>
            </div>
          </dl>
          <p class="m-0 text-muted">{{ t('streamingVideo.reclamation.preserved') }}</p>
          <p class="m-0 break-words text-muted">{{ t(generating ? 'streamingVideo.generation.confirmNote' : 'streamingVideo.reclamation.playbackNote') }}</p>
        </div>
      </template>
    </ConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { requestJson } from '../api/http';
import ConfirmDialog from './ConfirmDialog.vue';

type Source = { id: number; name: string };
type Counts = Record<string, number>;
interface Job {
  id: string;
  state: 'assessing' | 'ready' | 'running' | 'complete' | 'cancelled' | 'interrupted';
  sources: Source[];
  assessment: { checked: number; videos: number; files: number; bytes: number; skipped: number; reasons: Counts };
  result: { switched: number; files: number; bytes: number; skipped: number; deferred: number; failed: number; reasons: Counts };
  confirmed: boolean;
  cancelRequested: boolean;
  failedVideos?: string[];
}

const props = defineProps<{ mode: 'streaming' | 'previews'; canStart: boolean; overviewRevision?: number }>();
const emit = defineEmits<{ changed: [] }>();
const generating = props.mode === 'previews';
const endpoint = '/api/admin/video-previews/' + (generating ? 'generation' : 'reclamation');
const headingId = useId();
const streamingCount = ref(0);
const cleanupPending = ref(false);
const manualCheckOpen = ref(false);
const overviewLoaded = ref(false);
const dismissalKey = 'foldergram-video-maintenance-dismissed-' + props.mode;
const dismissedJobId = ref<string | null>(null);
try { dismissedJobId.value = localStorage.getItem(dismissalKey); } catch { /* Browser storage is optional. */ }
const { t, locale } = useI18n();
const sources = ref<Source[]>([]);
const source = ref('');
const job = ref<Job | null>(null);
const error = ref('');
const busy = ref(false);
const confirmation = ref(false);
const assessButton = ref<HTMLButtonElement | null>(null);
const remainingPreviewsButton = ref<HTMLButtonElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let overviewRequest = 0;

const running = computed(() => job.value?.state === 'assessing' || job.value?.state === 'running');
const hasCandidates = computed(() => Boolean(job.value?.assessment.videos || job.value?.assessment.files));
const canRetry = computed(() => job.value && (
  job.value.state === 'cancelled' || job.value.state === 'interrupted' ||
  (job.value.state === 'complete' && (job.value.result.deferred || job.value.result.failed))
));

const hasWork = computed(() => generating ? streamingCount.value > 0 : cleanupPending.value);
const showActions = computed(() => props.canStart && (hasWork.value || manualCheckOpen.value ||
  (job.value?.state === 'ready' && hasCandidates.value)));
const showCard = computed(() => running.value || canRetry.value || showActions.value ||
  (props.canStart && Boolean(error.value)));
const canCheckRemaining = computed(() => props.canStart && !generating && overviewLoaded.value &&
  !hasWork.value && !manualCheckOpen.value && !running.value && !canRetry.value &&
  !error.value && !(job.value?.state === 'ready' && hasCandidates.value));
const canCloseCheck = computed(() => props.canStart && !generating && !hasWork.value &&
  !running.value && !canRetry.value && (manualCheckOpen.value || job.value?.state === 'ready'));
const completedJob = computed(() => job.value?.state === 'complete' && job.value.confirmed &&
  !canRetry.value && job.value.id !== dismissedJobId.value ? job.value : null);
const completion = computed(() => completedJob.value?.result ?? null);
const statusMessage = computed(() => {
  const key = 'streamingVideo.maintenance.';
  if (running.value) return t(key + 'working');
  if (canRetry.value) return t(key + 'needsAttention');
  if (!overviewLoaded.value || error.value) return t(key + (error.value ? 'checkFailed' : 'checking'));
  if (job.value?.state === 'complete' && job.value.result.skipped && !hasWork.value) return t(key + 'skipped');
  if (generating) return t(key + (hasWork.value ? 'videosPending' : 'noVideosPending'));
  return t(key + (hasWork.value ? 'cleanupPending' : 'noCleanupPending'));
});
const title = computed(() => t(generating ? 'streamingVideo.generation.title'
  : props.canStart ? 'streamingVideo.reclamation.action' : 'streamingVideo.reclamation.recoveryTitle'));

const storageUnits = [
  { unit: 'gigabyte', bytesPerUnit: 1_000_000_000, maximumFractionDigits: 1 },
  { unit: 'megabyte', bytesPerUnit: 1_000_000, maximumFractionDigits: 0 },
  { unit: 'kilobyte', bytesPerUnit: 1_000, maximumFractionDigits: 0 }
];

function formatBytes(bytes: number) {
  const { unit, bytesPerUnit, maximumFractionDigits } = storageUnits.find(size => bytes >= size.bytesPerUnit) ??
    { unit: 'byte', bytesPerUnit: 1, maximumFractionDigits: 0 };
  return new Intl.NumberFormat(locale.value, {
    style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits
  }).format(bytes / bytesPerUnit);
}

const estimate = computed(() => job.value ? t(generating ? 'streamingVideo.generation.estimate' : 'streamingVideo.reclamation.estimate', {
  checked: job.value.assessment.checked, videos: job.value.assessment.videos,
  files: job.value.assessment.files, bytes: formatBytes(job.value.assessment.bytes)
}) : '');
const scope = computed(() => t('streamingVideo.reclamation.scope', {
  names: job.value?.sources.map(item => item.name).join(', ') ?? ''
}));

function describeReasons(reasons: Counts) {
  return Object.entries(reasons).map(([reason, count]) =>
    t(reason === 'generationFailed' ? 'streamingVideo.generation.failed' : 'streamingVideo.reclamation.reason.' + reason) +
      ' (' + count + ')').join(' · ');
}

function formatResult(result: Job['result'], compact = false) {
  return t(generating ? 'streamingVideo.generation.result' : compact
    ? 'streamingVideo.reclamation.completedChanges' : 'streamingVideo.reclamation.result', {
    videos: result.switched.toLocaleString(locale.value), files: result.files.toLocaleString(locale.value), bytes: formatBytes(result.bytes)
  });
}

function dismissCompletion() {
  const id = completedJob.value?.id;
  if (!id) return;
  dismissedJobId.value = id;
  try { localStorage.setItem(dismissalKey, id); } catch { /* Keep the dismissal for this visit. */ }
  (assessButton.value ?? document.getElementById('video-playback-status'))?.focus();
}

async function closeManualCheck() {
  if (!canCloseCheck.value || busy.value) return;
  manualCheckOpen.value = false;
  if (job.value?.state === 'ready' && !job.value.confirmed) job.value = null;
  error.value = '';
  confirmation.value = false;
  await nextTick();
  remainingPreviewsButton.value?.focus();
}

function updateJob(next: Job) {
  const previous = job.value;
  job.value = next;
  if (next.state === 'complete' && next.confirmed) manualCheckOpen.value = false;
  if (!running.value && next.confirmed &&
      (previous?.state === 'running' || previous?.result.switched !== next.result.switched ||
        previous?.result.files !== next.result.files)) {
    emit('changed');
  }
}

function poll() {
  clearTimeout(timer);
  if (!running.value || disposed || !job.value) return;
  const id = job.value.id;
  timer = setTimeout(async () => {
    try {
      const next = await requestJson<Job>(endpoint + '/' + id);
      if (!disposed && job.value?.id === id && !busy.value) updateJob(next);
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
    }
    poll();
  }, 1000);
}

async function submit(url: string, body?: object) {
  clearTimeout(timer);
  busy.value = true;
  error.value = '';
  try {
    const next = await requestJson<Job>(url, {
      method: 'POST',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    if (!disposed) updateJob(next);
    confirmation.value = false;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
    poll();
  }
}

function assess() {
  if (!showActions.value) return;
  return submit(endpoint, source.value ? { sourceId: Number(source.value) } : {});
}

function run(action: 'confirm' | 'cancel' | 'retry') {
  if ((action === 'confirm' && !showActions.value) || (action === 'retry' && !canRetry.value)) return;
  if (job.value) return submit(endpoint + '/' + job.value.id + '/' + action);
}

async function loadOverview() {
  const request = ++overviewRequest;
  try {
    const data = await requestJson<{
      sources: Source[]; job: Job | null; streamingCount?: number; cleanupPending?: boolean
    }>(endpoint);
    if (disposed || request !== overviewRequest) return;
    sources.value = data.sources;
    streamingCount.value = data.streamingCount ?? 0;
    cleanupPending.value = data.cleanupPending ?? false;
    if (!overviewLoaded.value) {
      job.value = data.job;
      poll();
    }
    overviewLoaded.value = true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
}

onMounted(() => { void loadOverview(); });
watch(() => props.overviewRevision, () => { if (props.canStart) void loadOverview(); });

onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
});
</script>

<style scoped>
.source-select {
  color-scheme: light;
}

:root[data-theme="dark"] .source-select {
  color-scheme: dark;
}
</style>
