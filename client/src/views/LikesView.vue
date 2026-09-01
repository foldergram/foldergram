<template>
  <section class="w-[min(100%,58rem)] mx-auto">
    <EmptyState
      v-if="appStore.isLibraryUnavailable"
      title="Library storage unavailable"
      :description="appStore.libraryUnavailableReason"
    />
    <section v-else-if="appStore.isRebuilding && likesStore.items.length === 0" class="card p-8 text-center">
      <p class="m-0 text-muted">{{ t('likes.view.rebuilding', { label: likesStore.collectionLabel }) }}</p>
    </section>
    <ErrorState v-else-if="likesStore.error" :title="likesStore.errorTitle" :message="likesStore.error" />
    <template v-else>
      <div class="flex justify-center py-[0.95rem] mb-[0.45rem] border-t border-border" :aria-label="t('likes.view.sectionsAria', { label: likesStore.collectionLabel })">
        <span class="relative pt-[0.1rem] text-text text-[0.78rem] font-bold tracking-[0.11em] uppercase">
          <span class="absolute left-0 right-0 top-[-1.05rem] h-px bg-text" aria-hidden="true"></span>
          {{ likesStore.collectionSectionLabel }}
        </span>
      </div>
      <EmptyState
        v-if="!likesStore.loading && likesStore.items.length === 0"
        :title="likesStore.emptyTitle"
        :description="likesStore.emptyDescription"
      />
      <div v-else-if="likesStore.loading" class="card p-8 text-center">
        <p class="text-muted">{{ likesStore.loadingLabel }}</p>
      </div>
      <FolderGrid v-else :items="likesStore.items" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FolderGrid from '../components/FolderGrid.vue';
import { useAppStore } from '../stores/app';
import { useLikesStore } from '../stores/likes';

// Named explicitly so <KeepAlive include> keeps matching after a minified build.
defineOptions({ name: 'LikesView' });

const appStore = useAppStore();
const likesStore = useLikesStore();
const { t } = useI18n();

onMounted(async () => {
  if (appStore.isLibraryUnavailable) {
    return;
  }

  await likesStore.initialize();
});
</script>
