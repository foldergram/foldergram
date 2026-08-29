import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { deleteImage, trashImage } from '../api/gallery';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useCollectionsStore } from '../stores/collections';
import { useExploreStore } from '../stores/explore';
import { useFeedStore } from '../stores/feed';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import { useMomentsStore } from '../stores/moments';
import { usePlacesStore } from '../stores/places';
import { useReelsStore } from '../stores/reels';
import type { FeedItem } from '../types/api';

type DeletableItem = Pick<FeedItem, 'id' | 'mediaType'>;

/**
 * The delete-to-trash flow shared by every surface that shows a post: reels, the
 * immersive layers and the feed card. Trashing is the default because the Trash
 * view is what makes the action recoverable; only the explicit checkbox removes
 * the file from disk.
 */
export function usePostDeletion() {
  const { t } = useI18n();
  const appStore = useAppStore();
  const authStore = useAuthStore();
  const collectionsStore = useCollectionsStore();
  const exploreStore = useExploreStore();
  const feedStore = useFeedStore();
  const foldersStore = useFoldersStore();
  const likesStore = useLikesStore();
  const momentsStore = useMomentsStore();
  const placesStore = usePlacesStore();
  const reelsStore = useReelsStore();

  const isConfirmOpen = ref(false);
  const isDeleting = ref(false);
  const deleteOriginalFromDisk = ref(false);
  const error = ref<string | null>(null);

  const canDelete = computed(() => authStore.canDeleteMedia);
  const dialogMessage = computed(() =>
    deleteOriginalFromDisk.value
      ? t('post.feedCard.delete.messagePermanent')
      : t('post.feedCard.delete.messageTrash')
  );
  const dialogConfirmLabel = computed(() =>
    deleteOriginalFromDisk.value ? t('post.feedCard.delete.confirmPermanent') : t('post.feedCard.delete.confirm')
  );

  function requestDelete() {
    if (!canDelete.value) {
      return;
    }

    deleteOriginalFromDisk.value = false;
    error.value = null;
    isConfirmOpen.value = true;
  }

  function cancelDelete() {
    isConfirmOpen.value = false;
    deleteOriginalFromDisk.value = false;
    error.value = null;
  }

  // Every list that can hold the post has to drop it, otherwise a tile the viewer just
  // deleted from Search or a collection stays on screen until the next reload.
  function applyRemoval(deleted: { id: number; folderSlug: string }, mediaType: DeletableItem['mediaType']) {
    feedStore.removeImage(deleted.id);
    reelsStore.removeImage(deleted.id);
    likesStore.removeImage(deleted.id);
    collectionsStore.removeImage(deleted.id);
    exploreStore.removeImage(deleted.id);
    placesStore.removeImage(deleted.id);
    const removedFolder = foldersStore.removeImage(deleted.id, deleted.folderSlug, mediaType);
    momentsStore.removeImage(deleted.id);
    appStore.removeIndexedImage(removedFolder ? 1 : 0, mediaType);
  }

  /**
   * Moving a post to the Trash without a dialog. The Trash view is what makes the
   * action recoverable, so a confirmation there only slows the viewer down; the
   * confirmation is reserved for the paths that erase the file from disk.
   */
  async function trashNow(item: DeletableItem): Promise<boolean> {
    if (!canDelete.value) {
      return false;
    }

    isDeleting.value = true;
    error.value = null;

    try {
      const deleted = await trashImage(item.id);
      applyRemoval(deleted, item.mediaType);
      return true;
    } catch (deleteError) {
      error.value = deleteError instanceof Error ? deleteError.message : 'Unable to delete post';
      return false;
    } finally {
      isDeleting.value = false;
    }
  }

  async function confirmDelete(item: DeletableItem): Promise<boolean> {
    if (!canDelete.value) {
      return false;
    }

    isDeleting.value = true;
    error.value = null;

    try {
      const deleted = deleteOriginalFromDisk.value ? await deleteImage(item.id) : await trashImage(item.id);
      applyRemoval(deleted, item.mediaType);
      isConfirmOpen.value = false;
      deleteOriginalFromDisk.value = false;
      return true;
    } catch (deleteError) {
      error.value = deleteError instanceof Error ? deleteError.message : 'Unable to delete post';
      return false;
    } finally {
      isDeleting.value = false;
    }
  }

  return {
    canDelete,
    isConfirmOpen,
    isDeleting,
    deleteOriginalFromDisk,
    error,
    dialogMessage,
    dialogConfirmLabel,
    requestDelete,
    cancelDelete,
    confirmDelete,
    trashNow
  };
}
