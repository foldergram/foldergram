# AI File Index

Generated: 2026-09-01 11:50:33 +0800

Run again after adding/moving files: `scripts/ai-map.sh`.

Do not read `ai/AI_REPOMIX_CONTEXT.md` or graph dumps by default.

## Important Entrypoints

| Area | Path |
|---|---|
| server-entry | server/src/index.ts |
| server-app | server/src/app.ts |
| api-routes | server/src/routes/api.ts |
| db-repos | server/src/db/repositories.ts |
| db-schema | server/src/db/schema.ts |
| server-models | server/src/types/models.ts |
| server-env | server/src/config/env.ts |
| client-entry | client/src/main.ts |
| client-router | client/src/router/index.ts |
| client-http | client/src/api/http.ts |
| client-api | client/src/api/gallery.ts |
| client-types | client/src/types/api.ts |

## Server Source (`server/src`)

- `server/src/app.ts`
- `server/src/config/env.ts`
- `server/src/constants/app-setting-keys.ts`
- `server/src/db/database.ts`
- `server/src/db/migration.ts`
- `server/src/db/repositories.ts`
- `server/src/db/schema-compat.ts`
- `server/src/db/schema.ts`
- `server/src/index.ts`
- `server/src/middleware/auth-protection.ts`
- `server/src/middleware/csrf-protection.ts`
- `server/src/middleware/public-demo-mode.ts`
- `server/src/middleware/rate-limit.ts`
- `server/src/middleware/response-compression.ts`
- `server/src/routes/api.ts`
- `server/src/routes/lazy-derivatives.ts`
- `server/src/routes/video-stream.ts`
- `server/src/scripts/migrate.ts`
- `server/src/scripts/rescan.ts`
- `server/src/services/auth-service.ts`
- `server/src/services/deletion-job-service.ts`
- `server/src/services/derivative-migration-service.ts`
- `server/src/services/derivative-service.ts`
- `server/src/services/folder-share-service.ts`
- `server/src/services/gallery-service.ts`
- `server/src/services/library-relocation-service.ts`
- `server/src/services/log-service.ts`
- `server/src/services/maintenance-operation-lock.ts`
- `server/src/services/permanent-deletion-service.ts`
- `server/src/services/place-service.ts`
- `server/src/services/post-share-service.ts`
- `server/src/services/scanner-service.ts`
- `server/src/services/storage-service.ts`
- `server/src/services/video-stream-service.ts`
- `server/src/services/watcher-service.ts`
- `server/src/types/models.ts`
- `server/src/utils/carousels-utils.ts`
- `server/src/utils/derivative-paths.ts`
- `server/src/utils/excluded-folder-rules.ts`
- `server/src/utils/exif-utils.ts`
- `server/src/utils/feed-rail-utils.ts`
- `server/src/utils/feed-utils.ts`
- `server/src/utils/folder-title-format.ts`
- `server/src/utils/gallery-root-utils.ts`
- `server/src/utils/image-utils.ts`
- `server/src/utils/media-paths.ts`
- `server/src/utils/media-response.ts`
- `server/src/utils/path-utils.ts`
- `server/src/utils/reels-utils.ts`
- `server/src/utils/scan-utils.ts`
- `server/src/utils/share-url.ts`
- `server/src/utils/slug.ts`
- `server/src/utils/stories-utils.ts`

## Client Source (`client/src`)

