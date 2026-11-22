<template>
  <div
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/55"
    :class="wide ? 'p-4' : 'p-6'"
    @click.self="$emit('cancel')"
  >
    <section
      class="bg-surface border border-border rounded-[1.2rem] shadow-[var(--shadow)]"
      :class="wide ? 'flex max-h-full w-full max-w-[36rem] flex-col p-4 sm:p-6' : 'w-[min(100%,26rem)] p-[1.4rem]'"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <div :class="wide ? 'flex shrink-0 items-center gap-3' : 'grid gap-4'">
        <div
          class="inline-flex shrink-0 items-center justify-center rounded-full text-[#d93025] bg-[rgba(217,48,37,0.1)]"
          :class="wide ? 'h-10 w-10' : 'h-12 w-12'"
          aria-hidden="true"
        >
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
        <h2 :id="titleId" class="m-0 text-[1.15rem]" :class="{ 'font-semibold': wide }">{{ title }}</h2>
      </div>
      <div
        class="grid gap-[0.45rem]"
        :class="wide ? 'mt-4 min-h-0 overflow-y-auto' : 'mt-[0.45rem]'"
      >
        <p v-if="message" class="m-0 text-muted">{{ message }}</p>
        <slot name="details" />
      </div>
      <div
        class="flex justify-end gap-3"
        :class="wide ? 'mt-4 shrink-0 flex-wrap border-t border-border pt-4' : 'mt-[1.4rem]'"
      >
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
    message?: string;
    wide?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
    loadingLabel?: string;
    loading?: boolean;
  }>(),
  {
    wide: false,
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
