<template>
  <!-- Mobile bottom nav — hidden on desktop (md+) -->
  <nav class="mobile-nav" :class="{ 'mobile-nav--lens': supportsBackdropLens }" :aria-label="t('nav.primary')">
    <svg v-if="supportsBackdropLens" class="mobile-nav__lens-defs" aria-hidden="true" focusable="false">
      <filter id="foldergram-nav-lens" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
        <feImage :href="lensMapUrl" result="lensMap" x="0" y="0" preserveAspectRatio="none" />
        <feDisplacementMap in="SourceGraphic" in2="lensMap" scale="26" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
    <div v-if="moreMenuOpen" class="mobile-nav__backdrop" @click="closeMoreMenu" />
    <div
      ref="barElement"
      class="mobile-nav__bar"
      :class="{ 'mobile-nav__bar--dragging': isDragging }"
      :style="sliderStyle"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerCancel"
    >
      <span class="mobile-nav__glass-slider" aria-hidden="true">
        <span class="mobile-nav__glass-refraction" />
      </span>
      <RouterLink custom to="/" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="mobile-nav__item mobile-nav__brand"
          data-nav-index="0"
          :class="isActive ? mobileNavActiveClass : ''"
          :aria-label="t('nav.foldergramHome')"
          @click="handleNavNavigate($event, navigate)"
        >
          <BrandMark />
        </a>
      </RouterLink>
      <div
        ref="linksElement"
        class="mobile-nav__links"
        :class="{ 'mobile-nav__links--dragging': isDragging }"
      >
        <RouterLink custom :to="{ name: 'reels' }" v-slot="{ href, navigate, isActive }">
          <a
            :href="href"
            class="mobile-nav__item"
            data-nav-index="1"
            :class="isActive ? mobileNavActiveClass : ''"
            :aria-label="t('nav.reels')"
            @click="handleNavNavigate($event, navigate)"
          >
            <span class="mobile-nav__icon" :class="isActive ? 'i-fluent-play-circle-24-filled' : 'i-fluent-play-circle-24-regular'" aria-hidden="true" />
          </a>
        </RouterLink>

        <RouterLink custom :to="{ name: 'explore' }" v-slot="{ href, navigate, isActive }">
          <a
            :href="href"
            class="mobile-nav__item"
            data-nav-index="2"
            :class="isActive ? mobileNavActiveClass : ''"
            :aria-label="t('nav.search')"
            @click="handleNavNavigate($event, navigate)"
          >
            <span class="mobile-nav__icon" :class="isActive ? 'i-fluent-search-16-filled' : 'i-fluent-search-16-regular'" aria-hidden="true" />
          </a>
        </RouterLink>

        <RouterLink custom :to="{ name: 'library' }" v-slot="{ href, navigate, isActive }">
          <a
            :href="href"
            class="mobile-nav__item"
            data-nav-index="3"
            :class="isActive ? mobileNavActiveClass : ''"
            :aria-label="t('nav.library')"
            @click="handleNavNavigate($event, navigate)"
          >
            <span class="mobile-nav__icon" :class="isActive ? 'i-fluent-folder-16-filled' : 'i-fluent-folder-16-regular'" aria-hidden="true" />
          </a>
        </RouterLink>

        <RouterLink v-if="showPlacesNav" custom :to="{ name: 'places' }" v-slot="{ href, navigate, isActive }">
          <a
            :href="href"
            class="mobile-nav__item mobile-nav__item--places"
            data-nav-index="4"
            :class="isActive || isPlacesRoute ? mobileNavActiveClass : ''"
            :aria-label="t('nav.places')"
            @click="handleNavNavigate($event, navigate)"
          >
            <span class="mobile-nav__icon" :class="isActive || isPlacesRoute ? 'i-fluent-location-20-filled' : 'i-fluent-location-20-regular'" aria-hidden="true" />
          </a>
        </RouterLink>

        <RouterLink v-if="authStore.canUseSavedItems" custom :to="{ name: 'likes' }" v-slot="{ href, navigate, isActive }">
          <a
            :href="href"
            class="mobile-nav__item mobile-nav__item--likes"
            data-nav-index="5"
            :class="isActive ? mobileNavActiveClass : ''"
            :aria-label="t('nav.likesAriaLabel', { label: likesStore.collectionLabel, count: likesStore.items.length })"
            @click="handleNavNavigate($event, navigate)"
          >
            <span class="mobile-nav__icon" :class="isActive ? 'i-fluent-heart-20-filled' : 'i-fluent-heart-20-regular'" aria-hidden="true" />
          </a>
        </RouterLink>

        <RouterLink
          v-if="authStore.canUseSharedCollections || authStore.canUseLocalCollections"
          custom
          :to="{ name: 'collections' }"
          v-slot="{ href, navigate, isActive }"
        >
          <a
            :href="href"
            class="mobile-nav__item mobile-nav__item--collections"
            data-nav-index="6"
            :class="isActive || isCollectionsRoute ? mobileNavActiveClass : ''"
            :aria-label="t('nav.collections')"
            @click="handleNavNavigate($event, navigate)"
          >
            <span class="mobile-nav__icon" :class="isActive || isCollectionsRoute ? 'i-fluent-bookmark-20-filled' : 'i-fluent-bookmark-20-regular'" aria-hidden="true" />
          </a>
        </RouterLink>

        <div class="mobile-nav__more">
          <button
            class="mobile-nav__item mobile-nav__more-button"
            data-nav-index="7"
            :class="moreButtonClasses"
            type="button"
            :aria-label="t('nav.more')"
            aria-haspopup="menu"
            :aria-expanded="moreMenuOpen"
            :data-open="moreMenuOpen ? 'true' : 'false'"
            @click="handleMoreClick"
          >
            <span class="mobile-nav__icon i-fluent-line-horizontal-3-20-filled" aria-hidden="true" />
          </button>

          <div v-if="moreMenuOpen" class="mobile-nav__menu">
            <RouterLink v-if="authStore.canUseSavedItems" custom :to="{ name: 'likes' }" v-slot="{ href, navigate, isActive }">
              <a
                :href="href"
                class="mobile-nav__menu-item mobile-nav__menu-item--likes"
                :class="isActive ? menuItemActiveClass : ''"
                @click="handleNavNavigate($event, navigate)"
              >
                <span class="mobile-nav__menu-icon" :class="isActive ? 'i-fluent-heart-20-filled' : 'i-fluent-heart-20-regular'" aria-hidden="true" />
                <span>{{ likesStore.collectionLabel }}</span>
                <small class="mobile-nav__menu-badge">{{ likesStore.items.length }}</small>
              </a>
            </RouterLink>

            <RouterLink
              v-if="authStore.canUseSharedCollections || authStore.canUseLocalCollections"
              custom
              :to="{ name: 'collections' }"
              v-slot="{ href, navigate, isActive }"
            >
              <a
                :href="href"
                class="mobile-nav__menu-item mobile-nav__menu-item--collections"
                :class="isActive || isCollectionsRoute ? menuItemActiveClass : ''"
                @click="handleNavNavigate($event, navigate)"
              >
                <span class="mobile-nav__menu-icon" :class="isActive || isCollectionsRoute ? 'i-fluent-bookmark-20-filled' : 'i-fluent-bookmark-20-regular'" aria-hidden="true" />
                <span>{{ t('nav.collections') }}</span>
                <small class="mobile-nav__menu-badge">{{ collectionsStore.defaultCollection?.itemCount ?? 0 }}</small>
              </a>
            </RouterLink>

            <RouterLink
              v-if="authStore.canDeleteMedia"
              class="mobile-nav__menu-item"
              :to="{ name: 'trash' }"
              @click="closeMoreMenu"
            >
              <span class="mobile-nav__menu-icon i-fluent-delete-16-regular" aria-hidden="true" />
              <span>{{ t('nav.trash') }}</span>
            </RouterLink>

            <RouterLink v-if="authStore.canAccessSettings" custom :to="{ name: 'settings' }" v-slot="{ href, navigate, isActive }">
              <a
                :href="href"
                class="mobile-nav__menu-item"
                :class="isActive ? menuItemActiveClass : ''"
                @click="handleSettingsNavigate($event, navigate)"
              >
                <span
                  class="mobile-nav__menu-icon"
                  :class="isActive ? 'i-fluent-settings-20-filled' : 'i-fluent-settings-20-regular'"
                  aria-hidden="true"
                />
                <span>{{ t('nav.settings') }}</span>
              </a>
            </RouterLink>

            <button
              v-if="authStore.canUnlockAdmin"
              class="mobile-nav__menu-item"
              type="button"
              :disabled="authStore.loading"
              @click="handleUnlockAdmin"
            >
              <span class="mobile-nav__menu-icon i-fluent-key-16-regular" aria-hidden="true" />
              <span>{{ t('nav.unlockAdmin') }}</span>
            </button>

            <button
              class="mobile-nav__menu-item"
              type="button"
              :aria-label="themeLabel"
              @click="handleAppearanceToggle"
            >
              <span
                v-if="appStore.theme === 'light'"
                class="mobile-nav__menu-icon i-fluent-weather-moon-20-regular"
                aria-hidden="true"
              />
              <span
                v-else
                class="mobile-nav__menu-icon i-fluent-weather-sunny-20-regular"
                aria-hidden="true"
              />
              <span>{{ t('nav.switchAppearance') }}</span>
            </button>

            <button
              v-if="authStore.canSignOut"
              class="mobile-nav__menu-item"
              type="button"
              :disabled="authStore.loading"
              @click="handleSignOut"
            >
              <span class="mobile-nav__menu-icon i-fluent-arrow-exit-20-regular" aria-hidden="true" />
              <span>{{ signOutLabel }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';

import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useCollectionsStore } from '../stores/collections';
import { useLikesStore } from '../stores/likes';
import { usePlacesStore } from '../stores/places';
import BrandMark from './BrandMark.vue';

