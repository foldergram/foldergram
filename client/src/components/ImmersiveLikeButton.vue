<template>
  <button
    v-if="authStore.canUseSavedItems"
    class="immersive-like-button"
    :class="{ 'immersive-like-button--liked': isLiked }"
    type="button"
    :aria-label="label"
    :title="label"
    :aria-pressed="isLiked"
    :disabled="likesStore.isPending(item.id)"
    @click.stop="likesStore.toggleLike(item)"
  >
    <span
      class="immersive-like-button__icon"
      :class="isLiked ? 'i-fluent-heart-20-filled' : 'i-fluent-heart-20-regular'"
      aria-hidden="true"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useAuthStore } from '../stores/auth';
import { useLikesStore } from '../stores/likes';
import type { FeedItem } from '../types/api';

const props = defineProps<{
  item: FeedItem;
}>();

const authStore = useAuthStore();
const likesStore = useLikesStore();
const isLiked = computed(() => likesStore.isLiked(props.item.id));
const label = computed(() => likesStore.toggleAriaLabel(isLiked.value));
</script>

<style scoped>
.immersive-like-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent 16%);
  border-radius: 0.95rem;
  color: inherit;
  background: color-mix(in srgb, var(--surface-alt) 82%, var(--surface) 18%);
  box-shadow: 0 10px 24px rgba(15, 20, 25, 0.08);
  cursor: pointer;
  transition: opacity 0.18s ease, transform 0.18s ease, color 0.18s ease;
}

.immersive-like-button:hover {
  opacity: 0.78;
  transform: translateY(-1px);
}

.immersive-like-button:disabled {
  cursor: wait;
  opacity: 0.5;
  transform: none;
}

.immersive-like-button--liked {
  color: #e5484d;
}

.immersive-like-button__icon {
  width: 1.45rem;
  height: 1.45rem;
}

@media (prefers-reduced-motion: reduce) {
  .immersive-like-button {
    transition: color 0.12s ease, opacity 0.12s ease;
  }
}
</style>
