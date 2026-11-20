<template>
  <img
    v-if="poster"
    v-show="!state.hasFrame"
    class="local-video-feedback__cover"
    :src="poster"
    :style="{ objectFit: coverFit }"
    alt=""
    loading="lazy"
    decoding="async"
  />
  <div v-if="active && (state.pending || state.failed)" class="local-video-feedback__status">
    <span
      v-if="state.pending"
      class="local-video-feedback__spinner"
      role="status"
      :aria-label="t('streamingVideo.loading')"
    />
    <div v-else class="local-video-feedback__error" data-swipe-ignore="true">
      <p role="alert">{{ t('streamingVideo.unavailable') }}</p>
      <button type="button" @click.stop="emit('retry')" @keydown.enter.stop @keydown.space.stop>
        {{ t('streamingVideo.retry') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import type { LocalVideoState } from '../utils/local-video-provider';

withDefaults(defineProps<{
  poster?: string;
  state: LocalVideoState;
  coverFit?: 'cover' | 'contain';
  active?: boolean;
}>(), { coverFit: 'contain', active: true });

const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<style scoped>
.local-video-feedback__cover {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.local-video-feedback__status {
  position: absolute;
  inset: 0 0 3.25rem;
  z-index: 2;
  display: grid;
  place-items: center;
  pointer-events: none;
  color: white;
}

.local-video-feedback__spinner {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: rgb(0 0 0 / 55%);
}

.local-video-feedback__spinner::after {
  content: '';
  width: 1rem;
  height: 1rem;
  border: 2px solid rgb(255 255 255 / 35%);
  border-top-color: white;
  border-radius: 50%;
  animation: local-video-spin 0.85s linear infinite;
}

.local-video-feedback__error {
  pointer-events: auto;
  max-width: calc(100% - 1.5rem);
  padding: 0.55rem 0.8rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  text-align: center;
  background: rgb(0 0 0 / 80%);
}

.local-video-feedback__error p {
  margin: 0 0 0.35rem;
}

.local-video-feedback__error button {
  padding: 0.25rem 0.7rem;
  border: 1px solid rgb(255 255 255 / 65%);
  border-radius: 0.3rem;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.local-video-feedback__error button:hover {
  background: rgb(255 255 255 / 18%);
}

.local-video-feedback__error button:focus-visible {
  outline: 2px solid white;
  outline-offset: 2px;
}

@keyframes local-video-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .local-video-feedback__spinner::after { animation: none; }
}
</style>
