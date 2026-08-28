<template>
  <article class="bg-transparent">
    <div class="flex items-center justify-between gap-4 px-4 py-[0.55rem]">
      <div class="feed-card__folder flex items-center gap-[0.72rem] min-w-0">
        <button
          v-if="showHomeStoryAvatar"
          class="block rounded-full border-0 bg-transparent p-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          type="button"
          :aria-label="folderStoriesLabel"
          :title="folderStoriesLabel"
          @click="emit('openFolderStory', item.folderSlug)"
        >
          <div class="rounded-full p-[0.1rem] shadow-[0_10px_22px_rgba(246,106,61,0.16)]" style="background: var(--story-ring);">
            <div class="rounded-full bg-bg p-[0.1rem]">
              <Avatar class="w-8 h-8" :name="displayFolderTitle" :src="avatarUrl" />
            </div>
          </div>
        </button>
        <RouterLink
          v-else
          class="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          :to="{ name: 'folder', params: { slug: item.folderSlug } }"
          :aria-label="folderAvatarLabel"
          :title="folderAvatarLabel"
        >
          <Avatar class="w-8 h-8" :name="displayFolderTitle" :src="avatarUrl" />
        </RouterLink>
        <div class="min-w-0">
          <RouterLink class="block min-w-0 text-inherit no-underline" :to="{ name: 'folder', params: { slug: item.folderSlug } }">
            <h3 class="m-0 text-[0.88rem] font-semibold truncate">
              {{ displayFolderTitle }}
            </h3>
          </RouterLink>
          <RouterLink
            v-if="item.place"
            class="block truncate text-[0.78rem] font-medium text-muted no-underline hover:text-text"
            :to="{ name: 'place', params: { slug: item.place.slug } }"
          >
            {{ item.place.name }}
          </RouterLink>
        </div>
      </div>
      <button
        class="inline-flex items-center justify-center w-8 h-8 p-0 border-0 text-muted bg-transparent cursor-pointer"
        type="button"
        :aria-label="t('post.feedCard.moreOptions')"
        :title="t('post.feedCard.moreOptions')"
        @click="menuOpen = true"
      >
        <svg class="w-[1.15rem] h-[1.15rem]" viewBox="0 0 24 24" role="presentation">
          <circle cx="6.5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="17.5" cy="12" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>

    <CarouselMediaStage
      v-if="isCarousel"
      v-model="carouselIndex"
      class="rounded-[0.5rem] border border-border"
      :items="item.mediaItems!"
      :prefer-preview="isHomeContext"
      :retry-while="appStore.isScanning"
      :loading="isHomeContext ? 'eager' : 'lazy'"
      :muted="appStore.videoMuted"
    />

    <RouterLink v-else-if="!isHomeContext" custom :to="imageRoute" v-slot="{ href, navigate }">
      <a
        :href="href"
        class="relative block overflow-hidden rounded-[0.5rem] border border-border bg-surface-alt"
        :style="{ aspectRatio: mediaAspectRatio }"
        @click="handleImageNavigation($event, navigate)"
      >
        <ResilientImage
          :src="item.thumbnailUrl"
          :alt="item.filename"
          loading="lazy"
          :retry-while="appStore.isScanning"
          class="h-full w-full object-cover"
        />
        <div
          v-if="item.mediaType === 'video'"
          class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-4 py-3 text-white pointer-events-none bg-[linear-gradient(180deg,rgba(10,14,24,0)_0%,rgba(10,14,24,0.82)_100%)]"
        >
          <span class="i-fluent-play-circle-24-filled w-[1.15rem] h-[1.15rem] text-white" aria-hidden="true" />
          <span v-if="item.durationMs" class="rounded-full bg-black/55 px-[0.55rem] py-[0.18rem] text-[0.76rem] font-semibold">
            {{ formattedDuration }}
          </span>
        </div>
      </a>
    </RouterLink>

    <div
      v-else-if="item.mediaType === 'image'"
      class="relative block overflow-hidden rounded-[0.5rem] border border-border bg-surface-alt select-none"
      :style="{ aspectRatio: mediaAspectRatio, touchAction: 'manipulation' }"
      @click="handleHomeImageClick"
    >
      <ResilientImage
        :src="homeImageSrc"
        :alt="item.filename"
        loading="lazy"
        :retry-while="appStore.isScanning"
        class="h-full w-full object-cover"
      />
      <!-- Instagram-style double-tap heart burst, centered inside card -->
      <div ref="heartBurstEl" class="feed-card__heart-burst" aria-hidden="true">
        <span class="i-fluent-heart-20-filled feed-card__heart-burst-icon" />
      </div>
    </div>

    <div
      v-else
      ref="homeVideoTarget"
      class="feed-card__video-shell relative block overflow-hidden rounded-[0.5rem] border border-border bg-surface-alt"
      :class="{ 'feed-card__video-shell--interactive': showHomeVideoSurfaceControls }"
      :style="{ aspectRatio: homeVideoAspectRatio }"
      :aria-label="showHomeVideoSurfaceControls ? 'Toggle playback' : undefined"
      :role="showHomeVideoSurfaceControls ? 'button' : undefined"
      :tabindex="showHomeVideoSurfaceControls ? 0 : -1"
      @click="handleHomeVideoSurfaceClick"
      @keydown="handleHomeVideoSurfaceKeydown"
    >
      <media-player
        ref="homePlayerElement"
        class="feed-card__player"
        :src.prop="homeVideoSource"
        :title.prop="item.filename"
        :fullscreenOrientation.prop="'none'"
        :playsInline.prop="true"
        :muted.prop="appStore.videoMuted"
        :loop.prop="true"
        load="visible"
        preload="metadata"
        @fullscreen-change="handleHomeVideoFullscreenChange"
      >
        <media-provider />
        <media-poster
          :src.prop="item.thumbnailUrl"
          :alt.prop="item.filename"
        />
        <VideoProgressFooter
          variant="feed"
          :time-label="homeVideoTimeLabel"
        >
          <template #leading>
            <div v-if="showHomeVideoControls" class="feed-card__player-controls-group">
              <media-play-button
                class="feed-card__player-control"
                aria-label="Toggle playback"
              >
                <span
                  class="feed-card__player-control-icon feed-card__player-play-icon feed-card__player-play-icon--play i-fluent-play-16-filled"
                  aria-hidden="true"
                />
                <span
                  class="feed-card__player-control-icon feed-card__player-play-icon feed-card__player-play-icon--pause i-fluent-pause-16-filled"
                  aria-hidden="true"
                />
              </media-play-button>
            </div>
          </template>
          <template #trailing>
            <div v-if="showHomeVideoControls" class="feed-card__player-controls-group">
              <media-mute-button
                class="feed-card__player-control"
                aria-label="Toggle sound"
              >
                <span
                  class="feed-card__player-control-icon feed-card__player-mute-icon feed-card__player-mute-icon--on i-fluent-speaker-2-16-regular"
                  aria-hidden="true"
                />
                <span
                  class="feed-card__player-control-icon feed-card__player-mute-icon feed-card__player-mute-icon--off i-fluent-speaker-mute-16-regular"
                  aria-hidden="true"
                />
              </media-mute-button>
              <media-fullscreen-button
                class="feed-card__player-control"
                aria-label="Toggle fullscreen"
                target="media"
              >
                <span
                  class="feed-card__player-control-icon feed-card__player-fullscreen-icon feed-card__player-fullscreen-icon--enter i-fluent-full-screen-maximize-16-regular"
                  aria-hidden="true"
                />
                <span
                  class="feed-card__player-control-icon feed-card__player-fullscreen-icon feed-card__player-fullscreen-icon--exit i-fluent-full-screen-minimize-16-regular"
                  aria-hidden="true"
                />
              </media-fullscreen-button>
            </div>
          </template>
        </VideoProgressFooter>
      </media-player>
      <div
        v-if="showHomeVideoPausedIndicator"
        class="feed-card__pause-indicator"
        aria-hidden="true"
      >
        <span class="feed-card__pause-icon i-fluent-play-20-filled" />
      </div>
    </div>

    <div class="grid gap-[0.6rem] px-4 pt-[0.7rem] pb-[0.15rem]">
      <div class="flex items-center justify-between gap-[0.65rem]">
        <div class="flex items-center gap-[0.65rem]">
          <button
            v-if="authStore.canUseSavedItems"
            class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px disabled:opacity-50 disabled:cursor-wait disabled:transform-none"
            :class="{ 'text-[#e5484d]': likesStore.isLiked(item.id) }"
            type="button"
            :aria-label="likeActionLabel"
            :aria-pressed="likesStore.isLiked(item.id)"
            :title="likeActionLabel"
            :disabled="likesStore.isPending(item.id)"
            @click="handleLike"
          >
            <span
              class="w-[1.45rem] h-[1.45rem]"
              :class="likesStore.isLiked(item.id) ? 'i-fluent-heart-20-filled' : 'i-fluent-heart-20-regular'"
              aria-hidden="true"
            />
          </button>
          <RouterLink custom :to="imageRoute" v-slot="{ href, navigate }">
            <a
              :href="href"
              class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer color-inherit transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
              :aria-label="openMediaLabel"
              :title="openMediaLabel"
              @click="handleImageNavigation($event, navigate)"
            >
              <svg class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
                <path
                  d="M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5zm2.5 8 2.5-3 2.5 2.5 2-2 2.5 3"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                />
                <circle cx="15.25" cy="8.75" r="1.25" fill="currentColor" />
              </svg>
            </a>
          </RouterLink>
          <RouterLink
            class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer color-inherit transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
            :to="{ name: 'folder', params: { slug: item.folderSlug } }"
            :aria-label="t('post.viewer.openFolder')"
            :title="t('post.viewer.openFolder')"
          >
            <span class="i-fluent-folder-16-regular w-[1.30rem] h-[1.30rem]" aria-hidden="true" />
          </RouterLink>
        </div>
        <div class="flex items-center gap-[0.65rem]">
          <a
            v-if="isHomeContext"
            class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer color-inherit transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
            :href="downloadOriginalMediaUrl"
            download
            :aria-label="t('post.viewer.downloadOriginalFile')"
            :title="t('post.viewer.downloadOriginalFile')"
          >
            <svg class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
              <path
                d="M12 4.75v9.5m0 0 3.5-3.5M12 14.25l-3.5-3.5M5.75 16.75v1.5A1.75 1.75 0 0 0 7.5 20h9a1.75 1.75 0 0 0 1.75-1.75v-1.5"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
          </a>
          <a
            class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer color-inherit transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
            :href="originalMediaUrl"
            target="_blank"
            rel="noreferrer"
            :aria-label="t('post.viewer.openOriginalFile')"
            :title="t('post.viewer.openOriginalFile')"
          >
            <svg class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
              <path
                d="M14 5h5v5m0-5-7.5 7.5M10 7H7.5A2.5 2.5 0 0 0 5 9.5v7A2.5 2.5 0 0 0 7.5 19h7a2.5 2.5 0 0 0 2.5-2.5V14"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
          </a>
          <CollectionBookmark
            :item="item"
            placement="feed"
          />
        </div>
      </div>

      <p class="m-0 text-[0.88rem]">
        <strong class="mr-[0.35rem]">{{ displayFolderTitle }}</strong>
        {{ caption }}
      </p>
      <p class="m-0 text-muted text-[0.72rem] uppercase tracking-[0.05em]">
        {{ formattedDate }}
      </p>
    </div>

    <div v-if="menuOpen" class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/48" @click.self="menuOpen = false">
      <div class="w-[min(100%,22rem)] overflow-hidden bg-surface border border-border rounded-[1rem] shadow-[var(--shadow)]">
        <button
          v-if="authStore.canManageLibrary"
          class="flex items-center gap-[0.8rem] w-full px-4 py-[0.95rem] border-0 border-b border-border text-text bg-transparent cursor-pointer text-left"
          type="button"
          @click="openCaptionEditor"
        >
          <span class="i-fluent-edit-16-regular w-[1.15rem] h-[1.15rem] shrink-0" aria-hidden="true" />
          <span>{{ t('post.viewer.editCaption') }}</span>
        </button>
        <button
          class="flex items-center gap-[0.8rem] w-full px-4 py-[0.95rem] border-0 border-b border-border text-text bg-transparent cursor-pointer text-left"
          type="button"
          @click="openOriginal"
        >
          <svg class="w-[1.15rem] h-[1.15rem] shrink-0" viewBox="0 0 24 24" role="presentation">
            <path
              d="M14 5h5v5m0-5-7.5 7.5M10 7H7.5A2.5 2.5 0 0 0 5 9.5v7A2.5 2.5 0 0 0 7.5 19h7a2.5 2.5 0 0 0 2.5-2.5V14"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
          <span>{{ t('post.viewer.openOriginalFile') }}</span>
        </button>
        <button
          v-if="authStore.canDeleteMedia"
          class="flex items-center gap-[0.8rem] w-full px-4 py-[0.95rem] border-0 border-b border-border text-[#d93025] bg-transparent cursor-pointer text-left disabled:opacity-70 disabled:cursor-wait"
          type="button"
          :disabled="deleting"
          @click="handleDelete"
        >
          <svg class="w-[1.15rem] h-[1.15rem] shrink-0" viewBox="0 0 32 32" role="presentation">
            <path d="M12 12h2v12h-2z" fill="currentColor" />
            <path d="M18 12h2v12h-2z" fill="currentColor" />
            <path
              d="M4 6v2h2v20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8h2V6zm4 22V8h16v20z"
              fill="currentColor"
            />
            <path d="M12 2h8v2h-8z" fill="currentColor" />
          </svg>
          <span>{{ t('post.viewer.deletePost') }}</span>
        </button>
        <button
          class="flex items-center gap-[0.8rem] w-full px-4 py-[0.95rem] border-0 text-text bg-transparent cursor-pointer text-left"
          type="button"
          @click="menuOpen = false"
        >
          <svg class="w-[1.15rem] h-[1.15rem] shrink-0" viewBox="0 0 24 24" role="presentation">
            <path
              d="m7 7 10 10M17 7 7 17"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
          <span>{{ t('common.cancel') }}</span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <PostCaptionModal
        v-if="isEditingCaption"
        :filename="item.filename"
        :caption="item.caption"
        :error="captionError"
        :loading="captionSaving"
        @cancel="closeCaptionEditor"
        @save="handleCaptionSave"
      />
    </Teleport>

    <ConfirmDialog
      v-if="confirmDeleteOpen"
      :title="t('post.feedCard.delete.title')"
      :message="deleteDialogMessage"
      :confirm-label="deleteDialogConfirmLabel"
      :loading="deleting"
      @cancel="confirmDeleteOpen = false"
      @confirm="confirmDelete"
    >
      <template #details>
        <label class="flex items-start gap-3 mt-3 cursor-pointer select-none">
          <input
            v-model="deleteOriginalFromDisk"
            class="mt-[0.2rem]"
            type="checkbox"
            :disabled="deleting"
          />
          <span class="grid gap-[0.18rem]">
            <span class="text-[0.92rem] font-semibold text-text">{{ t('post.feedCard.delete.deleteOriginalLabel') }}</span>
            <span class="text-[0.84rem] text-muted">{{ t('post.feedCard.delete.deleteOriginalDescription') }}</span>
          </span>
        </label>
        <p
          v-if="deleteOriginalFromDisk"
          class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
        >
          {{ t('post.feedCard.delete.deleteOriginalWarning') }}
        </p>
        <p
          v-if="deleteError"
          class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
        >
          {{ deleteError }}
        </p>
      </template>
    </ConfirmDialog>
  </article>
