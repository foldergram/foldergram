<template>
  <aside
    class="sidebar group flex h-full w-[var(--desktop-sidebar-width)] flex-col overflow-visible px-[0.95rem] pt-7 pb-5 text-text transition-[width] duration-220 ease hover:w-[var(--desktop-sidebar-expanded-width)]"
  >
    <RouterLink
      class="sidebar__brand relative inline-flex items-center justify-center w-12 h-12 p-[0.3rem] rounded-[1rem] color-inherit transition-[background-color,transform,opacity] duration-180 hover:bg-sidebar-hover hover:-translate-y-px"
      to="/"
      :aria-label="t('nav.foldergramHome')"
    >
      <span
        class="pointer-events-none absolute top-[0.16rem] left-1/2 -translate-x-1/2 text-[0.42rem] leading-none tracking-[0.08em] text-muted"
        aria-hidden="true"
      >
        {{ appVersion }}
      </span>
      <BrandMark />
    </RouterLink>

    <nav
      class="sidebar__nav flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden mt-5 [scrollbar-width:none]"
    >
      <RouterLink custom to="/" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="sidebar__link sidebar__row sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <svg
            class="sidebar__icon shrink-0 w-6 h-6"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M2 11.2a2.5 2.5 0 0 1 .8-1.83l7.5-6.97a2.5 2.5 0 0 1 3.4 0l7.5 6.97a2.5 2.5 0 0 1 .8 1.83V19a3 3 0 0 1-3 3h-4v-5a3 3 0 0 0-6 0v5H5a3 3 0 0 1-3-3z"
              :fill="isActive ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
          </svg>
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ t('nav.home') }}</span
          >
        </a>
      </RouterLink>

      <RouterLink
        custom
        :to="{ name: 'reels' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar__row sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <svg
            class="sidebar__icon shrink-0 w-6 h-6"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              v-if="isActive"
              d="M7 1h10a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H7a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6ZM10 7.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1.5.87l6-3.5a1 1 0 0 0 0-1.74l-6-3.5A1 1 0 0 0 10 7.5Z"
              fill="currentColor"
              fill-rule="evenodd"
            />
            <g v-else fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <path d="M9.5 8.25 16.5 12l-7 3.75z" stroke-linejoin="round" />
            </g>
          </svg>
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ t('nav.reels') }}</span
          >
        </a>
      </RouterLink>

      <RouterLink
        custom
        :to="{ name: 'explore' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar__row sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon shrink-0 w-6 h-6"
            :class="
              isActive
                ? 'i-fluent-search-24-filled'
                : 'i-fluent-search-24-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ t('nav.search') }}</span
          >
        </a>
      </RouterLink>

      <RouterLink
        custom
        :to="{ name: 'library' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar__row sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon shrink-0 w-6 h-6"
            :class="
              isActive
                ? 'i-fluent-folder-24-filled'
                : 'i-fluent-folder-24-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ t('nav.library') }}</span
          >
        </a>
      </RouterLink>

      <RouterLink
        v-if="showPlacesNav"
        custom
        :to="{ name: 'places' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar__row sidebar-item"
          :class="isActive || isPlacesRoute ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon shrink-0 w-6 h-6"
            :class="
              isActive || isPlacesRoute
                ? 'i-fluent-location-24-filled'
                : 'i-fluent-location-24-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ t('nav.places') }}</span
          >
        </a>
      </RouterLink>

      <RouterLink
        v-if="authStore.canUseSavedItems"
        custom
        :to="{ name: 'likes' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar__row sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon shrink-0 w-6 h-6"
            :class="
              isActive
                ? 'i-fluent-heart-24-filled'
                : 'i-fluent-heart-24-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ likesStore.collectionLabel }}</span
          >
          <small
            class="sidebar__badge sidebar__meta ml-auto inline-flex h-6 min-w-6 max-w-0 shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full bg-[var(--sidebar-badge-background)] px-1.5 text-[0.72rem] leading-none font-bold text-text opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >{{ likesStore.items.length }}</small
          >
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
          class="sidebar__link sidebar__row sidebar-item"
          :class="isActive || isCollectionsRoute ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon shrink-0 w-6 h-6"
            :class="
              isActive || isCollectionsRoute
                ? 'i-fluent-bookmark-24-filled'
                : 'i-fluent-bookmark-24-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ t('nav.collections') }}</span
          >
        </a>
      </RouterLink>
    </nav>

    <div
      v-if="moreMenuOpen"
      class="fixed inset-0 z-40"
      @click="closeMoreMenu"
    />

    <div class="z-50 mt-auto pt-10 pb-1">
      <slot name="activity" />
      <div class="relative">
        <div
          v-if="moreMenuOpen"
          class="absolute bottom-[calc(100%+0.35rem)] left-0 w-[18rem] overflow-hidden rounded-[1.55rem] border border-border bg-[color-mix(in_srgb,var(--surface)_96%,var(--bg)_4%)] shadow-[0_28px_70px_rgba(0,0,0,0.24)]"
        >
          <RouterLink
            v-if="authStore.canDeleteMedia"
            class="flex items-center gap-[0.95rem] px-[1.2rem] py-[1rem] text-[0.98rem] text-text transition-colors duration-150 hover:bg-surface-hover"
            :to="{ name: 'trash' }"
            @click="closeMoreMenu"
          >
            <span class="i-fluent-delete-16-regular w-[1.18rem] h-[1.18rem] shrink-0" aria-hidden="true" />
            <span>{{ t('nav.trash') }}</span>
          </RouterLink>

          <RouterLink v-if="authStore.canAccessSettings" custom :to="{ name: 'settings' }" v-slot="{ href, navigate, isActive }">
            <a
              :href="href"
              class="flex items-center gap-[0.95rem] px-[1.2rem] py-[1rem] text-[0.98rem] text-text transition-colors duration-150 hover:bg-surface-hover"
              @click="handleSettingsNavigate($event, navigate)"
              >
                <span
                  class="w-[1.18rem] h-[1.18rem] shrink-0"
                  :class="isActive ? 'i-fluent-settings-20-filled' : 'i-fluent-settings-20-regular'"
                  aria-hidden="true"
                />
              <span>{{ t('nav.settings') }}</span>
            </a>
          </RouterLink>

          <button
            v-if="authStore.canUnlockAdmin"
            class="flex items-center gap-[0.95rem] w-full px-[1.2rem] py-[1rem] border-0 bg-transparent text-[0.98rem] text-text cursor-pointer text-left transition-colors duration-150 hover:bg-surface-hover disabled:opacity-60 disabled:cursor-wait"
            type="button"
            :disabled="authStore.loading"
            @click="handleUnlockAdmin"
          >
            <span
              class="i-fluent-key-16-regular w-[1.18rem] h-[1.18rem] shrink-0"
              aria-hidden="true"
            />
            <span>{{ t('nav.unlockAdmin') }}</span>
          </button>

          <AppearanceToggle @switched="closeMoreMenu" />
          <button
            v-if="authStore.canSignOut"
            class="flex items-center gap-[0.95rem] w-full px-[1.2rem] py-[1rem] border-0 bg-transparent text-[0.98rem] text-text cursor-pointer text-left transition-colors duration-150 hover:bg-surface-hover disabled:opacity-60 disabled:cursor-wait"
            type="button"
            :disabled="authStore.loading"
            @click="handleSignOut"
          >
            <span
              class="i-fluent-arrow-exit-20-regular w-[1.18rem] h-[1.18rem] shrink-0"
              aria-hidden="true"
            />
            <span>{{ signOutLabel }}</span>
          </button>
        </div>

        <button
          class="sidebar__row sidebar__more sidebar-item w-full"
          :class="{ 'font-semibold': moreMenuOpen }"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="moreMenuOpen"
          @click="toggleMoreMenu"
        >
          <span
            class="sidebar__icon i-fluent-line-horizontal-3-24-filled shrink-0 w-6 h-6"
            aria-hidden="true"
          />
          <span
            class="sidebar__label min-w-0 flex-1 truncate text-start text-base leading-6 opacity-0 transition-opacity duration-180 group-hover:opacity-100"
            >{{ t('nav.more') }}</span
          >
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref, watch } from "vue"
  import { useI18n } from "vue-i18n"
  import { RouterLink, useRoute } from "vue-router"

  import { useAuthStore } from "../stores/auth"
  import { useLikesStore } from "../stores/likes"
  import { usePlacesStore } from "../stores/places"
  import BrandMark from "./BrandMark.vue"
  import AppearanceToggle from "./BrowserAppearanceSelect.vue"

  const props = defineProps<{ panelOpen?: boolean }>()
  const emit = defineEmits<{ openMore: [] }>()
  const { t } = useI18n()
  const appVersion = __APP_VERSION__
  const authStore = useAuthStore()
  const likesStore = useLikesStore()
  const placesStore = usePlacesStore()
  const route = useRoute()
  const moreMenuOpen = ref(false)

  const showPlacesNav = computed(() =>
    placesStore.items.length > 0 && placesStore.listError === null,
  )
  const isPlacesRoute = computed(() =>
    route.name === "places" || route.name === "place",
  )
  const isCollectionsRoute = computed(() =>
    route.name === "collections" || route.name === "collection",
  )
  const signOutLabel = computed(() =>
    authStore.accessMode === "public" ? t("nav.returnToPublicView") : t("nav.signOut"),
  )
  const sidebarActiveClass = "router-link-active font-bold"

  function closeMoreMenu() {
    moreMenuOpen.value = false
  }

  function toggleMoreMenu() {
    if (!moreMenuOpen.value) emit('openMore')
    moreMenuOpen.value = !moreMenuOpen.value
  }

  function handleUnlockAdmin() {
    authStore.openUnlockDialog()
    closeMoreMenu()
  }

  function handleSettingsNavigate(event: MouseEvent, navigate: (event?: MouseEvent) => void) {
    closeMoreMenu()
    navigate(event)
  }

  async function handleSignOut() {
    closeMoreMenu()

    try {
      await authStore.logout()
    } catch {
      // Keep the current shell visible and let auth-store error handling surface the failure.
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeMoreMenu()
    }
  }

  watch(
    () => route.fullPath,
    () => {
      closeMoreMenu()
    },
  )

  watch(() => props.panelOpen, (open) => { if (open) closeMoreMenu() })

  onMounted(() => {
    void placesStore.fetchPlaces()
    window.addEventListener("keydown", handleWindowKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener("keydown", handleWindowKeydown)
  })
</script>

<style scoped>
.sidebar {
  background: linear-gradient(var(--bg), var(--bg)) left top / var(--desktop-sidebar-width) 100% no-repeat;
}

@media (orientation: portrait) {
  .sidebar {
    background-size: 100% 100%;
  }
}

.sidebar__nav {
  padding-block-end: clamp(0rem, calc(100vh - 40rem), 3.5rem);
}

.sidebar__row {
  min-height: 3.5rem;
  border-radius: 0.75rem;
}

span.sidebar__icon {
  mask-size: 110% 110%;
  mask-position: center;
}

.sidebar__row:hover,
.sidebar__more[aria-expanded="true"] {
  background-color: color-mix(in srgb, var(--text) 10%, transparent);
}
</style>
