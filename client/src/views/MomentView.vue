<template>
  <section class="w-[min(100%,58rem)] mx-auto">
    <EmptyState
      v-if="appStore.isLibraryUnavailable"
      title="Library storage unavailable"
      :description="appStore.libraryUnavailableReason"
    />
    <section v-else-if="appStore.isRebuilding && !momentsStore.currentCapsule" class="card p-8 text-center">
      <p class="m-0 text-muted">{{ t('moments.view.rebuilding') }}</p>
    </section>
    <ErrorState
      v-else-if="momentsStore.momentError"
      :title="t('moments.view.loadError', { label: inlineRailLabel })"
      :message="momentsStore.momentError"
    />
    <section v-else-if="momentsStore.loadingMoment && !momentsStore.currentCapsule" class="card p-8 text-center">
      <p class="m-0 text-muted">{{ t('moments.view.loading', { label: inlineRailLabel }) }}</p>
    </section>
    <template v-else-if="momentsStore.currentCapsule">
      <header class="grid gap-5 p-5 mb-5 border border-border rounded-[1.25rem] bg-surface shadow-[var(--shadow)] md:grid-cols-[6.5rem_minmax(0,1fr)]">
        <div class="overflow-hidden rounded-[1.1rem] aspect-square bg-surface-alt">
          <img
            class="block object-cover w-full h-full"
            :src="momentsStore.currentCapsule.coverImage.thumbnailUrl"
            :alt="momentsStore.currentCapsule.title"
            loading="lazy"
          />
        </div>
        <div class="grid gap-[0.55rem]">
          <span class="text-[0.74rem] font-bold tracking-[0.11em] uppercase text-accent-strong">{{ momentsStore.displayRailSingularLabel }}</span>
          <div class="grid gap-[0.2rem]">
            <h1 class="m-0 text-[1.7rem] leading-tight">{{ momentsStore.currentCapsule.title }}</h1>
            <p class="m-0 text-[0.96rem] text-muted">{{ momentsStore.currentCapsule.subtitle }}</p>
          </div>
          <div class="flex flex-wrap gap-3 text-[0.82rem] text-muted">
            <span>{{ t('moments.view.postCount', { count: momentsStore.currentCapsule.imageCount }) }}</span>
            <span>{{ momentsStore.currentCapsule.dateContext }}</span>
          </div>
        </div>
      </header>

      <FeedList :items="momentsStore.currentImages" :show-skeleton="!hasLoadedOnce && momentsStore.loadingMoment" />
      <InfiniteLoader
        :loading="momentsStore.loadingMoment"
        :has-more="momentsStore.currentHasMore"
        @load-more="loadMore"
      />
    </template>
    <EmptyState
      v-else-if="hasLoadedOnce && !momentsStore.loadingMoment"
      :title="t('moments.view.emptyTitle', { label: inlineRailLabel })"
      :description="t('moments.view.emptyDescription', { label: inlineRailLabel })"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FeedList from '../components/FeedList.vue';
import InfiniteLoader from '../components/InfiniteLoader.vue';
import { useAppStore } from '../stores/app';
import { useMomentsStore } from '../stores/moments';

const props = defineProps<{
  id: string;
}>();

const appStore = useAppStore();
const momentsStore = useMomentsStore();
const hasLoadedOnce = ref(false);
const { t, locale } = useI18n();
// German capitalizes nouns, so the rail label keeps its casing when used inline.
const inlineRailLabel = computed(() =>
  locale.value === 'de' ? momentsStore.displayRailSingularLabel : momentsStore.displayRailSingularLabel.toLowerCase()
);

async function loadMoment() {
  if (appStore.isLibraryUnavailable) {
    hasLoadedOnce.value = true;
    return;
  }

  await momentsStore.loadMoment(props.id, true);
  hasLoadedOnce.value = true;
}

async function loadMore() {
  if (momentsStore.currentHasMore) {
    await momentsStore.loadMoment(props.id, false);
  }
}

onMounted(loadMoment);
watch(
  () => props.id,
  async () => {
    hasLoadedOnce.value = false;
    await loadMoment();
  }
);
</script>
