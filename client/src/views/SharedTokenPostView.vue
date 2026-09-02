<template>
  <main class="shared-token-post">
    <header class="shared-token-post__bar">
      <span class="shared-token-post__brand">
        <span class="i-fluent-folder-24-filled h-5 w-5" aria-hidden="true" />
        <span>Foldergram</span>
      </span>
      <span class="shared-token-post__badge">{{ t('share.post.badge') }}</span>
    </header>

    <section v-if="loading" class="shared-token-post__notice">
      <p class="m-0">{{ t('share.post.loadingTitle') }}</p>
    </section>

    <ErrorState
      v-else-if="!detail"
      class="shared-token-post__notice"
      :title="t('share.post.notFoundTitle')"
      :message="error ?? t('share.post.notFoundDescription')"
    />

    <section v-else class="shared-token-post__body">
      <div class="shared-token-post__stage" :style="stageStyle">
        <CarouselMediaStage
          v-if="isCarousel"
          v-model="carouselIndex"
          class="shared-token-post__carousel"
          :items="detail.mediaItems!"
          prefer-preview
          loading="eager"
        />
        <VideoMediaPlayer
          v-else-if="detail.mediaType === 'video'"
          class="shared-token-post__player"
          :src="detail.previewUrl"
          :media="playbackMedia!"
          :original-url="detail.previewUrl"
          :playback-strategy="detail.playbackStrategy ?? null"
          :width="detail.width"
          :height="detail.height"
          :poster="detail.thumbnailUrl"
          :alt="detail.filename"
          :title="detail.filename"
          :muted="appStore.videoMuted"
          autoplay
          hold-to-seek
          variant="viewer"
          @toggle-mute="appStore.setVideoMuted(!appStore.videoMuted)"
        />
        <ResilientImage
          v-else
          class="shared-token-post__image"
          :src="detail.previewUrl"
          :fallback-src="detail.thumbnailUrl"
          :alt="detail.filename"
          loading="eager"
        />
      </div>

      <div class="shared-token-post__actions">
        <button
          class="shared-token-post__action"
          :class="{ 'shared-token-post__action--liked': liked }"
          type="button"
          data-test="share-like"
          :aria-pressed="liked"
          :aria-label="t(liked ? 'likes.actions.removeFavoriteFromPost' : 'likes.actions.favoritePost')"
          @click="toggleLike"
        >
          <span
            class="h-6 w-6"
            :class="liked ? 'i-fluent-heart-20-filled' : 'i-fluent-heart-20-regular'"
            aria-hidden="true"
          />
        </button>

        <button
          class="shared-token-post__action"
          type="button"
          data-test="share-details"
          :aria-pressed="detailsOpen"
          :aria-label="t(detailsOpen ? 'post.viewer.hideDetails' : 'post.viewer.showDetails')"
          @click="detailsOpen = !detailsOpen"
        >
          <span
            class="h-6 w-6"
            :class="detailsOpen ? 'i-fluent-info-16-filled' : 'i-fluent-info-16-regular'"
            aria-hidden="true"
          />
        </button>

        <button
          class="shared-token-post__action"
          type="button"
          data-test="share-copy"
          :aria-label="t('share.post.action')"
          @click="copyLink"
        >
          <span
            class="h-6 w-6"
            :class="copied ? 'i-fluent-checkmark-20-filled' : 'i-fluent-share-20-regular'"
            aria-hidden="true"
          />
        </button>
      </div>

      <dl v-if="detailsOpen" class="shared-token-post__details">
        <div>
          <dt>{{ t('reels.info.resolution') }}</dt>
          <dd>{{ activeMedia?.width ?? detail.width }} x {{ activeMedia?.height ?? detail.height }}</dd>
        </div>
        <div v-if="durationLabel">
          <dt>{{ t('reels.info.length') }}</dt>
          <dd>{{ durationLabel }}</dd>
        </div>
        <div>
          <dt>{{ t('reels.info.format') }}</dt>
          <dd>{{ formatLabel }}</dd>
        </div>
      </dl>

      <p class="shared-token-post__caption">{{ caption }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { fetchSharedPostByToken } from '../api/gallery';
import CarouselMediaStage from '../components/CarouselMediaStage.vue';
import ErrorState from '../components/ErrorState.vue';
import ResilientImage from '../components/ResilientImage.vue';
import VideoMediaPlayer from '../components/VideoMediaPlayer.vue';
import { useAppStore } from '../stores/app';
import type { SharedImageDetail } from '../types/api';
import { resolveDisplayCaption } from '../utils/caption';
import { formatMediaDuration } from '../utils/media';
import type { VideoPlaybackMedia } from '../utils/video-playback';

const props = defineProps<{
  token: string;
}>();

const { t } = useI18n();
const appStore = useAppStore();
const SHARE_LIKES_STORAGE_KEY = 'foldergram-share-likes';
const detail = ref<SharedImageDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const carouselIndex = ref(0);
const detailsOpen = ref(false);
const liked = ref(false);
const copied = ref(false);
let copiedTimer = 0;

const isCarousel = computed(
  () => detail.value?.postType === 'carousel' && (detail.value.mediaItems?.length ?? 0) > 1
);
const activeMedia = computed(() =>
  isCarousel.value ? detail.value?.mediaItems?.[carouselIndex.value] ?? null : null
);

/**
 * The token's own preview route streams the untouched file for videos, so it doubles as
 * the "original" here. `/api/originals/:id` is deliberately not reachable for a visitor
 * holding only a share token.
 */
const playbackMedia = computed<VideoPlaybackMedia | null>(() => {
  const current = detail.value;
  if (!current || current.mediaType !== 'video') {
    return null;
  }

  return {
    id: current.id,
    filename: current.filename,
    playbackStrategy: current.playbackStrategy ?? null,
    streamUrl: current.streamUrl ?? null,
    originalUrl: current.previewUrl,
    previewUrl: current.previewUrl
  };
});

const caption = computed(() => {
  const current = detail.value;
  if (!current) {
    return '';
  }

  return resolveDisplayCaption({
    filename: current.filename,
    caption: current.caption,
    postType: current.postType,
    carouselTitle: current.carouselTitle
  });
});
const durationLabel = computed(() =>
  formatMediaDuration(activeMedia.value?.durationMs ?? detail.value?.durationMs ?? null)
);
const formatLabel = computed(() => {
  const mimeType = activeMedia.value?.mimeType ?? detail.value?.mimeType;
  return mimeType ? mimeType.replace(/^(video|image)\//, '').toUpperCase() : t('reels.info.unavailable');
});
// A known aspect ratio keeps the frame from collapsing and then jumping once the media
// loads, which on a phone is the difference between a stable page and a flicker.
const stageStyle = computed(() => {
  const width = activeMedia.value?.width ?? detail.value?.width ?? 0;
  const height = activeMedia.value?.height ?? detail.value?.height ?? 0;
  return width > 0 && height > 0 ? { aspectRatio: `${width} / ${height}` } : undefined;
});

function readLikedTokens(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(SHARE_LIKES_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The heart is remembered per link in this browser only. Writing it into the real likes
 * store would need an account, and it would file token URLs into the owner's library.
 */
function toggleLike() {
  liked.value = !liked.value;

  if (typeof window === 'undefined') {
    return;
  }

  const tokens = readLikedTokens().filter((entry) => entry !== props.token);
  if (liked.value) {
    tokens.push(props.token);
  }

  try {
    window.localStorage.setItem(SHARE_LIKES_STORAGE_KEY, JSON.stringify(tokens.slice(-200)));
  } catch {
    // A full or blocked storage must not break playback.
  }
}

async function copyLink() {
  const url = window.location.href;

  try {
    await navigator.clipboard.writeText(url);
    copied.value = true;
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.append(textArea);
    textArea.select();
    copied.value = document.execCommand('copy');
    textArea.remove();
  }

  if (copiedTimer !== 0) {
    window.clearTimeout(copiedTimer);
  }

  copiedTimer = window.setTimeout(() => {
    copied.value = false;
    copiedTimer = 0;
  }, 2_000);
}

watch(
  () => props.token,
  async (token) => {
    loading.value = true;
    error.value = null;
    detail.value = null;
    carouselIndex.value = 0;
    liked.value = readLikedTokens().includes(token);

    try {
      detail.value = await fetchSharedPostByToken(token);
    } catch (loadError) {
      error.value = loadError instanceof Error ? loadError.message : t('share.post.notFoundDescription');
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.shared-token-post {
  display: grid;
  align-content: start;
  gap: 1rem;
  min-height: 100dvh;
  padding: 0.85rem 0.85rem 2rem;
  background: #0b0c0f;
  color: rgba(255, 255, 255, 0.92);
}

.shared-token-post__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: min(100%, 40rem);
  margin: 0 auto;
}

.shared-token-post__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.shared-token-post__badge {
  padding: 0.2rem 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.66);
}

.shared-token-post__notice {
  width: min(100%, 28rem);
  margin: 0 auto;
  padding: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 1rem;
  text-align: center;
}

.shared-token-post__body {
  display: grid;
  gap: 0.85rem;
  width: min(100%, 40rem);
  margin: 0 auto;
}

.shared-token-post__stage {
  position: relative;
  display: grid;
  place-items: center;
  max-height: 82dvh;
  overflow: hidden;
  border-radius: 1rem;
  background: #000;
}

.shared-token-post__carousel,
.shared-token-post__player {
  width: 100%;
  height: 100%;
}

.shared-token-post__image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.shared-token-post__actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.shared-token-post__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.6rem;
  height: 2.6rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.shared-token-post__action--liked {
  color: #ff6b81;
}

.shared-token-post__details {
  display: grid;
  gap: 0.4rem 1rem;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  margin: 0;
}

.shared-token-post__details dt {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.55);
}

.shared-token-post__details dd {
  margin: 0.1rem 0 0;
  font-size: 0.88rem;
  font-weight: 600;
}

.shared-token-post__caption {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 0.92rem;
  color: rgba(255, 255, 255, 0.78);
}
</style>
