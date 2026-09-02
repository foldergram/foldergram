<template>
  <svg class="orientation-toggle-icon" viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <rect class="orientation-toggle-icon__landscape" x="2" y="10" width="13" height="8" rx="2.2" />
    <rect class="orientation-toggle-icon__portrait" x="9" y="4" width="8" height="13" rx="2.2" />
  </svg>
</template>

<style scoped>
.orientation-toggle-icon {
  display: block;
  width: 1.25rem;
  height: 1.25rem;
  color: inherit;
}

.orientation-toggle-icon__landscape,
.orientation-toggle-icon__portrait {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.65;
  stroke-linejoin: round;
}

.orientation-toggle-icon__portrait {
  fill: currentColor;
  fill-opacity: 0.14;
}
</style>
