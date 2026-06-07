<template>
  <div class="reel-action-rail" @click.stop>
    <slot name="prepend" />
    <button
      class="reel-action-rail__button"
      :class="{ 'reel-action-rail__button--liked': isLiked }"
      type="button"
      :aria-label="likesStore.toggleAriaLabel(isLiked)"
      :aria-pressed="isLiked"
      :disabled="likesStore.isPending(item.id) || !authStore.canUseSavedItems"
      @click="handleLike"
    >
      <span
        class="reel-action-rail__icon"
        :class="isLiked ? 'i-fluent-heart-20-filled' : 'i-fluent-heart-20-regular'"
        aria-hidden="true"
      />
    </button>

    <CollectionBookmark :item="item" placement="feed" />

    <div class="reel-action-rail__info-wrap">
      <button
        class="reel-action-rail__button"
        type="button"
        :aria-label="infoOpen ? t('reels.rail.hideDetails') : t('reels.rail.showDetails')"
        :title="infoOpen ? t('reels.rail.hideDetails') : t('reels.rail.showDetails')"
        :aria-pressed="infoOpen"
        @click="$emit('toggle-info')"
      >
        <span
          class="reel-action-rail__icon"
          :class="infoOpen ? 'i-fluent-info-16-filled' : 'i-fluent-info-16-regular'"
          aria-hidden="true"
        />
      </button>

      <div v-if="$slots['info-panel']" class="reel-action-rail__info-panel">
        <slot name="info-panel" />
      </div>
    </div>

    <a
      class="reel-action-rail__button"
      :href="downloadOriginalMediaUrl"
      download
      :aria-label="t('reels.rail.downloadOriginal')"
      :title="t('reels.rail.downloadOriginal')"
    >
      <span class="reel-action-rail__icon i-fluent-arrow-download-20-regular" aria-hidden="true" />
    </a>

    <RouterLink
      class="reel-action-rail__button"
      :to="{ name: 'folder', params: { slug: item.folderSlug } }"
      :aria-label="t('reels.rail.openFolder')"
      :title="t('reels.rail.openFolder')"
    >
      <span class="reel-action-rail__icon i-fluent-folder-16-regular" aria-hidden="true" />
    </RouterLink>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import { useAuthStore } from '../stores/auth';
import { useLikesStore } from '../stores/likes';
import type { FeedItem } from '../types/api';
import { getOriginalMediaDownloadUrl } from '../utils/original-media';
import CollectionBookmark from './CollectionBookmark.vue';

const props = defineProps<{
  item: FeedItem;
  infoOpen?: boolean;
}>();

defineEmits<{
  'toggle-info': [];
}>();

const authStore = useAuthStore();
const likesStore = useLikesStore();
const { t } = useI18n();
const isLiked = computed(() => likesStore.isLiked(props.item.id));
const downloadOriginalMediaUrl = computed(() => getOriginalMediaDownloadUrl(props.item.id));

async function handleLike() {
  if (!authStore.canUseSavedItems) {
    return;
  }

  await likesStore.toggleLike(props.item);
}
</script>

<style scoped>
.reel-action-rail {
  display: grid;
  gap: 0.88rem;
  justify-items: center;
}

.reel-action-rail__info-wrap {
  position: relative;
  display: inline-flex;
}

.reel-action-rail__info-panel {
  position: absolute;
  bottom: -0.85rem;
  left: calc(100% + 0.9rem);
  z-index: 7;
}

.reel-action-rail__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.3rem;
  height: 2.3rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, var(--text) 82%, transparent);
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    opacity 0.16s ease,
    color 0.16s ease;
}

.reel-action-rail__button:hover:not(:disabled) {
  transform: translateY(-1px);
  opacity: 0.96;
  color: var(--text);
}

.reel-action-rail__button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.reel-action-rail__button--liked {
  color: #ff6b81;
}

.reel-action-rail__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.45rem;
  height: 1.45rem;
}
</style>
