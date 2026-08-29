<template>
  <aside
    class="reels-info-sidebar sidebar"
    :class="{
      'reels-info-sidebar--anchor-right': anchor === 'right',
      'reels-info-sidebar--sheet': variant === 'sheet'
    }"
    :aria-label="t('reels.info.ariaLabel')"
    :style="sheetStyle"
    @pointercancel="dismiss.onPointercancel"
    @pointerdown="onSheetPointerdown"
    @pointermove="dismiss.onPointermove"
    @pointerup="dismiss.onPointerup"
  >
    <div v-if="variant === 'sheet'" class="reels-info-sidebar__grabber" aria-hidden="true" />

    <div class="reels-info-sidebar__header">
      <p class="reels-info-sidebar__eyebrow">{{ t('reels.info.eyebrow') }}</p>

      <button
        class="reels-info-sidebar__close"
        type="button"
        :aria-label="t('reels.info.hideDetails')"
        @click="$emit('close')"
      >
        <svg class="reels-info-sidebar__close-icon" viewBox="0 0 24 24" role="presentation">
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
    </div>

    <div class="reels-info-sidebar__folder-row">
      <RouterLink
        class="reels-info-sidebar__folder-link"
        :to="{ name: 'folder', params: { slug: item.folderSlug } }"
        :aria-label="t('reels.info.openFolder')"
        :title="t('reels.info.openFolder')"
      >
        <Avatar
          class="reels-info-sidebar__avatar"
          :name="displayFolderTitle"
          :src="folder?.avatarUrl ?? null"
        />
        <div class="min-w-0">
          <p class="reels-info-sidebar__folder-name">
            {{ displayFolderTitle }}
          </p>
          <p class="reels-info-sidebar__folder-breadcrumb">
            {{ folderBreadcrumb }}
          </p>
        </div>
      </RouterLink>

      <span class="reels-info-sidebar__date">{{ formattedDate }}</span>
    </div>

    <p class="reels-info-sidebar__caption">{{ caption }}</p>

    <dl class="reels-info-sidebar__stats">
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">{{ t('reels.info.resolution') }}</dt>
        <dd class="reels-info-sidebar__stat-value">{{ dimensionsLabel }}</dd>
      </div>
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">{{ t('reels.info.length') }}</dt>
        <dd class="reels-info-sidebar__stat-value">{{ durationLabel }}</dd>
      </div>
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">{{ t('reels.info.size') }}</dt>
        <dd class="reels-info-sidebar__stat-value">{{ fileSizeLabel }}</dd>
      </div>
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">{{ t('reels.info.format') }}</dt>
        <dd class="reels-info-sidebar__stat-value">{{ formatLabel }}</dd>
      </div>
    </dl>

    <p
      v-if="loading"
      class="reels-info-sidebar__notice"
      role="status"
      aria-live="polite"
    >
      {{ t('reels.info.loading') }}
    </p>
    <p v-else-if="error" class="reels-info-sidebar__notice reels-info-sidebar__notice--error" role="status">
      {{ error }}
    </p>

    <dl class="reels-info-sidebar__meta">
      <div class="reels-info-sidebar__meta-item">
        <dt class="reels-info-sidebar__meta-label">{{ t('reels.info.folderPath') }}</dt>
        <dd class="reels-info-sidebar__meta-value">{{ item.folderPath }}</dd>
      </div>

      <div v-if="mimeLabel" class="reels-info-sidebar__meta-item">
        <dt class="reels-info-sidebar__meta-label">{{ t('reels.info.mimeType') }}</dt>
        <dd class="reels-info-sidebar__meta-value">{{ mimeLabel }}</dd>
      </div>
    </dl>

    <button
      v-if="deletion.canDelete.value"
      class="reels-info-sidebar__delete"
      type="button"
      data-test="reel-delete"
      :disabled="deletion.isDeleting.value"
      @click="handleDelete"
    >
      <span class="reels-info-sidebar__delete-icon i-fluent-delete-20-regular" aria-hidden="true" />
      <span>{{ t('reels.info.deleteVideo') }}</span>
    </button>

    <p v-if="deletion.error.value" class="reels-info-sidebar__delete-error" role="status">
      {{ deletion.error.value }}
    </p>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import { fetchImage } from '../api/gallery';
import { usePostDeletion } from '../composables/usePostDeletion';
import { useVerticalDismiss } from '../composables/useVerticalDismiss';
import { useAppStore } from '../stores/app';
import type { FeedItem, FolderSummary, ImageDetail } from '../types/api';
import { resolveDisplayCaption } from '../utils/caption';
import { formatFolderTitle } from '../utils/folder-titles';
import { formatMediaDuration } from '../utils/media';
import Avatar from './Avatar.vue';

const props = withDefaults(defineProps<{
  item: FeedItem;
  folder: FolderSummary | null;
  open: boolean;
  anchor?: 'left' | 'right';
  /** `sheet` is the phone presentation: a bottom sheet with a grabber and swipe-to-close. */
  variant?: 'panel' | 'sheet';
}>(), {
  anchor: 'left',
  variant: 'panel'
});