const { t } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const collectionsStore = useCollectionsStore();
const likesStore = useLikesStore();
const placesStore = usePlacesStore();
const route = useRoute();
const router = useRouter();
const moreMenuOpen = ref(false);
const barElement = ref<HTMLElement | null>(null);
const linksElement = ref<HTMLElement | null>(null);
const activeIndex = ref(0);
const isDragging = ref(false);
const dragStartX = ref(0);
const dragIndex = ref(0);
const dragMoved = ref(false);
const suppressClick = ref(false);
const sliderBounds = ref({ left: 0, top: 0, width: 0, height: 0 });
const supportsBackdropLens = ref(false);
const themeLabel = computed(() => (appStore.theme === 'light' ? t('nav.switchToDarkMode') : t('nav.switchToLightMode')));
const signOutLabel = computed(() => (authStore.accessMode === 'public' ? t('nav.returnToPublicView') : t('nav.signOut')));
const showPlacesNav = computed(() => placesStore.items.length > 0 && placesStore.listError === null);
const isPlacesRoute = computed(() => route.name === 'places' || route.name === 'place');
const isLikesRoute = computed(() => route.name === 'likes');
const isCollectionsRoute = computed(() => route.name === 'collections' || route.name === 'collection');
const isStaticMoreRoute = computed(() => route.name === 'trash' || route.name === 'settings' || isCollectionsRoute.value);
const mobileNavActiveClass = 'mobile-nav__item--active';
const menuItemActiveClass = 'mobile-nav__menu-item--active';
const moreButtonClasses = computed(() => ({
  [mobileNavActiveClass]: moreMenuOpen.value || isStaticMoreRoute.value || isLikesRoute.value,
  'mobile-nav__more-button--likes-active': isLikesRoute.value,
  'mobile-nav__more-button--collections-active': isCollectionsRoute.value
}));

