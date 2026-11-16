<template>
  <div v-if="canShow" class="flex flex-wrap items-center gap-2">
    <button
      v-if="toggleAction"
      class="btn-ghost"
      type="button"
      :disabled="busy"
      @click="appStore.sendScanControl(toggleAction)"
    >{{ t('scanActivity.controls.' + toggleAction) }}</button>

    <button
      v-if="allowCancel && controls.includes('cancel')"
      class="btn-ghost text-[#b64d36]"
      type="button"
      :disabled="busy"
      @click="appStore.sendScanControl('cancel')"
    >{{ t('scanActivity.controls.cancel') }}</button>

    <p v-if="allowCancel && controls.includes('cancel')" class="m-0 w-full text-[0.8rem] text-muted">
      {{ t('scanActivity.controls.keepsWork') }}
    </p>
    <p v-if="appStore.scanControlError" class="m-0 w-full text-[0.8rem]" role="status">{{ t('scanActivity.controls.error') }}</p>
  </div>
  <p v-if="allowCancel && canManage && !controls.length && !stopping" class="m-0 text-[0.8rem] text-muted">
    {{ t('scanActivity.controls.unavailable') }}
  </p>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';

defineProps<{ allowCancel?: boolean }>();
const { t } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const operation = computed(() => appStore.stats?.scan.operation);
const canManage = computed(() => authStore.canManageLibrary && appStore.isScanning);
const controls = computed(() => operation.value?.controls ?? []);
const stopping = computed(() => operation.value?.state === 'cancelling');
const canShow = computed(() => canManage.value && (controls.value.length > 0 || appStore.scanControlError));
const toggleAction = computed(() => controls.value.includes('resume') ? 'resume' : controls.value.includes('pause') ? 'pause' : null);
const busy = computed(() => appStore.scanControlPending || appStore.scanStatusUnavailable);
</script>
