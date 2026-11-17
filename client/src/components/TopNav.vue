<template>
  <!-- Mobile bottom nav — hidden on desktop (md+) -->
  <nav class="mobile-nav" :class="{ 'mobile-nav--activity': hasActivity }" :aria-label="t('nav.primary')">
    <div v-if="moreMenuOpen" class="mobile-nav__backdrop" @click="closeMoreMenu" />

    <div class="mobile-nav__bar">
      <RouterLink custom to="/" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="mobile-nav__item mobile-nav__brand"
          :class="isActive ? mobileNavActiveClass : ''"
          :aria-label="t('nav.foldergramHome')"
          @click="handleNavNavigate($event, navigate)"
        >
          <BrandMark />
        </a>
      </RouterLink>

      <div class="mobile-nav__links">
        <RouterLink custom :to="{ name: 'reels' }" v-slot="{ href, navigate, isActive }">
          <a
            :href="href"
            class="mobile-nav__item"
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
            :class="isActive || isCollectionsRoute ? mobileNavActiveClass : ''"
            :aria-label="t('nav.collections')"
            @click="handleNavNavigate($event, navigate)"
          >
            <span class="mobile-nav__icon" :class="isActive || isCollectionsRoute ? 'i-fluent-bookmark-20-filled' : 'i-fluent-bookmark-20-regular'" aria-hidden="true" />
          </a>
        </RouterLink>

        <slot name="activity" />
        <div class="mobile-nav__more">
          <button
            class="mobile-nav__item mobile-nav__more-button"
            :class="moreButtonClasses"
            type="button"
            :aria-label="t('nav.more')"
            aria-haspopup="menu"
            :aria-expanded="moreMenuOpen"
            :data-open="moreMenuOpen ? 'true' : 'false'"
            @click="toggleMoreMenu"
          >
            <span class="mobile-nav__icon i-fluent-line-horizontal-3-20-filled" aria-hidden="true" />
          </button>

          <div v-if="moreMenuOpen" class="mobile-nav__menu">
            <RouterLink v-if="showPlacesNav && hasActivity" class="mobile-nav__menu-item mobile-nav__menu-item--places"
              :to="{ name: 'places' }" @click="closeMoreMenu">
              <span class="mobile-nav__menu-icon i-fluent-location-20-regular" aria-hidden="true" />
              <span>{{ t('nav.places') }}</span>
            </RouterLink>
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

            <BrowserAppearanceSelect class="mobile-nav__menu-item" />
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';

import { useAuthStore } from '../stores/auth';
import { useCollectionsStore } from '../stores/collections';
import { useLikesStore } from '../stores/likes';
import { usePlacesStore } from '../stores/places';
import BrandMark from './BrandMark.vue';
import BrowserAppearanceSelect from './BrowserAppearanceSelect.vue';

const { t } = useI18n();
const authStore = useAuthStore();
const collectionsStore = useCollectionsStore();
const likesStore = useLikesStore();
const placesStore = usePlacesStore();
const route = useRoute();
const props = defineProps<{ panelOpen?: boolean; hasActivity?: boolean }>();
const emit = defineEmits<{ openMore: [] }>();
const moreMenuOpen = ref(false);
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

function closeMoreMenu() {
  moreMenuOpen.value = false;
}

function toggleMoreMenu() {
  if (!moreMenuOpen.value) emit('openMore');
  moreMenuOpen.value = !moreMenuOpen.value;
}

function handleUnlockAdmin() {
  authStore.openUnlockDialog();
  closeMoreMenu();
}

function handleNavNavigate(event: MouseEvent, navigate: (event?: MouseEvent) => void) {
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
  }
);

watch(() => props.panelOpen, open => { if (open) closeMoreMenu(); });

onMounted(() => {
  void placesStore.fetchPlaces();
  window.addEventListener('keydown', handleWindowKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
});
</script>

<style scoped>
.mobile-nav {
  display: none;
}

@media (max-width: 767.98px) {
  .mobile-nav {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 30;
    display: block;
    padding:
      0.22rem max(0.72rem, env(safe-area-inset-right))
      calc(0.22rem + var(--mobile-safe-area-bottom, 0px))
      max(0.72rem, env(safe-area-inset-left));
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 92%, var(--surface) 8%);
    color: var(--text);
    backdrop-filter: blur(16px);
  }

  .mobile-nav__backdrop {
    position: fixed;
    inset: 0;
    z-index: 1;
  }

  .mobile-nav__bar {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: 0.48rem;
    width: min(100%, 42rem);
    min-height: 2.9rem;
    margin: 0 auto;
  }

  .mobile-nav__links {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    gap: 0.34rem;
  }

  .mobile-nav__item,
  :slotted(.mobile-nav__item) {
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
    background: color-mix(in srgb, var(--accent-soft) 78%, transparent 22%);
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

  .mobile-nav--activity .mobile-nav__item--places {
    display: none;
  }

  .mobile-nav--activity .mobile-nav__links {
    justify-content: flex-end;
  }

  .mobile-nav--activity :deep(.scan-activity-trigger) {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }

  @media (hover: hover) {
    .mobile-nav__item:hover,
    :slotted(.mobile-nav__item):hover {
      background: var(--surface-hover);
      color: var(--text);
      transform: translateY(-1px);
    }
  }

  @media (min-width: 360px) {
    .mobile-nav__bar {
      grid-template-columns: 2.8rem minmax(0, 1fr);
      gap: 0.38rem;
    }

    .mobile-nav__links {
      gap: 0.28rem;
    }

    .mobile-nav__item,
    :slotted(.mobile-nav__item) {
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
  @media (max-width: 399.98px) {
    .mobile-nav--activity .mobile-nav__item--likes,
    .mobile-nav--activity .mobile-nav__item--collections {
      display: none;
    }

    .mobile-nav--activity .mobile-nav__menu-item--likes,
    .mobile-nav--activity .mobile-nav__menu-item--collections {
      display: flex;
    }

    .mobile-nav--activity .mobile-nav__more-button--likes-active:not([data-open='true']),
    .mobile-nav--activity .mobile-nav__more-button--collections-active:not([data-open='true']) {
      background: color-mix(in srgb, var(--accent-soft) 78%, transparent 22%);
      color: var(--accent-strong);
    }
  }

}
</style>
