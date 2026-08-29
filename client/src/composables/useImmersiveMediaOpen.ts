import { useAppStore } from '../stores/app';
import { useImmersiveImageStore } from '../stores/immersive-image';
import { useImmersiveVideoStore } from '../stores/immersive-video';
import type { FeedItem } from '../types/api';
import { getOriginalMediaUrl } from '../utils/original-media';
import { warmVideoStream } from '../utils/video-playback';

/**
 * Opening a grid tile in the same players the home feed uses.
 *
 * Search, Liked, Collections and the folder grids used to navigate to the post route
 * instead, which meant a different surface with a different delete flow and none of the
 * hold-to-speed or scrub gestures. Routing them through the immersive layers is what
 * makes every entry point behave the same way.
 *
 * Carousels keep going to the post route: the immersive layers show one item at a time.
 */
export function useImmersiveMediaOpen() {
  const appStore = useAppStore();
  const immersiveImageStore = useImmersiveImageStore();
  const immersiveVideoStore = useImmersiveVideoStore();

  function canOpenInPlace(item: Pick<FeedItem, 'mediaType' | 'postType'>): boolean {
    if (item.postType === 'carousel') {
      return false;
    }

    return item.mediaType === 'image' || item.mediaType === 'video';
  }

  /** Returns false when the caller should fall back to its own navigation. */
  function openInPlace(item: FeedItem): boolean {
    if (!canOpenInPlace(item)) {
      return false;
    }

    if (item.mediaType === 'image') {
      immersiveImageStore.open({
        id: item.id,
        filename: item.filename,
        thumbnailUrl: item.thumbnailUrl,
        fullUrl: item.originalUrl ?? getOriginalMediaUrl(item.id),
        width: item.width,
        height: item.height,
        caption: item.caption ?? null,
        folderSlug: item.folderSlug
      });
      return true;
    }

    // Warming the head of the clip before the layer mounts is what removes the stall
    // between the tap and the first frame on a NAS that transcodes on demand.
    warmVideoStream(item, appStore.videoPlaybackQuality, { fromSeconds: 0, segments: 4 });

    immersiveVideoStore.open({
      id: item.id,
      filename: item.filename,
      thumbnailUrl: item.thumbnailUrl,
      previewUrl: item.previewUrl,
      originalUrl: item.originalUrl,
      streamUrl: item.streamUrl,
      playbackStrategy: item.playbackStrategy,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs
    });

    return true;
  }

  return { canOpenInPlace, openInPlace };
}
