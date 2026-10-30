<template>
  <div class="fixed inset-0 z-60 flex items-center justify-center p-6 bg-black/55" @click.self="$emit('cancel')">
    <section class="w-[min(100%,26rem)] p-[1.4rem] bg-surface border border-border rounded-[1.2rem] shadow-[var(--shadow)]" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <!-- Icon -->
      <div class="inline-flex items-center justify-center w-12 h-12 mb-4 rounded-full text-[#d93025] bg-[rgba(217,48,37,0.1)]" aria-hidden="true">
        <svg class="w-[1.3rem] h-[1.3rem]" viewBox="0 0 24 24" role="presentation">
          <path
            d="M12 8.5v4m0 3h.01M10.2 4.9 3.9 16a1.5 1.5 0 0 0 1.3 2.25h13.6A1.5 1.5 0 0 0 20.1 16L13.8 4.9a1.5 1.5 0 0 0-2.6 0Z"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </div>
      <!-- Copy -->
      <div class="grid gap-[0.45rem]">
        <h2 :id="titleId" class="m-0 text-[1.15rem]">{{ title }}</h2>
        <p class="m-0 text-muted">{{ message }}</p>
        <slot name="details" />
      </div>
      <!-- Actions -->
      <div class="flex justify-end gap-3 mt-[1.4rem]">
        <button class="min-h-[2.5rem] px-4 py-[0.6rem] border border-transparent rounded-[0.75rem] font-semibold cursor-pointer bg-surface-hover text-text disabled:opacity-70 disabled:cursor-wait" type="button" @click="$emit('cancel')">
          {{ cancelLabel ?? t('common.cancel') }}
        </button>
        <button class="min-h-[2.5rem] px-4 py-[0.6rem] border border-transparent rounded-[0.75rem] font-semibold cursor-pointer bg-[#d93025] text-white disabled:opacity-70 disabled:cursor-wait" type="button" :disabled="loading" @click="$emit('confirm')">
          {{ loading ? (loadingLabel ?? t('common.deleting')) : (confirmLabel ?? t('post.viewer.deletePost')) }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    loadingLabel?: string;
    loading?: boolean;
  }>(),
  {
    confirmLabel: undefined,
    cancelLabel: undefined,
    loadingLabel: undefined,
    loading: false
  }
);

defineEmits<{
  cancel: [];
  confirm: [];
}>();

const { t } = useI18n();
const titleId = `confirm-dialog-title-${Math.random().toString(36).slice(2, 10)}`;
</script>