const emit = defineEmits<{
  close: [];
}>();

const { t, locale } = useI18n();
const appStore = useAppStore();
const detail = ref<ImageDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const detailCache = new Map<number, ImageDetail>();
const deletion = usePostDeletion();
let requestToken = 0;

// Swipe-down to close, so the sheet behaves the way a phone sheet is expected to.
const dismiss = useVerticalDismiss({
  canStart: (event) =>
    props.variant === 'sheet' &&
    !(event.target instanceof Element && event.target.closest('button, a, input, label')),
  minDistance: 72,
  onDismiss: (direction) => {
    if (direction === 'down') {
      emit('close');
    }
  }
});

function onSheetPointerdown(event: PointerEvent) {
  if (props.variant !== 'sheet') {
    return;
  }

  dismiss.onPointerdown(event);
}

const sheetStyle = computed(() => {
  if (props.variant !== 'sheet' || !dismiss.isDragging.value || dismiss.dragOffset.value <= 0) {
    return undefined;
  }

  // Only downward travel follows the finger; dragging up must not lift the sheet off
  // the bottom edge.
  return { transform: `translateY(${Math.min(dismiss.dragOffset.value, 420)}px)` };
});

// Straight to the Trash, no dialog: the Trash view is the undo, and permanent
// deletion still asks first from the feed card.
async function handleDelete() {
  const deleted = await deletion.trashNow(props.item);
  if (deleted) {
    // The reel is gone, so the panel that described it has nothing left to show.
    emit('close');
  }
}

const hasExplicitItemCaption = computed(() => Object.hasOwn(props.item, 'caption'));
const caption = computed(() =>
  resolveDisplayCaption({
    filename: props.item.filename,
    caption: hasExplicitItemCaption.value ? props.item.caption ?? null : detail.value?.caption,
    postType: props.item.postType,
    sourcePath: props.item.sourcePath,
    carouselTitle: props.item.carouselTitle
  })
);
const formattedDate = computed(() =>
  new Date(detail.value?.takenAt ?? detail.value?.sortTimestamp ?? props.item.takenAt ?? props.item.sortTimestamp).toLocaleDateString(
    locale.value,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }
  )
);
const folderBreadcrumb = computed(
  () => props.folder?.breadcrumb ?? detail.value?.folderBreadcrumb ?? props.item.folderBreadcrumb ?? t('reels.info.topLevelSourceFolder')
);
const displayFolderTitle = computed(() => formatFolderTitle(props.folder ?? props.item, appStore.nestedFolderTitleFormat));
const dimensionsLabel = computed(() => `${detail.value?.width ?? props.item.width} x ${detail.value?.height ?? props.item.height}`);
const durationLabel = computed(() => formatMediaDuration(detail.value?.durationMs ?? props.item.durationMs) || t('reels.info.unavailable'));
const formatLabel = computed(() => {
  if (!detail.value?.mimeType) {
    return t('reels.info.video');
  }

  return detail.value.mimeType.replace(/^video\//, '').toUpperCase();
});
const fileSizeLabel = computed(() => {
  if (!detail.value) {
    return loading.value ? t('common.loading') : t('reels.info.unavailable');
  }

  return `${(detail.value.fileSize / (1024 * 1024)).toFixed(2)} MB`;
});
const mimeLabel = computed(() => detail.value?.mimeType ?? null);

watch(
  () => [props.open, props.item.id] as const,
  ([open, itemId]) => {
    requestToken += 1;
    const currentToken = requestToken;

    if (!open) {
      detail.value = detailCache.get(itemId) ?? null;
      loading.value = false;
      error.value = null;
      return;
    }

    const cachedDetail = detailCache.get(itemId);
    if (cachedDetail) {
      detail.value = cachedDetail;
      loading.value = false;
      error.value = null;
      return;
    }

    detail.value = null;
    loading.value = true;
    error.value = null;

    void (async () => {
      try {
        const loadedDetail = await fetchImage(itemId, 'video');
        if (currentToken !== requestToken) {
          return;
        }

        detailCache.set(itemId, loadedDetail);
        detail.value = loadedDetail;
      } catch (loadError) {
        if (currentToken !== requestToken) {
          return;
        }

        detail.value = null;
        error.value = loadError instanceof Error ? loadError.message : t('reels.info.loadError');
      } finally {
        if (currentToken === requestToken) {
          loading.value = false;
        }
      }
    })();
  },
  { immediate: true }
);
</script>

<style scoped>
.reels-info-sidebar {
  position: relative;
  width: min(22rem, calc(100vw - 8rem));
  max-height: min(34rem, calc(100vh - 2rem));
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  border-radius: 1.35rem;
  background: color-mix(in srgb, var(--surface) 96%, white 4%);
  box-shadow: 0 22px 48px rgba(15, 20, 25, 0.18);
  overflow-y: auto;
}

.reels-info-sidebar::before {
  content: '';
  position: absolute;
  bottom: 1.45rem;
  left: -0.5rem;
  width: 1rem;
  height: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  border-left: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  background: color-mix(in srgb, var(--surface) 96%, white 4%);
  transform: rotate(45deg);
}

.reels-info-sidebar--anchor-right::before {
  right: -0.5rem;
  left: auto;
  border-right: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  border-left: 0;
}

/* Phone presentation: a bottom sheet anchored to the safe area, so the delete button
   is always inside the sheet instead of being covered by the action rail. */
.reels-info-sidebar--sheet {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 80;
  width: auto;
  max-height: 78dvh;
  padding: 0.4rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  border-radius: 1.35rem 1.35rem 0 0;
  box-shadow: 0 -18px 48px rgba(15, 20, 25, 0.32);
  overscroll-behavior: contain;
  touch-action: pan-y;
}

.reels-info-sidebar--sheet::before {
  content: none;
}

.reels-info-sidebar__grabber {
  width: 2.6rem;
  height: 0.25rem;
  margin: 0.15rem auto 0.6rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 70%, transparent 30%);
}