</template>

<script setup lang="ts">
import 'vidstack/bundle';

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import type { PlayerSrc } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';

import { deleteImage, trashImage } from '../api/gallery';
import { useImageCaptionEditor } from '../composables/useImageCaptionEditor';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useFeedStore } from '../stores/feed';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import { useMomentsStore } from '../stores/moments';
import type { FeedItem } from '../types/api';
import { resolveDisplayCaption } from '../utils/caption';
import { formatFolderTitle } from '../utils/folder-titles';
import { formatMediaDuration, formatVideoTimestamp } from '../utils/media';
import { resolveFeedAspectRatio } from '../utils/media-layout';
import { getOriginalMediaDownloadUrl, getOriginalMediaUrl } from '../utils/original-media';
import {
  resolveVideoFallbackSource,
  resolveVideoSource,
  toPlayerSrc,
  useBundledHlsLibrary,
  type ResolvedVideoSource
} from '../utils/video-playback';
import Avatar from './Avatar.vue';
import CarouselMediaStage from './CarouselMediaStage.vue';
import CollectionBookmark from './CollectionBookmark.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import PostCaptionModal from './PostCaptionModal.vue';
import ResilientImage from './ResilientImage.vue';
import VideoProgressFooter from './VideoProgressFooter.vue';

interface HomeVideoVisibilityChange {
  id: number;
  ratio: number;
  centerOffset: number;
}

