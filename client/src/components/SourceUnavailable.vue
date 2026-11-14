<template>
  <section
    class="w-full rounded-[1rem] border border-border bg-surface"
    :class="variant === 'banner'
      ? 'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-3.5 gap-y-3 px-4 py-4 max-sm:grid-cols-[2.5rem_minmax(0,1fr)]'
      : 'mx-auto flex max-w-[30rem] flex-col items-center px-6 py-8 text-center sm:px-8 sm:py-9'"
    role="status"
    :aria-busy="retrying"
    data-test="source-unavailable"
  >
    <div
      class="grid shrink-0 place-items-center"
      :class="variant === 'banner' ? 'h-10 w-10 rounded-xl' : 'h-14 w-14 rounded-[1rem]'"
      style="background: color-mix(in srgb, var(--surface) 90%, #d7a354 10%); color: color-mix(in srgb, var(--text) 65%, #d7a354 35%);"
      aria-hidden="true"
    >
      <svg :class="variant === 'banner' ? 'h-[1.3rem] w-[1.3rem]' : 'h-7 w-7'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 3 18 18M6.3 6.3A6.5 6.5 0 0 0 5.5 9a4.5 4.5 0 0 0 0 9H18a5 5 0 0 0 1.2-.15M10.2 3.25A6.5 6.5 0 0 1 18 8h1a5 5 0 0 1 3.3 8.75" />
      </svg>
    </div>

    <div class="min-w-0" :class="variant === 'banner' ? '' : 'mt-4'">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1" :class="variant === 'banner' ? '' : 'justify-center'">
        <h2 class="m-0 text-[0.94rem] font-semibold tracking-[-0.02em] leading-snug text-text">{{ t('sources.unavailableTitle') }}</h2>
        <span v-if="sourceName" class="max-w-full break-words rounded-md bg-surface-hover px-1.5 py-0.5 text-[0.68rem] font-medium text-muted">{{ sourceName }}</span>
      </div>
      <p class="mb-0 mt-2 text-[0.8rem] leading-[1.65] text-muted" :class="variant === 'banner' ? '' : 'mx-auto max-w-[20rem]'">{{ t('sources.unavailableMessage') }}</p>
      <p class="mb-0 mt-3 flex items-center gap-1.5 text-[0.69rem] leading-normal text-muted" :class="variant === 'banner' ? '' : 'justify-center'">
        <span class="h-[5px] w-[5px] shrink-0 rounded-full bg-[#c7974b]" aria-hidden="true" />
        {{ t('sources.reconnecting') }}
      </p>
    </div>

    <button
      class="inline-flex min-h-9 items-center justify-center gap-2 rounded-[0.65rem] border border-border bg-surface px-3 text-[0.76rem] font-semibold text-text transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-wait disabled:opacity-65"
      :class="variant === 'banner' ? 'self-center max-sm:col-start-2 max-sm:justify-self-start' : 'mt-5'"
      type="button"
      :disabled="retrying"
      @click="retry"
    >
      <svg class="h-3.5 w-3.5" :class="{ 'animate-spin motion-reduce:animate-none': retrying }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8.3 8.3 0 0 1 20 12M4 12a8.3 8.3 0 0 0 13.9 5.9" />
      </svg>
      {{ retrying ? t('sources.checking') : t('common.retry') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSourcesStore } from '../stores/sources';
const props = withDefaults(defineProps<{ name?: string; variant?: 'banner' | 'panel' }>(), { variant: 'panel' });
const sourceName = computed(() => props.name?.trim().toLowerCase() === 'immich' ? null : props.name?.trim());
const { t } = useI18n();
const sources = useSourcesStore();
const retrying = ref(false);
async function retry() {
  retrying.value = true;
  try { await sources.refresh(true); } finally { retrying.value = false; }
}
</script>
