<template>
  <section
    v-if="image"
    :class="['viewer relative', { 'viewer--modal': isModal }]"
    @wheel="handleWheel"
  >
    <!-- Close button (modal only) -->
    <button
      v-if="isModal"
      class="viewer__modal-close"
      type="button"
      :aria-label="t('post.viewer.close')"
      @click="$emit('close')"
    >
      <svg
        class="viewer__modal-close-icon"
        viewBox="0 0 24 24"
        role="presentation"
      >
        <path
          d="m7 7 10 10M17 7 7 17"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
        />
      </svg>
    </button>

    <!-- Previous nav -->
    <RouterLink
      v-if="previousNavigationImageId"
      :class="[
        'inline-flex items-center justify-center w-[2.2rem] h-[2.2rem] rounded-full text-[#111] bg-white/88 shadow-[0_8px_20px_rgba(0,0,0,0.18)]',
        isModal
          ? 'fixed top-1/2 z-45 -translate-y-1/2 left-[5px]'
          : 'absolute top-1/2 z-2 -mt-[1.1rem] left-[-3.25rem] max-md:left-[-2.75rem]',
      ]"
      :to="{
        name: 'image',
        params: { id: String(previousNavigationImageId) },
        query: route.query,
      }"
      :aria-label="t('post.viewer.previous')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" role="presentation">
        <path
          d="m14.5 6.5-5 5 5 5"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
        />
      </svg>
    </RouterLink>

    <!-- Next nav -->
    <RouterLink
      v-if="nextNavigationImageId"
      :class="[
        'inline-flex items-center justify-center w-[2.2rem] h-[2.2rem] rounded-full text-[#111] bg-white/88 shadow-[0_8px_20px_rgba(0,0,0,0.18)]',
        isModal
          ? 'fixed top-1/2 z-45 -translate-y-1/2 right-[5px]'
          : 'absolute top-1/2 z-2 -mt-[1.1rem] right-[-3.25rem] max-md:right-[-2.75rem]',
      ]"
      :to="{
        name: 'image',
        params: { id: String(nextNavigationImageId) },
        query: route.query,
      }"
      :aria-label="t('post.viewer.next')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" role="presentation">
        <path
          d="m9.5 6.5 5 5-5 5"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
        />
      </svg>
    </RouterLink>

    <button
      v-if="isModalSidebarCollapsible"
      ref="sidebarToggleElement"
      class="viewer__sidebar-toggle"
      type="button"
      :aria-expanded="isSidebarExpanded"
      :aria-label="
        isSidebarExpanded ? t('post.viewer.hideDetails') : t('post.viewer.showDetails')
      "
      @click="toggleSidebar"
    >
      <span
        :class="
          isSidebarExpanded
            ? 'i-fluent-panel-left-contract-16-filled'
            : 'i-fluent-panel-left-expand-16-filled'
        "
        class="viewer__sidebar-toggle-icon"
        aria-hidden="true"
      />
    </button>

    <!-- Card -->
      <div
        ref="cardWrapperElement"
        :class="[
          'card viewer__card-wrapper',
        {
          'viewer__card-wrapper--modal': isModal,
          'viewer__card-wrapper--compact': isModalSidebarCollapsible,
        },
      ]"
    >
      <!-- Media -->
      <div
        :class="[
          'viewer__media',
          {
            'viewer__media--modal': isModal,
            'viewer__media--page': !isModal,
            'viewer__media--swipe-enabled': isModal,
          },
        ]"
        @pointercancel="handleMediaPointercancel"
        @pointerdown="handleMediaPointerdown"
        @pointermove="handleMediaPointermove"
        @pointerup="handleMediaPointerup"
      >
        <CarouselMediaStage
          v-if="isCarousel"
          v-model="carouselIndex"
          class="viewer__media-shell"
          :items="image.mediaItems!"
          prefer-preview
          :retry-while="appStore.isScanning"
          loading="eager"
          :muted="appStore.videoMuted"
          autoplay
        />
        <template v-else-if="image.mediaType === 'video'">
          <div
            class="viewer__media-shell viewer__media-shell--video viewer__media-shell--video-interactive"
            :style="mediaShellStyle"
            :aria-label="t('post.immersive.open')"
            role="button"
            tabindex="0"
            @click="handleVideoSurfaceClick"
            @keydown="handleVideoSurfaceKeydown"
            @pointercancel="holdSpeed.onPointercancel"
            @pointerdown="holdSpeed.onPointerdown"
            @pointermove="holdSpeed.onPointermove"
            @pointerup="holdSpeed.onPointerup"
          >
            <media-player
              ref="playerElement"
              class="viewer__player"
              :src.prop="videoSource"
              :title.prop="image.filename"
              :fullscreenOrientation.prop="'landscape'"
              :playsInline.prop="true"
              :muted.prop="appStore.videoMuted"
              :loop.prop="true"
              load="eager"
              preload="metadata"
              >
                <media-provider />
              <media-poster
                class="viewer__player-poster"
                :src.prop="image.thumbnailUrl"
                :alt.prop="image.filename"
              />
              <VideoProgressFooter
                variant="viewer"
                :time-label="videoTimeLabel"
                data-swipe-ignore="true"
              >
                <template #leading>
                  <div class="viewer__player-controls-group">
                    <media-play-button
                      class="viewer__player-control"
                      :aria-label="t('post.viewer.togglePlayback')"
                    >
                      <span
                        class="viewer__player-control-icon viewer__player-play-icon viewer__player-play-icon--play i-fluent-play-16-filled"
                        aria-hidden="true"
                      />
                      <span
                        class="viewer__player-control-icon viewer__player-play-icon viewer__player-play-icon--pause i-fluent-pause-16-filled"
                        aria-hidden="true"
                      />
                    </media-play-button>
                  </div>
                </template>
                <template #trailing>
                  <div class="viewer__player-controls-group">
                    <button
                      class="viewer__player-control"
                      type="button"
                      :aria-label="t('post.viewer.toggleSound')"
                      @click.stop="toggleViewerSound"
                    >
                      <span
                        class="viewer__player-control-icon"
                        :class="
                          appStore.videoMuted
                            ? 'i-fluent-speaker-mute-16-regular'
                            : 'i-fluent-speaker-2-16-regular'
                        "
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      v-if="showHdButton"
                      class="viewer__player-control"
                      :class="{ 'viewer__player-control--active': isPlayingHd }"
                      type="button"
                      :aria-label="
                        isPlayingHd
                          ? t('post.viewer.switchToPreviewQuality')
                          : t('post.viewer.switchToHdOriginal')
                      "
                      :aria-pressed="isPlayingHd"
                      :title="isPlayingHd ? t('post.viewer.previewQuality') : t('post.viewer.hdOriginal')"
                      @click.stop="toggleHdSource"
                    >
                      <span
                        class="viewer__player-control-icon"
                        :class="
                          isPlayingHd
                            ? 'i-fluent-hd-16-filled'
                            : 'i-fluent-hd-16-regular'
                        "
                        aria-hidden="true"
                      />
                    </button>
                    <media-fullscreen-button
                      class="viewer__player-control"
                      :aria-label="t('post.viewer.toggleFullscreen')"
                      target="media"
                    >
                      <span
                        class="viewer__player-control-icon viewer__player-fullscreen-icon viewer__player-fullscreen-icon--enter i-fluent-full-screen-maximize-16-regular"
                        aria-hidden="true"
                      />
                      <span
                        class="viewer__player-control-icon viewer__player-fullscreen-icon viewer__player-fullscreen-icon--exit i-fluent-full-screen-minimize-16-regular"
                        aria-hidden="true"
                      />
                    </media-fullscreen-button>
                  </div>
                </template>
              </VideoProgressFooter>
            </media-player>
            <div
              v-if="showVideoPausedIndicator"
              class="viewer__pause-indicator"
              aria-hidden="true"
            >
              <span class="viewer__pause-icon i-fluent-play-20-filled" />
            </div>
            <div
              v-if="holdSpeed.isFastForwarding.value"
              class="viewer__hold-indicator"
              aria-hidden="true"
            >
              <span class="viewer__hold-icon i-fluent-fast-forward-20-filled" />
              <span>{{ holdSpeed.rate }}x</span>
            </div>
            <div
              v-else-if="holdSpeed.isScrubbing.value"
              class="viewer__hold-indicator"
              aria-hidden="true"
            >
              <span>{{ videoScrubLabel }}</span>
            </div>
          </div>
        </template>
        <div
          v-else
          class="viewer__media-shell viewer__media-shell--image"
          :style="mediaShellStyle"
        >
          <ResilientImage
            class="viewer__media-image viewer__media-image--zoomable"
            :src="image.previewUrl"
            :fallback-src="image.originalUrl"
            :alt="image.filename"
            :width="image.width"
            :height="image.height"
            loading="eager"
            :retry-while="appStore.isScanning"
            @click="openImmersiveImage"
          />
        </div>
      </div>

      <button
        v-if="isModalSidebarOverlayVisible"
        class="viewer__drawer-backdrop"
        type="button"
        :aria-label="t('post.viewer.hideDetails')"
        @click="handleSidebarBackdropClick"
      />

      <!-- Sidebar -->
      <aside
        ref="sidebarElement"
        :class="[
        'viewer__sidebar',
        {
          'viewer__sidebar--modal': isModal,
            'viewer__sidebar--drawer': isModalSidebarCollapsible,
            'viewer__sidebar--drawer-open':
              isModalSidebarCollapsible && isSidebarExpanded,
            'viewer__sidebar--dragging': isSidebarSheetDragging,
          },
        ]"
        :style="sidebarSheetStyle"
        :aria-hidden="isModalSidebarCollapsible && !isSidebarExpanded"
        :inert="isModalSidebarCollapsible && !isSidebarExpanded"
        @pointercancel="handleSidebarSheetPointercancel"
        @pointerdown="handleSidebarSheetPointerdown"
        @pointermove="handleSidebarSheetPointermove"
        @pointerup="handleSidebarSheetPointerup"
      >
        <div
          v-if="isModalSidebarCollapsible"
          class="viewer__sidebar-handle"
          aria-hidden="true"
        />

        <!-- Header -->
        <div
          class="viewer__sidebar-header flex items-center justify-between gap-4 border-b border-border px-5 pt-[1.1rem] pb-4"
        >
          <RouterLink
            class="viewer__sidebar-folder-link flex items-center gap-[0.85rem] min-w-0"
            :to="{ name: 'folder', params: { slug: image.folderSlug } }"
            :aria-label="t('post.viewer.openFolder')"
          >
            <Avatar
              class="h-[2.65rem] w-[2.65rem]"
              :name="displayFolderTitle"
              :src="folderAvatar"
            />
            <div class="viewer__sidebar-folder-meta min-w-0">
              <h2 class="viewer__sidebar-title m-0 text-[0.9rem] font-semibold truncate">
                {{ displayFolderTitle }}
              </h2>
              <p class="viewer__sidebar-breadcrumb m-0 text-muted truncate">
                {{ folderBreadcrumbLabel }}
              </p>
            </div>
          </RouterLink>
          <span class="viewer__sidebar-date text-muted text-[0.78rem] whitespace-nowrap">{{
            formattedDate
          }}</span>
        </div>

        <!-- Description -->
        <div class="viewer__sidebar-summary grid gap-[0.3rem] px-5 pt-[1.1rem]">
          <div class="flex items-start gap-[0.35rem]">
            <p class="viewer__sidebar-caption m-0 text-text">
              <strong class="mr-[0.35rem]">{{ displayFolderTitle }}</strong>
              {{ caption }}
            </p>
            <button
              v-if="authStore.canManageLibrary"
              class="inline-flex items-center justify-center mt-[0.05rem] w-6 h-6 p-0 border-0 rounded-full bg-transparent text-muted cursor-pointer transition-colors hover:text-text"
              type="button"
              :aria-label="t('post.viewer.editCaption')"
              :title="t('post.viewer.editCaption')"
              @click="openCaptionEditor"
            >
              <span class="i-fluent-edit-16-regular w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <p class="viewer__sidebar-path mt-3 text-muted">
            <span class="viewer__sidebar-path-label">{{ t('post.viewer.folderPath') }}</span>
            <span class="viewer__sidebar-path-value">{{ image.relativePath }}</span>
          </p>
        </div>

        <!-- Quick stats -->
        <dl class="viewer__sidebar-stats m-0 px-5 pt-[0.9rem]">
          <div class="viewer__sidebar-stat">
            <dt class="viewer__sidebar-stat-label">
              {{ t('post.viewer.stats.dimensions') }}
            </dt>
            <dd class="viewer__sidebar-stat-value m-0 text-[0.96rem] font-semibold">
              {{ activeMediaWidth }} × {{ activeMediaHeight }}
            </dd>
          </div>
          <div class="viewer__sidebar-stat">
            <dt class="viewer__sidebar-stat-label">
              {{ t('post.viewer.stats.type') }}
            </dt>
            <dd class="viewer__sidebar-stat-value m-0 text-[0.96rem] font-semibold">
              {{ mediaTypeLabel }}
            </dd>
          </div>
          <div
            v-if="activeMediaDurationMs"
            class="viewer__sidebar-stat"
          >
            <dt class="viewer__sidebar-stat-label">
              {{ t('post.viewer.stats.duration') }}
            </dt>
            <dd class="viewer__sidebar-stat-value m-0 text-[0.96rem] font-semibold">
              {{ formattedDuration }}
            </dd>
          </div>
          <div class="viewer__sidebar-stat">
            <dt class="viewer__sidebar-stat-label">
              {{ t('post.viewer.stats.size') }}
            </dt>
            <dd class="viewer__sidebar-stat-value m-0 text-[0.96rem] font-semibold">{{ fileSize }}</dd>
          </div>
          <div
            v-if="image.place"
            class="viewer__sidebar-stat"
          >
            <dt class="viewer__sidebar-stat-label">
              {{ t('post.viewer.stats.place') }}
            </dt>
            <dd class="viewer__sidebar-stat-value m-0 text-[0.96rem] font-semibold">
              <RouterLink
                class="text-inherit no-underline hover:text-muted"
                :to="{ name: 'place', params: { slug: image.place.slug } }"
              >
                {{ image.place.name }}
              </RouterLink>
            </dd>
          </div>
        </dl>

        <!-- Metadata -->
        <dl
          v-if="exifDetails.length > 0"
          class="viewer__sidebar-metadata m-0 px-5 pt-[0.75rem]"
        >
          <div
            v-for="detail in exifDetails"
            :key="detail.label"
            class="viewer__sidebar-metadata-item"
          >
            <dt class="viewer__sidebar-metadata-label">
              {{ detail.label }}
            </dt>
            <dd class="viewer__sidebar-metadata-value m-0 text-[0.96rem] font-semibold break-words">
              {{ detail.value }}
            </dd>
          </div>
        </dl>

        <!-- Actions -->
        <div
          class="viewer__sidebar-actions flex items-center justify-between gap-3 px-5 pt-[0.7rem] pb-5 mt-auto"
        >
          <div class="viewer__sidebar-actions-group flex items-center gap-[0.55rem]">
            <!-- Like -->
            <button
              v-if="authStore.canUseSavedItems"
              class="viewer__sidebar-action inline-flex items-center justify-center p-0 border-0 bg-transparent cursor-pointer transition-[opacity,transform,color] duration-180 hover:opacity-72 hover:-translate-y-px disabled:opacity-45 disabled:cursor-wait disabled:transform-none"
              :class="{ 'text-[#e5484d]': likesStore.isLiked(image.id) }"
              type="button"
              :aria-label="likesStore.toggleAriaLabel(likesStore.isLiked(image.id))"
              :aria-pressed="likesStore.isLiked(image.id)"
              :disabled="likesStore.isPending(image.id)"
              @click="likesStore.toggleLike(image)"
            >
              <span
                class="w-[1.55rem] h-[1.55rem]"
                :class="
                  likesStore.isLiked(image.id)
                    ? 'i-fluent-heart-20-filled'
                    : 'i-fluent-heart-20-regular'
                "
                aria-hidden="true"
              />
            </button>
            <CollectionBookmark
              v-if="image"
              :item="image"
              placement="viewer"
            />
          </div>

          <div class="viewer__sidebar-actions-group flex items-center gap-[0.55rem]">
            <!-- Set as cover -->
            <button
              v-if="authStore.canManageLibrary"
              class="viewer__sidebar-action inline-flex items-center justify-center p-0 border-0 bg-transparent cursor-pointer text-text transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px disabled:opacity-45 disabled:cursor-wait disabled:transform-none"
              type="button"
              :aria-label="t('post.viewer.setAsCover')"
              :title="t('post.viewer.setAsCover')"
              :disabled="settingCover || isCurrentCover"
              @click="handleSetCover"
            >
              <span :class="[isCurrentCover ? 'i-fluent-folder-add-20-filled text-accent' : 'i-fluent-folder-add-20-regular', 'w-[1.5rem] h-[1.5rem]']" aria-hidden="true" />
            </button>
            <!-- Download original -->
            <a
              class="viewer__sidebar-action inline-flex items-center justify-center p-0 border-0 bg-transparent cursor-pointer text-text transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
              :href="downloadOriginalMediaUrl"
              download
              :aria-label="t('post.viewer.downloadOriginalFile')"
              :title="t('post.viewer.downloadOriginalFile')"
            >
              <svg
                class="w-[1.55rem] h-[1.55rem]"
                viewBox="0 0 24 24"
                role="presentation"
              >
                <path
                  d="M12 4.75v9.5m0 0 3.5-3.5M12 14.25l-3.5-3.5M5.75 16.75v1.5A1.75 1.75 0 0 0 7.5 20h9a1.75 1.75 0 0 0 1.75-1.75v-1.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.4"
                />
              </svg>
            </a>
            <!-- Open original -->
            <a
              class="viewer__sidebar-action inline-flex items-center justify-center p-0 border-0 bg-transparent cursor-pointer text-text transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
              :href="originalMediaUrl"
              target="_blank"
              rel="noreferrer"
              :aria-label="t('post.viewer.openOriginalFile')"
              :title="t('post.viewer.openOriginalFile')"
            >
              <svg
                class="w-[1.55rem] h-[1.55rem]"
                viewBox="0 0 24 24"
                role="presentation"
              >
                <path
                  d="M11 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1"
                />
                <path
                  d="M10 14L20 4"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1"
                />
                <path
                  d="M15 4h5v5"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1"
                />
              </svg>
            </a>
            <!-- Delete -->
            <button
              v-if="authStore.canDeleteMedia"
              class="viewer__sidebar-action inline-flex items-center justify-center p-0 border-0 bg-transparent cursor-pointer text-[#d93025] transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px disabled:opacity-45 disabled:cursor-wait disabled:transform-none"
              type="button"
              :aria-label="t('post.viewer.deletePost')"
              :disabled="deleting"
              @click="$emit('delete')"
            >
              <svg
                class="w-[1.38rem] h-[1.38rem]"
                viewBox="0 0 32 32"
                role="presentation"
              >
                <path d="M12 12h2v12h-2z" fill="currentColor" />
                <path d="M18 12h2v12h-2z" fill="currentColor" />
                <path
                  d="M4 6v2h2v20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8h2V6zm4 22V8h16v20z"
                  fill="currentColor"
                />
                <path d="M12 2h8v2h-8z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <PostCaptionModal
        v-if="isEditingCaption && image"
        :filename="captionFallbackFilename"
        :caption="image.caption"
        :error="captionError"
        :loading="captionSaving"
        @cancel="closeCaptionEditor"
        @save="handleCaptionSave"
      />
    </Teleport>
  </section>