const HOME_IMAGE_DOUBLE_TAP_WINDOW_MS = 320;
const HOME_VIDEO_OBSERVER_THRESHOLDS = [0, 0.2, 0.4, 0.6, 0.8, 1];

const props = withDefaults(
  defineProps<{
    item: FeedItem;
    avatarUrl: string | null;
    hasAvatarStory?: boolean;
    context?: 'default' | 'home';
    isActiveVideo?: boolean;
  }>(),
  {
    hasAvatarStory: false,
    context: 'default',
    isActiveVideo: false
  }
);

const emit = defineEmits<{
  openFolderStory: [folderSlug: string];
  videoVisibilityChange: [payload: HomeVideoVisibilityChange];
}>();

const appStore = useAppStore();
const authStore = useAuthStore();
const feedStore = useFeedStore();
const likesStore = useLikesStore();
const foldersStore = useFoldersStore();
const momentsStore = useMomentsStore();
const route = useRoute();
const { t, locale } = useI18n();
const menuOpen = ref(false);
const deleting = ref(false);
const confirmDeleteOpen = ref(false);
const deleteOriginalFromDisk = ref(false);
const deleteError = ref<string | null>(null);
const isEditingCaption = ref(false);
const homeVideoTarget = ref<HTMLElement | null>(null);
const homePlayerElement = ref<MediaPlayerElement | null>(null);
const loadedHomeVideoAspectRatio = ref<string | null>(null);
const isHomeVideoPaused = ref(false);
const isHomeVideoFullscreen = ref(false);
const homeVideoDurationMs = ref(props.item.durationMs ?? 0);
const homeVideoCurrentTimeMs = ref(0);
const lastHomeImageTapAt = ref(0);
const heartBurstEl = ref<HTMLElement | null>(null);
const carouselIndex = ref(0);

