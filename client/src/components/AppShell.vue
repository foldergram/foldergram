<template>
  <!-- Desktop: fixed sidebar + content with margin-left -->
  <!-- Mobile: no sidebar, fixed bottom nav handles navigation -->
  <div
    class="app-shell flex min-h-screen overflow-x-clip"
    :class="{
      'app-shell--standalone': isStandaloneDisplay,
      'app-shell--explore': isExploreShell,
      'app-shell--reels': isReelsShell
    }"
  >
    <!-- Sidebar: fixed on desktop, hidden on mobile -->
    <SidebarNav class="hidden md:flex fixed top-0 left-0 h-screen z-30" :panel-open="Boolean(activityAnchor)" @open-more="dismissActivity(false)" @open-display-preferences="openDisplayPreferences">
      <template #activity>
        <ScanActivityTrigger v-if="showActivity" v-bind="activityTrigger" @activate="toggleActivity" />
      </template>
    </SidebarNav>
    <!-- Content: margin-left matches sidebar width on desktop -->
    <div class="app-shell__content flex flex-1 min-h-screen min-w-0 flex-col md:ml-[4.85rem]">
      <TopNav :has-activity="showActivity" :panel-open="Boolean(activityAnchor)" @open-more="dismissActivity(false)" @open-display-preferences="openDisplayPreferences">
        <template #activity>
          <ScanActivityTrigger v-if="showActivity" v-bind="activityTrigger" mobile @activate="toggleActivity" />
        </template>
      </TopNav>
      <main
        class="app-shell__main flex-1 min-h-0"
        :class="[
          isImmersiveShell
            ? 'px-0 pt-0 pb-0 md:px-0 md:pt-0 md:pb-0'
            : 'px-10 pt-7 pb-28 md:px-[0.9rem] md:pt-4 md:pb-10'
        ]"
      >
        <slot />
      </main>
    </div>

    <Teleport to="body">
      <DisplayPreferencesDialog v-if="displayPreferencesAnchor" @close="closeDisplayPreferences()" />
      <ScanActivityPanel
        v-if="activityAnchor"
        :mobile="mobile"
        :anchor="activityAnchor"
        @dismiss="dismissActivity"
      >
        <div class="flex items-start justify-between gap-3">
          <h2 id="scan-activity-heading" class="m-0 text-base">
            {{ scan?.isScanning ? getScanTitle(scan) : t('scanActivity.title') }}
          </h2>
          <button
            class="btn-ghost shrink-0"
            type="button"
            data-scan-close
            autofocus
            @click="dismissActivity()"
          >{{ t('common.close') }}</button>
        </div>
        <ScanActivityContent show-remote :held-result="heldResult" @navigate="dismissActivity(false)" />
        <RouterLink
          class="text-[0.85rem] font-semibold text-accent-strong"
          :to="authStore.canAccessSettings ? { name: 'settings', hash: '#library' } : { name: 'library' }"
          @click="dismissActivity(false)"
        >{{ t(authStore.canAccessSettings ? 'scanActivity.openSettings' : 'scanActivity.openLibrary') }}</RouterLink>
      </ScanActivityPanel>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import SidebarNav from './SidebarNav.vue';
import TopNav from './TopNav.vue';
import DisplayPreferencesDialog from './DisplayPreferencesDialog.vue';

import ScanActivityContent from './ScanActivityContent.vue';
import ScanActivityPanel from './ScanActivityPanel.vue';
import ScanActivityTrigger from './ScanActivityTrigger.vue';
import { openScanActivityKey } from './scan-activity';
import type { ScanRunSummary } from '../types/api';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useSourcesStore } from '../stores/sources';
import { getScanTitle } from '../utils/scan-progress';

const { t } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const sourcesStore = useSourcesStore();
const route = useRoute();
const isStandaloneDisplay = ref(false);
const isExploreShell = computed(() => route.meta.shell === 'explore');
const isReelsShell = computed(() => route.meta.shell === 'reels');
const isImmersiveShell = computed(() => isExploreShell.value || isReelsShell.value);
const scan = computed(() => appStore.stats?.scan ?? null);
const remoteSync = computed(() => sourcesStore.items.some(source => source.kind === 'immich' && source.syncing));
const issue = computed(() => authStore.canAccessSettings && Boolean(appStore.unacknowledgedScanResult));
const awayCompletion = computed(() => authStore.canAccessSettings && appStore.scanCompletion?.surface === null);
const activityAnchor = shallowRef<HTMLElement | null>(null);
const displayPreferencesAnchor = shallowRef<HTMLButtonElement | null>(null);
const heldResult = shallowRef<ScanRunSummary | null>(null);
const media = window.matchMedia('(max-width: 767.98px)');
const mobile = ref(media.matches);
const showActivity = computed(() => Boolean(activityAnchor.value || scan.value?.isScanning ||
  remoteSync.value || issue.value || awayCompletion.value || appStore.scanStatusUnavailable));
