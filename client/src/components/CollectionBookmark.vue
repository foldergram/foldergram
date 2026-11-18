<template>
  <div
    v-if="canUseCollections"
    ref="rootElement"
    class="collection-bookmark"
    :class="[`collection-bookmark--${placement}`, { 'collection-bookmark--open': popoverOpen }]"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
    @pointerenter="handlePointerEnter"
    @pointerleave="handlePointerLeave"
    @keydown.esc.stop.prevent="closePopover"
  >
    <button
      ref="buttonElement"
      class="collection-bookmark__button"
      :class="{ 'collection-bookmark__button--saved': isSaved }"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="popoverOpen"
      :aria-label="buttonLabel"
      :title="buttonLabel"
      :disabled="collectionsStore.isPending(item.id)"
      @click.stop="handleBookmarkClick"
      @pointerdown="handlePointerDown"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerCancel"
    >
      <span
        class="collection-bookmark__icon"
        :class="isSaved ? 'i-fluent-bookmark-20-filled' : 'i-fluent-bookmark-20-regular'"
        aria-hidden="true"
      />
    </button>

    <Teleport to="body">
      <div
        v-if="popoverOpen"
        ref="popoverElement"
        class="collection-bookmark__popover"
        :data-placement="popoverPlacement"
        :style="popoverStyle"
        role="dialog"
        :aria-label="t('collections.bookmark.dialogLabel')"
        @click.stop
        @focusout="handleFocusOut"
        @keydown.esc.stop.prevent="closePopover"
        @pointerenter="handlePointerEnter"
        @pointerleave="handlePointerLeave"
      >
        <div class="collection-bookmark__header">
          <strong>{{ t('collections.bookmark.title') }}</strong>
          <button
            class="collection-bookmark__create-button"
            type="button"
            :aria-label="t('collections.bookmark.createCollection')"
            :title="t('collections.bookmark.createCollection')"
            @click="startCreating"
          >
            <span class="i-fluent-add-16-filled" aria-hidden="true" />
          </button>
        </div>

        <form v-if="creating" class="collection-bookmark__create" @submit.prevent="submitCreate">
          <input
            ref="createInputElement"
            v-model="collectionName"
            class="collection-bookmark__input"
            type="text"
            maxlength="80"
            :placeholder="t('collections.bookmark.namePlaceholder')"
            @keydown.esc.stop.prevent="cancelCreating"
          />
          <button class="collection-bookmark__submit" type="submit" :disabled="creatingCollection">
            <span class="i-fluent-checkmark-16-filled" aria-hidden="true" />
          </button>
        </form>

        <p v-if="localError" class="collection-bookmark__error">{{ localError }}</p>
        <p v-else-if="collectionsStore.error" class="collection-bookmark__error">{{ collectionsStore.error }}</p>

        <div class="collection-bookmark__rows">
          <p v-if="customMemberships.length === 0" class="collection-bookmark__empty">{{ t('collections.bookmark.empty') }}</p>
          <button
            v-for="collection in customMemberships"
            :key="collection.slug"
            class="collection-bookmark__row"
            type="button"
            :disabled="collectionsStore.isCollectionPending(collection.slug, item.id)"
            @click="toggleCollection(collection.slug)"
          >
            <span class="collection-bookmark__cover">
              <ResilientImage
                v-if="collection.coverImage"
                :src="collection.coverImage.thumbnailUrl"
                :alt="displayCollectionName(collection)"
                loading="lazy"
              />
            </span>
            <span class="collection-bookmark__name">{{ displayCollectionName(collection) }}</span>
            <span
              v-if="collection.containsImage"
              class="collection-bookmark__check i-fluent-checkmark-16-filled"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAuthStore } from '../stores/auth';
import { useCollectionsStore } from '../stores/collections';
import type { CollectionSummary, FeedItem, ImageDetail } from '../types/api';
import ResilientImage from './ResilientImage.vue';

const props = defineProps<{
  item: FeedItem | ImageDetail;
  placement: 'feed' | 'viewer' | 'reels';
}>();

const { t } = useI18n();
const authStore = useAuthStore();
const collectionsStore = useCollectionsStore();
const rootElement = ref<HTMLElement | null>(null);
const buttonElement = ref<HTMLButtonElement | null>(null);
const popoverElement = ref<HTMLElement | null>(null);
const createInputElement = ref<HTMLInputElement | null>(null);
const popoverOpen = ref(false);
const popoverPlacement = ref<'top' | 'bottom' | 'left'>('top');
const popoverStyle = ref<Record<string, string>>({});
const creating = ref(false);
const creatingCollection = ref(false);
const collectionName = ref('');
const localError = ref<string | null>(null);
const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const suppressNextClick = ref(false);
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const popoverViewportMargin = 12;
const popoverGap = 10;
const popoverOpenDelayMs = 1000;
const popoverMinHeightPx = 116;
const popoverPreferredMaxHeightPx = 324;
const popoverArrowEdgePaddingPx = 20;

