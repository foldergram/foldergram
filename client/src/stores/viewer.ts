import { defineStore } from 'pinia';

import { deleteImage, fetchImage, trashImage } from '../api/gallery';
import { i18n } from '../locales';
import type { DeleteImageResult, ImageDetail } from '../types/api';

interface ViewerState {
  image: ImageDetail | null;
  loading: boolean;
  deleting: boolean;
  error: string | null;
}

let viewerLoadToken = 0;

export const useViewerStore = defineStore('viewer', {
  state: (): ViewerState => ({
    image: null,
    loading: false,
    deleting: false,
    error: null
  }),
  actions: {
    reset() {
      viewerLoadToken += 1;
      this.image = null;
      this.loading = false;
      this.deleting = false;
      this.error = null;
    },

    async loadImage(id: number, mediaType?: 'image' | 'video') {
      const requestToken = ++viewerLoadToken;
      this.loading = true;
      this.error = null;

      try {
        const image = await fetchImage(id, mediaType);
        if (requestToken !== viewerLoadToken) {
          return;
        }

        this.image = image;
      } catch (error) {
        if (requestToken !== viewerLoadToken) {
          return;
        }

        this.image = null;
        this.error = error instanceof Error ? error.message : i18n.global.t('errors.loadPost');
      } finally {
        if (requestToken === viewerLoadToken) {
          this.loading = false;
        }
      }
    },

    updateCaption(id: number, caption: string | null) {
      if (this.image?.id !== id) {
        return;
      }

      this.image = {
        ...this.image,
        caption
      };
    },

    async deleteImage(id: number, options: { permanent?: boolean } = {}): Promise<DeleteImageResult> {
      this.deleting = true;
      this.error = null;

      try {
        const payload = options.permanent ? await deleteImage(id) : await trashImage(id);
        if (this.image?.id === id) {
          this.image = null;
        }

        return payload;
      } catch (error) {
        this.error = error instanceof Error ? error.message : i18n.global.t('post.view.deleteError');
        throw error;
      } finally {
        this.deleting = false;
      }
    }
  }
});
