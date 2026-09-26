<template>
  <section ref="listElement" class="feed-list flex flex-col gap-[1.2rem]">
    <SkeletonCard v-if="showSkeleton" v-for="index in 4" :key="index" />
    <FeedCard
      v-for="item in windowedItems"
      :key="item.id"
      :data-feed-window-id="item.id"
      :item="item"
      :context="context"
      :has-avatar-story="folderLookup.get(item.folderSlug)?.hasAvatarStory ?? false"
      :avatar-url="folderLookup.get(item.folderSlug)?.avatarUrl ?? null"
      :is-active-video="context === 'home' && item.id === activeVideoId"
      :prefetch-video="context === 'home' && prefetchVideoIds.has(item.id)"
      @open-folder-story="emit('openFolderStory', $event)"
      @video-visibility-change="handleVideoVisibilityChange"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { useFeedWindow } from '../composables/useFeedWindow';
import { useFoldersStore } from '../stores/folders';
import { useSharedVideoSurfaceStore } from '../stores/shared-video-surface';
import type { FeedItem } from '../types/api';
import FeedCard from './FeedCard.vue';
import SkeletonCard from './SkeletonCard.vue';

interface HomeVideoVisibilityChange {
  id: number;
  ratio: number;
  centerOffset: number;
}

// The card observer reports at 20% increments. Requiring 35% here created a dead
// zone where a clearly visible clip had no playback owner until fullscreen forced
// it active. At 20%, the first meaningfully visible video starts while tiny slivers
// still stay paused.
const MIN_HOME_VIDEO_RATIO = 0.2;

const props = withDefaults(
  defineProps<{
    items: FeedItem[];
    showSkeleton?: boolean;
    context?: 'default' | 'home';
  }>(),
  {
    context: 'default'
  }
);

const emit = defineEmits<{
  openFolderStory: [folderSlug: string];
}>();

const foldersStore = useFoldersStore();
const sharedVideoSurfaceStore = useSharedVideoSurfaceStore();
const folderLookup = computed(() => new Map(foldersStore.items.map((folder) => [folder.slug, folder])));
const listElement = ref<HTMLElement | null>(null);

/**
 * The immersive layer teleports one card's `<media-player>` into its own slot, so that card
 * has to stay mounted even if the reader scrolled the feed behind the overlay. Unmounting it
 * would destroy the shared decoder and leave fullscreen on a black frame.
 */
const pinnedItemIndex = computed(() => {
  const ownerId = sharedVideoSurfaceStore.ownerId;
  if (!ownerId?.startsWith('feed:')) {
    return null;
  }

  const ownerItemId = Number(ownerId.slice('feed:'.length));
  if (!Number.isFinite(ownerItemId)) {
    return null;
  }

  const index = props.items.findIndex((item) => item.id === ownerItemId);
  return index === -1 ? null : index;
});

const feedWindow = useFeedWindow({
  items: () => props.items,
  container: listElement,
  pinnedIndex: () => pinnedItemIndex.value
});

/**
 * Only the rows near the viewport are handed to `FeedCard`; the column's padding stands in
 * for the rest. `endIndex` is negative until real layout exists, which keeps jsdom and the
 * very first paint on the plain full render.
 */
const windowedItems = computed<FeedItem[]>(() => {
  if (feedWindow.endIndex.value < 0) {
    return props.items;
  }

  return props.items.slice(feedWindow.startIndex.value, feedWindow.endIndex.value + 1);
});

const videoVisibilityById = reactive(new Map<number, Omit<HomeVideoVisibilityChange, 'id'>>());
const activeVideoId = computed<number | null>(() => {
  if (props.context !== 'home') {
    return null;
  }

  let activeId: number | null = null;
  let activeRatio = 0;
  let activeCenterOffset = Number.POSITIVE_INFINITY;

  // Only mounted rows may own playback. Metrics left behind by a row that scrolled out of
  // the window must not win, or the active card would be one that no longer has a player.
  for (const item of windowedItems.value) {
    if (item.mediaType !== 'video') {
      continue;
    }

    const metrics = videoVisibilityById.get(item.id);
    if (!metrics || metrics.ratio < MIN_HOME_VIDEO_RATIO) {
      continue;
    }

    if (metrics.ratio > activeRatio || (metrics.ratio === activeRatio && metrics.centerOffset < activeCenterOffset)) {
      activeId = item.id;
      activeRatio = metrics.ratio;
      activeCenterOffset = metrics.centerOffset;
    }
  }

  // IntersectionObserver may report its first entry a frame after the feed has
  // painted, especially after a PWA reload. Keep the first video as a temporary
  // owner so refresh never leaves the homepage with every player unbound; the
  // observer immediately replaces it once real visibility metrics arrive.
  if (activeId === null) {
    return windowedItems.value.find((item) => item.mediaType === 'video')?.id ?? null;
  }

  return activeId;
});

const prefetchVideoIds = computed<Set<number>>(() => {
  if (props.context !== 'home' || activeVideoId.value === null) {
    return new Set();
  }

  const activeIndex = windowedItems.value.findIndex((item) => item.id === activeVideoId.value);
  if (activeIndex < 0) {
    return new Set();
  }

  const ids = new Set<number>();
  for (const direction of [-1, 1]) {
    for (
      let index = activeIndex + direction;
      index >= 0 && index < windowedItems.value.length;
      index += direction
    ) {
      const item = windowedItems.value[index];
      if (item?.mediaType === 'video') {
        ids.add(item.id);
        break;
      }
    }
  }

  return ids;
});

function handleVideoVisibilityChange(payload: HomeVideoVisibilityChange) {
  if (props.context !== 'home') {
    return;
  }

  if (payload.ratio <= 0) {
    videoVisibilityById.delete(payload.id);
    return;
  }

  videoVisibilityById.set(payload.id, {
    ratio: payload.ratio,
    centerOffset: payload.centerOffset
  });
}

watch(
  () => props.items.map((item) => item.id),
  (itemIds) => {
    const itemIdSet = new Set(itemIds);

    for (const id of videoVisibilityById.keys()) {
      if (!itemIdSet.has(id)) {
        videoVisibilityById.delete(id);
      }
    }
  },
  {
    immediate: true
  }
);
</script>

<style scoped>
.feed-list {
  /*
   * The column carries the space of unmounted rows as padding. Browser scroll anchoring
   * would try to compensate for those padding changes on its own and fight the window,
   * so the padding math stays the single source of truth.
   */
  overflow-anchor: none;
}
</style>
