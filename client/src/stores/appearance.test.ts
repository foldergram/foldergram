import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppearanceStore } from './appearance';

const mocks = vi.hoisted(() => ({ request: vi.fn(), setTheme: vi.fn(), canWrite: true }));
vi.mock('../api/http', () => ({ requestJson: mocks.request }));
vi.mock('./app', () => ({ useAppStore: () => ({ setTheme: mocks.setTheme }) }));
vi.mock('./auth', () => ({ useAuthStore: () => ({ canWriteAppearance: mocks.canWrite }) }));

describe('appearance', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    mocks.canWrite = true;
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the instance theme in admin mode and restores the legacy browser preference as a visitor', async () => {
    mocks.canWrite = false;
    localStorage.setItem('foldergram-theme', 'dark');
    mocks.request.mockResolvedValue({ theme: 'light', accent: 'purple' });
    const store = useAppearanceStore();
    store.initialize();
    expect(mocks.setTheme).toHaveBeenLastCalledWith('dark');
    await store.load();
    expect(store.theme).toBe('light');
    expect(mocks.setTheme).toHaveBeenLastCalledWith('dark');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#b794ff');

    mocks.canWrite = true;
    store.render();
    expect(mocks.setTheme).toHaveBeenLastCalledWith('light');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#7c3aed');

    mocks.canWrite = false;
    store.render();
    expect(mocks.setTheme).toHaveBeenLastCalledWith('dark');
    expect(localStorage.getItem('foldergram-theme')).toBe('dark');
  });

  it('follows the system only when the effective preference is System', () => {
    mocks.canWrite = false;
    const store = useAppearanceStore();
    store.apply({ theme: 'system', accent: 'green' });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    store.render();
    expect(mocks.setTheme).toHaveBeenLastCalledWith('dark');
    store.apply({ theme: 'light', accent: 'green' });
    expect(mocks.setTheme).toHaveBeenLastCalledWith('light');
    store.setBrowserTheme('system');
    expect(mocks.setTheme).toHaveBeenLastCalledWith('dark');
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    store.render();
    expect(mocks.setTheme).toHaveBeenLastCalledWith('light');
  });

  it('persists a viewer selection in the browser and clears it for Instance default', () => {
    mocks.canWrite = false;
    const store = useAppearanceStore();
    store.apply({ theme: 'dark', accent: 'rose' });
    store.setBrowserTheme('light');
    expect(localStorage.getItem('foldergram-theme')).toBe('light');
    expect(mocks.setTheme).toHaveBeenLastCalledWith('light');
    store.setBrowserTheme('instance');
    expect(localStorage.getItem('foldergram-theme')).toBeNull();
    expect(mocks.setTheme).toHaveBeenLastCalledWith('dark');
    expect(store.accent).toBe('rose');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('bounds a stalled read, skips duplicate reads, and can retry', async () => {
    vi.useFakeTimers();
    mocks.request.mockImplementationOnce((_url, { signal }: RequestInit) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    }));
    const store = useAppearanceStore();
    const pending = store.load();
    await store.load();
    expect(mocks.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(store.ready).toBe(false);
    mocks.request.mockResolvedValueOnce({ theme: 'dark', accent: 'orange' });
    await store.load();
    expect(store.ready).toBe(true);
    expect(store.accent).toBe('orange');
  });

  it('preserves saved appearance when saving fails and blocks viewer writes', async () => {
    const store = useAppearanceStore();
    store.apply({ theme: 'light', accent: 'blue' });
    const update = { theme: 'dark', accent: 'green' } as const;
    mocks.request.mockRejectedValue(new Error('offline'));
    expect(await store.save(update)).toBe(false);
    expect(mocks.request).toHaveBeenCalledWith('/api/admin/settings/appearance', expect.objectContaining({
      method: 'PUT', body: JSON.stringify(update)
    }));
    expect(store.theme).toBe('light');
    expect(store.error).toBe('appearance.saveError');
    mocks.canWrite = false;
    mocks.request.mockClear();
    expect(await store.save(update)).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('releases a stalled theme save so it can be retried before the first successful read', async () => {
    vi.useFakeTimers();
    const store = useAppearanceStore();
    mocks.request.mockImplementationOnce((_url, { signal }: RequestInit) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    }));
    const pending = store.save({ theme: 'dark' });
    expect(store.saving).toBe(true);
    expect(await store.save({ theme: 'light' })).toBe(false);
    expect(mocks.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(false);
    expect(store.saving).toBe(false);
    expect(store.ready).toBe(false);
    expect(store.error).toBe('appearance.saveError');

    mocks.request.mockResolvedValueOnce({ theme: 'dark', accent: 'rose' });
    expect(await store.save({ theme: 'dark' })).toBe(true);
    expect(store.theme).toBe('dark');
    expect(store.accent).toBe('rose');
  });

  it('does not let an older read overwrite a successful save', async () => {
    const store = useAppearanceStore();
    store.apply({ theme: 'light', accent: 'blue' });
    let finish!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.load();
    mocks.request.mockResolvedValueOnce({ theme: 'dark', accent: 'green' });
    await store.save({ theme: 'dark', accent: 'green' });
    finish({ theme: 'light', accent: 'blue' });
    await pending;
    expect(store.theme).toBe('dark');
    expect(store.accent).toBe('green');
  });
});
