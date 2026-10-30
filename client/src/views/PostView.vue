<template>
  <div :class="modal ? 'image-view image-view--modal' : 'image-view image-view--page'" @click.stop>
    <ErrorState v-if="viewerStore.error" :title="t('post.view.loadErrorTitle')" :message="viewerStore.error" />
    <PostViewer
      v-else-if="activeImage"
      :image="activeImage"
      :folder="folder"
      :is-modal="modal"
      :deleting="viewerStore.deleting"
      @close="emit('close')"
      @delete="openDeleteDialog"
    />
    <div v-else-if="viewerStore.loading" class="card p-8 text-center">
      <p class="text-muted">{{ t('post.view.loading') }}</p>
    </div>
    <ConfirmDialog
      v-if="confirmDeleteOpen"
      :title="t('post.feedCard.delete.title')"
      :message="deleteDialogMessage"
      :confirm-label="deleteDialogConfirmLabel"
      :loading="viewerStore.deleting"
      @cancel="confirmDeleteOpen = false"
      @confirm="handleDelete"
    >
      <template #details>
        <label class="flex items-start gap-3 mt-3 cursor-pointer select-none">
          <input
            v-model="deleteOriginalFromDisk"
            class="mt-[0.2rem]"
            type="checkbox"
            :disabled="viewerStore.deleting"
          />
          <span class="grid gap-[0.18rem]">
            <span class="text-[0.92rem] font-semibold text-text">{{ t('post.feedCard.delete.deleteOriginalLabel') }}</span>
            <span class="text-[0.84rem] text-muted">{{ t('post.feedCard.delete.deleteOriginalDescription') }}</span>
          </span>
        </label>
        <p
          v-if="deleteOriginalFromDisk"
          class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
        >
          {{ t('post.feedCard.delete.deleteOriginalWarning') }}
        </p>
        <p
          v-if="deleteError"
          class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
        >
          {{ deleteError }}
        </p>
      </template>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import ConfirmDialog from '../components/ConfirmDialog.vue';
import ErrorState from '../components/ErrorState.vue';
import PostViewer from '../components/PostViewer.vue';
import { useAppStore } from '../stores/app';
import { useFeedStore } from '../stores/feed';
import { useLikesStore } from '../stores/likes';
import { useFoldersStore } from '../stores/folders';
import { useMomentsStore } from '../stores/moments';
import { useViewerStore } from '../stores/viewer';

const props = defineProps<{
  id: string;
  modal?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const appStore = useAppStore();
const feedStore = useFeedStore();
const likesStore = useLikesStore();
const viewerStore = useViewerStore();
const foldersStore = useFoldersStore();
const momentsStore = useMomentsStore();
const route = useRoute();
const router = useRouter();
const confirmDeleteOpen = ref(false);
const deleteOriginalFromDisk = ref(false);
const deleteError = ref<string | null>(null);

const imageId = computed(() => Number(props.id));
const activeMediaType = computed(() => (route.query.tab === 'reels' ? 'video' : undefined));
const activeImage = computed(() => (viewerStore.image?.id === imageId.value ? viewerStore.image : null));
const folder = computed(() =>
  activeImage.value ? foldersStore.items.find((entry) => entry.slug === activeImage.value?.folderSlug) ?? null : null
);
const deleteDialogMessage = computed(() =>
  deleteOriginalFromDisk.value
    ? t('post.feedCard.delete.messagePermanent')
    : t('post.feedCard.delete.messageTrash')
);
const deleteDialogConfirmLabel = computed(() => (deleteOriginalFromDisk.value ? t('post.feedCard.delete.confirmPermanent') : t('post.feedCard.delete.confirm')));

async function loadImage() {
  if (Number.isFinite(imageId.value)) {
    await viewerStore.loadImage(imageId.value, activeMediaType.value);
  }
}

watch(() => [imageId.value, activeMediaType.value] as const, loadImage, { immediate: true });

function openDeleteDialog() {
  deleteOriginalFromDisk.value = false;
  deleteError.value = null;
  confirmDeleteOpen.value = true;
}

async function handleDelete() {
  if (!viewerStore.image) {
    return;
  }

  const currentImage = viewerStore.image;
  deleteError.value = null;

  try {
    const deleted = await viewerStore.deleteImage(currentImage.id, {
      permanent: deleteOriginalFromDisk.value
    });
    confirmDeleteOpen.value = false;
    deleteOriginalFromDisk.value = false;

    feedStore.removeImage(deleted.id);
    likesStore.removeImage(deleted.id);
    const removedFolder = foldersStore.removeImage(deleted.id, deleted.folderSlug, currentImage.mediaType);
    momentsStore.removeImage(deleted.id);
    appStore.removeIndexedImage(removedFolder ? 1 : 0, currentImage.mediaType);

    if (props.modal) {
      emit('close');
      return;
    }

    if (removedFolder) {
      await router.replace({ name: 'library' });
      return;
    }

    await router.replace({ name: 'folder', params: { slug: deleted.folderSlug } });
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : t('post.view.deleteError');
  }
}
</script>

<style scoped>
.image-view {
  width: min(100%, 72rem);
}

.image-view--modal {
  display: flex;
  justify-content: center;
  min-height: 0;
  height: 100%;
  max-height: 100%;
}

.image-view--page {
  margin: 0 auto;
}
</style>
