<template>
  <section v-if="auth.canAccessSettings" class="card overflow-visible p-0">
    <div class="border-b border-border px-6 py-5">
      <h2 class="m-0 text-[1.18rem]">{{ t('appearance.title') }}</h2>
      <p class="m-0 mt-[0.25rem] text-muted">{{ t('appearance.description') }}</p>
      <p v-if="auth.publicDemoMode" class="m-0 mt-2 text-sm font-semibold">{{ t('appearance.demoReadOnly') }}</p>
    </div>
    <form @submit.prevent="save">
      <div class="grid gap-5 px-6 py-4">
      <label class="grid gap-2">
        <span class="font-semibold">{{ t('appearance.theme') }}</span>
        <select v-model="theme" class="border border-border rounded-lg p-3 bg-surface text-text disabled:opacity-60 disabled:cursor-not-allowed" :disabled="editingDisabled">
          <option v-for="mode in themes" :key="mode" :value="mode">{{ t('appearance.' + mode) }}</option>
        </select>
      </label>
      <fieldset class="border-0 p-0 m-0 disabled:opacity-60" :disabled="editingDisabled">
        <legend class="font-semibold mb-2">{{ t('appearance.accent') }}</legend>
        <div class="flex flex-wrap gap-3">
          <label v-for="(color, name) in accentColors" :key="name" class="inline-flex items-center gap-2 cursor-pointer">
            <input v-model="accent" type="radio" name="instance-accent" :value="name" />
            <span class="inline-block w-5 h-5 rounded-full" :style="{ background: color }" aria-hidden="true" />
            {{ t('appearance.' + name) }}
          </label>
        </div>
      </fieldset>
      <p v-if="appearance.error" role="alert">{{ t(appearance.error) }}</p>
      <p v-else-if="saved" role="status">{{ t('appearance.saved') }}</p>
      </div>
      <div class="rounded-b-[1.05rem] border-t border-border bg-[color-mix(in_srgb,var(--surface)_96%,var(--accent-soft)_4%)] px-6 py-5">
        <div class="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
          <p class="m-0 flex-1 text-[0.84rem] text-muted">{{ t('appearance.accentHelp') }}</p>
          <button class="btn-primary min-w-[10.5rem] self-end max-sm:self-stretch" type="submit" :disabled="editingDisabled">
            {{ t(appearance.saving ? 'appearance.saving' : 'appearance.save') }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { useAppearanceStore, accentColors, type InstanceTheme, type Accent } from '../stores/appearance';

const { t } = useI18n();
const auth = useAuthStore();
const appearance = useAppearanceStore();
const themes: InstanceTheme[] = ['system', 'light', 'dark'];
const theme = ref<InstanceTheme>(appearance.theme);
const accent = ref<Accent>(appearance.accent);
const saved = ref(false);
const editingDisabled = computed(() => !auth.canWriteAppearance || !appearance.ready || appearance.saving);
watch(() => [appearance.theme, appearance.accent] as const, ([nextTheme, nextAccent]) => {
  theme.value = nextTheme;
  accent.value = nextAccent;
});
watch([theme, accent], () => { saved.value = false; });
async function save() {
  if (editingDisabled.value) return;
  saved.value = await appearance.save({ theme: theme.value, accent: accent.value });
}
</script>
