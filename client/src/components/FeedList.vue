<template>
  <section class="flex flex-col gap-[1.2rem]">
    <SkeletonCard v-if="showSkeleton" v-for="index in 4" :key="index" />
    <FeedCard
      v-for="item in items"
      :key="item.id"
      :item="item"
      :context="context"
      :has-avatar-story="folderLookup.get(item.folderSlug)?.hasAvatarStory ?? false"
      :avatar-url="folderLookup.get(item.folderSlug)?.avatarUrl ?? null"
      :is-active-video="context === 'home' && item.id === activeVideoId"
      @open-folder-story="emit('openFolderStory', $event)"
      @video-visibility-change="handleVideoVisibilityChange"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

import { useFoldersStore } from '../stores/folders';
import type { FeedItem } from '../types/api';
import FeedCard from './FeedCard.vue';
import SkeletonCard from './SkeletonCard.vue';

interface HomeVideoVisibilityChange {
  id: number;
  ratio: number;
  centerOffset: number;
}

// A video can be partly offset by the top rail or an interleaved image. Keeping the
// threshold above a small visibility sliver avoids decoding hidden cards, while not
// leaving the first visible video without an owner during a mixed image/video scroll.
const MIN_HOME_VIDEO_RATIO = 0.35;

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
const folderLookup = computed(() => new Map(foldersStore.items.map((folder) => [folder.slug, folder])));
const videoVisibilityById = reactive(new Map<number, Omit<HomeVideoVisibilityChange, 'id'>>());
const activeVideoId = computed<number | null>(() => {
  if (props.context !== 'home') {
    return null;
  }

  let activeId: number | null = null;
  let activeRatio = 0;
  let activeCenterOffset = Number.POSITIVE_INFINITY;

  for (const item of props.items) {
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

  return activeId;
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
