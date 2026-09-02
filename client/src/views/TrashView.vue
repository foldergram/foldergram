<template>
  <section class="w-[min(100%,72rem)] mx-auto grid gap-[1.1rem]">
    <header class="flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start">
      <div class="flex flex-col items-start gap-[0.25rem]">
        <span class="eyebrow">{{ t('trashPage.eyebrow') }}</span>
        <h1 class="m-0 text-[clamp(1.5rem,2.2vw,1.9rem)] tracking-[-0.03em]">{{ t('trashPage.title') }}</h1>
        <p class="m-0 text-muted">
          {{ t('trashPage.description') }}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[0.82rem] text-muted tabular-nums">{{ selectedCountLabel }}</span>
        <button
          class="min-h-[2.35rem] px-4 py-[0.6rem] rounded-[0.75rem] border border-border bg-surface text-text font-semibold disabled:opacity-55 disabled:cursor-not-allowed"
          type="button"
          :disabled="trashStore.items.length === 0 || processing"
          @click="toggleAllVisible"
        >
          {{ allVisibleSelected ? t('trashPage.deselectAll') : t('trashPage.selectAll') }}
        </button>
        <button
          class="min-h-[2.35rem] px-4 py-[0.6rem] rounded-[0.75rem] border border-border bg-surface text-text font-semibold disabled:opacity-55 disabled:cursor-not-allowed"
          type="button"
          :disabled="selectedCount === 0 || processing"
          @click="restoreConfirmOpen = true"
        >
          {{ t('trashPage.restoreButton') }}
        </button>
        <button
          class="min-h-[2.35rem] px-4 py-[0.6rem] rounded-[0.75rem] border border-transparent bg-[#b42318] text-white font-semibold disabled:opacity-55 disabled:cursor-not-allowed"
          type="button"
          :disabled="selectedCount === 0 || processing"
          @click="permanentConfirmOpen = true"
        >
          {{ t('trashPage.deleteButton') }}
        </button>
      </div>
    </header>

    <EmptyState
      v-if="appStore.isLibraryUnavailable"
      :title="t('trashPage.libraryUnavailableTitle')"
      :description="libraryUnavailableDescription"
    />
    <ErrorState
      v-else-if="trashStore.error && trashStore.items.length === 0"
      :title="t('trashPage.loadErrorTitle')"
      :message="trashStore.error"
    />
    <template v-else>
      <p
        v-if="deletionProgressLabel"
        class="m-0 px-4 py-[0.75rem] rounded-[0.85rem] border border-border text-[0.88rem] text-muted bg-surface"
        role="status"
        aria-live="polite"
      >
        {{ deletionProgressLabel }}
      </p>
      <div
        v-else-if="deletionFailureLabel"
        class="m-0 flex items-center justify-between gap-3 px-4 py-[0.75rem] rounded-[0.85rem] border border-[rgba(217,48,37,0.24)] text-[0.88rem] text-[#b42318] bg-[rgba(217,48,37,0.08)] max-sm:flex-col max-sm:items-start"
      >
        <span>{{ deletionFailureLabel }}</span>
        <button
          class="min-h-[2rem] px-3 py-[0.4rem] rounded-[0.6rem] border border-[rgba(217,48,37,0.32)] bg-transparent text-[#b42318] font-semibold"
          type="button"
          @click="dismissDeletionResult"
        >
          {{ t('trashPage.dismissDeletionResult') }}
        </button>
      </div>
      <p
        v-if="actionError"
        class="m-0 px-4 py-[0.75rem] rounded-[0.85rem] border border-[rgba(217,48,37,0.24)] text-[0.88rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
      >
        {{ actionError }}
      </p>

      <section
        v-if="trashStore.loading && !trashStore.initialized && trashStore.items.length === 0"
        class="card p-8 text-center"
      >
        <p class="m-0 text-muted">{{ t('trashPage.loading') }}</p>
      </section>
      <EmptyState
        v-else-if="trashStore.initialized && trashStore.items.length === 0"
        :title="t('trashPage.emptyTitle')"
        :description="t('trashPage.emptyDescription')"
      />
      <template v-else>
        <section class="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <article
            v-for="item in trashStore.items"
            :key="item.id"
            :class="[
              'group overflow-hidden rounded-[0.9rem] border bg-surface transition-[border-color,box-shadow,transform,background-color] duration-180',
              isSelected(item.id)
                ? 'border-[color-mix(in_srgb,var(--accent)_40%,var(--border)_60%)] bg-[color-mix(in_srgb,var(--surface)_90%,var(--accent)_10%)] shadow-[0_16px_36px_rgba(0,149,246,0.14)]'
                : 'border-border'
            ]"
          >
            <label class="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none border-b border-border">
              <span class="text-[0.8rem] font-semibold text-text truncate">
                {{ formatDisplayFolderTitle(item) }}
              </span>
              <input
                class="cursor-pointer"
                type="checkbox"
                :checked="isSelected(item.id)"
                @change="toggleSelected(item.id)"
              />
            </label>

            <button
              class="relative block w-full aspect-square overflow-hidden border-0 p-0 text-left cursor-pointer bg-surface-alt"
              type="button"
              :aria-pressed="isSelected(item.id)"
              :aria-label="itemSelectionAriaLabel(item.id, displayCaption(item))"
              @click="toggleSelected(item.id)"
            >
              <ResilientImage
                :src="item.thumbnailUrl"
                :alt="item.filename"
                loading="lazy"
                :retry-while="appStore.isInitialScan"
                :class="[
                  'h-full w-full object-cover transition-[transform,filter] duration-180',
                  isSelected(item.id) ? 'scale-[1.02] saturate-[1.05]' : 'group-hover:scale-[1.01]'
                ]"
              />
              <div
                v-if="item.mediaType === 'video'"
                class="absolute inset-x-0 top-0 flex items-center justify-between px-2 py-2 text-white pointer-events-none bg-[linear-gradient(180deg,rgba(10,14,24,0.72)_0%,rgba(10,14,24,0)_100%)]"
              >
                <span class="i-fluent-play-circle-24-filled w-[1.05rem] h-[1.05rem]" aria-hidden="true" />
              </div>
              <div
                :class="[
                  'absolute inset-0 pointer-events-none transition-colors duration-180',
                  isSelected(item.id) ? 'bg-[rgba(0,149,246,0.16)]' : 'bg-transparent'
                ]"
              />
              <div
                :class="[
                  'absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full border shadow-[0_10px_28px_rgba(15,20,25,0.18)] transition-all duration-180',
                  isSelected(item.id)
                    ? 'border-transparent bg-accent text-white'
                    : 'border-[rgba(255,255,255,0.45)] bg-[rgba(10,14,24,0.46)] text-white/92'
                ]"
              >
                <span
                  :class="isSelected(item.id) ? 'i-fluent-checkmark-20-filled h-5 w-5' : 'i-fluent-square-20-regular h-5 w-5'"
                  aria-hidden="true"
                />
              </div>
            </button>

            <div class="grid gap-[0.35rem] px-3 py-3">
              <p class="m-0 text-[0.84rem] truncate">{{ displayCaption(item) }}</p>
              <p class="m-0 text-[0.74rem] text-muted">{{ t('trashPage.trashedAt', { date: formatTrashedAt(item.trashedAt) }) }}</p>
              <RouterLink class="text-[0.74rem] font-semibold text-accent-strong" :to="{ name: 'folder', params: { slug: item.folderSlug } }">
                {{ t('trashPage.openFolder') }}
              </RouterLink>
            </div>
          </article>
        </section>

        <InfiniteLoader :loading="trashStore.loading" :has-more="trashStore.hasMore" @load-more="trashStore.loadMore" />
      </template>
    </template>

    <ConfirmDialog
      v-if="restoreConfirmOpen"
      :title="t('trashPage.restoreDialog.title')"
      :message="restoreDialogMessage"
      :confirm-label="t('trashPage.restoreDialog.confirm')"
      :cancel-label="t('common.cancel')"
      :loading-label="progressLabel ?? t('trashPage.restoreDialog.loading')"
      :loading="processing"
      @cancel="restoreConfirmOpen = false"
      @confirm="handleRestore"
    />

    <ConfirmDialog
      v-if="permanentConfirmOpen"
      :title="t('trashPage.deleteDialog.title')"
      :message="permanentDeleteDialogMessage"
      :confirm-label="t('trashPage.deleteDialog.confirm')"
      :cancel-label="t('common.cancel')"
      :loading-label="progressLabel ?? t('trashPage.deleteDialog.loading')"
      :loading="processing"
      @cancel="permanentConfirmOpen = false"
      @confirm="handlePermanentDelete"
    >
      <template #details>
        <p class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]">
          {{ t('trashPage.deleteDialog.warning') }}
        </p>
      </template>
    </ConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import { restoreImage } from '../api/gallery';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import InfiniteLoader from '../components/InfiniteLoader.vue';
