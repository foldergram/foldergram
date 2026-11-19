import { readonly, ref } from 'vue';

const STORAGE_KEY = 'foldergram-show-suggested-folders-on-desktop';
const enabled = ref(readPreference());
const saveFailed = ref(false);

function readPreference(): boolean {
  if (typeof window === 'undefined') return true;

  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function useSuggestedFoldersPreference() {
  function setEnabled(value: boolean): boolean {
    enabled.value = value;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
      saveFailed.value = false;
      return true;
    } catch {
      saveFailed.value = true;
      return false;
    }
  }

  return { enabled: readonly(enabled), saveFailed: readonly(saveFailed), setEnabled };
}
