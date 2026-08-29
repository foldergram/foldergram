<template>
  <section class="immersive-details" data-swipe-ignore="true" @click.stop>
    <header class="immersive-details__header">
      <p class="immersive-details__title">{{ filename }}</p>
      <button
        class="immersive-details__close"
        type="button"
        :aria-label="t('post.immersive.hideDetails')"
        :title="t('post.immersive.hideDetails')"
        @click="emit('close')"
      >
        <span class="i-fluent-dismiss-20-regular immersive-details__close-icon" aria-hidden="true" />
      </button>
    </header>

    <dl class="immersive-details__stats">
      <div class="immersive-details__stat">
        <dt>{{ t('reels.info.resolution') }}</dt>
        <dd>{{ dimensionsLabel }}</dd>
      </div>
      <div v-if="mediaType === 'video'" class="immersive-details__stat">
        <dt>{{ t('reels.info.length') }}</dt>
        <dd>{{ durationLabel }}</dd>
      </div>
      <div class="immersive-details__stat">
        <dt>{{ t('reels.info.size') }}</dt>
        <dd>{{ fileSizeLabel }}</dd>
      </div>
      <div class="immersive-details__stat">
        <dt>{{ t('reels.info.format') }}</dt>
        <dd>{{ formatLabel }}</dd>
      </div>
    </dl>

    <p class="immersive-details__path">{{ detail?.folderPath ?? '' }}</p>

    <p v-if="error" class="immersive-details__error" role="status">{{ error }}</p>

    <button
      v-if="deletion.canDelete.value"
      class="immersive-details__delete"
      type="button"
      :disabled="deletion.isDeleting.value"
      @click="deletion.requestDelete()"
    >
      <span class="i-fluent-delete-20-regular immersive-details__delete-icon" aria-hidden="true" />
      <span>{{ t('post.immersive.deleteVideo') }}</span>
    </button>

    <ConfirmDialog
      v-if="deletion.isConfirmOpen.value"
      :title="t('post.feedCard.delete.title')"
      :message="deletion.dialogMessage.value"
      :confirm-label="deletion.dialogConfirmLabel.value"
      :loading="deletion.isDeleting.value"
      @cancel="deletion.cancelDelete()"
      @confirm="handleDeleteConfirm"
    >
      <template #details>
        <label class="immersive-details__delete-option">
          <input
            v-model="deletion.deleteOriginalFromDisk.value"
            type="checkbox"
            :disabled="deletion.isDeleting.value"
          />
          <span>
            <span class="immersive-details__delete-option-title">{{ t('post.feedCard.delete.deleteOriginalLabel') }}</span>
            <span class="immersive-details__delete-option-hint">{{ t('post.feedCard.delete.deleteOriginalDescription') }}</span>
          </span>
        </label>
        <p v-if="deletion.error.value" class="immersive-details__error">{{ deletion.error.value }}</p>
      </template>
    </ConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { fetchImage } from '../api/gallery';
import { usePostDeletion } from '../composables/usePostDeletion';
import type { ImageDetail } from '../types/api';
import { formatMediaDuration } from '../utils/media';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{
  id: number;
  mediaType: 'image' | 'video';
  filename: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}>();

const emit = defineEmits<{
  close: [];
  deleted: [id: number];
}>();

const { t } = useI18n();
const detail = ref<ImageDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const deletion = usePostDeletion();

let requestToken = 0;

const dimensionsLabel = computed(() => {
  const width = detail.value?.width ?? props.width ?? 0;
  const height = detail.value?.height ?? props.height ?? 0;
  return width > 0 && height > 0 ? `${width} x ${height}` : t('reels.info.unavailable');
});
const durationLabel = computed(
  () => formatMediaDuration(detail.value?.durationMs ?? props.durationMs ?? null) || t('reels.info.unavailable')
);
const fileSizeLabel = computed(() => {
  if (!detail.value) {
    return loading.value ? t('common.loading') : t('reels.info.unavailable');
  }

  return `${(detail.value.fileSize / (1024 * 1024)).toFixed(2)} MB`;
});
const formatLabel = computed(() => {
  const mimeType = detail.value?.mimeType;
  if (!mimeType) {
    return t('reels.info.unavailable');
  }

  return mimeType.replace(/^(video|image)\//, '').toUpperCase();
});

async function handleDeleteConfirm() {
  const deleted = await deletion.confirmDelete({ id: props.id, mediaType: props.mediaType });
  if (deleted) {
    emit('deleted', props.id);
  }
}

watch(
  () => props.id,
  (id) => {
    requestToken += 1;
    const currentToken = requestToken;
    detail.value = null;
    loading.value = true;
    error.value = null;

    void (async () => {
      try {
        const loaded = await fetchImage(id, props.mediaType);
        if (currentToken !== requestToken) return;
        detail.value = loaded;
      } catch (loadError) {
        if (currentToken !== requestToken) return;
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
.immersive-details {
  width: min(22rem, calc(100vw - 2rem));
  padding: 0.9rem 1rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 1.1rem;
  background: rgba(18, 20, 26, 0.94);
  color: rgba(255, 255, 255, 0.92);
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.42);
}

.immersive-details__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.immersive-details__title {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 0.92rem;
  font-weight: 600;
}

.immersive-details__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  cursor: pointer;
}

.immersive-details__close-icon {
  width: 1.05rem;
  height: 1.05rem;
}

.immersive-details__stats {
  display: grid;
  gap: 0.4rem 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0.85rem 0 0;
}

.immersive-details__stat dt {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0;
  color: rgba(255, 255, 255, 0.55);
}

.immersive-details__stat dd {
  margin: 0.1rem 0 0;
  font-size: 0.88rem;
  font-weight: 600;
}

.immersive-details__path {
  margin: 0.75rem 0 0;
  overflow-wrap: anywhere;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.6);
}

.immersive-details__error {
  margin: 0.75rem 0 0;
  font-size: 0.82rem;
  color: #ff8a80;
}

.immersive-details__delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: 100%;
  min-height: 2.5rem;
  margin-top: 0.9rem;
  padding: 0 0.9rem;
  border: 1px solid rgba(255, 107, 107, 0.36);
  border-radius: 0.85rem;
  background: rgba(217, 48, 37, 0.18);
  color: #ff8a80;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.immersive-details__delete:disabled {
  cursor: wait;
  opacity: 0.7;
}

.immersive-details__delete-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.immersive-details__delete-option {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-top: 0.75rem;
  cursor: pointer;
  user-select: none;
  color: var(--text);
}

.immersive-details__delete-option-title {
  display: block;
  font-size: 0.92rem;
  font-weight: 600;
}

.immersive-details__delete-option-hint {
  display: block;
  margin-top: 0.18rem;
  font-size: 0.84rem;
  color: var(--muted);
}
</style>
