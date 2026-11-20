<template>
  <section class="card grid gap-4 p-5 sm:p-8" aria-labelledby="preview-reclamation-title">
    <h2 id="preview-reclamation-title" class="m-0 text-[1.18rem]">{{ t('streamingVideo.reclamation.action') }}</h2>
    <p class="m-0 text-muted">
      {{ t('streamingVideo.reclamation.description') }}
      {{ t('streamingVideo.reclamation.preserved') }}
      {{ t('streamingVideo.reclamation.playbackNote') }}
    </p>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
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
        {{ t('streamingVideo.reclamation.assess') }}
      </button>
    </div>
    <div v-if="job?.state === 'ready'" class="grid gap-3">
      <div class="grid gap-3 rounded-xl border border-border bg-surface-alt p-3.5 sm:p-4" role="status">
        <dl v-if="canRemove" class="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <div class="col-span-2 flex min-w-0 flex-col-reverse justify-end gap-1 sm:col-span-1">
            <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.estimatedSavings') }}</dt>
            <dd class="m-0 break-words text-[1.65rem] font-semibold leading-tight tabular-nums text-accent-strong">{{ formatBytes(job.assessment.bytes) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col-reverse justify-end gap-1">
            <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.previewsToRemove') }}</dt>
            <dd class="m-0 break-words text-xl font-semibold leading-tight tabular-nums">{{ job.assessment.files.toLocaleString(locale) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col-reverse justify-end gap-1">
            <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.videosToSwitch') }}</dt>
            <dd class="m-0 break-words text-xl font-semibold leading-tight tabular-nums">{{ job.assessment.videos.toLocaleString(locale) }}</dd>
          </div>
        </dl>
        <p v-else class="m-0 text-sm font-semibold">{{ t('streamingVideo.reclamation.noEligibleVideos') }}</p>
        <div class="grid gap-1 border-t border-border pt-2.5 text-xs text-muted">
          <p class="m-0 break-words">{{ scope }}</p>
          <p v-if="job.assessment.skipped" class="m-0">{{ describeReasons(job.assessment.reasons) }}</p>
        </div>
      </div>
      <button
        v-if="canRemove"
        type="button"
        class="btn-primary justify-self-start"
        :disabled="busy"
        @click="confirmation = true"
      >{{ t('streamingVideo.reclamation.action') }}</button>
    </div>
    <div v-else-if="job && (job.state !== 'complete' || canRetry)" class="grid gap-2 text-sm">
      <div class="grid gap-2" role="status">
        <p class="m-0 break-words">{{ scope }}</p>
        <p class="m-0">{{ t('streamingVideo.reclamation.status.' + job.state) }}</p>
        <template v-if="!job.confirmed">
          <p class="m-0">{{ estimate }}</p>
          <p v-if="job.assessment.skipped" class="m-0 text-muted">{{ describeReasons(job.assessment.reasons) }}</p>
        </template>
        <template v-else>
          <p class="m-0">{{ t('streamingVideo.reclamation.result', {
            videos: job.result.switched, files: job.result.files, bytes: formatBytes(job.result.bytes)
          }) }}</p>
          <p v-if="job.result.skipped || job.result.deferred || job.result.failed" class="m-0 text-muted">
            {{ describeReasons(job.result.reasons) }}
          </p>
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
    <div
      v-if="completion"
      class="flex items-start gap-2.5 rounded-lg bg-accent-soft py-2 pl-3 pr-1.5"
    >
      <span class="i-fluent-checkmark-20-regular mt-1.5 h-5 w-5 shrink-0 text-accent-strong" aria-hidden="true" />
      <div class="min-w-0 flex-1 py-1 text-sm" role="status">
        <p class="m-0 font-semibold">
          {{ completion.bytes ? t('streamingVideo.reclamation.spaceFreed', { bytes: formatBytes(completion.bytes) })
            : t('streamingVideo.reclamation.status.complete') }}
        </p>
        <p class="m-0 text-muted">{{ t('streamingVideo.reclamation.completedChanges', {
          videos: completion.switched.toLocaleString(locale), files: completion.files.toLocaleString(locale)
        }) }}</p>
        <p v-if="completion.skipped" class="mt-1 mb-0 text-muted">{{ describeReasons(completion.reasons) }}</p>
      </div>
      <button
        type="button"
        class="inline-grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        :aria-label="t('streamingVideo.reclamation.dismissResult')"
        @click="dismissCompletion"
      >
        <span class="i-fluent-dismiss-20-regular h-5 w-5" aria-hidden="true" />
      </button>
    </div>
    <p v-if="error" class="m-0 text-muted" role="alert">{{ error }}</p>
    <ConfirmDialog
      v-if="confirmation && job"
      wide
      :title="t('streamingVideo.reclamation.confirmTitle')"
      :confirm-label="t('streamingVideo.reclamation.confirmAction')"
      :loading-label="t('streamingVideo.reclamation.confirmPending')"
      :loading="busy"
      @confirm="run('confirm')"
      @cancel="confirmation = false"
    >
      <template #details>
        <div class="grid gap-3 text-sm">
          <p class="m-0 break-words font-semibold">{{ scope }}</p>
          <dl class="m-0 grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-alt p-3 sm:p-4">
            <div class="flex min-w-0 flex-col-reverse justify-end gap-1 break-words">
              <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.videosToSwitch') }}</dt>
              <dd class="m-0 text-lg font-semibold leading-tight tabular-nums">{{ job.assessment.videos.toLocaleString(locale) }}</dd>
            </div>
            <div class="flex min-w-0 flex-col-reverse justify-end gap-1 break-words">
              <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.previewsToRemove') }}</dt>
              <dd class="m-0 text-lg font-semibold leading-tight tabular-nums">{{ job.assessment.files.toLocaleString(locale) }}</dd>
            </div>
            <div class="flex min-w-0 flex-col-reverse justify-end gap-1 break-words">
              <dt class="text-xs text-muted">{{ t('streamingVideo.reclamation.estimatedSavings') }}</dt>
              <dd class="m-0 text-lg font-semibold leading-tight tabular-nums">{{ formatBytes(job.assessment.bytes) }}</dd>
            </div>
          </dl>
          <p class="m-0 text-muted">{{ t('streamingVideo.reclamation.preserved') }}</p>
          <p class="m-0 break-words text-muted">{{ t('streamingVideo.reclamation.playbackNote') }}</p>
        </div>
      </template>
    </ConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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
}

const emit = defineEmits<{ changed: [] }>();
const endpoint = '/api/admin/video-previews/reclamation';
const { t, locale } = useI18n();
const sources = ref<Source[]>([]);
const source = ref('');
const job = ref<Job | null>(null);
const error = ref('');
const busy = ref(false);
const confirmation = ref(false);
const assessButton = ref<HTMLButtonElement | null>(null);
const completion = ref<Job['result'] | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

const running = computed(() => job.value?.state === 'assessing' || job.value?.state === 'running');
const canRemove = computed(() => Boolean(job.value?.assessment.videos || job.value?.assessment.files));
const canRetry = computed(() => job.value && (
  job.value.state === 'cancelled' || job.value.state === 'interrupted' ||
  (job.value.state === 'complete' && (job.value.result.deferred || job.value.result.failed))
));

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

const estimate = computed(() => job.value ? t('streamingVideo.reclamation.estimate', {
  checked: job.value.assessment.checked, videos: job.value.assessment.videos,
  files: job.value.assessment.files, bytes: formatBytes(job.value.assessment.bytes)
}) : '');
const scope = computed(() => t('streamingVideo.reclamation.scope', {
  names: job.value?.sources.map(item => item.name).join(', ') ?? ''
}));

function describeReasons(reasons: Counts) {
  return Object.entries(reasons).map(([reason, count]) =>
    t('streamingVideo.reclamation.reason.' + reason) + ' (' + count + ')').join(' · ');
}

function dismissCompletion() {
  completion.value = null;
  assessButton.value?.focus();
}

function updateJob(next: Job) {
  const previous = job.value;
  job.value = next;
  if (next.confirmed && !running.value && next.result.switched &&
      (previous?.state === 'running' || previous?.result.switched !== next.result.switched)) {
    emit('changed');
  }
  if (next.state === 'complete' && next.confirmed && !canRetry.value) {
    completion.value = next.result;
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
  completion.value = null;
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
  return submit(endpoint, source.value ? { sourceId: Number(source.value) } : {});
}

function run(action: 'confirm' | 'cancel' | 'retry') {
  if (job.value) return submit(endpoint + '/' + job.value.id + '/' + action);
}

onMounted(async () => {
  try {
    const data = await requestJson<{ sources: Source[]; job: Job | null }>(endpoint);
    if (disposed) return;
    sources.value = data.sources;
    job.value = data.job;
    poll();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
});

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