let homeImageTapResetTimer: ReturnType<typeof setTimeout> | null = null;
let homeVideoObserver: IntersectionObserver | null = null;
let homeVideoMuteSyncToken = 0;
let homePlayerReady = false;
let removeHomePlayerEventListeners: (() => void) | null = null;
const {
  saving: captionSaving,
  error: captionError,
  saveCaption,
  clearError: clearCaptionError
} = useImageCaptionEditor();

const imageRoute = computed(() => ({
  name: 'image',
  params: { id: String(props.item.id) },
  query: route.query
}));
const isHomeContext = computed(() => props.context === 'home');
const isCarousel = computed(() => props.item.postType === 'carousel' && (props.item.mediaItems?.length ?? 0) > 1);
const showHomeStoryAvatar = computed(() => isHomeContext.value && props.hasAvatarStory);
const shouldOpenPostInModal = computed(() => props.context !== 'home');
const displayFolderTitle = computed(() => formatFolderTitle(props.item, appStore.nestedFolderTitleFormat));
const folderStoriesLabel = computed(() => t('post.feedCard.openStories', { name: displayFolderTitle.value }));
const folderAvatarLabel = computed(() => t('post.feedCard.openFolderAvatar', { name: displayFolderTitle.value }));
const likeActionLabel = computed(() => likesStore.toggleAriaLabel(likesStore.isLiked(props.item.id)));
const openMediaLabel = computed(() =>
  props.item.mediaType === 'video' ? t('post.feedCard.openReel') : t('post.feedCard.openPost')
);
const caption = computed(() => resolveDisplayCaption(props.item));
const formattedDate = computed(() =>
  new Date(props.item.takenAt ?? props.item.sortTimestamp).toLocaleDateString(locale.value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
);
const formattedDuration = computed(() => formatMediaDuration(props.item.durationMs));
const mediaAspectRatio = computed(() => resolveFeedAspectRatio(props.item.width, props.item.height));
const homeVideoAspectRatio = computed(() => loadedHomeVideoAspectRatio.value ?? mediaAspectRatio.value);
const homeImageSrc = computed(() => (props.item.isAnimated ? props.item.previewUrl : props.item.thumbnailUrl));
const activeMediaImageId = computed(() =>
  isCarousel.value ? props.item.mediaItems?.[carouselIndex.value]?.imageId ?? props.item.id : props.item.id
);
const originalMediaUrl = computed(() => getOriginalMediaUrl(activeMediaImageId.value));
const downloadOriginalMediaUrl = computed(() => getOriginalMediaDownloadUrl(activeMediaImageId.value));
const homeVideoFallbackSource = ref<ResolvedVideoSource | null>(null);
const homePreferredVideoSource = computed<ResolvedVideoSource>(() =>
  resolveVideoSource(props.item, appStore.videoPlaybackQuality)
);
const homeActiveVideoSource = computed<ResolvedVideoSource>(
  () => homeVideoFallbackSource.value ?? homePreferredVideoSource.value
);
const homeVideoSource = computed<PlayerSrc>(() => toPlayerSrc(homeActiveVideoSource.value));
const homeVideoTimeLabel = computed(() =>
  formatVideoTimestamp(
    homeVideoDurationMs.value > 0 ? homeVideoDurationMs.value : props.item.durationMs,
    homeVideoCurrentTimeMs.value
  )
);
const showHomeVideoControls = computed(() => props.isActiveVideo || isHomeVideoFullscreen.value);
const showHomeVideoSurfaceControls = computed(() => props.isActiveVideo || isHomeVideoFullscreen.value);
const showHomeVideoPausedIndicator = computed(() => showHomeVideoSurfaceControls.value && isHomeVideoPaused.value);
const deleteDialogMessage = computed(() =>
  deleteOriginalFromDisk.value
    ? t('post.feedCard.delete.messagePermanent')
    : t('post.feedCard.delete.messageTrash')
);
const deleteDialogConfirmLabel = computed(() =>
  deleteOriginalFromDisk.value ? t('post.feedCard.delete.confirmPermanent') : t('post.feedCard.delete.confirm')
);

function isPrimaryPlainClick(event: MouseEvent) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest(
      'a, button, input, textarea, select, media-play-button, media-mute-button, media-fullscreen-button, media-time-slider'
    )
  );
}