</template>

<script setup lang="ts">
  import "vidstack/bundle"

  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
  import { useI18n } from "vue-i18n"
  import { RouterLink, useRoute, useRouter } from "vue-router"
  import type { PlayerSrc } from "vidstack"
  import type { MediaPlayerElement } from "vidstack/elements"

  import { useHoldToSpeed } from "../composables/useHoldToSpeed"
  import { useHorizontalSwipe } from "../composables/useHorizontalSwipe"
  import { useImageCaptionEditor } from "../composables/useImageCaptionEditor"
  import type { ImageDetail, FolderSummary } from "../types/api"
  import { useAppStore } from "../stores/app"
  import { useAuthStore } from "../stores/auth"
  import { useLikesStore } from "../stores/likes"
  import { useFoldersStore } from "../stores/folders"
  import { useImmersiveImageStore } from "../stores/immersive-image"
  import { useImmersiveVideoStore } from "../stores/immersive-video"
  import { resolveDisplayCaption } from "../utils/caption"
  import { formatFolderTitle } from "../utils/folder-titles"
  import { getOriginalMediaDownloadUrl, getOriginalMediaUrl } from "../utils/original-media"
  import {
    resolveVideoFallbackSource,
    resolveVideoSource,
    toPlayerSrc,
    useBundledHlsLibrary,
    type ResolvedVideoSource,
  } from "../utils/video-playback"
  import Avatar from "./Avatar.vue"
  import CarouselMediaStage from "./CarouselMediaStage.vue"
  import CollectionBookmark from "./CollectionBookmark.vue"
  import PostCaptionModal from "./PostCaptionModal.vue"
  import ResilientImage from "./ResilientImage.vue"
  import VideoProgressFooter from "./VideoProgressFooter.vue"
  import { formatMediaDuration, formatVideoTimestamp } from "../utils/media"

  const props = defineProps<{
    image: ImageDetail | null
    folder?: FolderSummary | null
    isModal?: boolean
    deleting?: boolean
  }>()

  defineEmits<{
    close: []
    delete: []
  }>()

  const likesStore = useLikesStore()
  const appStore = useAppStore()
  const authStore = useAuthStore()
  const foldersStore = useFoldersStore()
  const immersiveImageStore = useImmersiveImageStore()
  const immersiveVideoStore = useImmersiveVideoStore()
  const route = useRoute()
  const router = useRouter()
  const { locale, t } = useI18n()
  const playerElement = ref<MediaPlayerElement | null>(null)
  const cardWrapperElement = ref<HTMLElement | null>(null)
  const sidebarElement = ref<HTMLElement | null>(null)
  const sidebarToggleElement = ref<HTMLButtonElement | null>(null)
  const wheelDeltaAccumulator = ref(0)
  const navigationLockedUntil = ref(0)
  const isSidebarCollapsible = ref(false)
  const isSidebarExpanded = ref(true)
  const isSidebarSheetDragging = ref(false)
  const isPlayingHd = ref(false)
  const isVideoPaused = ref(false)
  const videoDurationMs = ref(props.image?.durationMs ?? 0)
  const videoCurrentTimeMs = ref(0)
  const sidebarSheetDragOffset = ref(0)
  const settingCover = ref(false)
  const isEditingCaption = ref(false)
  const carouselIndex = ref(0)
  const {
    saving: captionSaving,
    error: captionError,
    saveCaption,
    clearError: clearCaptionError,
  } = useImageCaptionEditor()

  const WHEEL_NAVIGATION_THRESHOLD = 72
  const NAVIGATION_COOLDOWN_MS = 320
  const isCarousel = computed(() => props.image?.postType === 'carousel' && (props.image.mediaItems?.length ?? 0) > 1)
  const activeMediaItem = computed(() => isCarousel.value ? props.image?.mediaItems?.[carouselIndex.value] ?? null : null)
  const activeMediaImageId = computed(() => activeMediaItem.value?.imageId ?? props.image?.id ?? null)
  const activeMediaWidth = computed(() => activeMediaItem.value?.width ?? props.image?.width ?? 0)
  const activeMediaHeight = computed(() => activeMediaItem.value?.height ?? props.image?.height ?? 0)
  const activeMediaDurationMs = computed(() => activeMediaItem.value?.durationMs ?? props.image?.durationMs ?? null)
  const captionFallbackFilename = computed(() => {
    if (props.image?.postType === 'carousel' && props.image.carouselTitle) {
      return props.image.carouselTitle
    }
    if (props.image?.postType === 'carousel' && props.image.sourcePath) {
      return props.image.sourcePath.replaceAll('\\', '/').split('/').at(-1) ?? props.image.filename
    }
    return props.image?.filename ?? ''
  })
  const originalMediaUrl = computed(() => activeMediaItem.value?.originalUrl ?? (activeMediaImageId.value ? getOriginalMediaUrl(activeMediaImageId.value) : ""))
  const downloadOriginalMediaUrl = computed(() => activeMediaImageId.value ? getOriginalMediaDownloadUrl(activeMediaImageId.value) : "")
  const MODAL_SIDEBAR_COLLAPSE_BREAKPOINT = 960
  const SHEET_SWIPE_MIN_DISTANCE = 56
  const SHEET_SWIPE_MAX_HORIZONTAL_DISTANCE = 96
  const SHEET_SWIPE_MIN_VERTICAL_RATIO = 1.15
  const SHEET_MAX_DRAG_OFFSET = 240

  type MetadataDetail = {
    label: string
    value: string
  }

  let playerReady = false
  let pendingVideoRestore: { currentTime: number; wasPaused: boolean } | null = null
  let removePlayerEventListeners: (() => void) | null = null
  let sidebarSheetPointerId: number | null = null
  let sidebarSheetCapturedElement: Element | null = null
  let sidebarSheetStartX = 0
  let sidebarSheetStartY = 0
  let sidebarSheetStartScrollTop = 0
  let mediaSheetRevealPointerId: number | null = null
  let mediaSheetRevealCapturedElement: Element | null = null
  let mediaSheetRevealStartX = 0
  let mediaSheetRevealStartY = 0

  const fileSize = computed(() => {
    if (!props.image) {
      return ""
    }

    const megabytes = (activeMediaItem.value?.fileSize ?? props.image.fileSize) / (1024 * 1024)
    return `${megabytes.toFixed(2)} MB`
  })

  // Only worth offering when the default source is a transcoded stream; there is
  // nothing to upgrade to when the browser is already playing the original file.
  const showHdButton = computed(
    () =>
      props.image?.mediaType === 'video' &&
      Boolean(props.image?.streamUrl) &&
      (isPlayingHd.value || preferredVideoSource.value?.isStream === true),
  )
  const showVideoPausedIndicator = computed(
    () => props.image?.mediaType === 'video' && isVideoPaused.value,
  )
  const videoTimeLabel = computed(() =>
    formatVideoTimestamp(
      videoDurationMs.value > 0 ? videoDurationMs.value : props.image?.durationMs,
      videoCurrentTimeMs.value,
    ),
  )

  const videoFallbackSource = ref<ResolvedVideoSource | null>(null)
  const preferredVideoSource = computed<ResolvedVideoSource | null>(() => {
    if (!props.image || props.image.mediaType !== 'video') {
      return null
    }

    // The HD toggle is a per-playback override that forces the untouched file.
    const quality = isPlayingHd.value ? 'original' : appStore.videoPlaybackQuality
    return resolveVideoSource(props.image, quality)
  })
  const activeVideoSource = computed<ResolvedVideoSource | null>(
    () => videoFallbackSource.value ?? preferredVideoSource.value,
  )
  const videoSrc = computed(() => activeVideoSource.value?.src ?? '')
  const videoSource = computed<PlayerSrc>(() => {
    const source = activeVideoSource.value
    if (!source) {
      return { src: "", type: "video/mp4" }
    }

    return toPlayerSrc(source)
  })
  const mediaShellStyle = computed(() => {
    if (!props.image) {
      return undefined
    }

    return {
      "--viewer-media-aspect-ratio": `${props.image.width} / ${props.image.height}`,
      "--viewer-media-intrinsic-width": `${props.image.width}px`,
    }
  })

  watch(() => props.image?.id, () => {
    carouselIndex.value = 0
  })

  const locallySetCover = ref(false)

  const isCurrentCover = computed(() => {
    if (locallySetCover.value) return true;
    if (!props.image) return false;

    if ('folderAvatarImageId' in props.image && typeof props.image.folderAvatarImageId === 'number') {
      return activeMediaImageId.value === props.image.folderAvatarImageId;
    }

    if (foldersStore.currentFolder?.avatarUrl) {
      return Boolean(activeMediaImageId.value && foldersStore.currentFolder.avatarUrl.includes(`/api/images/${activeMediaImageId.value}/`));
    }

    return false;
  })

  const folderAvatar = computed(() => props.folder?.avatarUrl ?? null)
  const caption = computed(() => (props.image ? resolveDisplayCaption(props.image) : ""))
  const displayFolderTitle = computed(() =>
    props.image ? formatFolderTitle(props.folder ?? props.image, appStore.nestedFolderTitleFormat) : "",
  )
  const folderBreadcrumbLabel = computed(() =>
    props.folder?.breadcrumb ?? props.image?.folderBreadcrumb ?? t('folder.shared.topLevelSourceFolder'),
  )
  const mediaTypeLabel = computed(() => {
    if (!props.image) {
      return ""
    }

    const mediaType = activeMediaItem.value?.mediaType ?? props.image.mediaType
    const mimeType = activeMediaItem.value?.mimeType ?? props.image.mimeType
    return mediaType === "video"
      ? t('post.viewer.videoType', { mimeType })
      : mimeType
  })
  const formattedDate = computed(() =>
    props.image
      ? new Date(
          props.image.takenAt ?? props.image.sortTimestamp,
        ).toLocaleDateString(locale.value, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "",
  )
  const formattedDuration = computed(() =>
    formatMediaDuration(activeMediaDurationMs.value),
  )
  const exifDetails = computed<MetadataDetail[]>(() => {
    const exif = activeMediaItem.value?.exif ?? props.image?.exif
    if (!exif) {
      return []
    }

    const details: MetadataDetail[] = []
    const location = formatLocation(
      exif.latitude,
      exif.longitude,
      exif.altitudeMeters,
    )
    const camera = formatCameraLabel(exif.cameraMake, exif.cameraModel)
    const aperture =
      typeof exif.fNumber === "number" && Number.isFinite(exif.fNumber)
        ? `f/${formatExifNumber(exif.fNumber, 2)}`
        : null
    const shutter = formatExposureTime(exif.exposureTimeSeconds)
    const iso =
      typeof exif.iso === "number" && Number.isFinite(exif.iso)
        ? formatExifNumber(exif.iso, 0)
        : null
    const focalLength = formatFocalLength(
      exif.focalLengthMm,
      exif.focalLength35mmMm,
    )

    if (location) {
      details.push({
        label: t('post.viewer.metadata.location'),
        value: location,
      })
    }

    if (camera) {
      details.push({
        label: t('post.viewer.metadata.camera'),
        value: camera,
      })
    }

    if (exif.lensModel) {
      details.push({
        label: t('post.viewer.metadata.lens'),
        value: exif.lensModel,
      })
    }

    if (aperture) {
      details.push({
        label: t('post.viewer.metadata.aperture'),
        value: aperture,
      })
    }

    if (shutter) {
      details.push({
        label: t('post.viewer.metadata.shutter'),
        value: shutter,
      })
    }

    if (iso) {
      details.push({
        label: t('post.viewer.metadata.iso'),
        value: iso,
      })
    }

    if (focalLength) {
      details.push({
        label: t('post.viewer.metadata.focalLength'),
        value: focalLength,
      })
    }

    return details
  })

  function openCaptionEditor() {
    clearCaptionError()
    isEditingCaption.value = true
  }

  function closeCaptionEditor() {
    clearCaptionError()
    isEditingCaption.value = false
  }

  async function handleCaptionSave(nextCaption: string | null) {
    if (!props.image) {
      return
    }

    try {
      await saveCaption(props.image, nextCaption)
      closeCaptionEditor()
    } catch {
      // The modal surfaces the current error state.
    }
  }
  const isModalSidebarCollapsible = computed(
    () => props.isModal === true && isSidebarCollapsible.value,
  )
  const isLikesNavigationContext = computed(() => {
    if (props.isModal !== true || !appStore.imageModalBackgroundPath) {
      return false
    }

    return router.resolve(appStore.imageModalBackgroundPath).name === "likes"
  })
  const likesNavigationIds = computed(() => {
    if (!props.image || !isLikesNavigationContext.value) {
      return null
    }

    const currentIndex = likesStore.items.findIndex(
      item => item.id === props.image?.id,
    )
    if (currentIndex === -1) {
      return null
    }

    return {
      previousImageId: likesStore.items[currentIndex - 1]?.id ?? null,
      nextImageId: likesStore.items[currentIndex + 1]?.id ?? null,
    }
  })
  const previousNavigationImageId = computed(
    () => likesNavigationIds.value?.previousImageId ?? props.image?.previousImageId ?? null,
  )
  const nextNavigationImageId = computed(
    () => likesNavigationIds.value?.nextImageId ?? props.image?.nextImageId ?? null,
  )
  const isModalSidebarOverlayVisible = computed(
    () => isModalSidebarCollapsible.value && isSidebarExpanded.value,
  )
  const sidebarSheetStyle = computed(() =>
    isModalSidebarCollapsible.value
      ? {
          "--viewer-sidebar-drag-offset": `${sidebarSheetDragOffset.value}px`,
        }
      : undefined,
  )
  const swipeNavigation = useHorizontalSwipe({
    canStart: canStartSwipeNavigation,
    isEnabled: () => props.isModal === true && props.image !== null,
    onSwipeLeft: () => {
      wheelDeltaAccumulator.value = 0
      void navigateByDirection("next")
    },
    onSwipeRight: () => {
      wheelDeltaAccumulator.value = 0
      void navigateByDirection("previous")
    },
  })

  function syncVideoMuted(player: MediaPlayerElement, muted: boolean) {
    player.muted = muted
  }

  // Vidstack re-initialises its own muted state after the provider attaches and
  // after a source swap, so the element is pushed back onto the stored preference
  // whenever it drifts.
  function enforceVideoMuted() {
    const player = playerElement.value
    if (player && player.muted !== appStore.videoMuted) {
      player.muted = appStore.videoMuted
    }
  }

  function isPrimaryPlainClick(event: MouseEvent) {
    return (
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    )
  }

  function isPlayerInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(
      target.closest(
        [
          "a",
          "button",
          "input",
          "select",
          "textarea",
          "label",
          "media-play-button",
          "media-mute-button",
          "media-fullscreen-button",
          "media-time-slider",
        ].join(", "),
      ),
    )
  }

  function syncVideoTimelineState(player: MediaPlayerElement | null = playerElement.value) {
    if (!player) {
      return
    }

    if (Number.isFinite(player.duration) && player.duration > 0) {
      videoDurationMs.value = player.duration * 1000
    }

    if (Number.isFinite(player.currentTime) && player.currentTime >= 0) {
      videoCurrentTimeMs.value = player.currentTime * 1000
    }
  }

  function formatExifNumber(
    value: number | null | undefined,
    maximumFractionDigits = 1,
  ) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null
    }

    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits,
    }).format(value)
  }

  function formatCameraLabel(
    make: string | null | undefined,
    model: string | null | undefined,
  ) {
    if (make && model) {
      return model.toLowerCase().startsWith(make.toLowerCase())
        ? model
        : `${make} ${model}`
    }

    return make ?? model ?? null
  }

  function formatExposureTime(seconds: number | null | undefined) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return null
    }

    if (seconds >= 1) {
      return `${formatExifNumber(seconds, seconds >= 10 ? 0 : 1)} s`
    }

    const reciprocal = Math.round(1 / seconds)
    if (
      reciprocal > 1 &&
      Math.abs(1 / reciprocal - seconds) <= Math.max(seconds * 0.08, 0.0005)
    ) {
      return `1/${reciprocal} s`
    }

    return `${formatExifNumber(seconds, 3)} s`
  }

  function formatFocalLength(
    focalLengthMm: number | null | undefined,
    focalLength35mmMm: number | null | undefined,
  ) {
    const focalLength = formatExifNumber(focalLengthMm, 2)
    const focalLength35mm = formatExifNumber(focalLength35mmMm, 0)

    if (focalLength && focalLength35mm) {
      return `${focalLength} mm (${focalLength35mm} mm equiv.)`
    }

    if (focalLength) {
      return `${focalLength} mm`
    }

    if (focalLength35mm) {
      return `${focalLength35mm} mm equiv.`
    }

    return null
  }

  function formatLocation(
    latitude: number | null | undefined,
    longitude: number | null | undefined,
    altitudeMeters: number | null | undefined,
  ) {
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude)
    ) {
      return null
    }

    const coordinates = `${formatExifNumber(latitude, 5)}, ${formatExifNumber(
      longitude,
      5,
    )}`
    const altitude = formatExifNumber(altitudeMeters, 1)

    return altitude ? `${coordinates} (alt ${altitude} m)` : coordinates
  }

  function focusSidebarToggle(force = false) {
    if (!force) {
      const activeElement = document.activeElement
      if (
        !sidebarElement.value ||
        !(activeElement instanceof Node) ||
        !sidebarElement.value.contains(activeElement)
      ) {
        return
      }
    }

    void nextTick(() => {
      sidebarToggleElement.value?.focus()
    })
  }

  function releaseCapturedPointer(
    capturedElement: Element | null,
    pointerId: number | null,
  ) {
    if (!capturedElement || pointerId === null || !("releasePointerCapture" in capturedElement)) {
      return
    }

    try {
      capturedElement.releasePointerCapture(pointerId)
    } catch {
      // Ignore failures if the pointer has already been released.
    }
  }

  function isGestureIgnoredTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return false
    }

    return Boolean(
      target.closest(
        [
          '[data-swipe-ignore="true"]',
          '[data-sheet-swipe-ignore="true"]',
          "button",
          "a",
          "input",
          "select",
          "textarea",
          "label",
          '[role="button"]',
          '[role="link"]',
        ].join(", "),
      ),
    )
  }

  function resetSidebarSheetGesture() {
    releaseCapturedPointer(sidebarSheetCapturedElement, sidebarSheetPointerId)
    sidebarSheetPointerId = null
    sidebarSheetCapturedElement = null
    sidebarSheetStartX = 0
    sidebarSheetStartY = 0
    sidebarSheetStartScrollTop = 0
    sidebarSheetDragOffset.value = 0
    isSidebarSheetDragging.value = false
  }

  function resetMediaSheetRevealGesture() {
    releaseCapturedPointer(
      mediaSheetRevealCapturedElement,
      mediaSheetRevealPointerId,
    )
    mediaSheetRevealPointerId = null
    mediaSheetRevealCapturedElement = null
    mediaSheetRevealStartX = 0
    mediaSheetRevealStartY = 0
  }

  function updateSidebarLayout() {
    resetSidebarSheetGesture()
    resetMediaSheetRevealGesture()

    if (!props.isModal) {
      isSidebarCollapsible.value = false
      isSidebarExpanded.value = true
      return
    }

    const nextCollapsible = window.innerWidth <= MODAL_SIDEBAR_COLLAPSE_BREAKPOINT
    const wasCollapsible = isSidebarCollapsible.value

    isSidebarCollapsible.value = nextCollapsible

    if (!nextCollapsible) {
      isSidebarExpanded.value = true
      return
    }

    if (!wasCollapsible) {
      focusSidebarToggle()
      isSidebarExpanded.value = false
    }
  }

  function openSidebar() {
    if (!isModalSidebarCollapsible.value) {
      return
    }

    resetSidebarSheetGesture()
    isSidebarExpanded.value = true
  }

  function toggleSidebar() {
    if (!isModalSidebarCollapsible.value) {
      return
    }

    if (isSidebarExpanded.value) {
      closeSidebar()
      return
    }

    openSidebar()
  }

  function closeSidebar(options: { restoreFocus?: boolean } = {}) {
    if (!isModalSidebarCollapsible.value) {
      return
    }

    resetSidebarSheetGesture()
    isSidebarExpanded.value = false

    if (options.restoreFocus !== false) {
      focusSidebarToggle(true)
    }
  }

  function handleSidebarBackdropClick() {
    closeSidebar()
  }

  function handleMediaPointerdown(event: PointerEvent) {
    if (isCarousel.value) return
    swipeNavigation.onPointerdown(event)
    handleMediaSheetRevealPointerdown(event)
  }

  function handleMediaPointermove(event: PointerEvent) {
    if (isCarousel.value) return
    swipeNavigation.onPointermove(event)
    handleMediaSheetRevealPointermove(event)
  }

  async function handleMediaPointerup(event: PointerEvent) {
    if (isCarousel.value) return
    await swipeNavigation.onPointerup(event)
    await handleMediaSheetRevealPointerup(event)
  }

  function handleMediaPointercancel(event: PointerEvent) {
    if (isCarousel.value) return
    swipeNavigation.onPointercancel()
    handleMediaSheetRevealPointercancel(event)
  }

  function handleMediaSheetRevealPointerdown(event: PointerEvent) {
    if (
      !event.isPrimary ||
      event.pointerType === "mouse" ||
      !isModalSidebarCollapsible.value ||
      isSidebarExpanded.value ||
      Date.now() < navigationLockedUntil.value ||
      isGestureIgnoredTarget(event.target)
    ) {
      return
    }

    mediaSheetRevealPointerId = event.pointerId
    mediaSheetRevealStartX = event.clientX
    mediaSheetRevealStartY = event.clientY

    if (event.currentTarget instanceof Element && "setPointerCapture" in event.currentTarget) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
        mediaSheetRevealCapturedElement = event.currentTarget
      } catch {
        mediaSheetRevealCapturedElement = null
      }
    }
  }

  function handleMediaSheetRevealPointermove(event: PointerEvent) {
    if (event.pointerId !== mediaSheetRevealPointerId) {
      return
    }

    const deltaX = Math.abs(event.clientX - mediaSheetRevealStartX)
    const deltaY = mediaSheetRevealStartY - event.clientY

    if (deltaY > 10 && deltaY > deltaX) {
      event.preventDefault()
    }
  }

  async function handleMediaSheetRevealPointerup(event: PointerEvent) {
    if (event.pointerId !== mediaSheetRevealPointerId) {
      return
    }

    const deltaX = event.clientX - mediaSheetRevealStartX
    const deltaY = event.clientY - mediaSheetRevealStartY

    resetMediaSheetRevealGesture()

    if (-deltaY < SHEET_SWIPE_MIN_DISTANCE) {
      return
    }

    if (Math.abs(deltaX) > SHEET_SWIPE_MAX_HORIZONTAL_DISTANCE) {
      return
    }

    if (Math.abs(deltaY) <= Math.abs(deltaX) * SHEET_SWIPE_MIN_VERTICAL_RATIO) {
      return
    }

    openSidebar()
  }

  function handleMediaSheetRevealPointercancel(_event: PointerEvent) {
    resetMediaSheetRevealGesture()
  }

  function handleSidebarSheetPointerdown(event: PointerEvent) {
    if (
      !event.isPrimary ||
      event.pointerType === "mouse" ||
      !isModalSidebarCollapsible.value ||
      !isSidebarExpanded.value ||
      isGestureIgnoredTarget(event.target)
    ) {
      return
    }

    sidebarSheetPointerId = event.pointerId
    sidebarSheetStartX = event.clientX
    sidebarSheetStartY = event.clientY
    sidebarSheetStartScrollTop = sidebarElement.value?.scrollTop ?? 0

    if (event.currentTarget instanceof Element && "setPointerCapture" in event.currentTarget) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
        sidebarSheetCapturedElement = event.currentTarget
      } catch {
        sidebarSheetCapturedElement = null
      }
    }
  }

  function handleSidebarSheetPointermove(event: PointerEvent) {
    if (event.pointerId !== sidebarSheetPointerId) {
      return
    }

    const sidebar = sidebarElement.value
    if (!sidebar || sidebarSheetStartScrollTop > 0 || sidebar.scrollTop > 0) {
      return
    }

    const deltaX = event.clientX - sidebarSheetStartX
    const deltaY = event.clientY - sidebarSheetStartY

    if (deltaY <= 0) {
      if (isSidebarSheetDragging.value) {
        sidebarSheetDragOffset.value = 0
      }
      return
    }

    if (deltaY > 10 && deltaY > Math.abs(deltaX)) {
      event.preventDefault()
      isSidebarSheetDragging.value = true
      sidebarSheetDragOffset.value = Math.min(deltaY, SHEET_MAX_DRAG_OFFSET)
    }
  }

  function handleSidebarSheetPointerup(event: PointerEvent) {
    if (event.pointerId !== sidebarSheetPointerId) {
      return
    }

    const deltaX = event.clientX - sidebarSheetStartX
    const deltaY = event.clientY - sidebarSheetStartY
    const shouldClose =
      isSidebarSheetDragging.value &&
      deltaY >= SHEET_SWIPE_MIN_DISTANCE &&
      deltaY > Math.abs(deltaX) * SHEET_SWIPE_MIN_VERTICAL_RATIO

    resetSidebarSheetGesture()

    if (shouldClose) {
      closeSidebar({ restoreFocus: false })
    }
  }

  function handleSidebarSheetPointercancel(_event: PointerEvent) {
    resetSidebarSheetGesture()
  }

  function canStartSwipeNavigation(event: PointerEvent) {
    if (Date.now() < navigationLockedUntil.value) {
      return false
    }

    const target = event.target
    return !isGestureIgnoredTarget(target)
  }

  async function attemptVideoPlayback(): Promise<void> {
    if (props.image?.mediaType !== "video") {
      return
    }

    await nextTick()
    const player = playerElement.value
    if (!player) {
      return
    }

    syncVideoMuted(player, appStore.videoMuted)

    try {
      await player.play()
      isVideoPaused.value = false
      return
    } catch {
      if (appStore.videoMuted) {
        // Ignore autoplay rejections and leave manual controls available.
        isVideoPaused.value = true
        return
      }
    }

    // Audible autoplay was refused, so record the fallback in the store and keep
    // the element, the icon and the persisted preference consistent.
    appStore.setVideoMuted(true)
    syncVideoMuted(player, true)

    try {
      await player.play()
      isVideoPaused.value = false
    } catch {
      // Ignore autoplay rejections and leave manual controls available.
      isVideoPaused.value = true
    }
  }

  async function resumeVideoPlayback() {
    const player = playerElement.value
    if (!player || props.image?.mediaType !== "video") {
      return
    }

    syncVideoMuted(player, appStore.videoMuted)

    try {
      await player.play()
      isVideoPaused.value = false
    } catch {
      // Ignore playback rejections and leave manual controls available.
    }
  }

  // Only an explicit tap writes the muted preference. Mirroring vidstack's
  // `volume-change` back into the store also captured its own `muted=false`
  // initialisation on every source swap, which un-muted the library silently.
  function toggleViewerSound() {
    const nextMuted = !appStore.videoMuted
    appStore.setVideoMuted(nextMuted)

    const player = playerElement.value
    if (player) {
      syncVideoMuted(player, nextMuted)
    }
  }

  function toggleHdSource() {
    const player = playerElement.value
    const image = props.image
    if (!player || !image || image.mediaType !== 'video') {
      return
    }

    const savedTime = player.currentTime
    pendingVideoRestore = {
      currentTime: savedTime,
      wasPaused: player.paused
    }
    videoFallbackSource.value = null
    isPlayingHd.value = !isPlayingHd.value
  }

  function switchVideoToFallbackSource() {
    const image = props.image
    const failed = activeVideoSource.value
    if (!image || !failed || videoFallbackSource.value) {
      return
    }

    const fallback = resolveVideoFallbackSource(image, failed)
    if (!fallback) {
      return
    }

    videoFallbackSource.value = fallback
  }

  async function handlePlayerReadyForPlayback(): Promise<void> {
    const player = playerElement.value
    if (player && pendingVideoRestore) {
      const restoreState = pendingVideoRestore
      pendingVideoRestore = null
      player.currentTime = restoreState.currentTime
      syncVideoTimelineState(player)

      if (!restoreState.wasPaused) {
        void player.play().catch(() => { /* ignore */ })
      } else {
        isVideoPaused.value = true
      }

      return
    }

    await attemptVideoPlayback()
  }

  function bindPlayerEventListeners(player: MediaPlayerElement | null) {
    removePlayerEventListeners?.()
    removePlayerEventListeners = null

    if (!player) {
      return
    }

    const handleReady = () => {
      playerReady = true
      void handlePlayerReadyForPlayback()
    }
    const handlePlay = () => {
      isVideoPaused.value = false
      syncVideoTimelineState(player)
    }
    const handlePause = () => {
      isVideoPaused.value = props.image?.mediaType === "video"
      syncVideoTimelineState(player)
    }
    const handleDuration = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "number" && event.detail > 0) {
        videoDurationMs.value = event.detail * 1000
      }

      syncVideoTimelineState(player)
    }
    const handleTimeUpdate = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail === "object" &&
        event.detail !== null &&
        "currentTime" in event.detail &&
        typeof event.detail.currentTime === "number"
      ) {
        videoCurrentTimeMs.value = event.detail.currentTime * 1000
        return
      }

      syncVideoTimelineState(player)
    }
    const handleEnded = () => {
      videoCurrentTimeMs.value = videoDurationMs.value
    }
    const handleVolume = () => {
      enforceVideoMuted()
    }
    const handleError = () => {
      switchVideoToFallbackSource()
    }

    const removeHlsLibraryBinding = useBundledHlsLibrary(player)

    player.addEventListener("loaded-metadata", handleReady)
    player.addEventListener("can-play", handleReady)
    player.addEventListener("volume-change", handleVolume)
    player.addEventListener("play", handlePlay)
    player.addEventListener("pause", handlePause)
    player.addEventListener("duration-change", handleDuration)
    player.addEventListener("time-update", handleTimeUpdate)
    player.addEventListener("ended", handleEnded)
    player.addEventListener("error", handleError)

    removePlayerEventListeners = () => {
      removeHlsLibraryBinding()
      player.removeEventListener("loaded-metadata", handleReady)
      player.removeEventListener("can-play", handleReady)
      player.removeEventListener("volume-change", handleVolume)
      player.removeEventListener("play", handlePlay)
      player.removeEventListener("pause", handlePause)
      player.removeEventListener("duration-change", handleDuration)
      player.removeEventListener("time-update", handleTimeUpdate)
      player.removeEventListener("ended", handleEnded)
      player.removeEventListener("error", handleError)
    }

    if (player.hasAttribute("data-can-play")) {
      void handlePlayerReadyForPlayback()
    }
  }

  watch(
    () => props.image?.id ?? null,
    () => {
      wheelDeltaAccumulator.value = 0
      navigationLockedUntil.value = 0
      resetSidebarSheetGesture()
      resetMediaSheetRevealGesture()
      isPlayingHd.value = false
      isVideoPaused.value = false
      videoDurationMs.value = props.image?.durationMs ?? 0
      videoCurrentTimeMs.value = 0
      videoFallbackSource.value = null
      pendingVideoRestore = null
      void attemptVideoPlayback()
    },
  )

  watch(
    () => appStore.videoPlaybackQuality,
    () => {
      videoFallbackSource.value = null
    },
  )

  watch(
    () => appStore.videoMuted,
    videoMuted => {
      const player = playerElement.value
      if (!player) {
        return
      }

      syncVideoMuted(player, videoMuted)
    },
  )

  watch(playerElement, player => {
    videoDurationMs.value = props.image?.durationMs ?? 0
    videoCurrentTimeMs.value = 0
    playerReady = false
    bindPlayerEventListeners(player)
  })

  watch(
    () => props.isModal,
    () => {
      updateSidebarLayout()
    },
  )

  async function navigateByDirection(direction: "previous" | "next") {
    const targetId =
      direction === "next"
        ? nextNavigationImageId.value
        : previousNavigationImageId.value
    if (!targetId) {
      return
    }

    navigationLockedUntil.value = Date.now() + NAVIGATION_COOLDOWN_MS
    await router.push({
      name: "image",
      params: { id: String(targetId) },
      query: route.query,
    })
  }

  function handleWheel(event: WheelEvent) {
    if (!props.isModal || !props.image) {
      return
    }

    if (
      sidebarElement.value &&
      event.target instanceof Node &&
      sidebarElement.value.contains(event.target)
    ) {
      return
    }

    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return
    }

    event.preventDefault()

    if (Date.now() < navigationLockedUntil.value) {
      return
    }

    wheelDeltaAccumulator.value += event.deltaY

    if (Math.abs(wheelDeltaAccumulator.value) < WHEEL_NAVIGATION_THRESHOLD) {
      return
    }

    const direction = wheelDeltaAccumulator.value > 0 ? "next" : "previous"
    wheelDeltaAccumulator.value = 0
    void navigateByDirection(direction)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!props.isModal || !props.image || event.defaultPrevented) {
      return
    }

    if (isEditingCaption.value || isGestureIgnoredTarget(event.target)) {
      return
    }

    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }

    if (Date.now() < navigationLockedUntil.value) {
      return
    }

    let direction: "previous" | "next" | null = null

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      direction = "previous"
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      direction = "next"
    }

    if (!direction) {
      return
    }

    event.preventDefault()
    wheelDeltaAccumulator.value = 0
    void navigateByDirection(direction)
  }

  async function toggleVideoSurfacePlayback() {
    const player = playerElement.value
    if (!player || props.image?.mediaType !== "video") {
      return
    }

    if (player.paused) {
      await resumeVideoPlayback()
      return
    }

    isVideoPaused.value = true
    void player.pause().catch(() => {
      // Ignore pause rejections before the provider is ready.
    })
  }

  const holdSpeed = useHoldToSpeed({
    canStart: event => !isPlayerInteractiveTarget(event.target),
    getCurrentTime: () => playerElement.value?.currentTime ?? 0,
    getDuration: () => playerElement.value?.duration ?? 0,
    seekTo: seconds => {
      const player = playerElement.value
      if (!player) {
        return
      }

      try {
        player.currentTime = seconds
      } catch {
        // Seeking before the provider is attached is a no-op.
      }
    },
    getPlaybackRate: () => playerElement.value?.playbackRate ?? 1,
    setPlaybackRate: rate => {
      const player = playerElement.value
      if (!player) {
        return
      }

      try {
        player.playbackRate = rate
      } catch {
        // Rate changes before the provider is attached are a no-op.
      }
    },
    play: () => {
      void playerElement.value?.play().catch(() => {
        // Ignore play rejections before the provider is ready.
      })
    },
  })

  const videoScrubLabel = computed(() => {
    const seconds = holdSpeed.scrubSeconds.value
    if (seconds === null) {
      return ""
    }

    return formatVideoTimestamp(
      videoDurationMs.value > 0 ? videoDurationMs.value : props.image?.durationMs,
      seconds * 1000,
    )
  })

  function openImmersiveImage() {
    const image = props.image
    if (!image || image.mediaType !== "image") {
      return
    }

    immersiveImageStore.open({
      id: image.id,
      filename: image.filename,
      thumbnailUrl: image.thumbnailUrl,
      fullUrl: image.originalUrl ?? getOriginalMediaUrl(image.id),
      width: image.width,
      height: image.height,
      caption: caption.value,
      folderSlug: image.folderSlug,
    })
  }

  function openImmersiveVideo() {
    const image = props.image
    if (!image || image.mediaType !== "video") {
      return
    }

    const player = playerElement.value
    const currentTime = Number.isFinite(player?.currentTime) ? player?.currentTime ?? 0 : 0

    void player?.pause().catch(() => {
      // Ignore pause rejections before the provider is ready.
    })

    immersiveVideoStore.open(
      {
        id: image.id,
        filename: image.filename,
        thumbnailUrl: image.thumbnailUrl,
        previewUrl: image.previewUrl,
        originalUrl: image.originalUrl,
        streamUrl: image.streamUrl,
        playbackStrategy: image.playbackStrategy,
        width: image.width,
        height: image.height,
        durationMs: image.durationMs,
      },
      { startTime: currentTime },
    )
  }

  function handleVideoSurfaceClick(event: MouseEvent) {
    if (!isPrimaryPlainClick(event) || isPlayerInteractiveTarget(event.target)) {
      return
    }

    if (holdSpeed.shouldSuppressClick()) {
      return
    }

    // Tapping the frame opens the immersive layer, matching how social apps behave.
    // The footer play button keeps the pause/resume role.
    openImmersiveVideo()
  }

  function handleVideoSurfaceKeydown(event: KeyboardEvent) {
    if (isPlayerInteractiveTarget(event.target)) {
      return
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return
    }

    event.preventDefault()
    void toggleVideoSurfacePlayback()
  }

  async function handleSetCover() {
    if (!props.image || settingCover.value) return;
    try {
      settingCover.value = true;
      await foldersStore.setFolderCover(props.image.folderSlug, activeMediaImageId.value ?? props.image.id);
      locallySetCover.value = true;
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set cover');
    } finally {
      settingCover.value = false;
    }
  }

  onMounted(() => {
    void nextTick().then(updateSidebarLayout)
    window.addEventListener("resize", updateSidebarLayout)
    window.addEventListener("keydown", handleKeydown)
    void attemptVideoPlayback()
  })

  onUnmounted(() => {
    holdSpeed.stop()
    resetSidebarSheetGesture()
    resetMediaSheetRevealGesture()
    window.removeEventListener("resize", updateSidebarLayout)
    window.removeEventListener("keydown", handleKeydown)
    removePlayerEventListeners?.()
    removePlayerEventListeners = null
    void playerElement.value?.pause().catch(() => { /* ignore */ })
  })

  watch(
    () => props.image?.id,
    (nextImageId, previousImageId) => {
      if (!nextImageId || nextImageId === previousImageId) {
        return
      }

      closeCaptionEditor()
    },
  )

  watch(
    () => immersiveVideoStore.isOpen,
    async isOpen => {
      const image = props.image
      if (!image || image.mediaType !== "video") {
        return
      }

      // Only one decoder should run at a time, so the inline player waits while the
      // immersive layer is up and then resumes where that layer stopped.
      if (isOpen) {
        isVideoPaused.value = true
        void playerElement.value?.pause().catch(() => {
          // Ignore pause rejections before the provider is ready.
        })
        return
      }

      const exitState = immersiveVideoStore.consumeExitState(image.id)
      const player = playerElement.value
      if (exitState && player) {
        try {
          player.currentTime = exitState.currentTime
        } catch {
          // Seeking before the provider is attached is a no-op.
        }

        if (exitState.paused) {
          isVideoPaused.value = true
          return
        }
      }

      await resumeVideoPlayback()
    },
  )
</script>