- `client/src/App.vue`
- `client/src/api/gallery.test.ts`
- `client/src/api/gallery.ts`
- `client/src/api/http.test.ts`
- `client/src/api/http.ts`
- `client/src/components/AdminUnlockDialog.vue`
- `client/src/components/AppShell.test.ts`
- `client/src/components/AppShell.vue`
- `client/src/components/AuthGate.vue`
- `client/src/components/Avatar.vue`
- `client/src/components/BrandMark.vue`
- `client/src/components/CarouselMediaStage.test.ts`
- `client/src/components/CarouselMediaStage.vue`
- `client/src/components/CollectionBookmark.test.ts`
- `client/src/components/CollectionBookmark.vue`
- `client/src/components/ConfirmDialog.vue`
- `client/src/components/EmptyState.vue`
- `client/src/components/ErrorState.vue`
- `client/src/components/ExploreGrid.test.ts`
- `client/src/components/ExploreGrid.vue`
- `client/src/components/FeedCard.test.ts`
- `client/src/components/FeedCard.vue`
- `client/src/components/FeedList.vue`
- `client/src/components/FolderGrid.test.ts`
- `client/src/components/FolderGrid.vue`
- `client/src/components/FolderHeader.test.ts`
- `client/src/components/FolderHeader.vue`
- `client/src/components/FolderProfileModal.vue`
- `client/src/components/FolderShareModal.test.ts`
- `client/src/components/FolderShareModal.vue`
- `client/src/components/ImmersiveDetailsPanel.vue`
- `client/src/components/ImmersiveImageLayer.vue`
- `client/src/components/ImmersiveLikeButton.test.ts`
- `client/src/components/ImmersiveLikeButton.vue`
- `client/src/components/ImmersiveVideoLayer.vue`
- `client/src/components/InfiniteLoader.test.ts`
- `client/src/components/InfiniteLoader.vue`
- `client/src/components/OrientationToggleIcon.vue`
- `client/src/components/PostCaptionModal.test.ts`
- `client/src/components/PostCaptionModal.vue`
- `client/src/components/PostViewer.test.ts`
- `client/src/components/PostViewer.vue`
- `client/src/components/ReelActionRail.test.ts`
- `client/src/components/ReelActionRail.vue`
- `client/src/components/ReelDeck.test.ts`
- `client/src/components/ReelDeck.vue`
- `client/src/components/ReelInfoSidebar.test.ts`
- `client/src/components/ReelInfoSidebar.vue`
- `client/src/components/ReelPlayerCard.test.ts`
- `client/src/components/ReelPlayerCard.vue`
- `client/src/components/ResilientImage.test.ts`
- `client/src/components/ResilientImage.vue`
- `client/src/components/SidebarNav.vue`
- `client/src/components/SkeletonCard.vue`
- `client/src/components/StoriesModal.test.ts`
- `client/src/components/StoriesModal.vue`
- `client/src/components/TopNav.vue`
- `client/src/components/VideoMediaPlayer.test.ts`
- `client/src/components/VideoMediaPlayer.vue`
- `client/src/components/VideoProgressFooter.test.ts`
- `client/src/components/VideoProgressFooter.vue`
- `client/src/composables/immersive-gesture-coordination.test.ts`
- `client/src/composables/useHoldToSpeed.test.ts`
- `client/src/composables/useHoldToSpeed.ts`
- `client/src/composables/useHorizontalSwipe.ts`
- `client/src/composables/useImageCaptionEditor.ts`
- `client/src/composables/useImmersiveMediaOpen.test.ts`
- `client/src/composables/useImmersiveMediaOpen.ts`
- `client/src/composables/useLandscapeStage.test.ts`
- `client/src/composables/useLandscapeStage.ts`
- `client/src/composables/usePinchZoom.test.ts`
- `client/src/composables/usePinchZoom.ts`
- `client/src/composables/usePostDeletion.ts`
- `client/src/composables/usePostShare.ts`
- `client/src/composables/usePullToRefresh.ts`
- `client/src/composables/useReelsLandscape.ts`
- `client/src/composables/useVerticalDismiss.test.ts`
- `client/src/composables/useVerticalDismiss.ts`
- `client/src/composables/useViewActivation.test.ts`
- `client/src/composables/useViewActivation.ts`
- `client/src/env.d.ts`
- `client/src/locales/index.ts`
- `client/src/locales/validation.test.ts`
- `client/src/main.ts`
- `client/src/router/index.test.ts`
- `client/src/router/index.ts`
- `client/src/stores/app.test.ts`
- `client/src/stores/app.ts`
- `client/src/stores/auth.test.ts`
- `client/src/stores/auth.ts`
- `client/src/stores/collections.test.ts`
- `client/src/stores/collections.ts`
- `client/src/stores/explore.ts`
- `client/src/stores/feed.test.ts`
- `client/src/stores/feed.ts`
- `client/src/stores/folder-stories.test.ts`
- `client/src/stores/folder-stories.ts`
- `client/src/stores/folders.ts`
- `client/src/stores/immersive-image.test.ts`
- `client/src/stores/immersive-image.ts`
- `client/src/stores/immersive-video.test.ts`
- `client/src/stores/immersive-video.ts`
- `client/src/stores/likes.test.ts`
- `client/src/stores/likes.ts`
- `client/src/stores/moments.test.ts`
- `client/src/stores/moments.ts`
- `client/src/stores/pinia.ts`
- `client/src/stores/places.test.ts`
- `client/src/stores/places.ts`
- `client/src/stores/reels.test.ts`
- `client/src/stores/reels.ts`
- `client/src/stores/share.ts`
- `client/src/stores/shared-video-surface.test.ts`
- `client/src/stores/shared-video-surface.ts`
- `client/src/stores/trash.test.ts`
- `client/src/stores/trash.ts`
- `client/src/stores/viewer.ts`
- `client/src/types/api.ts`
- `client/src/utils/caption.test.ts`
- `client/src/utils/caption.ts`
- `client/src/utils/explore.ts`
- `client/src/utils/folder-titles.test.ts`
- `client/src/utils/folder-titles.ts`
- `client/src/utils/fullscreen.ts`
- `client/src/utils/gesture-coordinates.ts`
- `client/src/utils/home-recommendations.ts`
- `client/src/utils/media-layout.ts`
- `client/src/utils/media.ts`
- `client/src/utils/original-media.ts`
- `client/src/utils/reels.ts`
- `client/src/utils/scan-progress.test.ts`
- `client/src/utils/scan-progress.ts`
- `client/src/utils/sidebar-folders.ts`
- `client/src/utils/video-playback.test.ts`
- `client/src/utils/video-playback.ts`
- `client/src/views/CollectionView.test.ts`
- `client/src/views/CollectionView.vue`
- `client/src/views/CollectionsView.test.ts`
- `client/src/views/CollectionsView.vue`
- `client/src/views/ExploreView.vue`
- `client/src/views/FolderView.vue`
- `client/src/views/HomeView.test.ts`
- `client/src/views/HomeView.vue`
- `client/src/views/LibraryView.vue`
- `client/src/views/LikesView.vue`
- `client/src/views/MomentView.vue`
- `client/src/views/PlaceView.vue`
- `client/src/views/PlacesView.vue`
- `client/src/views/PostView.test.ts`
- `client/src/views/PostView.vue`
- `client/src/views/ReelsView.test.ts`
- `client/src/views/ReelsView.vue`
- `client/src/views/SettingsView.test.ts`
- `client/src/views/SettingsView.vue`
- `client/src/views/SharedFolderView.test.ts`
- `client/src/views/SharedFolderView.vue`
- `client/src/views/SharedPostView.test.ts`
- `client/src/views/SharedPostView.vue`
- `client/src/views/SharedTokenPostView.vue`
- `client/src/views/TrashView.test.ts`
- `client/src/views/TrashView.vue`

