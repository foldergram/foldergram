import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const key = 'foldergram-fit-tall-media-to-screen';
const foldersKey = 'foldergram-show-suggested-folders-on-desktop';

describe('fit tall media preference', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to off even when suggested folders are hidden', async () => {
    window.localStorage.setItem(foldersKey, 'false');
    const { useFitTallMediaPreference } = await import('./useFitTallMediaPreference');
    expect(useFitTallMediaPreference().enabled.value).toBe(false);
  });

  it('persists and shares changes without changing the suggested folders preference', async () => {
    const { useFitTallMediaPreference } = await import('./useFitTallMediaPreference');
    const { useSuggestedFoldersPreference } = await import('./useSuggestedFoldersPreference');
    const fitting = useFitTallMediaPreference();
    const second = useFitTallMediaPreference();
    const folders = useSuggestedFoldersPreference();
    expect(fitting.setEnabled(true)).toBe(true);
    expect(second.enabled.value).toBe(true);
    expect(window.localStorage.getItem(key)).toBe('true');
    expect(folders.enabled.value).toBe(true);
    folders.setEnabled(false);
    expect(second.enabled.value).toBe(true);
    expect(fitting.setEnabled(false)).toBe(true);
    expect(second.enabled.value).toBe(false);
    expect(window.localStorage.getItem(key)).toBe('false');
    expect(folders.enabled.value).toBe(false);
  });

  it('restores an explicit opt-in after reload', async () => {
    window.localStorage.setItem(key, 'true');
    const { useFitTallMediaPreference } = await import('./useFitTallMediaPreference');
    expect(useFitTallMediaPreference().enabled.value).toBe(true);
  });

  it('keeps session changes usable and reports failed persistence until a save succeeds', async () => {
    const { useFitTallMediaPreference } = await import('./useFitTallMediaPreference');
    const fitting = useFitTallMediaPreference();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(fitting.setEnabled(true)).toBe(false);
    expect(fitting.enabled.value).toBe(true);
    expect(fitting.saveFailed.value).toBe(true);
    write.mockRestore();
    expect(fitting.setEnabled(false)).toBe(true);
    expect(fitting.saveFailed.value).toBe(false);
  });

  it('defaults to off when reading storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    const { useFitTallMediaPreference } = await import('./useFitTallMediaPreference');
    expect(useFitTallMediaPreference().enabled.value).toBe(false);
  });
});
