import { defineStore } from 'pinia';

export interface ImmersiveImageTarget {
  id: number;
  filename: string;
  /** Shown instantly so the layer never opens on an empty frame. */
  thumbnailUrl: string;
  /** Full-size source, loaded over the thumbnail once it decodes. */
  fullUrl: string;
  width: number;
  height: number;
  caption?: string | null;
  folderSlug?: string;
}

interface ImmersiveImageState {
  target: ImmersiveImageTarget | null;
}

export const useImmersiveImageStore = defineStore('immersiveImage', {
  state: (): ImmersiveImageState => ({
    target: null
  }),
  getters: {
    isOpen: (state) => state.target !== null
  },
  actions: {
    open(target: ImmersiveImageTarget) {
      this.target = target;
    },

    close() {
      this.target = null;
    },

    reset() {
      this.target = null;
    }
  }
});
