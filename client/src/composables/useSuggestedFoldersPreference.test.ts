import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const key = 'foldergram-show-suggested-folders-on-desktop';

describe('suggested folders preference', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to enabled and shares immediate changes between consumers', async () => {
    const { useSuggestedFoldersPreference } = await import('./useSuggestedFoldersPreference');
    const first = useSuggestedFoldersPreference();
    const second = useSuggestedFoldersPreference();
    expect(first.enabled.value).toBe(true);
    expect(first.setEnabled(false)).toBe(true);
    expect(second.enabled.value).toBe(false);
    expect(window.localStorage.getItem(key)).toBe('false');
    expect(first.setEnabled(true)).toBe(true);
    expect(second.enabled.value).toBe(true);
    expect(window.localStorage.getItem(key)).toBe('true');
  });

  it('restores the existing browser preference after reload', async () => {
    window.localStorage.setItem(key, 'false');
    const { useSuggestedFoldersPreference } = await import('./useSuggestedFoldersPreference');
    expect(useSuggestedFoldersPreference().enabled.value).toBe(false);
  });

  it('keeps session changes usable and reports failed persistence until a save succeeds', async () => {
    const { useSuggestedFoldersPreference } = await import('./useSuggestedFoldersPreference');
    const preference = useSuggestedFoldersPreference();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(preference.setEnabled(false)).toBe(false);
    expect(preference.enabled.value).toBe(false);
    expect(preference.saveFailed.value).toBe(true);
    write.mockRestore();
    expect(preference.setEnabled(true)).toBe(true);
    expect(preference.saveFailed.value).toBe(false);
  });

  it('defaults to enabled when reading storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    const { useSuggestedFoldersPreference } = await import('./useSuggestedFoldersPreference');
    expect(useSuggestedFoldersPreference().enabled.value).toBe(true);
  });
});
