import { watch, type Ref } from 'vue';
import type { MediaVolumeChangeEvent } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';

export function useNativeVideoMuteSync(
  playerElement: Ref<MediaPlayerElement | null>,
  getMuted: () => boolean,
  setMuted: (muted: boolean) => void
) {
  watch(playerElement, (player, _previous, onCleanup) => {
    if (!player) return;

    let initialized = false;
    let initializationFrame = 0;

    const reset = () => {
      initialized = false;
      cancelAnimationFrame(initializationFrame);
    };
    const handleReady = () => {
      reset();
      // Vidstack restores provider settings asynchronously after can-play.
      // Wait until those microtasks finish before accepting native changes.
      initializationFrame = requestAnimationFrame(() => {
        initialized = player.hasAttribute('data-can-play');
      });
    };
    const handleVolumeChange = (event: MediaVolumeChangeEvent) => {
      if (!initialized || !player.hasAttribute('data-can-play')) return;

      const video = player.querySelector('video');
      const nativeEvent = event.triggers?.findType('volumechange');
      if (!video || nativeEvent?.target !== video) return;

      // A queued notification can describe a superseded programmatic update.
      if (event.detail.muted !== video.muted || event.detail.volume !== video.volume) return;

      const muted = video.muted || video.volume === 0;
      if (muted !== getMuted()) setMuted(muted);
    };

    player.addEventListener('source-change', reset);
    player.addEventListener('provider-change', reset);
    player.addEventListener('can-play', handleReady);
    player.addEventListener('volume-change', handleVolumeChange);
    if (player.hasAttribute('data-can-play')) handleReady();

    onCleanup(() => {
      reset();
      player.removeEventListener('source-change', reset);
      player.removeEventListener('provider-change', reset);
      player.removeEventListener('can-play', handleReady);
      player.removeEventListener('volume-change', handleVolumeChange);
    });
  });
}