const routeIndex = computed(() => {
  if (route.name === 'home' || route.name === undefined || route.name === null) return 0;
  if (route.name === 'reels') return 1;
  if (route.name === 'explore') return 2;
  if (route.name === 'library' || route.name === 'folder') return 3;
  if (isPlacesRoute.value) return 4;
  if (isLikesRoute.value) return 5;
  if (isCollectionsRoute.value) return 6;
  return 7;
});

const sliderStyle = computed(() => ({
  '--mobile-nav-slider-left': `${sliderBounds.value.left}px`,
  '--mobile-nav-slider-width': `${sliderBounds.value.width}px`,
  '--mobile-nav-slider-top': `${sliderBounds.value.top}px`,
  '--mobile-nav-slider-height': `${sliderBounds.value.height}px`,
  '--mobile-nav-lens-scale': isDragging.value ? '1.04' : '1'
}));

const lensMapUrl = ref('');

// Displacement map for the slider lens: R drives horizontal shift, G vertical.
// 0.5 means "no shift", so the flat centre stays undistorted while the rounded
// edges bend the backdrop outward like a real convex glass edge.
function buildLensDisplacementMap() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return '';

  const image = context.createImageData(size, size);
  const radius = size * 0.28;
  const half = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Signed distance to a rounded rectangle inset from the canvas edge.
      const dx = Math.abs(x - half + 0.5) - (half - radius);
      const dy = Math.abs(y - half + 0.5) - (half - radius);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      const distance = outside - radius + Math.min(Math.max(dx, dy), 0);
      // Bevel band: only the outer rim refracts, the middle stays clear.
      const bevel = Math.min(Math.max(1 - Math.abs(distance) / (size * 0.22), 0), 1) ** 1.6;
      const length = Math.hypot(x - half + 0.5, y - half + 0.5) || 1;
      const nx = ((x - half + 0.5) / length) * bevel;
      const ny = ((y - half + 0.5) / length) * bevel;
      const offset = (y * size + x) * 4;
      image.data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
      image.data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      image.data[offset + 2] = 128;
      image.data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

