import { defineStore } from 'pinia';
import { requestJson } from '../api/http';
import { useAppStore } from './app';
import { useFeedStore } from './feed';
import { useFoldersStore } from './folders';
import { useReelsStore } from './reels';
import { useMomentsStore } from './moments';
import { useExploreStore } from './explore';
import { useLikesStore } from './likes';
import { useCollectionsStore } from './collections';
import { useViewerStore } from './viewer';

export interface SourceStatus {
  id: number;
  name: string;
  enabled: number;
  status: string;
  generation: number;
  updated_at: string;
  available: boolean;
  syncing: boolean;
}

export const useSourcesStore = defineStore('sources', {
  state: () => ({
    items: [] as SourceStatus[],
    initialized: false,
    hasLocalPosts: null as boolean | null,
    contentRevision: 0,
    timer: null as ReturnType<typeof setInterval> | null,
    request: null as Promise<void> | null,
    session: 0
  }),
  getters: {
    unavailable: state => state.items.filter(s => s.enabled && s.status !== 'revoked' && !s.available),
    allContentUnavailable: state => state.initialized && state.hasLocalPosts === false &&
      state.items.some(s => s.enabled && s.status !== 'revoked' && !s.available) &&
      state.items.every(s => !s.enabled || s.status === 'revoked' || !s.available)
  },
  actions: {
    isUnavailable(id?: number | null) {
      return Boolean(id && this.unavailable.some(s => s.id === id));
    },
    canBrowse(id?: number | null) {
      const source = this.items.find(s => s.id === id);
      return !id || !source || Boolean(source.enabled && source.status !== 'revoked' && source.available);
    },
    refresh(retry = false): Promise<void> {
      const session = this.session;
      if (this.request) {
        if (!retry) return this.request;
        // A manual retry must run after an older poll, rather than inherit its
        // potentially stale failure. Do not carry it across an access reset.
        return this.request.then(() => {
          if (session === this.session) return this.refresh(true);
        });
      }
      const request = (async () => {
        try {
          const payload = await requestJson<{ items: SourceStatus[]; hasLocalPosts?: boolean }>(`/api/sources/status${retry ? '?retry=1' : ''}`);
          if (session !== this.session) return;
          const fingerprint = (items: SourceStatus[]) => JSON.stringify(items.map(s => [s.id, s.name, s.enabled, s.generation, s.updated_at, s.status === 'revoked']));
          const changed = this.initialized && fingerprint(this.items) !== fingerprint(payload.items);
          this.items = payload.items;
          this.hasLocalPosts = payload.hasLocalPosts ?? null;
          this.initialized = true;
          if (changed) {
            useFeedStore().resetForRebuild();
            useFoldersStore().resetForRebuild();
            useReelsStore().reset();
            useMomentsStore().resetForRebuild();
            useExploreStore().reset();
            useLikesStore().resetForRebuild();
            useCollectionsStore().resetForRebuild();
            useViewerStore().reset();
            // App owns this revision, so the active route reloads even after
            // Settings unmounts, including changes with identical asset counts.
            this.contentRevision++;
            await Promise.allSettled([
              useLikesStore().initialize(),
              useAppStore().fetchStats({ background: true }),
              useFoldersStore().fetchFolders(true)
            ]);
          }
        } catch { /* A Foldergram request failure is not an Immich outage. Poll again. */ }
      })();
      this.request = request;
      void request.finally(() => { if (this.request === request) this.request = null; });
      return request;
    },
    start() {
      if (this.timer) return;
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), 2000);
    },
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.session++;
      this.request = null;
      this.items = [];
      this.initialized = false;
      this.hasLocalPosts = null;
    }
  }
});