const canUseCollections = computed(() => authStore.canUseSharedCollections || authStore.canUseLocalCollections);
const isSaved = computed(() => collectionsStore.isSaved(props.item.id));
const buttonLabel = computed(() =>
  isSaved.value ? t('collections.bookmark.removeSavedPost') : t('collections.bookmark.savePost')
);
const memberships = computed(() => collectionsStore.membershipByImageId[props.item.id]?.items ?? collectionsStore.items.map((collection) => ({
  ...collection,
  containsImage: collection.isDefault && isSaved.value
})));
const customMemberships = computed(() => memberships.value.filter((collection) => !collection.isDefault));

watch(
  () => props.item,
  (item) => {
    collectionsStore.syncSavedState(item);
  },
  {
    immediate: true
  }
);

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function clearOpenTimer() {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
}

function scheduleOpen() {
  clearCloseTimer();
  if (popoverOpen.value || openTimer) {
    return;
  }

  openTimer = setTimeout(() => {
    openTimer = null;
    void openPopover();
  }, popoverOpenDelayMs);
}

function scheduleClose() {
  clearCloseTimer();
  closeTimer = setTimeout(() => {
    if (!creating.value) {
      popoverOpen.value = false;
    }
  }, 180);
}

async function openPopover() {
  clearOpenTimer();
  clearCloseTimer();
  popoverOpen.value = true;
  localError.value = null;
  await nextTick();
  updatePopoverPosition();
  await collectionsStore.fetchMembership(props.item.id).catch((error) => {
    localError.value = error instanceof Error ? error.message : t('collections.bookmark.errors.loadCollections');
  });
  await nextTick();
  updatePopoverPosition();
}

function closePopover() {
  clearOpenTimer();
  clearCloseTimer();
  popoverOpen.value = false;
  popoverPlacement.value = 'top';
  popoverStyle.value = {};
  creating.value = false;
  localError.value = null;
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function updatePopoverPosition() {
  const button = buttonElement.value;
  const popover = popoverElement.value;
  if (!button || !popover) {
    return;
  }

  const buttonRect = button.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const measuredWidth = popoverRect.width || popover.offsetWidth;
  const measuredHeight = popoverRect.height || popover.offsetHeight || popoverPreferredMaxHeightPx;

  const leftOfButton = buttonRect.left - measuredWidth - popoverGap;
  if (props.placement === 'reels' && window.innerWidth > 768 && leftOfButton >= popoverViewportMargin) {
    const maxHeight = Math.min(window.innerHeight - 2 * popoverViewportMargin, popoverPreferredMaxHeightPx);
    const height = Math.min(measuredHeight, maxHeight);
    const buttonCenter = buttonRect.top + buttonRect.height / 2;
    const top = clamp(buttonCenter - height / 2, popoverViewportMargin, window.innerHeight - height - popoverViewportMargin);
    const arrowTop = clamp(buttonCenter - top, popoverArrowEdgePaddingPx, height - popoverArrowEdgePaddingPx);

    popoverPlacement.value = 'left';
    popoverStyle.value = {
      '--collection-bookmark-arrow-top': `${Math.round(arrowTop)}px`,
      left: `${Math.round(leftOfButton)}px`,
      top: `${Math.round(top)}px`,
      minHeight: `${Math.min(popoverMinHeightPx, Math.round(maxHeight))}px`,
      maxHeight: `${Math.round(maxHeight)}px`
    };
    return;
  }

  const availableAbove = Math.max(buttonRect.top - popoverViewportMargin - popoverGap, 0);
  const availableBelow = Math.max(window.innerHeight - buttonRect.bottom - popoverViewportMargin - popoverGap, 0);
  const nextPlacement = availableAbove >= measuredHeight || availableAbove >= availableBelow ? 'top' : 'bottom';
  const availableHeight = nextPlacement === 'top' ? availableAbove : availableBelow;
  const maxHeight = availableHeight >= popoverMinHeightPx
    ? Math.min(availableHeight, popoverPreferredMaxHeightPx)
    : Math.max(availableHeight, popoverMinHeightPx);
  const constrainedHeight = Math.min(measuredHeight, maxHeight);
  const centeredLeft = buttonRect.left + buttonRect.width / 2 - popoverRect.width / 2;
  const left = clamp(
    centeredLeft,
    popoverViewportMargin,
    window.innerWidth - measuredWidth - popoverViewportMargin
  );
  const top = nextPlacement === 'top'
    ? Math.max(buttonRect.top - constrainedHeight - popoverGap, popoverViewportMargin)
    : Math.min(buttonRect.bottom + popoverGap, window.innerHeight - constrainedHeight - popoverViewportMargin);
  const buttonCenter = buttonRect.left + buttonRect.width / 2;
  const arrowLeft = clamp(
    buttonCenter - left,
    popoverArrowEdgePaddingPx,
    measuredWidth - popoverArrowEdgePaddingPx
  );

  popoverPlacement.value = nextPlacement;
  popoverStyle.value = {
    '--collection-bookmark-arrow-left': `${Math.round(arrowLeft)}px`,
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    minHeight: `${Math.min(popoverMinHeightPx, Math.round(maxHeight))}px`,
    maxHeight: `${Math.round(maxHeight)}px`
  };
}

function addPopoverPositionListeners() {
  window.addEventListener('resize', updatePopoverPosition);
  window.addEventListener('scroll', updatePopoverPosition, true);
}

function removePopoverPositionListeners() {
  window.removeEventListener('resize', updatePopoverPosition);
  window.removeEventListener('scroll', updatePopoverPosition, true);
}

function handleFocusIn() {
  scheduleOpen();
}

function handlePointerEnter() {
  scheduleOpen();
}

function handlePointerLeave() {
  clearOpenTimer();
  if (popoverOpen.value) {
    scheduleClose();
  }
}

function handleFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget;
  if (
    nextTarget instanceof Node &&
    (rootElement.value?.contains(nextTarget) || popoverElement.value?.contains(nextTarget))
  ) {
    return;
  }

  clearOpenTimer();
  if (popoverOpen.value) {
    scheduleClose();
  }
}

