import { defineStore } from 'pinia';

import type { FeedItem } from '../types/api';
import type { ResolvedVideoSource, VideoPlaybackMedia } from '../utils/video-playback';

/**
 * Everything the immersive layer needs to render a clip without refetching it.
 * Feed cards, reels and the post viewer all already hold these fields.
 */
export interface ImmersiveVideoTarget extends VideoPlaybackMedia {
  id: number;
  filename: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  durationMs: number | null;
  collectionItem?: FeedItem;
  /** Keep the source selected by the inline player during the handoff. */
  sourceOverride?: ResolvedVideoSource | null;
}

export interface ImmersiveExitState {
  id: number;
  currentTime: number;
  paused: boolean;
}

interface ImmersiveVideoState {
  target: ImmersiveVideoTarget | null;
  startTime: number;
  startPaused: boolean;
  exitState: ImmersiveExitState | null;
}

export const useImmersiveVideoStore = defineStore('immersiveVideo', {
  state: (): ImmersiveVideoState => ({
    target: null,
    startTime: 0,
    startPaused: false,
    exitState: null
  }),
  getters: {
    isOpen: (state) => state.target !== null
  },
  actions: {
    open(target: ImmersiveVideoTarget, options: { startTime?: number; startPaused?: boolean } = {}) {
      this.target = target;
      this.startTime = Number.isFinite(options.startTime) ? Math.max(0, options.startTime ?? 0) : 0;
      this.startPaused = options.startPaused === true;
      this.exitState = null;
    },

    /**
     * Records where playback stopped so the surface that opened the layer can
     * pick the clip back up at the same position instead of restarting it.
     */
    close(exitState: ImmersiveExitState | null = null) {
      this.exitState = exitState;
      this.target = null;
      this.startTime = 0;
      this.startPaused = false;
    },

    consumeExitState(id: number): ImmersiveExitState | null {
      if (!this.exitState || this.exitState.id !== id) {
        return null;
      }

      const exitState = this.exitState;
      this.exitState = null;
      return exitState;
    },

    reset() {
      this.target = null;
      this.startTime = 0;
      this.startPaused = false;
      this.exitState = null;
    }
  }
});
