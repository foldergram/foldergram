import type { MediaContext, MediaEvents, MediaProviderAdapter, MediaProviderLoader, Src } from 'vidstack';

import { RequestError, requestJson } from '../api/http';
import { i18n } from '../locales';

type ProviderNotify = (type: keyof MediaEvents, detail?: unknown, trigger?: Event) => void;
type Mode = 'original' | 'standard' | 'low';
interface Metadata {
  duration: number;
  width: number;
  height: number;
  bitrate: number | null;
  original: { url: string; type: string } | null;
  warmupAvailable?: boolean;
}
interface Session {
  url: string;
  releaseUrl: string;
  offset: number;
  duration: number;
  window: number;
  profile: 'standard' | 'low';
}
interface Upcoming {
  offset: number;
  controller: AbortController;
  result: Promise<Session | undefined>;
}
export const VIDEO_SETTLE_MS = 200;

/** Keep only the next Reel's most recent metadata, within this deck. */
export class ReelVideoPreparation {
  private next?: { endpoint: string; metadata: Metadata; expiresAt: number };

  remember(endpoint: string, metadata: Metadata) {
    this.next = { endpoint, metadata, expiresAt: Date.now() + 15_000 };
  }

  take(endpoint: string) {
    const next = this.next;
    if (!next || next.endpoint !== endpoint) return;
    this.next = undefined;
    if (Date.now() < next.expiresAt) return next.metadata;
  }
}

export interface LocalVideoState {
  pending: boolean;
  hasFrame: boolean;
  failed: boolean;
}

export interface LocalVideoOptions {
  active?: () => boolean;
  autoplay?: () => boolean;
  original?: () => boolean;
  next?: () => string | undefined;
  settleMs?: number;
  reelPreparation?: ReelVideoPreparation;
  loadOnPlay?: boolean;
  onStateChange?: (state: LocalVideoState) => void;
  onAutoplayBlocked?: () => void;
}

function range(start: number, end: number): TimeRanges {
  return {
    length: end > start ? 1 : 0,
    start: () => start,
    end: () => end
  };
}

function release(session?: Session) {
  if (session) void fetch(session.releaseUrl, {
    method: 'POST', credentials: 'same-origin', keepalive: true,
    headers: { 'x-foldergram-intent': '1' }
  }).catch(() => undefined);
}

/** One logical Vidstack source; temporary HLS windows never become UI timelines. */
export class LocalVideoDelivery {
  source: Src<string> | null = null;
  private metadata?: Metadata;
  private session?: Session;
  private previousWindow?: Pick<Session, 'offset' | 'window' | 'profile'>;
  private upcoming?: Upcoming;
  private operation?: AbortController;
  private mode?: Mode;
  private position = 0;
  private attachAt = 0;
  private intended: boolean;
  private phase: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private visible = true;
  private available = false;
  private attached = false;
  private disposed = false;
  private observer?: IntersectionObserver;
  private monitor?: ReturnType<typeof setInterval>;
  private frame?: number;
  private framePaint?: number;
  private hasFrame = false;
  private settleTimer?: ReturnType<typeof setTimeout>;
  private negotiation?: { controller: AbortController; result: Promise<Metadata | undefined> };
  private warmup?: AbortController;
  private lastWarmCandidate?: string;
  private warmRetryAt = 0;
  private lastFrame = 0;
  private lastTick = 0;
  private lastLocalTime = 0;
  private lastPulse = 0;
  private reopened = false;
  private readyPublished = false;
  private playbackRate = 1;

  constructor(
    private video: HTMLVideoElement,
    private ctx: MediaContext,
    private options: LocalVideoOptions,
    private load: (source: Src<string>, signal: AbortSignal, startPosition: number) => Promise<void>,
    private unload: () => void
  ) {
    this.intended = options.autoplay?.() ?? false;
  }