async function handleBookmarkClick() {
  clearOpenTimer();
  if (suppressNextClick.value) {
    suppressNextClick.value = false;
    return;
  }

  await collectionsStore.toggleDefaultSave(props.item);
  await collectionsStore.fetchMembership(props.item.id, true);
}

function handlePointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    return;
  }

  clearLongPressTimer();
  longPressTimer.value = setTimeout(() => {
    suppressNextClick.value = true;
    void openPopover();
  }, 480);
}

function handlePointerUp() {
  clearLongPressTimer();
}

function handlePointerCancel() {
  clearLongPressTimer();
}

function clearLongPressTimer() {
  if (!longPressTimer.value) {
    return;
  }

  clearTimeout(longPressTimer.value);
  longPressTimer.value = null;
}

async function startCreating() {
  creating.value = true;
  localError.value = null;
  await nextTick();
  createInputElement.value?.focus();
  updatePopoverPosition();
}

function cancelCreating() {
  creating.value = false;
  collectionName.value = '';
  localError.value = null;
}

async function submitCreate() {
  const name = collectionName.value.trim();
  if (!name) {
    localError.value = t('collections.detail.edit.required');
    return;
  }

  creatingCollection.value = true;
  localError.value = null;

  try {
    await collectionsStore.createAndAdd(name, props.item);
    collectionName.value = '';
    closePopover();
  } catch (error) {
    localError.value = error instanceof Error ? error.message : t('collections.detail.edit.createError');
    await nextTick();
    updatePopoverPosition();
  } finally {
    creatingCollection.value = false;
  }
}

async function toggleCollection(slug: string) {
  localError.value = null;

  try {
    await collectionsStore.toggleCollectionMembership(slug, props.item);
    if (!creating.value) {
      closePopover();
    }
  } catch (error) {
    localError.value = error instanceof Error ? error.message : t('collections.detail.edit.updateError');
  }
}

function displayCollectionName(collection: CollectionSummary) {
  return collection.isDefault ? t('collections.shared.defaultName') : collection.name;
}

watch(popoverOpen, (isOpen) => {
  if (isOpen) {
    addPopoverPositionListeners();
    void nextTick(updatePopoverPosition);
  } else {
    removePopoverPositionListeners();
  }
});

onBeforeUnmount(() => {
  clearOpenTimer();
  clearCloseTimer();
  clearLongPressTimer();
  removePopoverPositionListeners();
});
</script>
