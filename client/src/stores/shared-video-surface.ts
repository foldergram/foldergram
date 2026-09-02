import { markRaw } from 'vue';
import { defineStore } from 'pinia';
import type { MediaPlayerElement } from 'vidstack/elements';

/** Registry for the one physical player handed between an inline surface and immersive UI. */
interface SharedVideoSurfaceState {
  ownerId: string | null;
  target: HTMLElement | null;
  orientation: 'normal' | 'rotated';
}

const players = new Map<string, MediaPlayerElement>();

export const useSharedVideoSurfaceStore = defineStore('sharedVideoSurface', {
  state: (): SharedVideoSurfaceState => ({
    ownerId: null,
    target: null,
    orientation: 'normal'
  }),
  getters: {
    isAttached: (state) => state.ownerId !== null && state.target !== null
  },
  actions: {
    register(id: string, player: MediaPlayerElement) {
      players.set(id, player);
    },
    unregister(id: string) {
      players.delete(id);
      if (this.ownerId === id) this.release();
    },
    claim(id: string) {
      if (!players.has(id)) return false;
      this.ownerId = id;
      this.target = null;
      this.orientation = 'normal';
      return true;
    },
    attach(target: HTMLElement) {
      if (!this.ownerId || !players.has(this.ownerId)) return false;
      this.target = markRaw(target);
      return true;
    },
    setOrientation(orientation: 'normal' | 'rotated') {
      this.orientation = orientation;
    },
    getPlayer(id: string | null) {
      return id ? players.get(id) ?? null : null;
    },
    release() {
      this.ownerId = null;
      this.target = null;
      this.orientation = 'normal';
    }
  }
});
