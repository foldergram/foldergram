type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type IosVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

type OrientationLockType = 'landscape' | 'portrait' | 'natural';

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: OrientationLockType) => Promise<void>;
};

export function isDocumentFullscreen(): boolean {
  return Boolean(document.fullscreenElement ?? (document as any).webkitFullscreenElement);
}

/**
 * iPhone Safari never implements Element.requestFullscreen, only the video
 * element's own `webkitEnterFullscreen`. Trying both keeps one code path for
 * desktop, Android and iOS, and the caller falls back to its own overlay when
 * neither exists.
 */
export async function requestElementFullscreen(
  element: HTMLElement | null,
  video: HTMLVideoElement | null
): Promise<boolean> {
  const target = element as FullscreenCapableElement | null;

  if (target?.requestFullscreen) {
    try {
      await target.requestFullscreen();
      return true;
    } catch {
      // Fall through to the vendor paths below.
    }
  }

  if (target?.webkitRequestFullscreen) {
    try {
      await target.webkitRequestFullscreen();
      return true;
    } catch {
      // Fall through to the iOS video path.
    }
  }

  const iosVideo = video as IosVideoElement | null;
  if (iosVideo?.webkitEnterFullscreen && iosVideo.webkitSupportsFullscreen !== false) {
    try {
      iosVideo.webkitEnterFullscreen();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export async function exitDocumentFullscreen(): Promise<void> {
  try {
    if (document.exitFullscreen && document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    const webkitExit = (document as any).webkitExitFullscreen;
    if (typeof webkitExit === 'function' && (document as any).webkitFullscreenElement) {
      webkitExit.call(document);
    }
  } catch {
    // Leaving fullscreen is best effort.
  }
}

/** Returns false when the platform has no Screen Orientation lock (notably iOS). */
export async function lockScreenOrientation(orientation: OrientationLockType): Promise<boolean> {
  const screenOrientation = window.screen?.orientation as LockableOrientation | undefined;
  if (!screenOrientation?.lock) {
    return false;
  }

  try {
    await screenOrientation.lock(orientation);
    return true;
  } catch {
    return false;
  }
}

export function unlockScreenOrientation(): void {
  try {
    window.screen?.orientation?.unlock?.();
  } catch {
    // Unlocking is best effort and throws when no lock is held.
  }
}
