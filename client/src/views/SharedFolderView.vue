<template>
  <main class="min-h-screen bg-bg px-5 py-6 text-text sm:px-8 sm:py-8">
    <section class="mx-auto grid w-full max-w-[66rem] gap-6">
      <header class="flex items-center justify-between gap-4 border-b border-border pb-4">
        <RouterLink class="inline-flex items-center gap-2 text-text no-underline" :to="{ name: 'home' }">
          <span class="i-fluent-folder-24-filled h-6 w-6 text-accent" aria-hidden="true" />
          <span class="text-[1rem] font-semibold tracking-[-0.02em]">Foldergram</span>
        </RouterLink>
      </header>

      <section v-if="shareStore.access?.granted && shareStore.folder" class="grid gap-6">
        <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-6 max-sm:grid-cols-1 max-sm:text-center">
          <div class="grid place-items-center">
            <Avatar class="h-[7.25rem] w-[7.25rem]" :name="displayFolderTitle" :src="shareStore.folder.avatarThumbnailUrl" />
          </div>
          <div class="grid gap-3">
            <h1 class="m-0 text-[clamp(1.6rem,3vw,2.15rem)] font-semibold tracking-[-0.04em]">{{ displayFolderTitle }}</h1>
            <p v-if="shareStore.folder.description" class="m-0 max-w-[36rem] whitespace-pre-wrap text-[0.96rem] leading-[1.45] text-muted max-sm:mx-auto">
              {{ shareStore.folder.description }}
            </p>
            <div class="flex flex-wrap gap-4 text-[0.92rem] text-muted max-sm:justify-center">
              <span>{{ t('folder.header.posts', { count: shareStore.folder.imageCount }) }}</span>
              <span>{{ t('folder.header.reels', { count: shareStore.folder.videoCount }) }}</span>
            </div>
          </div>
        </div>

        <EmptyState
          v-if="!shareStore.loading && shareStore.images.length === 0"
          :title="t('share.emptyTitle')"
          :description="t('share.emptyDescription')"
        />
        <section v-else class="grid gap-5">
          <FolderGrid :items="shareStore.images" variant="posts" :shared-slug="slug" />
          <InfiniteLoader :loading="shareStore.loading" :has-more="shareStore.hasMore" @load-more="loadMore" />
        </section>
      </section>

      <section
        v-else-if="isAccessPending || shareStore.loading || shareStore.unlocking"
        class="mx-auto grid w-[min(100%,28rem)] gap-3 rounded-[1rem] border border-border bg-surface p-7 text-center"
      >
        <p class="m-0 text-[0.78rem] font-bold uppercase tracking-[0.08em] text-accent-strong">{{ t('share.loadingEyebrow') }}</p>
        <h1 class="m-0 text-[1.45rem] font-semibold tracking-[-0.04em]">{{ t('share.loadingTitle') }}</h1>
      </section>

      <section
        v-else-if="shareStore.access?.hasPassword"
        class="mx-auto grid w-[min(100%,28rem)] gap-4 rounded-[1rem] border border-border bg-surface p-7"
      >
        <div class="grid gap-2 text-center">
          <p class="m-0 text-[0.78rem] font-bold uppercase tracking-[0.08em] text-accent-strong">{{ t('share.passwordEyebrow') }}</p>
          <h1 class="m-0 text-[1.45rem] font-semibold tracking-[-0.04em]">{{ t('share.passwordTitle') }}</h1>
          <p class="m-0 text-[0.88rem] leading-relaxed text-muted">
            {{ t(linkUnlockFailed ? 'share.passwordFallbackDescription' : 'share.passwordDescription') }}
          </p>
        </div>
        <form class="grid gap-3" @submit.prevent="unlockPassword">
          <label class="grid gap-[0.35rem] text-[0.85rem] font-semibold">
            {{ t('share.passwordLabel') }}
            <input
              v-model="password"
              class="min-h-11 rounded-[0.8rem] border border-border bg-bg px-3 text-text outline-none focus:border-text"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>
          <p v-if="shareStore.unlockError && !linkUnlockFailed" class="m-0 rounded-[0.85rem] border border-[rgba(214,48,49,0.24)] bg-[rgba(214,48,49,0.08)] px-3 py-2 text-[0.84rem] text-[#c0392b]">
            {{ shareStore.unlockError }}
          </p>
          <button
            class="min-h-11 rounded-[0.8rem] border border-transparent bg-text px-4 font-semibold text-bg disabled:cursor-wait disabled:opacity-70"
            type="submit"
            :disabled="shareStore.unlocking"
          >
            {{ shareStore.unlocking ? t('share.unlocking') : t('share.unlock') }}
          </button>
        </form>
      </section>

      <ErrorState
        v-else
        class="mx-auto w-[min(100%,34rem)]"
        :title="shareStore.error ? t('share.errorTitle') : t('share.expiredTitle')"
        :message="shareStore.error ?? t('share.expiredDescription')"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import Avatar from '../components/Avatar.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FolderGrid from '../components/FolderGrid.vue';
import InfiniteLoader from '../components/InfiniteLoader.vue';
import { useShareStore } from '../stores/share';

const props = defineProps<{
  slug: string;
}>();

const { t } = useI18n();
const shareStore = useShareStore();
const password = ref('');
const linkUnlockFailed = ref(false);
const displayFolderTitle = computed(() => (shareStore.folder ? shareStore.folder.name : t('share.fallbackTitle')));
const isAccessPending = computed(() => shareStore.access === null && !shareStore.error);

function extractFragmentToken(): string | null {
  if (typeof window === 'undefined' || !window.location.hash) {
    return null;
  }

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('token');
}

function clearFragmentToken() {
  if (typeof window === 'undefined' || !window.location.hash) {
    return;
  }

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

async function initializeShare() {
  shareStore.reset();
  linkUnlockFailed.value = false;
  const token = extractFragmentToken();

  if (token) {
    try {
      await shareStore.unlockLink(props.slug, token);
    } catch {
      linkUnlockFailed.value = true;
    } finally {
      clearFragmentToken();
    }
  }

  try {
    await shareStore.loadAccess(props.slug);
  } catch (error) {
    shareStore.error = error instanceof Error ? error.message : t('share.errorDescription');
    return;
  }

  if (shareStore.access?.granted) {
    await shareStore.loadFolder(props.slug, true);
  }
}

async function loadMore() {
  if (shareStore.hasMore) {
    await shareStore.loadFolder(props.slug, false);
  }
}

async function unlockPassword() {
  linkUnlockFailed.value = false;

  try {
    await shareStore.unlockPassword(props.slug, password.value);
    password.value = '';

    if (shareStore.access?.granted) {
      await shareStore.loadFolder(props.slug, true);
    }
  } catch {
    // The store-owned error is rendered under the password field.
  }
}

onMounted(initializeShare);

watch(
  () => props.slug,
  async () => {
    password.value = '';
    await initializeShare();
  }
);
</script>
