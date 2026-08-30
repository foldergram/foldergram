import { describe, expect, it } from 'vitest';

import { useBundledHlsLibrary } from './video-playback';

interface FakeProvider {
  type: string;
  library?: unknown;
  config: Record<string, unknown>;
}

/**
 * `useBundledHlsLibrary` only needs `addEventListener`/`removeEventListener`, so a
 * plain element stands in for the vidstack player here.
 */
function createHost() {
  const host = document.createElement('div');

  function attachProvider(type = 'hls'): FakeProvider {
    const provider: FakeProvider = { type, config: { maxBufferLength: 1 } };
    host.dispatchEvent(new CustomEvent('provider-change', { detail: provider }));
    return provider;
  }

  return { host, attachProvider };
}

describe('useBundledHlsLibrary', () => {
  it('hands a handover position to hls.js so the first fragment is the one being watched', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => 42.5 });

    const provider = attachProvider();

    expect(provider.config.startPosition).toBe(42.5);
    // The tuning that was already there must survive.
    expect(provider.config.maxBufferLength).toBe(30);
    expect(typeof provider.library).toBe('function');
  });

  it('leaves hls.js on its own default when there is no handover', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => 0 });

    expect(attachProvider().config.startPosition).toBe(-1);
  });

  it('ignores a position that is not a finite number', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => Number.NaN });

    expect(attachProvider().config.startPosition).toBe(-1);
  });

  it('reads the position per provider attach, so a resumed clip does not rewind later', () => {
    const { host, attachProvider } = createHost();
    let position = 12;
    useBundledHlsLibrary(host as never, { getStartPosition: () => position });

    expect(attachProvider().config.startPosition).toBe(12);

    // The owner clears the handover once it has been honoured.
    position = 0;
    expect(attachProvider().config.startPosition).toBe(-1);
  });

  it('leaves non-HLS providers untouched', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => 30 });

    const provider = attachProvider('video');

    expect(provider.config.startPosition).toBeUndefined();
    expect(provider.library).toBeUndefined();
  });

  it('stops configuring providers once disposed', () => {
    const { host, attachProvider } = createHost();
    const dispose = useBundledHlsLibrary(host as never, { getStartPosition: () => 8 });

    dispose();

    expect(attachProvider().config.startPosition).toBeUndefined();
  });
});