// Only Chromium routes an SVG filter through `backdrop-filter`, which is what makes
// the slider bend the icons behind it. WebKit keeps the plain blur/tint material.
function enableLensIfSupported() {
  const supported =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    (CSS.supports('backdrop-filter', 'url(#foldergram-nav-lens)') ||
      CSS.supports('-webkit-backdrop-filter', 'url(#foldergram-nav-lens)'));
  if (!supported) return;

  const map = buildLensDisplacementMap();
  if (!map) return;

  lensMapUrl.value = map;
  supportsBackdropLens.value = true;
}

function visibleNavItems() {
  return Array.from(barElement.value?.querySelectorAll<HTMLElement>('[data-nav-index]') ?? []).filter(
    (element) => element.offsetParent !== null
  );
}

// The slider is absolutely positioned against the bar's padding box, so the item
// offset has to drop the bar border width or the glass lands a pixel off the icon.
function measureItem(item: HTMLElement) {
  const bar = barElement.value;
  if (!bar) return null;

  const barRect = bar.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  return {
    left: itemRect.left - barRect.left - bar.clientLeft,
    top: itemRect.top - barRect.top - bar.clientTop,
    width: itemRect.width,
    height: itemRect.height
  };
}

function syncActiveSlider() {
  const items = visibleNavItems();
  const active = items.find((item) => Number(item.dataset.navIndex) === routeIndex.value) ?? items.at(-1);
  if (!active || !barElement.value) return;

  activeIndex.value = Number(active.dataset.navIndex ?? 0);
  const bounds = measureItem(active);
  if (bounds) sliderBounds.value = bounds;
}

function setSliderToIndex(index: number) {
  const item = visibleNavItems().find((element) => Number(element.dataset.navIndex) === index);
  if (!item || !barElement.value) return;

  const bounds = measureItem(item);
  if (bounds) sliderBounds.value = bounds;
}

function handlePointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  dragStartX.value = event.clientX;
  dragIndex.value = activeIndex.value;
  dragMoved.value = false;
  isDragging.value = true;
  barElement.value?.setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent) {
  if (!isDragging.value || !barElement.value) return;
  const delta = event.clientX - dragStartX.value;
  if (Math.abs(delta) > 6) dragMoved.value = true;

  const items = visibleNavItems();
  const closest = items.reduce<HTMLElement | null>((current, item) => {
    if (!current) return item;
    const currentDistance = Math.abs(event.clientX - current.getBoundingClientRect().left - current.getBoundingClientRect().width / 2);
    const itemDistance = Math.abs(event.clientX - item.getBoundingClientRect().left - item.getBoundingClientRect().width / 2);
    return itemDistance < currentDistance ? item : current;
  }, null);
  if (closest) {
    dragIndex.value = Number(closest.dataset.navIndex ?? activeIndex.value);
    setSliderToIndex(dragIndex.value);
  }
}

