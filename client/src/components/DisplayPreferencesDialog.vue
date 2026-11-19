<template>
  <dialog
    ref="dialog"
    class="display-preferences-dialog w-[min(28rem,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[1.25rem] border border-border bg-surface p-6 text-text shadow-[var(--shadow)]"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-description`"
    @cancel.prevent="emit('close')"
    @click="handleBackdropClick"
  >
    <h2 :id="`${id}-title`" class="m-0 text-[1.25rem] font-semibold">{{ t('displayPreferences.title') }}</h2>
    <p :id="`${id}-description`" class="mt-2 mb-6 text-[0.85rem] text-muted">{{ t('displayPreferences.description') }}</p>

    <BrowserAppearanceSelect autofocus class="mb-6" @changed="saved = $event" />

    <div class="mb-6 flex items-start justify-between gap-5">
      <div class="min-w-0">
        <p :id="`${id}-label`" class="m-0 font-semibold">{{ t('displayPreferences.suggestedFolders.label') }}</p>
        <p :id="`${id}-help`" class="mt-2 mb-0 text-[0.85rem] text-muted">{{ t('displayPreferences.suggestedFolders.description') }}</p>
      </div>
      <button
        class="display-preferences-switch shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        :class="{ 'display-preferences-switch--on': enabled }"
        type="button"
        role="switch"
        :aria-checked="enabled"
        :aria-labelledby="`${id}-label`"
        :aria-describedby="`${id}-help`"
        @click="toggleSuggestedFolders"
      />
    </div>

    <div class="flex items-start justify-between gap-5">
      <div class="min-w-0">
        <p :id="`${id}-fit-label`" class="m-0 font-semibold">{{ t('displayPreferences.fitTallMedia.label') }}</p>
        <p :id="`${id}-fit-help`" class="mt-2 mb-0 text-[0.85rem] text-muted">{{ t('displayPreferences.fitTallMedia.description') }}</p>
      </div>
      <button
        class="display-preferences-switch shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        :class="{ 'display-preferences-switch--on': fitTallMediaEnabled }"
        type="button"
        role="switch"
        :aria-checked="fitTallMediaEnabled"
        :aria-labelledby="`${id}-fit-label`"
        :aria-describedby="`${id}-fit-help`"
        @click="toggleFitTallMedia"
      />
    </div>

    <p v-if="hasSaveFailure" class="mt-5 mb-0 text-[0.85rem] text-text" role="alert">{{ t('displayPreferences.sessionOnly') }}</p>
    <p v-else class="mt-5 mb-0 min-h-6 text-[0.85rem] text-accent-strong" role="status">{{ saved ? t('displayPreferences.saved') : '' }}</p>
    <div class="mt-5 flex justify-end">
      <button class="btn-primary" type="button" @click="emit('close')">{{ t('displayPreferences.done') }}</button>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSuggestedFoldersPreference } from '../composables/useSuggestedFoldersPreference';
import { useFitTallMediaPreference } from '../composables/useFitTallMediaPreference';
import { useAppearanceStore } from '../stores/appearance';
import BrowserAppearanceSelect from './BrowserAppearanceSelect.vue';

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const id = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const saved = ref(false);
const { enabled, saveFailed, setEnabled } = useSuggestedFoldersPreference();
const { enabled: fitTallMediaEnabled, saveFailed: fitTallMediaSaveFailed, setEnabled: setFitTallMediaEnabled } = useFitTallMediaPreference();
const appearance = useAppearanceStore();
const hasSaveFailure = computed(() => saveFailed.value || fitTallMediaSaveFailed.value || appearance.browserSaveFailed);

function toggleSuggestedFolders() {
  saved.value = setEnabled(!enabled.value);
}

function toggleFitTallMedia() {
  saved.value = setFitTallMediaEnabled(!fitTallMediaEnabled.value);
}

function handleBackdropClick(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return;
  const bounds = dialog.value.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
    emit('close');
  }
}

onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close();
});
</script>

<style scoped>
.display-preferences-dialog {
  margin: auto;
}

.display-preferences-dialog::backdrop {
  background: rgb(0 0 0 / 45%);
}

.display-preferences-switch {
  position: relative;
  width: 3rem;
  height: 1.75rem;
  margin-top: 0.15rem;
  padding: 0;
  border: 1px solid var(--muted);
  border-radius: 999px;
  background: var(--surface-alt);
}

.display-preferences-switch::before {
  position: absolute;
  inset: 0.2rem auto 0.2rem 0.2rem;
  width: 1.2rem;
  border-radius: 50%;
  background: var(--text);
  content: '';
}

.display-preferences-switch--on {
  border-color: var(--accent);
  background: var(--accent);
}

.display-preferences-switch--on::before {
  left: auto;
  right: 0.2rem;
  background: var(--on-accent);
}
</style>