function clearHomeImageTapResetTimer() {
  if (homeImageTapResetTimer) {
    clearTimeout(homeImageTapResetTimer);
    homeImageTapResetTimer = null;
  }
}

function queueHomeImageTapReset() {
  clearHomeImageTapResetTimer();
  homeImageTapResetTimer = setTimeout(() => {
    lastHomeImageTapAt.value = 0;
    homeImageTapResetTimer = null;
  }, HOME_IMAGE_DOUBLE_TAP_WINDOW_MS);
}

async function likeFromMedia() {
  if (!authStore.canUseSavedItems || likesStore.isLiked(props.item.id) || likesStore.isPending(props.item.id)) {
    return;
  }

  await likesStore.toggleLike(props.item);
}

function triggerHeartBurst() {
  const el = heartBurstEl.value;
  if (!el) return;

  // Restart animation cleanly
  el.classList.remove('feed-card__heart-burst--active');
  void el.offsetWidth; // force reflow
  el.classList.add('feed-card__heart-burst--active');
}

function handleImageNavigation(event: MouseEvent, navigate: () => void) {
  if (!isPrimaryPlainClick(event)) {
    return;
  }

  event.preventDefault();

  if (shouldOpenPostInModal.value) {
    appStore.setImageModalBackground(route.fullPath);
  }

  navigate();
}

function handleHomeImageClick(event: MouseEvent) {
  if (!isHomeContext.value || props.item.mediaType !== 'image' || !isPrimaryPlainClick(event)) {
    return;
  }

  const now = Date.now();
  if (lastHomeImageTapAt.value > 0 && now - lastHomeImageTapAt.value <= HOME_IMAGE_DOUBLE_TAP_WINDOW_MS) {
    lastHomeImageTapAt.value = 0;
    clearHomeImageTapResetTimer();
    triggerHeartBurst();
    void likeFromMedia();
    return;
  }

  lastHomeImageTapAt.value = now;
  queueHomeImageTapReset();
}

