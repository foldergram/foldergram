<template>
  <img
    v-if="resolvedSrc"
    :src="resolvedSrc"
    :alt="alt"
    :width="width"
    :height="height"
    :loading="loading"
    :data-loaded="loaded ? 'true' : 'false'"
    @load="handleLoad"
    @error="handleError"
  />
  <button
    v-else-if="showRetry && failed"
    type="button"
    class="flex h-full w-full items-center justify-center bg-surface-alt text-sm text-fg-muted"
    :aria-label="`${t('common.retry')} ${alt}`"
    @click.stop="retryManually"
  >
    {{ t('common.retry') }}
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    src: string | null;
    fallbackSrc?: string | null;
    alt: string;
    width?: number;
    height?: number;
    loading?: 'lazy' | 'eager';
    retryWhile?: boolean;
    showRetry?: boolean;
    maxRetries?: number;
    retryDelayMs?: number;
  }>(),
  {
    src: null,
    fallbackSrc: null,
    loading: 'lazy',
    retryWhile: false,
    maxRetries: 8,
    retryDelayMs: 1500
  }
);

const attempt = ref(0);
const loaded = ref(false);
const hiddenUntilRetry = ref(false);
const usingFallback = ref(false);
const failed = ref(false);
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const activeSrc = computed(() => {
  if (usingFallback.value && props.fallbackSrc && props.fallbackSrc !== props.src) {
    return props.fallbackSrc;
  }

  return props.src;
});

const resolvedSrc = computed(() => {
  if (!activeSrc.value || hiddenUntilRetry.value) {
    return null;
  }

  if (attempt.value === 0) {
    return activeSrc.value;
  }

  const separator = activeSrc.value.includes('?') ? '&' : '?';
  return `${activeSrc.value}${separator}retry=${attempt.value}`;
});

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function resetState() {
  clearRetryTimer();
  attempt.value = 0;
  loaded.value = false;
  hiddenUntilRetry.value = false;
  usingFallback.value = false;
  failed.value = false;
}

function retryManually() {
  resetState();
  attempt.value = 1;
}

function scheduleRetry() {
  if (!props.src || retryTimer) {
    return;
  }

  const canRetry = (props.retryWhile && !props.showRetry) || attempt.value < props.maxRetries;
  if (!canRetry) {
    return;
  }

  retryTimer = setTimeout(() => {
    retryTimer = null;
    hiddenUntilRetry.value = false;
    attempt.value += 1;
  }, props.retryDelayMs);
}

function handleLoad() {
  clearRetryTimer();
  loaded.value = true;
}

function handleError() {
  loaded.value = false;

  if (!usingFallback.value && props.fallbackSrc && props.fallbackSrc !== props.src) {
    clearRetryTimer();
    attempt.value = 0;
    hiddenUntilRetry.value = false;
    usingFallback.value = true;
    return;
  }

  const canRetry = (props.retryWhile && !props.showRetry) || attempt.value < props.maxRetries;
  if (!canRetry) {
    failed.value = true;
    hiddenUntilRetry.value = true;
    return;
  }

  hiddenUntilRetry.value = true;
  scheduleRetry();
}

watch(() => [props.src, props.fallbackSrc] as const, resetState);
watch(
  () => props.retryWhile,
  (retryWhile) => {
    if (retryWhile && hiddenUntilRetry.value && !failed.value) {
      scheduleRetry();
    }
  }
);

onBeforeUnmount(clearRetryTimer);
</script>
