<template>
  <section class="grid gap-[1px]" :class="columns === 'three' ? 'grid-cols-3' : 'grid-cols-3 md:grid-cols-4'">
    <RouterLink v-for="item in items" :key="item.id" custom :to="buildImageRoute(item.id)" v-slot="{ href, navigate }">
      <a
        :href="href"
        class="group relative overflow-hidden bg-surface-alt"
        :class="variant === 'reels' ? 'aspect-[9/14]' : variant === 'posts' ? 'aspect-[3/4]' : 'aspect-square'"
        @click="handleImageNavigation($event, item, navigate)"
        :aria-label="item.postType === 'carousel' ? t('post.carousel.open', { count: item.itemCount ?? item.mediaItems?.length ?? 0 }) : undefined"
      >
        <ResilientImage
          :src="item.thumbnailUrl"
          :alt="item.filename"
          loading="lazy"
          :retry-while="appStore.isInitialScan"
          class="h-full w-full object-cover group-hover:scale-[1.03] group-hover:opacity-90"
          style="transition: transform 0.22s ease, opacity 0.22s ease;"
        />
        <div v-if="item.mediaType === 'video'" class="absolute inset-x-0 top-0 flex items-center justify-between px-2 py-2 text-white pointer-events-none bg-[linear-gradient(180deg,rgba(10,14,24,0.72)_0%,rgba(10,14,24,0)_100%)]">
          <span class="i-fluent-play-circle-24-filled w-[1.15rem] h-[1.15rem] text-white" aria-hidden="true" />
          <span v-if="item.durationMs" class="rounded-full bg-black/55 px-[0.42rem] py-[0.12rem] text-[0.7rem] font-semibold">
            {{ formatMediaDuration(item.durationMs) }}
          </span>
        </div>
        <div
          v-if="'postType' in item && item.postType === 'carousel'"
          class="absolute top-2 right-2 flex items-center justify-center gap-[0.22rem] rounded-[0.4rem] bg-black/45 px-[0.42rem] py-[0.2rem] text-white pointer-events-none shadow-[0_1px_4px_rgba(0,0,0,0.2)] backdrop-blur-[2px]"
          aria-hidden="true"
        >
          <span class="i-fluent-square-multiple-24-filled w-[0.9rem] h-[0.9rem] text-white" />
          <span class="text-[0.65rem] font-semibold leading-none tabular-nums">{{ item.itemCount ?? item.mediaItems?.length }}</span>
        </div>
      </a>
    </RouterLink>
  </section>
</template>

<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';

import { useImmersiveMediaOpen } from '../composables/useImmersiveMediaOpen';
import { useAppStore } from '../stores/app';
import type { FeedItem, SharedFeedItem } from '../types/api';
import { formatMediaDuration } from '../utils/media';
import ResilientImage from './ResilientImage.vue';

const props = withDefaults(
  defineProps<{
    items: Array<FeedItem | SharedFeedItem>;
    variant?: 'square' | 'posts' | 'reels';
    columns?: 'adaptive' | 'three';
    sharedSlug?: string | null;
  }>(),
  {
    variant: 'square',
    columns: 'adaptive',
    sharedSlug: null
  }
);

const appStore = useAppStore();
const route = useRoute();
const { t } = useI18n();
const immersiveOpen = useImmersiveMediaOpen();

function buildImageRoute(id: number) {
  if (props.sharedSlug) {
    return {
      name: 'shared-post',
      params: {
        slug: props.sharedSlug,
        id: String(id)
      },
      query: route.query
    };
  }

  return {
    name: 'image',
    params: { id: String(id) },
    query: route.query
  };
}

function handleImageNavigation(
  event: MouseEvent,
  item: FeedItem | SharedFeedItem,
  navigate: () => void
) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  event.preventDefault();
  if (props.sharedSlug) {
    navigate();
    return;
  }

  // Same players as the home feed, so the delete and gesture behaviour is identical
  // wherever a tile is tapped. Carousels still need the post route.
  if (!('folderId' in item) || !immersiveOpen.openInPlace(item as FeedItem)) {
    appStore.setImageModalBackground(route.fullPath);
    navigate();
  }
}
</script>
