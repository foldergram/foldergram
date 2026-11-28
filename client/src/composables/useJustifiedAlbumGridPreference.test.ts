import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const key = 'foldergram-justified-album-grid';

describe('justified album grid preference', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to the Instagram-style grid and shares a persisted opt-in', async () => {
    const { useJustifiedAlbumGridPreference } = await import('./useJustifiedAlbumGridPreference');
    const first = useJustifiedAlbumGridPreference();
    const second = useJustifiedAlbumGridPreference();
    expect(first.enabled.value).toBe(false);
    expect(first.setEnabled(true)).toBe(true);
    expect(second.enabled.value).toBe(true);
    expect(window.localStorage.getItem(key)).toBe('true');
    vi.resetModules();
    const reloaded = (await import('./useJustifiedAlbumGridPreference')).useJustifiedAlbumGridPreference();
    expect(reloaded.enabled.value).toBe(true);
    expect(reloaded.setEnabled(false)).toBe(true);
    expect(window.localStorage.getItem(key)).toBe('false');
  });

  it('allows session-only changes when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    const { useJustifiedAlbumGridPreference } = await import('./useJustifiedAlbumGridPreference');
    const preference = useJustifiedAlbumGridPreference();
    expect(preference.enabled.value).toBe(false);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(preference.setEnabled(true)).toBe(false);
    expect(preference.enabled.value).toBe(true);
    expect(preference.saveFailed.value).toBe(true);
    write.mockRestore();
    expect(preference.setEnabled(false)).toBe(true);
    expect(preference.saveFailed.value).toBe(false);
  });
});
