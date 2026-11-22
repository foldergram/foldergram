import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';

import { createLocalVideoLoader, type LocalVideoOptions, type LocalVideoState } from '../utils/local-video-provider';

export function useLocalVideoPlayback(endpoint: () => string | undefined, options: LocalVideoOptions = {}) {
  const idle: LocalVideoState = { pending: false, hasFrame: false, failed: false };
  const state = shallowRef(idle);
  const playback = createLocalVideoLoader(endpoint, { ...options, onStateChange: next => { state.value = next; } });
  watch(endpoint, () => { state.value = idle; });
  watch(() => options.next?.(), playback.cancelWarmup);
  watch(() => options.active?.(), () => playback.sync());
  watch(() => options.original?.(), () => playback.quality());
  onBeforeUnmount(playback.destroy);
  return {
    // The custom provider negotiates the physical media. Claiming MP4 here
    // lets Vidstack's built-in loader consume the JSON endpoint first.
    source: computed(() => endpoint() ? { src: endpoint()!, type: 'video/object' as const } : undefined),
    loaders: playback.loaders,
    state,
    play: async () => { await playback.play()?.catch(() => undefined); },
    pause: playback.pause
  };
}
