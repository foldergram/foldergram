import { afterEach, describe, expect, it, vi } from 'vitest';

import { addImageToCollection, fetchSharedImage, fetchSharedPost } from './gallery';

describe('post and image API namespaces', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the canonical shared-post endpoint for new shared links and preserves the legacy image endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 42 })
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchSharedPost(42);
    await fetchSharedImage(17);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/share/posts/42');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/share/images/17');
  });

  it('uses canonical post IDs for collection membership mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 42, isSaved: true })
    });
    vi.stubGlobal('fetch', fetchMock);

    await addImageToCollection('trip-picks', 42);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/collections/trip-picks/posts/42',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('manual scan options', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the legacy empty-body request when no options are provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, lastScan: null })
    });
    vi.stubGlobal('fetch', fetchMock);

    const { triggerManualScan } = await import('./gallery');
    await triggerManualScan();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/rescan');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Headers).get('content-type')).toBeNull();
  });

  it('sends the selected derivative repair mode as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, lastScan: null })
    });
    vi.stubGlobal('fetch', fetchMock);

    const { triggerManualScan } = await import('./gallery');
    await triggerManualScan({ repairDerivatives: false });
    await triggerManualScan({ repairDerivatives: true });

    const firstInit = fetchMock.mock.calls[0]![1];
    const secondInit = fetchMock.mock.calls[1]![1];
    expect(firstInit.method).toBe('POST');
    expect(firstInit.body).toBe(JSON.stringify({ repairDerivatives: false }));
    expect((firstInit.headers as Headers).get('content-type')).toBe('application/json');
    expect(secondInit.method).toBe('POST');
    expect(secondInit.body).toBe(JSON.stringify({ repairDerivatives: true }));
    expect((secondInit.headers as Headers).get('content-type')).toBe('application/json');
  });
});