function handlePointerUp(event: PointerEvent) {
  if (!isDragging.value) return;
  const targetIndex = dragIndex.value;
  isDragging.value = false;
  barElement.value?.releasePointerCapture(event.pointerId);
  if (dragMoved.value) event.preventDefault();
  suppressClick.value = dragMoved.value;
  if (targetIndex === activeIndex.value) return;

  const destinations = ['home', 'reels', 'explore', 'library', 'places', 'likes', 'collections'] as const;
  const destination = destinations[targetIndex];
  if (destination === 'home') void router.push('/');
  else if (destination) void router.push({ name: destination });
  else toggleMoreMenu();
}

function handlePointerCancel() {
  isDragging.value = false;
  dragIndex.value = activeIndex.value;
  dragMoved.value = false;
  void nextTick(syncActiveSlider);
}

function closeMoreMenu() {
  moreMenuOpen.value = false;
}

function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value;
}

function handleMoreClick() {
  activeIndex.value = 7;
  dragIndex.value = 7;
  setSliderToIndex(7);
  toggleMoreMenu();
}

function handleAppearanceToggle() {
  appStore.toggleTheme();
  closeMoreMenu();
}

function handleUnlockAdmin() {
  authStore.openUnlockDialog();
  closeMoreMenu();
}

function handleNavNavigate(event: MouseEvent, navigate: (event?: MouseEvent) => void) {
  if (suppressClick.value) {
    suppressClick.value = false;
    event.preventDefault();
    return;
  }
  closeMoreMenu();
  navigate(event);
}

function handleSettingsNavigate(event: MouseEvent, navigate: (event?: MouseEvent) => void) {
  closeMoreMenu();
  navigate(event);
}

async function handleSignOut() {
  closeMoreMenu();

  try {
    await authStore.logout();
  } catch {
    // Keep the current shell visible and let auth-store error handling surface the failure.
  }
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeMoreMenu();
  }
}

watch(
  () => route.fullPath,
  () => {
    closeMoreMenu();
    void nextTick(syncActiveSlider);
  }
);

onMounted(() => {
  void placesStore.fetchPlaces();
  void nextTick(syncActiveSlider);
  enableLensIfSupported();
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('resize', syncActiveSlider);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('resize', syncActiveSlider);
});
</script>

<style scoped>
.mobile-nav {
  display: none;
}

