import { defineStore } from 'pinia';
import { requestJson } from '../api/http';
import { useAppStore } from './app';
import { useAuthStore } from './auth';

export type InstanceTheme = 'system' | 'light' | 'dark';
export type BrowserTheme = 'instance' | InstanceTheme;
export type Accent = 'blue' | 'purple' | 'green' | 'orange' | 'rose';
export interface Appearance { theme: InstanceTheme; accent: Accent }
const THEME_STORAGE_KEY = 'foldergram-theme';
const APPEARANCE_REQUEST_TIMEOUT_MS = 5000;

export const accentColors: Record<Accent, string> = {
  blue: '#1769d4', purple: '#7c3aed', green: '#15803d', orange: '#b45309', rose: '#be185d'
};
const darkColors: Record<Accent, string> = {
  blue: '#4cb5f9', purple: '#b794ff', green: '#4ade80', orange: '#fbbf24', rose: '#fb92b4'
};

export const useAppearanceStore = defineStore('appearance', {
  state: () => ({
    theme: 'system' as InstanceTheme, accent: 'blue' as Accent,
    browserTheme: 'instance' as BrowserTheme,
    browserSaveFailed: false,
    ready: false, loading: false, saving: false, error: '', revision: 0
  }),
  actions: {
    initialize() {
      try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        this.browserTheme = saved === 'system' || saved === 'light' || saved === 'dark' ? saved : 'instance';
      } catch { /* Use the instance default when storage is unavailable. */ }
      this.render();
    },
    setBrowserTheme(theme: BrowserTheme) {
      this.browserTheme = theme;
      try {
        if (theme === 'instance') {
          window.localStorage.removeItem(THEME_STORAGE_KEY);
        } else {
          window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        }
        this.browserSaveFailed = false;
      } catch {
        this.browserSaveFailed = true;
      }
      this.render();
      return !this.browserSaveFailed;
    },
    apply(value: Appearance) {
      this.revision += 1;
      this.theme = value.theme;
      this.accent = value.accent;
      this.ready = true;
      this.render();
    },
    render() {
      const theme = this.browserTheme === 'instance' ? this.theme : this.browserTheme;
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      useAppStore().setTheme(dark ? 'dark' : 'light');
      const root = document.documentElement;
      const color = (dark ? darkColors : accentColors)[this.accent];
      root.style.setProperty('--accent-rgb', [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)).join(','));
      root.style.setProperty('--sidebar-active-background', 'color-mix(in srgb, var(--accent) 10%, var(--surface))');
      root.style.setProperty('--accent', color);
      root.style.setProperty('--accent-strong', color);
      root.style.setProperty('--accent-soft', `color-mix(in srgb, ${color} ${dark ? 18 : 10}%, transparent)`);
    },
    async load() {
      if (this.loading || this.saving) return;
      const revision = this.revision;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), APPEARANCE_REQUEST_TIMEOUT_MS);
      this.loading = true;
      try {
        const value = await requestJson<Appearance>('/api/appearance', { signal: controller.signal });
        if (!this.saving && this.revision === revision) this.apply(value);
      } catch {
        // Preserve the last appearance during connection failures.
      } finally {
        window.clearTimeout(timeout);
        this.loading = false;
      }
    },
    async save(value: Appearance | { theme: 'light' | 'dark' }) {
      const replacesAppearance = 'accent' in value;
      if (!useAuthStore().canWriteAppearance || this.saving || (replacesAppearance && !this.ready)) return false;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), APPEARANCE_REQUEST_TIMEOUT_MS);
      this.revision += 1;
      this.saving = true;
      this.error = '';
      try {
        this.apply(await requestJson<Appearance>('/api/admin/settings/appearance', {
          method: replacesAppearance ? 'PUT' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
          signal: controller.signal
        }));
        return true;
      } catch {
        this.error = 'appearance.saveError';
        return false;
      } finally {
        window.clearTimeout(timeout);
        this.saving = false;
      }
    }
  }
});