  setup() {
    const player = this.ctx.player.el!;
    // Home and Reels supply playback ownership. Other existing players keep
    // their playback while the viewer scrolls between media and its controls.
    if (this.options.active && 'IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(([entry]) => {
        const height = Math.min(entry.rootBounds?.height ?? innerHeight, entry.boundingClientRect.height);
        this.visible = entry.isIntersecting && entry.intersectionRect.height >= height * 0.35;
        this.syncAvailability();
      }, { threshold: [0, 0.05, 0.1, 0.2, 0.35, 0.55, 1] });
      this.observer.observe(player);
    }
    document.addEventListener('visibilitychange', this.syncAvailability);
    window.addEventListener('pagehide', this.suspend);
    window.addEventListener('pageshow', this.syncAvailability);
    player.addEventListener('fullscreen-change', this.onFullscreenChange);
    player.addEventListener('media-play-request', this.onPlaybackRequest, true);
    player.addEventListener('media-pause-request', this.onPlaybackRequest, true);
    player.addEventListener('pointerup', this.onControlPress, true);
    player.addEventListener('keydown', this.onControlPress, true);
    this.video.addEventListener('pause', this.onNativePause);
    this.video.addEventListener('loadeddata', this.onLoadedData);
    this.monitor = setInterval(() => this.checkPlayback(), 1000);
    this.syncAvailability();
  }

  private canPlay() {
    const fullscreen = this.ctx.$state.fullscreen();
    return !this.disposed && document.visibilityState !== 'hidden' &&
      (fullscreen || ((this.options.active?.() ?? true) && this.visible));
  }

  syncAvailability = () => {
    const available = this.canPlay();
    if (available === this.available) return;
    this.available = available;
    if (!available) {
      this.suspend();
    } else if (this.source && this.phase === 'idle') void this.scheduleOpen();
  };

  private onFullscreenChange = () => {
    if (this.ctx.$state.fullscreen()) {
      this.cancelWarmup();
      if (this.source && this.phase === 'idle') void this.resume();
    }
    this.syncAvailability();
  };

  private scheduleOpen() {
    this.clearSettleTimer();
    if (this.ctx.$state.fullscreen()) return this.resume();
    if (this.options.loadOnPlay) return;
    const delay = this.options.settleMs ?? VIDEO_SETTLE_MS;
    if (delay <= 0) return this.resume();
    this.prepareReel();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      if (this.phase === 'idle') void this.resume();
    }, delay);
  }

  private clearSettleTimer() {
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  private prepareReel() {
    const preparation = this.options.reelPreparation;
    if (!preparation || !this.source || this.metadata || this.negotiation) return;
    this.metadata = preparation.take(this.source.src);
    if (this.metadata) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    this.negotiation = {
      controller,
      result: requestJson<Metadata>(this.source.src, { signal }).catch(() => undefined)
    };
  }

  private resume() {
    return this.open(this.position, this.mode, undefined, true);
  }

  private publishState() {
    this.options.onStateChange?.({
      pending: this.phase === 'loading' || (this.phase === 'ready' && this.intended && !this.hasFrame),
      hasFrame: this.hasFrame,
      failed: this.phase === 'error'
    });
  }

  private suspend = () => {
    this.available = false;
    const failed = this.phase === 'error';
    this.detach();
    this.phase = failed ? 'error' : 'idle';
    this.publishState();
    this.ctx.notify('pause', undefined, new Event('foldergram-suspend'));
  };

  private onControlPress = (event: PointerEvent | KeyboardEvent) => {
    if (!this.source || this.phase === 'ready' || event.defaultPrevented || !(event.target instanceof Element)) return;
    if ('key' in event ? event.repeat || (event.key !== 'Enter' && event.key !== ' ') : event.button !== 0) return;
    const control = event.target.closest('media-play-button, media-fullscreen-button');
    if (!control || control.hasAttribute('data-disabled') || control.getAttribute('aria-disabled') === 'true') return;

    // Vidstack queues its remote button requests until can-play. Handle the
    // original gesture while this provider is still waiting to prepare media.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (control.localName === 'media-play-button') {
      void this.play().catch(() => undefined);
      return;
    }
    const player = this.ctx.player;
    if (this.ctx.$state.fullscreen()) {
      void player.exitFullscreen('media', event).catch(() => undefined);
    } else {
      void player.enterFullscreen('media', event).catch(() => undefined);
      if (this.phase === 'idle' && this.canPlay()) void this.resume();
    }
  };

  private onPlaybackRequest = (event: Event) => {
    if (this.phase === 'ready') return;
    event.stopImmediatePropagation();
    if (event.type === 'media-pause-request') this.pause();
    else void this.play();
  };

  async loadSource(source: Src<string>) {
    if (source.src === this.source?.src) return;
    this.detach();
    this.source = source;
    this.phase = 'idle';
    this.lastWarmCandidate = undefined;
    this.warmRetryAt = 0;
    this.publishState();
    this.metadata = undefined;
    this.previousWindow = undefined;
    this.position = 0;
    this.mode = undefined;
    this.readyPublished = false;
    this.reopened = false;
    this.intended = this.options.autoplay?.() ?? false;
    if (this.canPlay()) await this.scheduleOpen();
  }

  async play() {
    this.intended = true;
    if (!this.canPlay()) return;
    if (this.phase === 'error') {
      this.mode = undefined;
      this.metadata = undefined;
      this.reopened = false;
      return this.open(this.position);
    }
    if (this.phase === 'idle') return this.resume();
    if (this.phase === 'ready') {
      this.publishState();
      return this.video.play();
    }
  }

  pause() {
    this.intended = false;
    this.clearSettleTimer();
    this.negotiation?.controller.abort();
    this.negotiation = undefined;
    this.cancelWarmup();
    this.discardUpcoming();
    this.video.pause();
    this.publishState();
    // Firefox can leave a partly offscreen video at HAVE_METADATA. The HTML
    // provider suppresses that native pause, so publish the requested state too.
    if (!this.disposed) this.ctx.notify('pause');
  }

  private onNativePause = (event: Event) => {
    if (this.disposed || this.phase !== 'ready' || !this.video.paused || this.video.ended) return;
    this.intended = false;
    this.cancelWarmup();
    this.discardUpcoming();
    this.publishState();
    this.ctx.notify('pause', undefined, event);
  };

  seek(at: number) {
    this.cancelWarmup();
    this.discardUpcoming();
    this.position = Math.max(0, Math.min((this.metadata?.duration ?? Infinity) - 0.05, at));
    const relative = this.position - (this.session?.offset ?? 0);
    const seekable = this.video.seekable;
    if (this.phase === 'ready' && (!this.session || Array.from({ length: seekable.length }, (_, i) =>
      seekable.start(i) <= relative && relative < seekable.end(i)).some(Boolean))) {
      this.video.currentTime = Math.max(0, relative);
      this.lastFrame = this.lastTick = Date.now();
    } else {
      this.ctx.notify('seeking', this.position);
      void this.open(this.position);
    }
  }

  changeQuality() {
    const selection = this.options.original?.() ? 'original' : 'standard';
    if (this.source && this.metadata) void this.open(this.position, selection);
  }

  private discardUpcoming() {
    const pending = this.upcoming;
    this.upcoming = undefined;
    if (!pending) return;
    pending.controller.abort();
    void pending.result.then(release);
  }

  private detach() {
    this.clearSettleTimer();
    this.negotiation?.controller.abort();
    this.negotiation = undefined;
    this.cancelWarmup();
    this.phase = 'loading';
    this.attached = false;
    this.hasFrame = false;
    this.discardUpcoming();
    this.operation?.abort();
    this.operation = undefined;
    if (this.frame !== undefined) this.video.cancelVideoFrameCallback?.(this.frame);
    this.frame = undefined;
    if (this.framePaint !== undefined) cancelAnimationFrame(this.framePaint);
    this.framePaint = undefined;
    this.video.pause();
    this.unload();
    release(this.session);
    this.session = undefined;
  }

  private networkFits(info: Metadata) {
    const connection = (navigator as Navigator & { connection?: { downlink?: number } }).connection;
    const cap = connection?.downlink ? connection.downlink * 700_000 : 12_000_000;
    const display = Math.max(1920, (this.ctx.player.el?.clientWidth ?? 0) * Math.min(devicePixelRatio || 1, 2));
    return (!info.bitrate || info.bitrate <= cap) && info.width <= display && info.height <= Math.max(display, 2160);
  }

  private async startWindow(at: number, profile: 'standard' | 'low', signal: AbortSignal) {
    for (const delay of [0, 550, 1100, 2000]) {
      if (delay) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
      try {
        return await requestJson<Session>(this.source!.src + '/sessions', {
          method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(32_000)]),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at, profile })
        });
      } catch (error) {
        if (signal.aborted || delay === 2000 || !(error instanceof RequestError) || ![503, 507].includes(error.status)) throw error;
      }
    }
    throw new Error('Playback window unavailable.');
  }

  private async open(at: number, selection = this.mode, prepared?: Upcoming, resumeWindow = false) {
    if (!this.canPlay() || !this.source) {
      prepared?.controller.abort();
      void prepared?.result.then(release);
      return;
    }
    const negotiation = this.negotiation;
    this.negotiation = undefined;
    this.detach();
    const controller = new AbortController();
    this.operation = controller;
    const signal = controller.signal;
    const abortPrepared = () => {
      prepared?.controller.abort();
      negotiation?.controller.abort();
    };
    signal.addEventListener('abort', abortPrepared, { once: true });
    this.attachAt = this.position = at;
    this.publishState();
    try {
      const negotiated = negotiation
        ? await negotiation.result
        : this.options.reelPreparation?.take(this.source.src);
      if (signal.aborted) return;
      const metadata = this.metadata ?? negotiated ?? await requestJson<Metadata>(this.source.src, { signal });
      if (signal.aborted) return;
      this.metadata = metadata;
      const original = this.metadata.original;
      const direct = original && this.video.canPlayType(original.type) &&
        (selection === 'original' || (!selection && this.networkFits(this.metadata)));
      this.mode = direct ? 'original' : selection === 'low' ? 'low' : 'standard';
      let source: Src<string>;
      if (direct) source = { src: original.url, type: original.type };
      else {
        const preloaded = await prepared?.result;
        if (signal.aborted) { release(preloaded); return; }
        const profile = this.mode === 'low' ? 'low' : 'standard';
        const previous = this.previousWindow;
        const offset = resumeWindow && previous?.profile === profile && at >= previous.offset && at < previous.offset + previous.window
          ? previous.offset : at;
        let session = preloaded ?? await this.startWindow(offset, profile, signal);
        if (signal.aborted) { release(session); return; }
        // A cancelled long conversion may have retained only its opening.
        // Resume farther into the video with a new window at that position.
        if (resumeWindow && at >= session.offset + session.window) {
          release(session);
          session = await this.startWindow(at, profile, signal);
          if (signal.aborted) { release(session); return; }
        }
        this.session = session;
        this.previousWindow = { offset: session.offset, window: session.window, profile: session.profile };
        this.mode = session.profile;
        this.lastPulse = Date.now();
        source = { src: session.url, type: 'application/vnd.apple.mpegurl' };
      }
      await this.load(source, signal, this.relativeStartPosition());
      if (signal.aborted) return;
      this.attached = true;
      this.lastFrame = this.lastTick = Date.now();
      this.lastLocalTime = -1;
    } catch {
      if (!signal.aborted) this.fail();
    } finally {
      signal.removeEventListener('abort', abortPrepared);
    }
  }

  private fullInfo(info: { duration?: number; seekable?: TimeRanges; buffered?: TimeRanges }) {
    const offset = this.session?.offset ?? 0;
    const buffered = info.buffered;
    return {
      ...info, duration: this.metadata?.duration ?? info.duration ?? 0,
      seekable: range(0, this.metadata?.duration ?? 0),
      buffered: buffered?.length ? range(offset + buffered.start(0), offset + buffered.end(buffered.length - 1)) : range(0, 0)
    };
  }

  private relativeStartPosition() {
    return Math.max(0, this.attachAt - (this.session?.offset ?? 0));
  }

  ready(info: Parameters<MediaContext['delegate']['ready']>[0], trigger?: Event) {
    if (!this.operation || this.operation.signal.aborted || this.video.readyState < 1) return Promise.resolve();
    if (this.phase === 'loading') {
      this.phase = 'ready';
      const relative = this.relativeStartPosition();
      if (Math.abs(this.video.currentTime - relative) > 0.15) this.video.currentTime = relative;
      this.video.playbackRate = this.playbackRate;
      this.observeFrames();
      this.onLoadedData();
      this.publishState();
    }
    const result = this.ctx.delegate.ready(this.fullInfo(info ?? {}), trigger);
    this.readyPublished = true;
    this.ctx.notify('time-change', this.position, trigger);
    this.ctx.notify('seeked', this.position, trigger);
    if (this.intended) this.startPlaying();
    return result;
  }

  // Vidstack owns the media element and HLS.js. Translate its provider events,
  // hiding source-transition pauses and intermediate window endings from the UI.
  notify: ProviderNotify = (type, detail, trigger) => {
    if (this.disposed) return;
    if (type === 'provider-setup') { this.forward(type, detail, trigger); return; }
    if (type === 'error') {
      if (this.operation && !this.operation.signal.aborted) this.fail();
      return;
    }
    if (type === 'stream-type-change') detail = 'on-demand';
    if (type === 'duration-change') detail = this.metadata?.duration ?? detail;
    if (type === 'progress' || type === 'can-play-through') detail = this.fullInfo(detail as Parameters<typeof this.fullInfo>[0]);
    if (['emptied', 'abort', 'load-start', 'loaded-metadata'].includes(type) && this.readyPublished) return;
    if (type === 'pause') {
      if (this.phase !== 'ready' || !this.video.paused || this.video.ended) return;
      this.intended = false;
      this.cancelWarmup();
      this.discardUpcoming();
    }
    if (type === 'play' || type === 'playing') {
      if (this.phase !== 'ready' || this.video.paused) return;
      this.intended = true;
      this.lastTick = this.lastFrame = Date.now();
    }
    if (type === 'rate-change') {
      if (this.phase !== 'ready') return;
      this.playbackRate = Number(detail);
    }
    if (type === 'time-change' || type === 'seeking' || type === 'seeked') {
      if (this.phase !== 'ready') return;
      if (type === 'seeking') this.cancelWarmup();
      const local = Number(detail);
      detail = Math.min(this.metadata?.duration ?? Infinity, (this.session?.offset ?? 0) + local);
      if (type === 'time-change') {
        if (local !== this.lastLocalTime) this.lastTick = Date.now();
        this.lastLocalTime = local;
        this.position = Number(detail);
        this.prefetch();
        this.warmNext();
      }
    }
    if (type === 'end') {
      const next = this.session ? this.session.offset + this.session.window : this.metadata?.duration ?? 0;
      if (next < (this.metadata?.duration ?? 0) - 0.3) {
        const prepared = this.upcoming?.offset === next ? this.upcoming : undefined;
        if (prepared) this.upcoming = undefined;
        void this.open(next, this.mode, prepared);
        return;
      }
    }
    this.forward(type, detail, trigger);
  };

  private forward: ProviderNotify = (type, detail, trigger) => {
    (this.ctx.notify as ProviderNotify)(type, detail, trigger);
  };

  private prefetch() {
    if (!this.session || !this.intended || this.video.paused || this.upcoming) return;
    const offset = this.session.offset + this.session.window;
    // Give a cached opening window the full three seconds to prepare its continuation.
    const lead = this.session.offset === 0 && this.session.window <= 3 ? this.session.window : Math.min(6, this.session.window / 2);
    if (offset >= (this.metadata?.duration ?? 0) - 0.3 || offset - this.position > lead) return;
    this.cancelWarmup();
    const controller = new AbortController();
    this.upcoming = { offset, controller,
      result: this.startWindow(offset, this.session.profile, controller.signal).catch(() => undefined) };
  }

  private startPlaying() {
    if (!this.canPlay()) return;
    void this.video.play().catch((error: DOMException) => {
      if (error.name === 'NotAllowedError') {
        this.intended = false;
        this.publishState();
        this.options.onAutoplayBlocked?.();
      }
    });
  }

  private observeFrames() {
    if (!this.video.requestVideoFrameCallback || this.frame !== undefined) return;
    const update = () => {
      this.lastFrame = Date.now();
      if (this.phase === 'ready') {
        this.presentFrame();
        this.frame = this.video.requestVideoFrameCallback(update);
      }
      else this.frame = undefined;
    };
    this.frame = this.video.requestVideoFrameCallback(update);
  }

  private presentFrame() {
    if (this.hasFrame) return;
    this.hasFrame = true;
    this.publishState();
  }

  private onLoadedData = () => {
    if (typeof this.video.requestVideoFrameCallback === 'function' || this.hasFrame || this.phase !== 'ready' ||
        this.video.readyState < 2 || this.framePaint !== undefined) return;
    // Older browsers have no frame callback. Keep the cover through a paint
    // after HAVE_CURRENT_DATA before exposing the video element.
    this.framePaint = requestAnimationFrame(() => {
      this.framePaint = requestAnimationFrame(() => {
        this.framePaint = undefined;
        if (this.phase === 'ready' && this.video.readyState >= 2) this.presentFrame();
      });
    });
  };

  cancelWarmup = () => {
    this.warmup?.abort();
    this.warmup = undefined;
  };

  private warmNext() {
    const candidate = this.options.next?.();
    if (!candidate || candidate === this.lastWarmCandidate || this.warmup || this.upcoming ||
        !this.hasFrame || !this.intended || this.video.paused || this.video.seeking ||
        Date.now() < this.warmRetryAt || !this.canPlay() || this.ctx.$state.fullscreen()) return;
    this.warmRetryAt = Date.now() + 1000;
    const controller = new AbortController();
    this.warmup = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    void requestJson<Metadata>(candidate, { signal }).then(async info => {
      if (signal.aborted) return;
      this.options.reelPreparation?.remember(candidate, info);
      if (info.original && this.video.canPlayType(info.original.type) && this.networkFits(info)) {
        this.lastWarmCandidate = candidate;
        return;
      }
      // Poll the cheap metadata hint while the current window owns the encoder.
      // A busy first attempt must not disable warmup for this entire Reel.
      if (info.warmupAvailable === false) return;
      await requestJson<void>(candidate + '/sessions', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at: 0, warmup: true })
      });
      this.lastWarmCandidate = candidate;
    }).catch(error => {
      if (signal.aborted) return;
      if (error instanceof RequestError && [503, 507].includes(error.status)) this.warmRetryAt = Date.now() + 2000;
      else this.lastWarmCandidate = candidate;
    }).finally(() => {
      if (this.warmup === controller) this.warmup = undefined;
    });
  }

  private fail() {
    if (this.phase === 'error' || !this.canPlay()) return;
    if (this.mode === 'original') void this.open(this.position, 'standard');
    else if (this.mode === 'standard') void this.open(this.position, 'low');
    else {
      this.detach();
      this.phase = 'error';
      this.publishState();
      this.ctx.notify('pause');
      this.ctx.notify('error', { code: 4, message: i18n.global.t('streamingVideo.unavailable') });
    }
  }

  private checkPlayback() {
    if (!this.canPlay() || !this.attached) return;
    const now = Date.now();
    if (this.session && now - this.lastPulse > 12_000) {
      const current = this.session;
      this.lastPulse = now;
      void fetch(current.url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' }).then(response => {
        if (response.ok || this.session !== current || !this.canPlay() || !this.intended) return;
        if (response.status === 404 && !this.reopened) { this.reopened = true; void this.open(this.position); }
        else this.fail();
      }).catch(() => undefined);
    }
    if (!this.intended || this.video.seeking || this.video.ended) return;
    if (now - this.lastTick > 10_000 || (this.frame !== undefined && now - this.lastFrame > 10_000)) this.fail();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    clearInterval(this.monitor);
    document.removeEventListener('visibilitychange', this.syncAvailability);
    window.removeEventListener('pagehide', this.suspend);
    window.removeEventListener('pageshow', this.syncAvailability);
    this.ctx.player.el?.removeEventListener('fullscreen-change', this.onFullscreenChange);
    this.ctx.player.el?.removeEventListener('media-play-request', this.onPlaybackRequest, true);
    this.ctx.player.el?.removeEventListener('media-pause-request', this.onPlaybackRequest, true);
    this.ctx.player.el?.removeEventListener('pointerup', this.onControlPress, true);
    this.ctx.player.el?.removeEventListener('keydown', this.onControlPress, true);
    this.video.removeEventListener('pause', this.onNativePause);
    this.video.removeEventListener('loadeddata', this.onLoadedData);
    this.detach();
  }
}

