/**
 * Keep the phone screen on while a real playback surface is playing.
 *
 * iOS Safari does not treat playsinline / MSE playback as "watching a video",
 * so the idle timer still dims and then locks the screen. Screen Wake Lock
 * (iOS 16.4+, HTTPS) is the supported fix. This module never touches the
 * player instance, gestures, or source selection.
 *
 * Vidstack keeps the native video element in an open shadow root.
 * querySelectorAll from document cannot see it, and native play/pause events
 * do not compose out of that tree. We therefore also read media-player.paused
 * / data-paused and walk each player's shadow root.
 */

interface ScreenWakeLockSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface ScreenWakeLockNavigator {
  wakeLock?: {
    request(type: 'screen'): Promise<ScreenWakeLockSentinel>;
  };
}

export interface ScreenWakeLockController {
  stop(): void;
}

interface MediaPlayerLike extends Element {
  paused?: boolean;
  ended?: boolean;
}

const PLAYBACK_EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied', 'abort'] as const;
const HEARTBEAT_MS = 20_000;

function isProbeVideo(video: HTMLVideoElement): boolean {
  return video.classList.contains('video-first-frame__probe');
}

function isVideoPlaying(video: HTMLVideoElement): boolean {
  return !isProbeVideo(video) && !video.paused && !video.ended;
}

function collectPlaybackVideos(root: ParentNode): HTMLVideoElement[] {
  const videos: HTMLVideoElement[] = [];
  const seen = new Set<HTMLVideoElement>();

  function add(node: Element | null | undefined) {
    if (!(node instanceof HTMLVideoElement) || seen.has(node) || isProbeVideo(node)) {
      return;
    }
    seen.add(node);
    videos.push(node);
  }

  if ('querySelectorAll' in root) {
    for (const node of root.querySelectorAll('video')) {
      add(node);
    }

    for (const player of root.querySelectorAll('media-player')) {
      add(player.querySelector('video'));
      add(player.shadowRoot?.querySelector('video'));
    }
  }

  return videos;
}

function isMediaPlayerPlaying(player: Element): boolean {
  const mediaPlayer = player as MediaPlayerLike;
  if (typeof mediaPlayer.paused === 'boolean') {
    return mediaPlayer.paused === false && mediaPlayer.ended !== true;
  }

  if (player.hasAttribute('data-paused')) {
    return false;
  }

  const videos = [
    player.querySelector('video'),
    player.shadowRoot?.querySelector('video')
  ];
  return videos.some((video) => video instanceof HTMLVideoElement && isVideoPlaying(video));
}

export function hasPlayingPlaybackVideo(root: ParentNode = document): boolean {
  if ('querySelectorAll' in root) {
    for (const player of root.querySelectorAll('media-player')) {
      if (isMediaPlayerPlaying(player)) {
        return true;
      }
    }
  }

  return collectPlaybackVideos(root).some((video) => isVideoPlaying(video));
}

export function shouldHoldScreenWakeLock(
  visibilityState: DocumentVisibilityState,
  root: ParentNode = document
): boolean {
  return visibilityState === 'visible' && hasPlayingPlaybackVideo(root);
}

function getWakeLockApi(): ScreenWakeLockNavigator['wakeLock'] {
  if (typeof navigator === 'undefined') {
    return undefined;
  }

  return (navigator as Navigator & ScreenWakeLockNavigator).wakeLock;
}

/** Wires the lock to in-page playback. Safe to call once per app. */
export function startScreenWakeLock(): ScreenWakeLockController | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  let sentinel: ScreenWakeLockSentinel | null = null;
  let desired = false;
  let stopped = false;
  let requestInFlight: Promise<void> | null = null;
  const boundTargets = new WeakSet<EventTarget>();

  function clearSentinel() {
    sentinel = null;
  }

  async function releaseSentinel() {
    const current = sentinel;
    sentinel = null;
    if (!current || current.released) {
      return;
    }

    try {
      await current.release();
    } catch {
      // Already released by the browser (backgrounding, idle policy).
    }
  }

  async function requestSentinel() {
    if (stopped || !desired || document.visibilityState !== 'visible') {
      return;
    }

    const api = getWakeLockApi();
    if (!api) {
      return;
    }

    if (sentinel && !sentinel.released) {
      return;
    }

    try {
      const next = await api.request('screen');
      if (stopped || !desired || document.visibilityState !== 'visible') {
        try {
          await next.release();
        } catch {
          // Ignore a release race after we already stood down.
        }
        return;
      }

      sentinel = next;
      next.addEventListener('release', () => {
        if (sentinel !== next) {
          return;
        }

        clearSentinel();
        if (!stopped && desired && document.visibilityState === 'visible') {
          void requestSentinel();
        }
      });
    } catch {
      // No user activation yet, Low Power Mode, or the API is blocked.
    }
  }

  function sync() {
    if (stopped) {
      return;
    }

    desired = shouldHoldScreenWakeLock(document.visibilityState);
    if (!desired) {
      void releaseSentinel();
      return;
    }

    if (requestInFlight) {
      void requestInFlight.then(() => {
        if (!stopped && desired && document.visibilityState === 'visible') {
          void requestSentinel();
        }
      });
      return;
    }

    requestInFlight = requestSentinel().finally(() => {
      requestInFlight = null;
    });
  }

  function bindTarget(target: EventTarget | null | undefined) {
    if (!target || boundTargets.has(target)) {
      return;
    }

    boundTargets.add(target);
    for (const eventName of PLAYBACK_EVENTS) {
      target.addEventListener(eventName, sync);
    }
  }

  function bindTree(root: ParentNode) {
    bindTarget(root instanceof Element ? root : null);
    if (!('querySelectorAll' in root)) {
      return;
    }

    for (const player of root.querySelectorAll('media-player')) {
      bindTarget(player);
      bindTarget(player.querySelector('video'));
      bindTarget(player.shadowRoot?.querySelector('video'));
    }

    for (const video of root.querySelectorAll('video')) {
      bindTarget(video);
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      // iOS drops the sentinel on hide; forget our handle so we re-request later.
      clearSentinel();
      desired = false;
      return;
    }

    bindTree(document);
    sync();
  }

  function onUserActivation() {
    bindTree(document);
    if (desired) {
      void requestSentinel();
      return;
    }

    sync();
  }

  for (const eventName of PLAYBACK_EVENTS) {
    document.addEventListener(eventName, sync, true);
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onVisibilityChange);
  document.addEventListener('pointerdown', onUserActivation, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        bindTree(document);
      }
    }
    sync();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-paused']
  });

  const heartbeat = window.setInterval(() => {
    bindTree(document);
    sync();
  }, HEARTBEAT_MS);

  bindTree(document);
  sync();

  return {
    stop() {
      stopped = true;
      desired = false;
      observer.disconnect();
      window.clearInterval(heartbeat);
      for (const eventName of PLAYBACK_EVENTS) {
        document.removeEventListener(eventName, sync, true);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onVisibilityChange);
      document.removeEventListener('pointerdown', onUserActivation, true);
      void releaseSentinel();
    }
  };
}
