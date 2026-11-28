<template>
  <div class="reel-skeleton" :role="loadingMore ? undefined : 'status'" :aria-label="loadingMore ? undefined : t('reels.view.loadingTitle')">
    <div class="reel-skeleton__copy" aria-hidden="true">
      <div class="reel-skeleton__profile">
        <span class="reel-skeleton__avatar" />
        <span class="reel-skeleton__username" />
      </div>
      <span class="reel-skeleton__line" />
      <span class="reel-skeleton__line reel-skeleton__line--long" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ loadingMore?: boolean }>();
const { t } = useI18n();
</script>

<style scoped>
.reel-skeleton {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow: hidden;
  border-radius: inherit;
  background: color-mix(in srgb, var(--text) 10%, var(--bg));
}

.reel-skeleton__copy {
  position: absolute;
  inset-inline: 1rem;
  bottom: 1rem;
  display: grid;
  gap: 0.6rem;
}

.reel-skeleton__profile {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.1rem;
}

.reel-skeleton__avatar,
.reel-skeleton__username,
.reel-skeleton__line {
  display: block;
  background: color-mix(in srgb, var(--text) 22%, var(--bg));
  animation: reel-skeleton-pulse 1.4s ease-in-out infinite alternate;
}

.reel-skeleton__avatar {
  flex: none;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
}

.reel-skeleton__username {
  width: 45%;
  height: 1rem;
  border-radius: 0.25rem;
}

.reel-skeleton__line {
  width: 40%;
  height: 0.85rem;
  border-radius: 0.25rem;
}

.reel-skeleton__line--long {
  width: 55%;
}

@keyframes reel-skeleton-pulse {
  to { opacity: 0.5; }
}

@media (prefers-reduced-motion: reduce) {
  .reel-skeleton__avatar,
  .reel-skeleton__username,
  .reel-skeleton__line { animation: none; }
}
</style>
