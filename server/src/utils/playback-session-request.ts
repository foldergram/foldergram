// Playback leases authorize transient cache work. The API routes still
// check the library session or the current folder share on every request.
export function isPlaybackSessionMutation(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' &&
    /^\/(?:videos|share\/images)\/\d+\/playback\/sessions(?:\/[0-9a-f-]+\/[0-9a-f-]+\/release)?$/.test(path);
}