import ResilientImage from '../components/ResilientImage.vue';
import { useAppStore } from '../stores/app';
import { useFeedStore } from '../stores/feed';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import { useMomentsStore } from '../stores/moments';
import { useTrashStore } from '../stores/trash';
import { resolveDisplayCaption } from '../utils/caption';
import { formatFolderTitle } from '../utils/folder-titles';

const { t, locale } = useI18n();
const appStore = useAppStore();
const feedStore = useFeedStore();
const foldersStore = useFoldersStore();
const likesStore = useLikesStore();
const momentsStore = useMomentsStore();
const trashStore = useTrashStore();
const selectedIds = ref<number[]>([]);
const actionError = ref<string | null>(null);
const lastFailureMessage = ref<string | null>(null);
const processing = ref(false);
const processedCount = ref(0);
const processingTotal = ref(0);
const restoreConfirmOpen = ref(false);
const permanentConfirmOpen = ref(false);

const selectedCount = computed(() => selectedIds.value.length);
const allVisibleSelected = computed(
  () => trashStore.items.length > 0 && trashStore.items.every((item) => selectedIds.value.includes(item.id))
);
const libraryUnavailableDescription = computed(() => appStore.stats?.storage.reason ?? t('trashPage.libraryUnavailableDescription'));
const selectedCountLabel = computed(() => {
  const count = formatCount(selectedCount.value);
  return selectedCount.value === 1 ? t('trashPage.selectedOne', { count }) : t('trashPage.selectedOther', { count });
});
const restoreDialogMessage = computed(() => {
  const count = formatCount(selectedCount.value);
  return selectedCount.value === 1
    ? t('trashPage.restoreDialog.messageOne', { count })
    : t('trashPage.restoreDialog.messageOther', { count });
});
// Restores are quick, so their dialog keeps a simple in-place progress label.
const progressLabel = computed(() => {
  if (!processing.value || processingTotal.value === 0) {
    return undefined;
  }

  return t('trashPage.processingProgress', {
    done: formatCount(processedCount.value),
    total: formatCount(processingTotal.value)
  });
});
// Permanent deletion runs in the store so it keeps going while the user browses
// elsewhere. This banner reports its progress whenever the page is visible.
const deletionProgressLabel = computed(() => {
  if (!trashStore.deletionActive) {
    return null;
  }

  return t('trashPage.deletionProgress', {
    done: formatCount(trashStore.deletionProcessed),
    total: formatCount(trashStore.deletionTotal)
  });
});
const deletionFailureLabel = computed(() => {
  if (trashStore.deletionActive) {
    return null;
  }

  if (trashStore.deletionFailedCount === 0) {
    // A stalled batch (for example storage offline) reports a message without failures.
    return trashStore.deletionErrorMessage;
  }

  const count = formatCount(trashStore.deletionFailedCount);
  const summary =
    trashStore.deletionFailedCount === 1
      ? t('trashPage.errors.processOne', { count })
      : t('trashPage.errors.processOther', { count });

  return trashStore.deletionErrorMessage ? `${summary} ${trashStore.deletionErrorMessage}` : summary;
});
const permanentDeleteDialogMessage = computed(() => {
  const count = formatCount(selectedCount.value);
  return selectedCount.value === 1
    ? t('trashPage.deleteDialog.messageOne', { count })
    : t('trashPage.deleteDialog.messageOther', { count });
});

