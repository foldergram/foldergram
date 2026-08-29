import { onBeforeUnmount, ref, type Ref } from 'vue';

import {
  exitDocumentFullscreen,
  isDocumentFullscreen,
  lockScreenOrientation,
  requestElementFullscreen,
  unlockScreenOrientation
} from '../utils/fullscreen';

interface LandscapeStageOptions {
  /** Element that should fill the screen while landscape is active. */
  getStage: () => HTMLElement | null;
  /** iOS only exposes fullscreen on the video element itself. */
  getVideo?: () => HTMLVideoElement | null;
  /**
   * `native` asks the platform for fullscreen plus an orientation lock and only
   * rotates by hand when both are refused. `rotate` never leaves the page: the
   * host widens the picture with a CSS rotation and the viewer turns the device.
   * The reels deck needs `rotate` so vertical swiping keeps working.
   */
  mode?: 'native' | 'rotate';
  /** Lets several hosts share one rotation flag, e.g. every card in a deck. */
  rotationState?: Ref<boolean>;
}

/**
 * Turns a portrait stage into a landscape one. `isRotated` is the flag the host
 * binds to its rotated class; `isFullscreen` only ever becomes true in `native`
 * mode.
 */
export function useLandscapeStage(options: LandscapeStageOptions) {
  const mode = options.mode ?? 'native';
  const isRotated = options.rotationState ?? ref(false);
  const isFullscreen = ref(false);

  async function enter() {
    if (mode === 'rotate') {
      isRotated.value = true;
      return;
    }

    // Fullscreen first: an orientation lock is only granted to a fullscreen
    // document on Android Chrome, and it also hides the browser chrome.
    const entered = await requestElementFullscreen(options.getStage(), options.getVideo?.() ?? null);
    isFullscreen.value = entered && isDocumentFullscreen();

    const locked = await lockScreenOrientation('landscape');
    // Without a lock the picture only widens if we rotate it ourselves.
    isRotated.value = !locked;
  }

  async function exit() {
    isRotated.value = false;

    if (mode === 'rotate') {
      return;
    }

    unlockScreenOrientation();

    if (isFullscreen.value || isDocumentFullscreen()) {
      await exitDocumentFullscreen();
    }

    isFullscreen.value = false;
  }

  async function toggle() {
    if (isRotated.value || isFullscreen.value) {
      await exit();
      return;
    }

    await enter();
  }

  function syncFromDocument() {
    isFullscreen.value = isDocumentFullscreen();
  }

  onBeforeUnmount(() => {
    if (mode !== 'rotate') {
      unlockScreenOrientation();
    }
  });

  return {
    isRotated,
    isFullscreen,
    enter,
    exit,
    toggle,
    syncFromDocument
  };
}