export function createLocalVideoLoader(endpoint: () => string | undefined, options: LocalVideoOptions = {}) {
  let delivery: LocalVideoDelivery | undefined;
  let dispose: (() => void) | undefined;
  const loader: MediaProviderLoader = {
    name: 'foldergram', target: null,
    canPlay: source => Boolean(endpoint() && source.src === endpoint()),
    mediaType: () => 'video',
    async load(ctx) {
      let current: LocalVideoDelivery | undefined;
      const { VideoProviderLoader, HLSProviderLoader, isHLSProvider } = await import('vidstack');
      const video = loader.target as HTMLVideoElement;
      // Follow Vidstack's provider preference. Some browsers advertise native
      // HLS as "maybe" but fail on the growing playlists produced by FFmpeg.
      const native = ctx.$props.preferNativeHLS() && Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
      const bridge: MediaContext = {
        ...ctx, notify: (type, ...args) => current?.notify(type, ...args),
        delegate: {
          notify: (type, ...args) => current?.notify(type, ...args),
          ready: (info, trigger) => current?.ready(info, trigger) ?? Promise.resolve()
        } as MediaContext['delegate']
      };
      const nativeLoader = new VideoProviderLoader();
      nativeLoader.target = video;
      const nativeProvider = await nativeLoader.load(bridge);
      const nativeLoad = nativeProvider.loadSource;
      const hlsLoader = new HLSProviderLoader();
      hlsLoader.target = video;
      const provider = native || !HLSProviderLoader.supported ? nativeProvider : await hlsLoader.load(bridge);
      if (provider !== nativeProvider) nativeProvider.scope.dispose();
      const load = provider.loadSource.bind(provider);
      const setup = provider.setup.bind(provider);
      const destroy = isHLSProvider(provider) ? provider.destroy.bind(provider) : undefined;
      if (isHLSProvider(provider)) {
        provider.library = () => import('hls.js');
        provider.config = { lowLatencyMode: false, maxBufferLength: 12, backBufferLength: 6 };
      }
      current = new LocalVideoDelivery(video, ctx, options, async (source, signal, startPosition) => {
        if (isHLSProvider(provider)) {
          // Vidstack creates and owns this instance using our bundled library.
          const deadline = Date.now() + 12_000;
          while (!provider.instance) {
            signal.throwIfAborted();
            if (Date.now() >= deadline) throw new Error('The local HLS provider did not initialize.');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          signal.throwIfAborted();
          if (source.type === 'application/vnd.apple.mpegurl') {
            // Growing playlists are otherwise opened near their live edge.
            provider.instance.config.startPosition = startPosition;
            if (!provider.instance.media) provider.instance.attachMedia(video);
            await load(source, 'metadata');
          } else {
            provider.instance.detachMedia();
            await nativeLoad.call(provider, { ...source, type: '?' }, 'metadata');
          }
        } else await nativeLoad.call(provider, { ...source, type: '?' }, 'metadata');
        provider.currentSrc = current!.source;
      }, () => {
        if (isHLSProvider(provider)) {
          provider.instance?.stopLoad();
          provider.instance?.detachMedia();
        }
        video.removeAttribute('src');
        for (const source of video.querySelectorAll('source[data-vds]')) source.remove();
        video.load();
      });
      // Decorate the adapters returned by Vidstack's public loaders. The
      // package exports their types, but not their constructors at runtime.
      provider.setup = () => { current!.setup(); setup(); };
      provider.loadSource = async source => {
        if (typeof source.src !== 'string') return;
        const logical = { ...source, src: source.src };
        provider.currentSrc = logical;
        await current!.loadSource(logical);
      };
      provider.setCurrentTime = time => current!.seek(time);
      provider.play = () => current!.play();
      provider.pause = async () => { current!.pause(); };
      (provider as MediaProviderAdapter).destroy = () => { current!.destroy(); destroy?.(); };
      delivery = current;
      dispose = () => { (provider as MediaProviderAdapter).destroy?.(); provider.scope.dispose(); };
      return provider;
    }
  };
  return { loaders: [loader], sync: () => delivery?.syncAvailability(), quality: () => delivery?.changeQuality(),
    play: () => delivery?.play(), pause: () => delivery?.pause(), cancelWarmup: () => delivery?.cancelWarmup(),
    destroy: () => { delivery?.destroy(); dispose?.(); } };
}
