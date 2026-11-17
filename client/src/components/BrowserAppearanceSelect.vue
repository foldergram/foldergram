<template>
  <button
    class="flex w-full items-center gap-[0.95rem] border-0 bg-transparent text-text cursor-pointer text-left transition-colors duration-150 hover:bg-surface-hover disabled:opacity-60 disabled:cursor-wait"
    :class="mobile ? 'min-h-[3.35rem] px-[1.05rem] py-[0.9rem] text-[0.96rem]' : 'px-[1.2rem] py-[1rem] text-[0.98rem]'"
    type="button"
    :title="t(app.theme === 'light' ? 'nav.switchToDarkMode' : 'nav.switchToLightMode')"
    :disabled="auth.canWriteAppearance && appearance.saving"
    @click="toggle"
  >
    <span
      class="w-[1.18rem] h-[1.18rem] shrink-0"
      :class="app.theme === 'light' ? 'i-fluent-weather-moon-20-regular' : 'i-fluent-weather-sunny-20-regular'"
      aria-hidden="true"
    />
    <span>{{ t('nav.switchAppearance') }}</span>
  </button>
  <p v-if="failed && auth.canWriteAppearance" class="m-0 px-4 pb-2 text-sm text-muted" role="alert">{{ t('appearance.saveError') }}</p>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '../stores/app';
import { useAppearanceStore } from '../stores/appearance';
import { useAuthStore } from '../stores/auth';

defineProps<{ mobile?: boolean }>();
const emit = defineEmits<{ switched: [] }>();
const { t } = useI18n();
const app = useAppStore();
const appearance = useAppearanceStore();
const auth = useAuthStore();
const failed = ref(false);

async function toggle() {
  failed.value = false;
  if (await appearance.toggleTheme()) {
    emit('switched');
  } else {
    failed.value = true;
  }
}
</script>
