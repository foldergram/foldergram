import { onBeforeUnmount, ref } from 'vue';

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
}

/**
 * Turns a portrait stage into a landscape one on whatever the platform supports:
 * a real orientation lock where it exists, native fullscreen next, and a CSS
 * rotation as the last resort (iPhone Safari has neither). `isRotated` is the
 * flag the host binds to its rotated class.
 */
export function useLandscapeStage(options: LandscapeStageOptions) {
  const isRotated = ref(false);
  const isFullscreen = ref(false);

  async function enter() {
    // Fullscreen first: an orientation lock is only granted to a fullscreen
    // document on Android Chrome, and it also hides the browser chrome.
    const entered = await requestElementFullscreen(options.getStage(), options.getVideo?.() ?? null);
    isFullscreen.value = entered && isDocumentFullscreen();

    const locked = await lockScreenOrientation('landscape');
    // Without a lock the picture only widens if we rotate it ourselves.
    isRotated.value = !locked;
  }

  async function exit() {
    unlockScreenOrientation();
    isRotated.value = false;

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
    unlockScreenOrientation();
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