@media (max-width: 767.98px) {
  /* No full-width frosted strip: the floating dock pill is the only glass surface. */
  .mobile-nav {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 30;
    display: block;
    padding:
      0.45rem max(0.72rem, env(safe-area-inset-right))
      calc(0.45rem + var(--mobile-safe-area-bottom, 0px))
      max(0.72rem, env(safe-area-inset-left));
    border-top: 0;
    background: transparent;
    color: var(--text);
    pointer-events: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .mobile-nav__bar,
  .mobile-nav__backdrop {
    pointer-events: auto;
  }

  .mobile-nav__backdrop {
    position: fixed;
    inset: 0;
    z-index: 1;
  }

  .mobile-nav__lens-defs {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .mobile-nav__bar {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: auto auto;
    gap: 0.12rem;
    align-items: center;
    width: fit-content;
    max-width: calc(100% - 0.5rem);
    min-height: 3.7rem;
    margin: 0 auto;
    padding: 0.32rem 0.62rem;
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
    border-radius: 1.85rem;
    background:
      linear-gradient(118deg, rgba(255, 255, 255, 0.16), transparent 34%),
      color-mix(in srgb, var(--surface) 42%, transparent);
    box-shadow: none;
    -webkit-backdrop-filter: blur(26px) saturate(160%);
    backdrop-filter: blur(26px) saturate(160%);
  }

  .mobile-nav__links {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    gap: 0.12rem;
    touch-action: pan-y;
  }

  .mobile-nav__links--dragging {
    cursor: grabbing;
  }

  /* Slider is measured against the bar's padding box, so it sits exactly on the icon cell. */
  .mobile-nav__glass-slider {
    position: absolute;
    z-index: 2;
    top: var(--mobile-nav-slider-top, 0);
    left: 0;
    width: var(--mobile-nav-slider-width, 2.6rem);
    height: var(--mobile-nav-slider-height, 2.7rem);
    border-radius: 1.15rem;
    transform: translate3d(var(--mobile-nav-slider-left, 0), 0, 0) scale(var(--mobile-nav-lens-scale, 1));
    transform-origin: center;
    transition: transform 380ms cubic-bezier(0.22, 1.1, 0.32, 1);
    pointer-events: none;
    will-change: transform;
  }

  /* Real lens: the SVG displacement map bends whatever is behind the slider. */
  .mobile-nav__glass-refraction {
    position: absolute;
    inset: 0;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.04);
    -webkit-backdrop-filter: blur(2px) saturate(150%) brightness(1.04);
    backdrop-filter: blur(2px) saturate(150%) brightness(1.04);
    pointer-events: none;
  }

  .mobile-nav--lens .mobile-nav__glass-refraction {
    background: transparent;
    -webkit-backdrop-filter: url('#foldergram-nav-lens') saturate(140%) brightness(1.03);
    backdrop-filter: url('#foldergram-nav-lens') saturate(140%) brightness(1.03);
  }

  .mobile-nav__bar--dragging .mobile-nav__glass-slider {
    transition: transform 110ms cubic-bezier(0.33, 1, 0.68, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .mobile-nav__glass-slider {
      transition: none;
    }
  }

  .mobile-nav__item {
    position: relative;
    z-index: 1;
    display: inline-flex;
    width: 2.75rem;
    height: 2.7rem;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 1rem;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      color 0.16s ease,
      transform 0.16s ease;
  }

  .mobile-nav__brand {
    width: 3rem;
    color: var(--text);
  }

  .mobile-nav__brand :deep(svg) {
    width: 1.95rem;
    height: 1.95rem;
  }

  .mobile-nav__icon {
    width: 1.45rem;
    height: 1.45rem;
  }

  .mobile-nav__item--active {
    color: var(--accent-strong);
    font-weight: 700;
  }

  .mobile-nav__item--likes {
    display: none;
  }

  .mobile-nav__item--collections {
    display: none;
  }

  .mobile-nav__more {
    position: relative;
    flex: 0 0 auto;
  }

  .mobile-nav__more-button--likes-active:not([data-open='true']) {
    background: color-mix(in srgb, var(--accent-soft) 78%, transparent 22%);
    color: var(--accent-strong);
  }

  .mobile-nav__menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.72rem);
    z-index: 3;
    width: min(18rem, calc(100vw - 1.4rem));
    max-height: min(31rem, calc(100dvh - 7rem));
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 1.35rem;
    background: color-mix(in srgb, var(--surface) 96%, var(--bg) 4%);
    box-shadow: 0 28px 70px rgba(0, 0, 0, 0.24);
  }

  .mobile-nav__menu-item {
    display: flex;
    width: 100%;
    min-height: 3.35rem;
    align-items: center;
    gap: 0.95rem;
    padding: 0.9rem 1.05rem;
    border: 0;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 0.96rem;
    text-align: left;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }

  .mobile-nav__menu-item:hover,
  .mobile-nav__menu-item--active,
  .mobile-nav__menu-item.router-link-active {
    background: var(--surface-hover);
  }

  .mobile-nav__menu-item:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  .mobile-nav__menu-icon {
    width: 1.18rem;
    height: 1.18rem;
    flex: 0 0 auto;
  }

  .mobile-nav__menu-badge {
    min-width: 1.45rem;
    margin-left: auto;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-soft) 82%, transparent 18%);
    color: var(--accent-strong);
    font-size: 0.72rem;
    font-weight: 800;
    line-height: 1.35;
    text-align: center;
  }

  @media (hover: hover) {
    .mobile-nav__item:hover {
      background: var(--surface-hover);
      color: var(--text);
      transform: translateY(-1px);
    }
  }

  @media (min-width: 360px) {
    .mobile-nav__bar {
      grid-template-columns: auto auto;
      gap: 0.08rem;
    }

    .mobile-nav__links {
      gap: 0.18rem;
    }

    .mobile-nav__item {
      width: 2.35rem;
    }

    .mobile-nav__brand {
      width: 2.8rem;
    }

    .mobile-nav__item--likes {
      display: inline-flex;
    }

    .mobile-nav__item--collections {
      display: inline-flex;
    }

    .mobile-nav__menu-item--likes {
      display: none;
    }

    .mobile-nav__menu-item--collections {
      display: none;
    }

    .mobile-nav__more-button--likes-active:not([data-open='true']),
    .mobile-nav__more-button--collections-active:not([data-open='true']) {
      background: transparent;
      color: var(--muted);
      font-weight: 400;
    }
  }
}
</style>
