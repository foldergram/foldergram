<template>
  <div class="grid gap-2">
    <label :for="id" class="font-semibold">{{ t('displayPreferences.appearance.label') }}</label>
    <select
      :id="id"
      :value="appearance.browserTheme"
      :autofocus="autofocus"
      :aria-describedby="`${id}-help`"
      class="w-full min-h-11 rounded-[0.75rem] border border-border bg-surface-alt px-3 text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      @change="changeTheme"
    >
      <option v-for="theme in themes" :key="theme" :value="theme">
        {{ theme === 'instance' ? t('displayPreferences.appearance.appDefault') : t('appearance.' + theme) }}
      </option>
    </select>
    <p :id="`${id}-help`" class="m-0 text-[0.85rem] text-muted">{{ t('displayPreferences.appearance.description') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppearanceStore, type BrowserTheme } from '../stores/appearance';

defineProps<{ autofocus?: boolean }>();
const emit = defineEmits<{ changed: [saved: boolean] }>();
const { t } = useI18n();
const id = useId();
const appearance = useAppearanceStore();
const themes: BrowserTheme[] = ['instance', 'system', 'light', 'dark'];

function changeTheme(event: Event) {
  const theme = (event.target as HTMLSelectElement).value as BrowserTheme;
  if (themes.includes(theme)) emit('changed', appearance.setBrowserTheme(theme));
}
</script>