const activityTrigger = computed(() => {
  const state = scan.value?.operation?.state;
  const paused = state === 'paused' || state === 'pausing';
  const stopping = state === 'cancelling';
  let status = 'showDetails';
  if (remoteSync.value) status = 'syncDetails';
  if (scan.value?.isScanning) status = 'runningDetails';
  if (state === 'paused' || state === 'pausing' || state === 'cancelling' || state === 'queued') status = 'state.' + state;
  if (issue.value && !scan.value?.isScanning) status = 'attentionDetails';
  if (appStore.scanStatusUnavailable) status = 'unavailableDetails';
  return {
    label: t('scanActivity.' + status),
    expanded: Boolean(activityAnchor.value),
    paused,
    stopping,
    running: !paused && !stopping && !appStore.scanStatusUnavailable && Boolean(scan.value?.isScanning || remoteSync.value),
    attention: issue.value || appStore.scanStatusUnavailable
  };
});

function openDisplayPreferences(anchor: HTMLButtonElement) {
  dismissActivity(false);
  displayPreferencesAnchor.value = anchor;
}

async function closeDisplayPreferences(restoreFocus = true) {
  const anchor = displayPreferencesAnchor.value;
  displayPreferencesAnchor.value = null;
  if (!restoreFocus || !anchor) return;
  await nextTick();
  const target = anchor.getClientRects().length ? anchor : document.querySelector<HTMLButtonElement>(
    mobile.value ? '.mobile-nav__more-button' : '.sidebar__more'
  );
  target?.focus();
}

function dismissActivity(restoreFocus = true) {
  const anchor = activityAnchor.value;
  const completion = appStore.scanCompletion;
  const reviewed = anchor && completion?.surface === null && !issue.value &&
    (heldResult.value ? heldResult.value.id === completion.result.id : !scan.value?.isScanning);
  if (reviewed) appStore.reviewDeferredScanCompletion();
  activityAnchor.value = null;
  heldResult.value = null;
  if (restoreFocus) void nextTick(() => { if (anchor?.isConnected) anchor.focus(); });
}

function toggleActivity(event: MouseEvent) {
  if (activityAnchor.value) {
    dismissActivity();
    return;
  }
  if (!(event.currentTarget instanceof HTMLElement)) return;
  activityAnchor.value = event.currentTarget;
  void appStore.refreshScanProgress();
}

function onLayoutChange(event: MediaQueryListEvent) {
  dismissActivity(false);
  mobile.value = event.matches;
}

provide(openScanActivityKey, toggleActivity);
watch(() => authStore.canAccessSettings, () => dismissActivity(false));
watch(() => scan.value?.lastCompletedScan, (result, previous) => {
  if (activityAnchor.value && result && result.id !== previous?.id) heldResult.value = result;
});
watch(() => route.fullPath, (_path, previous) => {
  void closeDisplayPreferences(false);
  dismissActivity(false);
  appStore.leaveScanSurface(previous);
});

onMounted(() => {
  media.addEventListener?.('change', onLayoutChange);
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  isStandaloneDisplay.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true;
});

onUnmounted(() => media.removeEventListener?.('change', onLayoutChange));
</script>

<style scoped>
.app-shell {
  --mobile-safe-area-bottom: 0px;
  --mobile-bottom-nav-height: calc(3.55rem + var(--mobile-safe-area-bottom));
}

.app-shell--standalone {
  --mobile-safe-area-bottom: env(safe-area-inset-bottom, 0px);
}

.app-shell--reels {
  height: 100dvh;
  min-height: 100dvh;
}

.app-shell--reels .app-shell__content {
  height: 100dvh;
  min-height: 100dvh;
}

.app-shell--reels .app-shell__main {
  overflow: hidden;
}

@media (max-width: 767.98px) {
  .app-shell--reels .app-shell__content {
    height: calc(100dvh - var(--mobile-bottom-nav-height));
    min-height: calc(100dvh - var(--mobile-bottom-nav-height));
  }
}
</style>