function emitHomeVideoVisibility(ratio: number, centerOffset = Number.POSITIVE_INFINITY) {
  if (!isHomeContext.value || props.item.mediaType !== 'video') {
    return;
  }

  emit('videoVisibilityChange', {
    id: props.item.id,
    ratio,
    centerOffset
  });
}

function getHomeVideoElement(player: MediaPlayerElement | null): HTMLVideoElement | null {
  if (!player) {
    return null;
  }

  const directVideo = player.querySelector('video');
  if (directVideo instanceof HTMLVideoElement) {
    return directVideo;
  }

  const shadowVideo = player.shadowRoot?.querySelector('video');
  return shadowVideo instanceof HTMLVideoElement ? shadowVideo : null;
}

function syncHomeVideoAspectRatio(player: MediaPlayerElement | null = homePlayerElement.value) {
  const video = getHomeVideoElement(player);
  if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return;
  }

  loadedHomeVideoAspectRatio.value = resolveFeedAspectRatio(video.videoWidth, video.videoHeight);
}

function syncHomeVideoTimelineState(player: MediaPlayerElement | null = homePlayerElement.value) {
  if (!player) {
    return;
  }

  if (Number.isFinite(player.duration) && player.duration > 0) {
    homeVideoDurationMs.value = player.duration * 1000;
  }

  if (Number.isFinite(player.currentTime) && player.currentTime >= 0) {
    homeVideoCurrentTimeMs.value = player.currentTime * 1000;
  }
}

function stopHomeVideoObserver(options: { clearVisibility?: boolean } = {}) {
  if (homeVideoObserver) {
    homeVideoObserver.disconnect();
    homeVideoObserver = null;
  }

  if (options.clearVisibility ?? true) {
    emitHomeVideoVisibility(0);
  }
}

function startHomeVideoObserver() {
  if (!isHomeContext.value || props.item.mediaType !== 'video' || !homeVideoTarget.value || homeVideoObserver) {
    return;
  }

  homeVideoObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const centerOffset = Math.abs(entry.boundingClientRect.top + entry.boundingClientRect.height / 2 - window.innerHeight / 2);
      emitHomeVideoVisibility(entry.isIntersecting ? entry.intersectionRatio : 0, centerOffset);
    },
    {
      threshold: HOME_VIDEO_OBSERVER_THRESHOLDS
    }
  );

  homeVideoObserver.observe(homeVideoTarget.value);
}

function syncHomeVideoMuted(player: MediaPlayerElement, muted: boolean) {
  const token = ++homeVideoMuteSyncToken;
  player.muted = muted;

  requestAnimationFrame(() => {
    if (homeVideoMuteSyncToken === token) {
      homeVideoMuteSyncToken = 0;
    }
  });
}

async function syncHomeVideoPlayback() {
  if (!isHomeContext.value || props.item.mediaType !== 'video') {
    return;
  }

  const player = homePlayerElement.value;
  if (!player) {
    return;
  }

  if (!props.isActiveVideo && !isHomeVideoFullscreen.value) {
    isHomeVideoPaused.value = false;
    void player.pause().catch(() => {
      // Ignore pause rejections before the provider is ready.
    });
    syncHomeVideoMuted(player, appStore.videoMuted);
    return;
  }

  syncHomeVideoMuted(player, appStore.videoMuted);

  try {
    await player.play();
    isHomeVideoPaused.value = false;
    return;
  } catch {
    if (appStore.videoMuted) {
      // Ignore autoplay rejections and leave manual controls available when focused.
      return;
    }
  }

  syncHomeVideoMuted(player, true);

  try {
    await player.play();
  } catch {
    // Ignore autoplay rejections and leave manual controls available when focused.
  }
}

function handleHomeVideoPlay() {
  isHomeVideoPaused.value = false;
  syncHomeVideoTimelineState();

  if (!props.isActiveVideo && !isHomeVideoFullscreen.value) {
    void homePlayerElement.value?.pause().catch(() => {
      // Ignore pause rejections before the provider is ready.
    });
  }
}

function handleHomeVideoPause() {
  isHomeVideoPaused.value = showHomeVideoSurfaceControls.value;
  syncHomeVideoTimelineState();
}

function handleHomeVideoDurationChange(event: Event) {
  if (event instanceof CustomEvent && typeof event.detail === 'number' && event.detail > 0) {
    homeVideoDurationMs.value = event.detail * 1000;
  }

  syncHomeVideoTimelineState();
}

function handleHomeVideoTimeUpdate(event: Event) {
  if (
    event instanceof CustomEvent &&
    typeof event.detail === 'object' &&
    event.detail !== null &&
    'currentTime' in event.detail &&
    typeof event.detail.currentTime === 'number'
  ) {
    homeVideoCurrentTimeMs.value = event.detail.currentTime * 1000;
    return;
  }

  syncHomeVideoTimelineState();
}

function handleHomeVideoEnded() {
  homeVideoCurrentTimeMs.value = homeVideoDurationMs.value;
}