function isSelected(id: number): boolean {
  return selectedIds.value.includes(id);
}

function toggleSelected(id: number) {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((selectedId) => selectedId !== id);
    return;
  }

  selectedIds.value = [...selectedIds.value, id];
}

function toggleAllVisible() {
  if (allVisibleSelected.value) {
    const visibleIds = new Set(trashStore.items.map((item) => item.id));
    selectedIds.value = selectedIds.value.filter((id) => !visibleIds.has(id));
    return;
  }

  const selectedIdSet = new Set(selectedIds.value);
  for (const item of trashStore.items) {
    selectedIdSet.add(item.id);
  }
  selectedIds.value = [...selectedIdSet];
}

function displayCaption(item: { filename: string; caption?: string | null }) {
  return resolveDisplayCaption(item);
}

function formatDisplayFolderTitle(item: { folderName: string; folderBreadcrumb: string | null; folderPath: string }) {
  return formatFolderTitle(item, appStore.nestedFolderTitleFormat);
}

function formatCount(value: number) {
  return new Intl.NumberFormat(locale.value).format(value);
}

function formatTrashedAt(value: string | null) {
  if (!value) {
    return t('trashPage.recently');
  }

  return new Date(value).toLocaleString(locale.value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function itemSelectionAriaLabel(id: number, label: string) {
  return isSelected(id) ? t('trashPage.deselectItem', { label }) : t('trashPage.selectItem', { label });
}

async function refreshVisibleData() {
  await Promise.all([
    foldersStore.fetchFolders(true),
    feedStore.loadInitial(true),
    likesStore.initialize(true),
    momentsStore.fetchMoments(true),
    appStore.fetchStats({ background: true })
  ]);
}

function refreshVisibleDataInBackground() {
  void refreshVisibleData().catch((error) => {
    actionError.value = error instanceof Error ? error.message : t('trashPage.errors.refresh');
  });
}

async function processRestoreSelection() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) {
    return {
      succeededCount: 0,
      failedCount: 0
    };
  }

  processing.value = true;
  actionError.value = null;
  processedCount.value = 0;
  processingTotal.value = ids.length;
  const succeeded: number[] = [];
  let failedCount = 0;

  for (const id of ids) {
    try {
      await restoreImage(id);
      succeeded.push(id);
      // Drop the row as soon as the server confirms it so long batches show progress.
      trashStore.removeItems([id]);
      selectedIds.value = selectedIds.value.filter((selectedId) => selectedId !== id);
    } catch (error) {
      failedCount += 1;
      if (failedCount === 1) {
        lastFailureMessage.value = error instanceof Error ? error.message : null;
      }
    } finally {
      processedCount.value += 1;
    }
  }

  if (failedCount > 0) {
    const count = formatCount(failedCount);
    const summary =
      failedCount === 1 ? t('trashPage.errors.processOne', { count }) : t('trashPage.errors.processOther', { count });
    actionError.value = lastFailureMessage.value ? `${summary} ${lastFailureMessage.value}` : summary;
  }

  processing.value = false;
  processedCount.value = 0;
  processingTotal.value = 0;
  lastFailureMessage.value = null;

  if (succeeded.length > 0) {
    refreshVisibleDataInBackground();
  }

  return {
    succeededCount: succeeded.length,
    failedCount
  };
}

