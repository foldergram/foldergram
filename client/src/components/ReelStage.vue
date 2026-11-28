<template>
  <article class="reel-player-card" :class="{ 'reel-player-card--portrait': height > width }" :style="{ '--reel-item-ratio': width > 0 && height > 0 ? width / height : 9 / 16 }">
    <div class="reel-player-card__stage"><slot /></div>
  </article>
</template>

<script setup lang="ts">
defineProps<{ width: number; height: number }>();
</script>

<style scoped>
.reel-player-card {
  --reel-stage-max-width: 24.4rem;
  --reel-stage-max-height: calc(var(--reel-stage-max-width) * 16 / 9);
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: calc(var(--reel-stage-gap, 0.75rem) / 2) 0;
}

.reel-player-card__stage {
  position: relative;
  justify-self: center;
  align-self: center;
  /* This Reel, not the active Reel, controls its own stage dimensions. */
  width: min(
    calc(100% - var(--reel-stage-inline-gap, 1.25rem)),
    calc(var(--reel-item-block-limit, calc(100cqh - 2rem)) * var(--reel-item-ratio))
  );
  height: auto;
  max-height: min(100%, var(--reel-item-block-limit, calc(100cqh - 2rem)));
  max-width: 100%;
  aspect-ratio: var(--reel-item-ratio, 9 / 16);
  overflow: hidden;
  border-radius: 0.6rem;
  background: #000;
  box-shadow: none;
}

@media (min-width: 768px) and (orientation: portrait) {
  .reel-player-card--portrait {
    --reel-item-block-limit: calc(88cqh - var(--reel-deck-top-inset, 1rem) - var(--reel-deck-panel-gap, 2rem));
  }
}

@media (max-width: 767.98px) {
  .reel-player-card {
    --reel-stage-gap: 0;
    padding: 0;
  }

  .reel-player-card__stage {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
}
</style>