async function handleHomeVideoSurfaceClick(event: MouseEvent) {
  if (!showHomeVideoSurfaceControls.value || !isPrimaryPlainClick(event) || isInteractiveTarget(event.target)) {
    return;
  }

  const player = homePlayerElement.value;
  if (!player) {
    return;
  }

  if (player.paused) {
    await syncHomeVideoPlayback();
    return;
  }

  isHomeVideoPaused.value = true;
  void player.pause().catch(() => {
    // Ignore pause rejections before the provider is ready.
  });
}

function handleHomeVideoSurfaceKeydown(event: KeyboardEvent) {
  if (isInteractiveTarget(event.target)) {
    return;
  }

  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  void handleHomeVideoSurfaceClick(new MouseEvent('click', { button: 0 }));
}

function handleHomeVideoFullscreenChange(event: Event) {
  const nextFullscreen =
    event instanceof CustomEvent && typeof event.detail === 'boolean'
      ? event.detail
      : homePlayerElement.value?.hasAttribute('data-fullscreen') === true;

  isHomeVideoFullscreen.value = nextFullscreen;

  if (nextFullscreen) {
    stopHomeVideoObserver({ clearVisibility: false });
    emitHomeVideoVisibility(1, -1);
    void syncHomeVideoPlayback();
    return;
  }

  startHomeVideoObserver();
  void syncHomeVideoPlayback();
}

function handleHomeVideoVolumeChange() {
  const player = homePlayerElement.value;
  // Ignore volume-change events that fire before the player has fully initialized.
  // Vidstack can emit these during its own setup with muted=false, which would
  // overwrite the persisted muted preference read from localStorage.
  if (!player || !homePlayerReady || homeVideoMuteSyncToken !== 0) {
    return;
  }

  if (player.muted !== appStore.videoMuted) {
    appStore.setVideoMuted(player.muted);
  }
}

function switchHomeVideoToFallbackSource() {
  if (homeVideoFallbackSource.value) {
    return;
  }

  const fallback = resolveVideoFallbackSource(props.item, homeActiveVideoSource.value);
  if (!fallback) {
    return;
  }

  homeVideoFallbackSource.value = fallback;
}

function bindHomePlayerEventListeners(player: MediaPlayerElement | null) {
  removeHomePlayerEventListeners?.();
  removeHomePlayerEventListeners = null;

  if (!player) {
    return;
  }

  const handleReady = () => {
    homePlayerReady = true;
    syncHomeVideoAspectRatio(player);
    syncHomeVideoTimelineState(player);
    void syncHomeVideoPlayback();
  };
  const handleVolume = () => {
    handleHomeVideoVolumeChange();
  };
  const handlePlay = () => {
    handleHomeVideoPlay();
  };
  const handlePause = () => {
    handleHomeVideoPause();
  };
  const handleDuration = (event: Event) => {
    handleHomeVideoDurationChange(event);
  };
  const handleTimeUpdate = (event: Event) => {
    handleHomeVideoTimeUpdate(event);
  };
  const handleEnded = () => {
    handleHomeVideoEnded();
  };
  const handleError = () => {
    switchHomeVideoToFallbackSource();
  };

  const removeHlsLibraryBinding = useBundledHlsLibrary(player);

  player.addEventListener('loaded-metadata', handleReady);
  player.addEventListener('can-play', handleReady);
  player.addEventListener('volume-change', handleVolume);
  player.addEventListener('play', handlePlay);
  player.addEventListener('pause', handlePause);
  player.addEventListener('duration-change', handleDuration);
  player.addEventListener('time-update', handleTimeUpdate);
  player.addEventListener('ended', handleEnded);
  player.addEventListener('error', handleError);

  removeHomePlayerEventListeners = () => {
    removeHlsLibraryBinding();
    player.removeEventListener('loaded-metadata', handleReady);
    player.removeEventListener('can-play', handleReady);
    player.removeEventListener('volume-change', handleVolume);
    player.removeEventListener('play', handlePlay);
    player.removeEventListener('pause', handlePause);
    player.removeEventListener('duration-change', handleDuration);
    player.removeEventListener('time-update', handleTimeUpdate);
    player.removeEventListener('ended', handleEnded);
    player.removeEventListener('error', handleError);
  };

  if (player.hasAttribute('data-can-play')) {
    syncHomeVideoAspectRatio(player);
    void syncHomeVideoPlayback();
  }
}

function openOriginal() {
  menuOpen.value = false;
  window.open(getOriginalMediaUrl(props.item.id), '_blank', 'noopener,noreferrer');
}

async function openCaptionEditor() {
  menuOpen.value = false;
  clearCaptionError();
  await nextTick();
  isEditingCaption.value = true;
}

function closeCaptionEditor() {
  clearCaptionError();
  isEditingCaption.value = false;
}

async function handleCaptionSave(nextCaption: string | null) {
  try {
    await saveCaption(props.item, nextCaption);
    closeCaptionEditor();
  } catch {
    // The modal surfaces the current error state.
  }
}

function handleDelete() {
  if (!authStore.canDeleteMedia) {
    return;
  }

  menuOpen.value = false;
  deleteOriginalFromDisk.value = false;
  deleteError.value = null;
  confirmDeleteOpen.value = true;
}

async function handleLike() {
  if (!authStore.canUseSavedItems) {
    return;
  }

  await likesStore.toggleLike(props.item);
}