async function handleRestore() {
  const result = await processRestoreSelection();
  if (result.succeededCount > 0 || result.failedCount === 0) {
    restoreConfirmOpen.value = false;
  }
}

function handlePermanentDelete() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) {
    permanentConfirmOpen.value = false;
    return;
  }

  // Hand the batch to the server and close the dialog right away. The job keeps
  // running even if this tab is closed, so the user is free to browse elsewhere.
  permanentConfirmOpen.value = false;
  selectedIds.value = [];
  actionError.value = null;

  void trashStore.deletePermanently(ids);
}

function dismissDeletionResult() {
  void trashStore.dismissDeletionResult();
}

onMounted(async () => {
  if (appStore.isLibraryUnavailable) {
    return;
  }

  // Reconnect to a batch that may still be running from an earlier session.
  void trashStore.syncDeletionJob();

  if (trashStore.initialized) {
    void trashStore.loadInitial(true);
    return;
  }

  await trashStore.loadInitial(true);
});

// Once the server-side batch settles, refresh the other views so their counts
// reflect the removed posts.
watch(
  () => trashStore.deletionActive,
  (active, wasActive) => {
    if (wasActive && !active && trashStore.deletionTotal > 0) {
      refreshVisibleDataInBackground();
    }
  }
);

watch(
  () => trashStore.items.map((item) => item.id),
  (itemIds) => {
    const itemIdSet = new Set(itemIds);
    selectedIds.value = selectedIds.value.filter((id) => itemIdSet.has(id));
  },
  { immediate: true }
);
</script>
