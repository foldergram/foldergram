import type { MediaStorage } from 'vidstack';

export function applyVideoMutePreference(player: Pick<HTMLMediaElement, 'muted' | 'volume'>, muted: boolean) {
  player.muted = muted;
  if (!muted && player.volume === 0) {
    player.volume = 1;
  }
}

export function createVideoMuteStorage(getMuted: () => boolean): MediaStorage {
  // Vidstack restores provider settings after can-play. Its `muted` property
  // setter only changes playback state, so initialization must also read the
  // latest preference here, including when a preloaded player changes sources.
  return {
    getMuted: async () => getMuted(),
    getVolume: async () => null,
    getTime: async () => null,
    getLang: async () => null,
    getCaptions: async () => null,
    getPlaybackRate: async () => null,
    getVideoQuality: async () => null,
    getAudioGain: async () => null
  };
}
