import { ref } from 'vue';

const STORAGE_KEY = 'foldergram-show-suggested-folders-on-desktop';
const enabled = ref(readPreference());

function readPreference(): boolean {
  if (typeof window === 'undefined') return true;

  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function useSuggestedFoldersPreference() {
  function setEnabled(value: boolean) {
    enabled.value = value;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Keep the setting usable for this session when storage is unavailable.
    }
  }

  return { enabled, setEnabled };
}
