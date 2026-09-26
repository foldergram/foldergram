import type { MediaPlayerElement } from 'vidstack/elements';

/** Vidstack can expose a player briefly before its provider is attached. */
export function safeMediaPlayerPlay(player: MediaPlayerElement): Promise<boolean> {
  try {
    return Promise.resolve(player.play()).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function safeMediaPlayerPause(player: MediaPlayerElement): void {
  try {
    const result = player.pause();
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Provider attachment is transient during Teleport/source changes.
  }
}

export function safeMediaPlayerGetCurrentTime(player: MediaPlayerElement): number {
  try {
    return Number.isFinite(player.currentTime) ? player.currentTime : 0;
  } catch {
    return 0;
  }
}

export function safeMediaPlayerSetCurrentTime(player: MediaPlayerElement, seconds: number): boolean {
  try {
    player.currentTime = Math.max(0, seconds);
    return true;
  } catch {
    return false;
  }
}

export function getNativeVideoElement(player: MediaPlayerElement | null): HTMLVideoElement | null {
  if (!player) {
    return null;
  }

  const direct = player.querySelector('video');
  if (direct instanceof HTMLVideoElement) {
    return direct;
  }

  const nested = player.shadowRoot?.querySelector('video');
  return nested instanceof HTMLVideoElement ? nested : null;
}

/**
 * Direct Play Range seeks should jump to the nearest keyframe. Safari exposes
 * `fastSeek` for that; everyone else still gets an exact `currentTime` assignment.
 */
export function safeMediaPlayerSeek(player: MediaPlayerElement, seconds: number): boolean {
  const target = Math.max(0, seconds);
  const video = getNativeVideoElement(player);
  if (video && typeof video.fastSeek === 'function') {
    try {
      video.fastSeek(target);
      return true;
    } catch {
      // Fall through to the exact currentTime path.
    }
  }

  return safeMediaPlayerSetCurrentTime(player, target);
}

export function safeMediaPlayerSetMuted(player: MediaPlayerElement, muted: boolean): void {
  try {
    player.muted = muted;
  } catch {
    // The next provider lifecycle event will apply the preference again.
  }
}