.reels-info-sidebar__delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: 100%;
  min-height: 2.5rem;
  margin-top: 0.9rem;
  padding: 0 0.9rem;
  border: 1px solid rgba(217, 48, 37, 0.28);
  border-radius: 0.85rem;
  background: rgba(217, 48, 37, 0.08);
  color: #d93025;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.reels-info-sidebar__delete:disabled {
  cursor: wait;
  opacity: 0.7;
}

.reels-info-sidebar__delete-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.reels-info-sidebar__delete-option {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-top: 0.75rem;
  cursor: pointer;
  user-select: none;
}

.reels-info-sidebar__delete-option-title {
  display: block;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text);
}

.reels-info-sidebar__delete-option-hint {
  display: block;
  margin-top: 0.18rem;
  font-size: 0.84rem;
  color: var(--muted);
}

.reels-info-sidebar__delete-error {
  margin: 0.75rem 0 0;
  padding: 0.8rem 0.75rem;
  border: 1px solid rgba(217, 48, 37, 0.24);
  border-radius: 0.9rem;
  background: rgba(217, 48, 37, 0.08);
  font-size: 0.84rem;
  color: #b42318;
}

.reels-info-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.reels-info-sidebar__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.3rem;
  height: 2.3rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-alt) 82%, var(--surface) 18%);
  color: var(--text);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    opacity 0.16s ease,
    background-color 0.16s ease;
}

.reels-info-sidebar__close:hover {
  transform: translateY(-1px);
  opacity: 0.92;
  background: color-mix(in srgb, var(--surface-alt) 74%, var(--surface) 26%);
}

.reels-info-sidebar__eyebrow {
  margin: 0;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text);
}

.reels-info-sidebar__close-icon {
  width: 1rem;
  height: 1rem;
}

.reels-info-sidebar__folder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  margin-top: 1rem;
}

.reels-info-sidebar__folder-link {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}

.reels-info-sidebar__avatar {
  width: 2.65rem;
  height: 2.65rem;
  flex-shrink: 0;
}

.reels-info-sidebar__folder-name {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reels-info-sidebar__folder-breadcrumb {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reels-info-sidebar__date {
  flex-shrink: 0;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--muted);
}

.reels-info-sidebar__caption {
  margin: 0;
  margin-top: 0.95rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--text);
  word-break: break-word;
}

.reels-info-sidebar__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 1rem 0 0;
}

.reels-info-sidebar__stat {
  min-width: 0;
  padding: 0.85rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent 16%);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--surface-alt) 82%, var(--surface) 18%);
}

.reels-info-sidebar__stat-label,
.reels-info-sidebar__meta-label {
  margin: 0;
  margin-bottom: 0.28rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}

.reels-info-sidebar__stat-value,
.reels-info-sidebar__meta-value {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.45;
  color: var(--text);
  word-break: break-word;
}

.reels-info-sidebar__notice {
  margin: 1rem 0 0;
  padding: 0.85rem 0.95rem;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent 16%);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--surface-alt) 76%, var(--surface) 24%);
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--muted);
}

.reels-info-sidebar__notice--error {
  border-color: rgba(208, 48, 37, 0.2);
  background: rgba(208, 48, 37, 0.08);
  color: #b3261e;
}

.reels-info-sidebar__meta {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0 0;
}

.reels-info-sidebar__meta-item {
  padding: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent 16%);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--surface-alt) 74%, var(--surface) 26%);
}

@media (max-width: 1100px) {
  .reels-info-sidebar {
    width: min(20rem, calc(100vw - 8rem));
  }
}

@media (max-width: 900px) {
  .reels-info-sidebar {
    width: min(18.5rem, calc(100vw - 7rem));
  }
}
</style>
