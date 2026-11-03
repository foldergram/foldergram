<template>
  <aside
    class="sidebar group flex h-full w-[4.85rem] flex-col overflow-visible bg-bg px-[0.95rem] pt-7 pb-5 text-text transition-[width] duration-220 ease hover:w-60"
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
      class="sidebar__nav flex flex-col flex-1 min-h-0 gap-[0.4rem] overflow-y-auto mt-5 [scrollbar-width:none]"
    >
      <RouterLink custom to="/" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive ? 'i-fluent-home-16-filled' : 'i-fluent-home-16-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
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
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive
                ? 'i-fluent-play-circle-24-filled'
                : 'i-fluent-play-circle-24-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
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
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive
                ? 'i-fluent-search-16-filled'
                : 'i-fluent-search-16-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
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
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive
                ? 'i-fluent-folder-16-filled'
                : 'i-fluent-folder-16-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
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
          class="sidebar__link sidebar-item"
          :class="isActive || isPlacesRoute ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive || isPlacesRoute
                ? 'i-fluent-location-20-filled'
                : 'i-fluent-location-20-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
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
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.58rem] h-[1.58rem]"
            :class="
              isActive
                ? 'i-fluent-heart-20-filled'
                : 'i-fluent-heart-20-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
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
          class="sidebar__link sidebar-item"
          :class="isActive || isCollectionsRoute ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.52rem] h-[1.52rem]"
            :class="
              isActive || isCollectionsRoute
                ? 'i-fluent-bookmark-20-filled'
                : 'i-fluent-bookmark-20-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >{{ t('nav.collections') }}</span
          >
        </a>
      </RouterLink>

      <span
        class="sidebar__section-label sidebar__meta inline-flex min-h-[1rem] items-center self-start mt-7 max-w-0 overflow-hidden whitespace-nowrap px-[0.75rem] text-[0.68rem] leading-[1.2] font-semibold uppercase tracking-[0.12em] text-muted opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
        style="
          transition:
            opacity 0.18s ease,
            max-width 0.22s ease;
        "
        >{{ t('nav.foldersSpotlight') }}</span
      >
      <div
        class="flex min-h-0 shrink-0 flex-col gap-[0.2rem] max-h-[22.5rem] overflow-y-auto [scrollbar-width:none]"
      >
        <RouterLink
          v-for="folder in featuredFolders"
          :key="folder.id"
          custom
          :to="{ name: 'folder', params: { slug: folder.slug } }"
          v-slot="{ href, navigate, isActive }"
        >
          <a
            :href="href"
            class="sidebar__folder sidebar-item"
            :class="isActive ? sidebarActiveClass : ''"
            :title="
              folder.breadcrumb
                ? `${folder.breadcrumb} / ${folder.name}`
                : folder.name
            "
            @click="navigate"
          >
            <Avatar
              :name="formatFeaturedFolderTitle(folder)"
              :src="folder.avatarUrl"
              class="h-[1.75rem] w-[1.75rem]"
            />
            <span
              class="sidebar__folder-copy sidebar__meta flex min-w-0 max-w-0 flex-col gap-[0.05rem] overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
              style="
                transition:
                  opacity 0.18s ease,
                  max-width 0.22s ease;
              "
            >
              <strong class="truncate text-[0.82rem]">{{ formatFeaturedFolderTitle(folder) }}</strong>
              <small class="truncate text-[0.68rem] text-muted">{{
                folder.breadcrumb ?? t('nav.folderPosts', { count: folder.imageCount })
              }}</small>
            </span>
          </a>
        </RouterLink>
      </div>
    </nav>

    <div
      v-if="moreMenuOpen"
      class="fixed inset-0 z-40"
      @click="closeMoreMenu"
    />

    <div class="z-50 mt-auto pt-10 pb-2">
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

          <button
            class="flex items-center gap-[0.95rem] w-full px-[1.2rem] py-[1rem] border-0 bg-transparent text-[0.98rem] text-text cursor-pointer text-left transition-colors duration-150 hover:bg-surface-hover"
            type="button"
            :aria-label="appearanceLabel"
            @click="handleAppearanceToggle"
          >
            <span
              v-if="appStore.theme === 'light'"
              class="i-fluent-weather-moon-20-regular w-[1.18rem] h-[1.18rem] shrink-0"
              aria-hidden="true"
            />
            <span
              v-else
              class="i-fluent-weather-sunny-20-regular w-[1.18rem] h-[1.18rem] shrink-0"
              aria-hidden="true"
            />
            <span>{{ t('nav.switchAppearance') }}</span>
          </button>

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
          class="sidebar-item w-full"
          :class="moreMenuOpen ? 'bg-[var(--sidebar-active-background)] hover:bg-[var(--sidebar-active-background)] font-semibold' : ''"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="moreMenuOpen"
          @click="toggleMoreMenu"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="'i-fluent-line-horizontal-3-20-filled'"
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
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

  import { useAppStore } from "../stores/app"
  import { useAuthStore } from "../stores/auth"
  import { useLikesStore } from "../stores/likes"
  import { useFoldersStore } from "../stores/folders"
  import { usePlacesStore } from "../stores/places"
  import { formatFolderTitle } from "../utils/folder-titles"
  import { buildLikedCountByFolder } from "../utils/home-recommendations"
  import { selectSidebarFolders } from "../utils/sidebar-folders"
  import Avatar from "./Avatar.vue"
  import BrandMark from "./BrandMark.vue"

  const { t } = useI18n()
  const appVersion = __APP_VERSION__
  const appStore = useAppStore()
  const authStore = useAuthStore()
  const likesStore = useLikesStore()
  const foldersStore = useFoldersStore()
  const placesStore = usePlacesStore()
  const route = useRoute()
  const moreMenuOpen = ref(false)

  const likedCountByFolder = computed(() =>
    buildLikedCountByFolder(likesStore.items),
  )
  const featuredFolders = computed(() =>
    selectSidebarFolders(
      [...foldersStore.items, ...Object.values(foldersStore.summaryBySlug)],
      likedCountByFolder.value,
      appStore.recentOpenedFolderSlugs,
    ),
  )
  watch(
    () => appStore.recentOpenedFolderSlugs.slice(0, 4),
    (slugs) => {
      for (const slug of slugs) void foldersStore.ensureSummary(slug).catch(() => {})
    },
    { immediate: true },
  )
  const appearanceLabel = computed(() =>
    appStore.theme === "light" ? t("nav.switchToDarkMode") : t("nav.switchToLightMode"),
  )
  const showPlacesNav = computed(() =>
    placesStore.items.length > 0 && placesStore.listError === null,
  )
  function formatFeaturedFolderTitle(folder: (typeof featuredFolders.value)[number]) {
    return formatFolderTitle(folder, appStore.nestedFolderTitleFormat)
  }
  const isPlacesRoute = computed(() =>
    route.name === "places" || route.name === "place",
  )
  const isCollectionsRoute = computed(() =>
    route.name === "collections" || route.name === "collection",
  )
  const signOutLabel = computed(() =>
    authStore.accessMode === "public" ? t("nav.returnToPublicView") : t("nav.signOut"),
  )
  const sidebarActiveClass =
    "router-link-active bg-[var(--sidebar-active-background)] hover:bg-[var(--sidebar-active-background)] font-bold"

  function closeMoreMenu() {
    moreMenuOpen.value = false
  }

  function toggleMoreMenu() {
    moreMenuOpen.value = !moreMenuOpen.value
  }

  function handleAppearanceToggle() {
    appStore.toggleTheme()
    closeMoreMenu()
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

  onMounted(() => {
    void placesStore.fetchPlaces()
    window.addEventListener("keydown", handleWindowKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener("keydown", handleWindowKeydown)
  })
</script>