## Server Tests (`server/test`)

- `server/test/admin-rate-limit.test.ts`
- `server/test/animated-avif-feed-support.test.ts`
- `server/test/animated-image-derivative.test.ts`
- `server/test/animated-image-feed-support.test.ts`
- `server/test/api-cache-control.test.ts`
- `server/test/auth-protection.test.ts`
- `server/test/auth-route-validation.test.ts`
- `server/test/auth-service.test.ts`
- `server/test/avif-support.test.ts`
- `server/test/carousel-deterministic-ordering.test.ts`
- `server/test/carousel-posts-feature.test.ts`
- `server/test/carousel-settings-coordination.test.ts`
- `server/test/collection-routes.test.ts`
- `server/test/collections.test.ts`
- `server/test/csrf-protection.test.ts`
- `server/test/deletion-batch-routes.test.ts`
- `server/test/deletion-job.test.ts`
- `server/test/derivative-layout-upgrade.test.ts`
- `server/test/env-config.test.ts`
- `server/test/excluded-folder-rules.test.ts`
- `server/test/excluded-folders-feature.test.ts`
- `server/test/exif-parse-tolerance.test.ts`
- `server/test/exif-utils.test.ts`
- `server/test/feed-rail-utils.test.ts`
- `server/test/feed-renderable-filter.test.ts`
- `server/test/feed-utils.test.ts`
- `server/test/folder-cover-scanner.test.ts`
- `server/test/folder-customization-scan-behavior.test.ts`
- `server/test/folder-customization.test.ts`
- `server/test/folder-share-routes.test.ts`
- `server/test/folder-share-service.test.ts`
- `server/test/gallery-delete.test.ts`
- `server/test/gallery-root-utils.test.ts`
- `server/test/highlight-rail.test.ts`
- `server/test/home-recommendations.test.ts`
- `server/test/http-test-utils.ts`
- `server/test/image-detail-source.test.ts`
- `server/test/image-orientation-backfill.test.ts`
- `server/test/image-orientation-derivative.test.ts`
- `server/test/image-utils.test.ts`
- `server/test/lazy-derivatives.test.ts`
- `server/test/library-rebuild.test.ts`
- `server/test/maintenance-operation-lock.test.ts`
- `server/test/media-layout.test.ts`
- `server/test/media-search.test.ts`
- `server/test/migration-bootstrap.test.ts`
- `server/test/moment-rail-localization-data.test.ts`
- `server/test/original-media-download.test.ts`
- `server/test/permanent-deletion.test.ts`
- `server/test/place-service.test.ts`
- `server/test/post-share-routes.test.ts`
- `server/test/public-demo-mode.test.ts`
- `server/test/recent-feed.test.ts`
- `server/test/reel-deck-utils.test.ts`
- `server/test/reels-feed.test.ts`
- `server/test/reels-utils.test.ts`
- `server/test/rescan-script.test.ts`
- `server/test/response-compression.test.ts`
- `server/test/scan-media-error-mode.test.ts`
- `server/test/scan-utils.test.ts`
- `server/test/search-carousel-dedup.test.ts`
- `server/test/setup.ts`
- `server/test/share-url.test.ts`
- `server/test/startup-behavior.test.ts`
- `server/test/stories-feature.test.ts`
- `server/test/thumbnail-rebuild.test.ts`
- `server/test/trash-flow.test.ts`
- `server/test/video-derivative-strategy.test.ts`
- `server/test/video-playback-strategy.test.ts`
- `server/test/video-stream-service.test.ts`
- `server/test/video-stream-warm-route.test.ts`
- `server/test/viewer-status.test.ts`
- `server/test/watcher-incremental-scan.test.ts`

## DB Migrations (`server/db/migrations`)

- `server/db/migrations/000001_baseline.sql`
- `server/db/migrations/000002_add_image_caption.sql`
- `server/db/migrations/000004_add_folder_shares.sql`
- `server/db/migrations/000005_add_posts_and_carousels.sql`
- `server/db/migrations/000006_add_post_shares.sql`

## Root Scripts (`scripts`)

- `scripts/ai-freeze-findings.sh`
- `scripts/ai-index-symbols.py`
- `scripts/ai-map.sh`
- `scripts/ai-refresh.sh`
- `scripts/ai-search.sh`
- `scripts/ai-symbol.sh`
- `scripts/install-ai-hooks.sh`
- `scripts/run-workspace-script.mjs`
