<template>
  <label>
    <span
      class="h-[1.18rem] w-[1.18rem] shrink-0"
      :class="app.theme === 'light' ? 'i-fluent-weather-sunny-20-regular' : 'i-fluent-weather-moon-20-regular'"
      aria-hidden="true"
    />
    <span class="min-w-0">{{ t('nav.switchAppearance') }}</span>
    <select
      v-model="browserTheme"
      class="ml-auto min-w-0 max-w-[55%] cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
    >
      <option value="instance">{{ t('appearance.instanceDefault') }}</option>
      <option value="system">{{ t('appearance.system') }}</option>
      <option value="light">{{ t('appearance.light') }}</option>
      <option value="dark">{{ t('appearance.dark') }}</option>
    </select>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '../stores/app';
import { useAppearanceStore, type BrowserTheme } from '../stores/appearance';

const { t } = useI18n();
const app = useAppStore();
const appearance = useAppearanceStore();
const browserTheme = computed({
  get: () => appearance.browserTheme,
  set: (theme: BrowserTheme) => appearance.setBrowserTheme(theme)
});
</script>
