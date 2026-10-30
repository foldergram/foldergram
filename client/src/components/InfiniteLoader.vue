<template>
  <div ref="sentinel" class="flex justify-center pt-[1.2rem]">
    <button
      v-if="showButton"
      class="btn-primary min-w-[8.5rem]"
      type="button"
      @click="$emit('load-more')"
    >
      {{ t('common.loadMore') }}
    </button>
    <span v-else-if="loading" class="text-muted">{{ t('common.loadingMore') }}</span>
    <span v-else-if="hasMore" class="sr-only">{{ t('common.loadingContinues') }}</span>
    <span v-else class="text-muted">{{ t('common.youAreCaughtUp') }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(defineProps<{
  loading: boolean;
  hasMore: boolean;
  buttonFallback?: boolean;
}>(), {
  buttonFallback: true
});

const emit = defineEmits<{
  'load-more': [];
}>();

const { t } = useI18n();
const sentinel = ref<HTMLElement | null>(null);
const isIntersecting = ref(false);
let observer: IntersectionObserver | null = null;

const showButton = computed(() => props.buttonFallback && !props.loading && props.hasMore);

function maybeLoadMore() {
  if (!isIntersecting.value || !props.hasMore || props.loading) {
    return;
  }

  emit('load-more');
}

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    isIntersecting.value = entries.some((entry) => entry.isIntersecting);
    maybeLoadMore();
  }, {
    rootMargin: '240px 0px'
  });

  if (sentinel.value) {
    observer.observe(sentinel.value);
  }
});

watch(
  () => [props.loading, props.hasMore] as const,
  () => {
    maybeLoadMore();
  }
);

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>
