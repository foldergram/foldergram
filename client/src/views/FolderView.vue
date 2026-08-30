<template>
  <section class="w-full">
    <EmptyState
      v-if="appStore.isLibraryUnavailable"
      class="mx-auto w-[min(100%,56rem)]"
      title="Library storage unavailable"
      :description="appStore.libraryUnavailableReason"
    />
    <section
      v-else-if="appStore.isRebuilding && !foldersStore.currentFolder"
      class="card mx-auto w-[min(100%,56rem)] p-8 text-center"
    >
      <p class="m-0 text-muted">
        Rebuilding the library index. Folder content will return as soon as this
        scan reaches it.
      </p>
    </section>
    <ErrorState
      v-else-if="foldersStore.folderError"
      class="mx-auto w-[min(100%,56rem)]"
      title="Could not load folder"
      :message="foldersStore.folderError"
    />
    <template v-else-if="foldersStore.currentFolder">
      <div class="mx-auto grid w-full max-w-[69rem] gap-[0.15rem]">
        <div class="mx-auto w-[min(100%,54rem)]">
          <FolderHeader
            :folder="foldersStore.currentFolder"
            :has-avatar-story="folderStoriesStore.hasAvatarStory"
            @open-avatar-story="openAvatarStory"
          />
        </div>
        <div
          v-if="folderStoriesStore.listError"
          class="mx-auto mb-5 grid w-[min(100%,66.5625rem)] gap-[0.75rem] rounded-[1rem] border border-[rgba(214,48,49,0.24)] bg-[rgba(214,48,49,0.08)] px-4 py-[0.95rem] text-[#c0392b]"
          role="alert"
        >
          <p class="m-0 text-[0.92rem]">{{ folderStoriesStore.listError }}</p>
          <div>
            <button
              class="inline-flex min-h-9 items-center justify-center rounded-[0.8rem] border border-[rgba(192,57,43,0.18)] bg-white/65 px-3 text-[0.82rem] font-semibold text-[#a93226] transition-colors duration-180 hover:bg-white"
              type="button"
              @click="retryFolderStories"
            >
              Retry Stories
            </button>
          </div>
        </div>
        <EmptyState
          v-if="
            !foldersStore.loadingFolder &&
            foldersStore.currentImages.length === 0
          "
          class="mx-auto w-[min(100%,66.5625rem)]"
          :title="
            activeTab === 'reels'
              ? 'No reels in this folder'
              : 'No posts in this folder'
          "
          :description="
            activeTab === 'reels'
              ? 'Drop supported videos into this folder and rescan to see them in the reels tab.'
              : 'Drop supported photos or videos into this folder and rescan to see them here.'
          "
        />
        <template v-else>
          <section class="mx-auto w-[min(100%,66.5625rem)]">
            <div
              v-if="folderStoriesStore.highlights.length"
              class="story-rail-shell mb-5"
              :aria-label="t('folder.header.openStories')"
            >
              <div class="story-rail pb-3 pt-[0.12rem]">
                <div class="story-rail__track mx-auto justify-center">
                  <button
                    v-for="story in folderStoriesStore.highlights"
                    :key="story.id"
                    class="story-rail__item story-rail__button"
                    :title="`${story.title} · ${story.subtitle}`"
                    type="button"
                    @click="openStoryViewer(story.id)"
                  >
                    <div
                      class="story-rail__ring"
                      style="background: var(--story-ring);"
                    >
                      <div class="story-rail__ring-inner">
                        <Avatar class="story-rail__avatar" :name="story.title" :src="story.coverImage.thumbnailUrl" />
                      </div>
                    </div>
                    <span class="story-rail__label">{{ story.title }}</span>
                  </button>
                </div>
              </div>
            </div>
            <div class="flex justify-center border-b border-border" :aria-label="t('folder.tabs.sections')">
              <div class="flex items-center gap-40 pt-[0.2rem] max-sm:gap-[2.9rem] max-sm:pt-[0.12rem]">
                <button
                  class="relative inline-flex h-[2.2rem] w-[3.15rem] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted transition-colors duration-[180ms] hover:text-text"
                  :class="activeTab === 'posts' ? 'text-text' : ''"
                  type="button"
                  :aria-label="t('folder.tabs.posts')"
                  :title="t('folder.tabs.posts')"
                  :aria-pressed="activeTab === 'posts'"
                  @click="setTab('posts')"
                >
                  <svg
                    class="w-7 h-7 mb-3"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="4" height="4" rx="0.75" />
                    <rect x="10" y="3" width="4" height="4" rx="0.75" />
                    <rect x="17" y="3" width="4" height="4" rx="0.75" />
                    <rect x="3" y="10" width="4" height="4" rx="0.75" />
                    <rect x="10" y="10" width="4" height="4" rx="0.75" />
                    <rect x="17" y="10" width="4" height="4" rx="0.75" />
                    <rect x="3" y="17" width="4" height="4" rx="0.75" />
                    <rect x="10" y="17" width="4" height="4" rx="0.75" />
                    <rect x="17" y="17" width="4" height="4" rx="0.75" />
                  </svg>
                  <span
                    v-if="activeTab === 'posts'"
                    class="absolute bottom-[0.02rem] left-[0.15rem] right-[0.15rem] h-[2px] rounded-full bg-current"
                    aria-hidden="true"
                  ></span>
                </button>
                <button
                  v-if="hasReelsTab"
                  class="relative inline-flex h-[2.2rem] w-[3.15rem] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted transition-colors duration-[180ms] hover:text-text"
                  :class="activeTab === 'reels' ? 'text-text' : ''"
                  type="button"
                  :aria-label="t('folder.tabs.reels')"
                  :title="t('folder.tabs.reels')"
                  :aria-pressed="activeTab === 'reels'"
                  @click="setTab('reels')"
                >
                  <span
                    class="i-fluent-play-circle-24-filled w-7 h-7 mb-3"
                    aria-hidden="true"
                  />
                  <span
                    v-if="activeTab === 'reels'"
                    class="absolute bottom-[0.02rem] left-[0.15rem] right-[0.15rem] h-[2px] rounded-full bg-current"
                    aria-hidden="true"
                  ></span>
                </button>
              </div>
            </div>
            <FolderGrid
              :items="foldersStore.currentImages"
              :variant="activeTab"
            />
            <div class="pt-6">
              <InfiniteLoader
                :loading="foldersStore.loadingFolder"
                :has-more="foldersStore.currentHasMore"
                @load-more="loadMore"
              />
            </div>
          </section>
        </template>
      </div>

      <StoriesModal
        v-if="activeStoryViewerId && folderStoriesStore.items.length"
        :items="folderStoriesStore.items"
        :initial-id="activeStoryViewerId"
        :rail-singular-label="folderStoriesStore.railSingularLabel"
        :store="folderStoriesStore"
        @close="closeStoryViewer"
      />
    </template>
    <EmptyState
      v-else-if="hasLoadedOnce && !foldersStore.loadingFolder"
      class="mx-auto w-[min(100%,56rem)]"
      title="No direct posts in this app folder"
      description="This source folder no longer has direct photos or videos. Browse the library to continue."
    />
  </section>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref, watch } from "vue"
  import { useI18n } from "vue-i18n"
  import { useRoute, useRouter } from "vue-router"

  import EmptyState from "../components/EmptyState.vue"
  import ErrorState from "../components/ErrorState.vue"
  import InfiniteLoader from "../components/InfiniteLoader.vue"
  import FolderGrid from "../components/FolderGrid.vue"
  import FolderHeader from "../components/FolderHeader.vue"
  import Avatar from "../components/Avatar.vue"
  import StoriesModal from "../components/StoriesModal.vue"
  import { useAppStore } from "../stores/app"
  import { useFolderStoriesStore } from "../stores/folder-stories"
  import { useFoldersStore } from "../stores/folders"

  const props = defineProps<{
    slug: string
  }>()

  const appStore = useAppStore()
  const folderStoriesStore = useFolderStoriesStore()
  const foldersStore = useFoldersStore()
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()
  const hasLoadedOnce = ref(false)
  const activeStoryViewerId = ref<string | null>(null)
  const activeTab = computed(() =>
    route.query.tab === "reels" ? "reels" : "posts",
  )
  const hasReelsTab = computed(
    () => (foldersStore.currentFolder?.videoCount ?? 0) > 0,
  )

  async function loadFolder() {
    if (appStore.isLibraryUnavailable) {
      hasLoadedOnce.value = true
      return
    }

    await foldersStore.loadFolder(
      props.slug,
      true,
      activeTab.value === "reels" ? "video" : undefined,
    )
    hasLoadedOnce.value = true

    // Stories are supplementary chrome; do not hold the first media grid behind them.
    void folderStoriesStore.fetchStories(
      props.slug,
      folderStoriesStore.currentFolderSlug !== props.slug,
    )

    if (activeTab.value === "reels" && !hasReelsTab.value) {
      await router.replace({
        name: "folder",
        params: { slug: props.slug },
        query: Object.fromEntries(
          Object.entries(route.query).filter(([key]) => key !== "tab"),
        ),
      })
      return
    }

    hasLoadedOnce.value = true
  }

  async function loadMore() {
    if (foldersStore.currentHasMore) {
      await foldersStore.loadFolder(
        props.slug,
        false,
        activeTab.value === "reels" ? "video" : undefined,
      )
    }
  }

  async function setTab(tab: "posts" | "reels") {
    if (activeTab.value === tab) {
      return
    }

    const nextQuery =
      tab === "reels"
        ? { ...route.query, tab: "reels" }
        : Object.fromEntries(
            Object.entries(route.query).filter(([key]) => key !== "tab"),
          )

    await router.replace({
      name: "folder",
      params: { slug: props.slug },
      query: nextQuery,
    })
  }

  function openAvatarStory() {
    if (!folderStoriesStore.hasAvatarStory || !folderStoriesStore.avatarStoryId) {
      return
    }

    activeStoryViewerId.value = folderStoriesStore.avatarStoryId
  }

  function openStoryViewer(id: string) {
    activeStoryViewerId.value = id
  }

  function closeStoryViewer() {
    activeStoryViewerId.value = null
  }

  async function retryFolderStories() {
    await folderStoriesStore.fetchStories(props.slug, true)
  }

  onMounted(loadFolder)
  watch(
    () => [props.slug, activeTab.value] as const,
    async () => {
      hasLoadedOnce.value = false
      activeStoryViewerId.value = null
      await loadFolder()
    },
  )
</script>