async function confirmDelete() {
  if (!authStore.canDeleteMedia) {
    return;
  }

  deleting.value = true;
  deleteError.value = null;

  try {
    const deleted = deleteOriginalFromDisk.value ? await deleteImage(props.item.id) : await trashImage(props.item.id);
    feedStore.removeImage(deleted.id);
    likesStore.removeImage(deleted.id);
    const removedFolder = foldersStore.removeImage(deleted.id, deleted.folderSlug, props.item.mediaType);
    momentsStore.removeImage(deleted.id);
    appStore.removeIndexedImage(removedFolder ? 1 : 0, props.item.mediaType);
    confirmDeleteOpen.value = false;
    deleteOriginalFromDisk.value = false;
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : 'Unable to delete post';
  } finally {
    deleting.value = false;
  }
}

watch(
  () => homeVideoTarget.value,
  () => {
    stopHomeVideoObserver();
    startHomeVideoObserver();
  }
);

watch(
  () => props.item.id,
  () => {
    loadedHomeVideoAspectRatio.value = null;
    isHomeVideoPaused.value = false;
    homeVideoDurationMs.value = props.item.durationMs ?? 0;
    homeVideoCurrentTimeMs.value = 0;
    homeVideoFallbackSource.value = null;
  }
);

watch(
  () => appStore.videoPlaybackQuality,
  () => {
    homeVideoFallbackSource.value = null;
  }
);

watch(
  () => props.isActiveVideo,
  () => {
    void syncHomeVideoPlayback();
  }
);

watch(isHomeVideoFullscreen, () => {
  void syncHomeVideoPlayback();
});

watch(
  () => appStore.videoMuted,
  (videoMuted) => {
    const player = homePlayerElement.value;
    if (!player) {
      return;
    }

    syncHomeVideoMuted(player, videoMuted);
  }
);

watch(homePlayerElement, (player) => {
  loadedHomeVideoAspectRatio.value = null;
  isHomeVideoPaused.value = false;
  homeVideoDurationMs.value = props.item.durationMs ?? 0;
  homePlayerReady = false;
  homeVideoCurrentTimeMs.value = 0;
  bindHomePlayerEventListeners(player);
});

watch(
  () => props.context,
  (context) => {
    if (context === 'home' && props.item.mediaType === 'video') {
      if (!isHomeVideoFullscreen.value) {
        startHomeVideoObserver();
      }
      void syncHomeVideoPlayback();
      return;
    }

    stopHomeVideoObserver();
    isHomeVideoPaused.value = false;
    void homePlayerElement.value?.pause().catch(() => {
      // Ignore pause rejections before the provider is ready.
    });
  }
);

onMounted(() => {
  if (!isHomeVideoFullscreen.value) {
    startHomeVideoObserver();
  }
  void syncHomeVideoPlayback();
});

onBeforeUnmount(() => {
  clearHomeImageTapResetTimer();
  stopHomeVideoObserver();
  isHomeVideoPaused.value = false;
  removeHomePlayerEventListeners?.();
  removeHomePlayerEventListeners = null;
  void homePlayerElement.value?.pause().catch(() => {
    // Ignore pause rejections before the provider is ready.
  });
});
</script>

<style scoped>
/* ── Double-tap heart burst ─────────────────────────────────────────── */
.feed-card__heart-burst {
  /* Always centered in the image card */
  position: absolute;
  inset: 0;
  margin: auto;
  width: 6.5rem;
  height: 6.5rem;
  opacity: 0;
  color: #e5484d;
  pointer-events: none;
  transform: scale(0);
  filter:
    drop-shadow(0 0 12px rgba(229, 72, 77, 0.65))
    drop-shadow(0 3px 8px rgba(0, 0, 0, 0.28));
  z-index: 10;
}

.feed-card__heart-burst-icon {
  display: block;
  width: 100%;
  height: 100%;
}

.feed-card__heart-burst--active {
  animation: feed-heart-burst 1.1s ease-out forwards;
  will-change: transform, opacity;
}

@keyframes feed-heart-burst {
  /* Phase 1 — spring pop-in */
  0%   { opacity: 0;   transform: translateY(0) scale(0) rotate(0deg); }
  16%  { opacity: 1;   transform: translateY(0) scale(1.4) rotate(0deg); }
  26%  { opacity: 1;   transform: translateY(0) scale(0.88) rotate(0deg); }
  36%  { opacity: 1;   transform: translateY(0) scale(1.1) rotate(0deg); }
  46%  { opacity: 1;   transform: translateY(0) scale(1) rotate(0deg); }

  /* Phase 2 — tilt left while beginning to rise */
  58%  { opacity: 1;   transform: translateY(-60%) scale(1) rotate(-18deg); }

  /* Phase 3 — straighten and continue rising */
  70%  { opacity: 1;   transform: translateY(-150%) scale(0.95) rotate(0deg); }

  /* Phase 4 — rocket upward and fade, clipped by overflow:hidden */
  100% { opacity: 0;   transform: translateY(-350%) scale(0.82) rotate(0deg); }
}
</style>
