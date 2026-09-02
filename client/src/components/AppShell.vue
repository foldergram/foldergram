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
    <SidebarNav class="hidden md:flex fixed top-0 left-0 h-screen z-30" />
    <!-- Content: margin-left matches sidebar width on desktop -->
    <div class="app-shell__content flex flex-1 min-h-screen min-w-0 flex-col md:ml-[4.85rem]">
      <TopNav />
      <main
        class="app-shell__main flex-1 min-h-0"
        :class="[
          isImmersiveShell
            ? 'px-0 pt-0 pb-0 md:px-0 md:pt-0 md:pb-0'
            : 'px-10 pt-7 pb-28 md:px-[0.9rem] md:pt-4 md:pb-10',
          showStickyScanStatus && isScanBannerExpanded && !isReelsShell ? 'pb-48 md:pb-40' : ''
        ]"
      >
        <slot />
      </main>
    </div>

    <div
      v-if="showStickyScanStatus"
      class="app-shell__scan-status pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <button
        v-if="!isScanBannerExpanded"
        class="app-shell__scan-chip pointer-events-auto inline-flex items-center gap-2 self-end rounded-full border border-white/12 px-[0.85rem] py-[0.42rem] text-[0.78rem] font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.32)] backdrop-blur-[18px]"
        style="background: linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(17,24,39,0.96) 100%);"
        type="button"
        data-test="scan-banner-expand"
        :aria-label="t('app.scanBanner.expand')"
        :title="t('app.scanBanner.expand')"
        @click="expandScanBanner"
      >
        <span class="app-shell__scan-chip-dot" aria-hidden="true" />
        <span>{{ stickyScanPhaseLabel }}</span>
      </button>

      <section
        v-else
        class="pointer-events-auto w-[min(100%,44rem)] rounded-[1.15rem] border border-white/12 px-4 py-[0.95rem] text-white shadow-[0_24px_60px_rgba(15,23,42,0.38)] backdrop-blur-[18px] md:px-5"
        style="background: linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(17,24,39,0.98) 100%);"
      >
        <div class="grid gap-[0.75rem]">
          <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
            <div class="grid gap-[0.2rem] min-w-0">
              <strong class="text-[0.96rem] leading-tight tracking-[-0.02em]">{{ stickyScanTitle }}</strong>
              <p class="m-0 text-[0.84rem] leading-[1.45] text-white/75">{{ stickyScanSummary }}</p>
              <p v-if="stickyScanActionLine" class="m-0 min-w-0 truncate text-[0.77rem] font-semibold text-[#dbeafe]">
                {{ stickyScanActionLine }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center justify-center min-h-8 px-[0.72rem] py-[0.34rem] rounded-full text-[0.73rem] font-bold whitespace-nowrap text-[#dbeafe]"
                style="background: rgba(78, 197, 255, 0.16);"
              >
                {{ stickyScanPhaseLabel }}
              </span>
              <button
                class="app-shell__scan-collapse inline-flex h-8 w-8 items-center justify-center rounded-full border-0 text-white/80"
                type="button"
                data-test="scan-banner-collapse"
                :aria-label="t('app.scanBanner.collapse')"
                :title="t('app.scanBanner.collapse')"
                @click="collapseScanBanner"
              >
                <span class="i-fluent-chevron-down-20-regular h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div
            class="relative h-[0.72rem] overflow-hidden rounded-full"
            style="background: rgba(255, 255, 255, 0.12);"
            aria-hidden="true"
          >
            <div
              v-if="stickyScanBarState.indeterminate"
              class="app-shell__scan-bar app-shell__scan-bar--indeterminate absolute inset-y-0 left-0 w-[38%] rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
            />
            <div
              v-else
              class="absolute inset-y-0 left-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
              style="background: linear-gradient(90deg, #38bdf8 0%, #4ec5ff 48%, #f8fafc 100%);"
              :style="{ width: `${stickyScanBarState.percent}%` }"
            />
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.82rem] text-white/72">
            <span>{{ stickyScanMetricLine }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import SidebarNav from './SidebarNav.vue';
import TopNav from './TopNav.vue';

import { useAppStore } from '../stores/app';
import {
  getScanActionLine,
  getScanBarState,
  getScanMetricLine,
  getScanPhaseLabel,
  getScanSummary
} from '../utils/scan-progress';

const { t } = useI18n();
const appStore = useAppStore();
const route = useRoute();

/**
 * The banner sits over the feed, so it has to be dismissible. Collapsing is remembered
 * per scan run: a new scan is new information and earns one more appearance, while the
 * run the viewer already dismissed stays out of the way across reloads. Detailed
 * progress lives on the settings page.
 */
const SCAN_BANNER_DISMISSED_KEY = 'foldergram-scan-banner-dismissed';
const dismissedScanSession = ref<string | null>(null);
const isStandaloneDisplay = ref(false);
const isExploreShell = computed(() => route.meta.shell === 'explore');
const isReelsShell = computed(() => route.meta.shell === 'reels');
const isImmersiveShell = computed(() => isExploreShell.value || isReelsShell.value);
const activeScan = computed(() => appStore.stats?.scan ?? null);
const showStickyScanStatus = computed(() => Boolean(activeScan.value?.isScanning));
// `runId` stands for the scan session; the start timestamp covers a server that does
// not report one, and a scan with neither simply cannot be remembered as dismissed.
const scanSessionId = computed(() => {
  const scan = activeScan.value;
  if (!scan?.isScanning) {
    return null;
  }

  const identity = scan.runId ?? scan.startedAt;
  return identity === null || identity === undefined ? null : String(identity);
});
const isScanBannerExpanded = computed(
  () => scanSessionId.value === null || dismissedScanSession.value !== scanSessionId.value
);

function collapseScanBanner() {
  const session = scanSessionId.value;
  dismissedScanSession.value = session;

  if (session === null) {
    return;
  }

  try {
    window.localStorage.setItem(SCAN_BANNER_DISMISSED_KEY, session);
  } catch {
    // A blocked storage quota only costs the memory of the choice.
  }
}

function expandScanBanner() {
  dismissedScanSession.value = null;

  try {
    window.localStorage.removeItem(SCAN_BANNER_DISMISSED_KEY);
  } catch {
    // Nothing to undo if storage is unavailable.
  }
}

const stickyScanTitle = computed(() => {
  if (activeScan.value?.scanReason === 'rebuild') {
    return 'Rebuilding library';
  }

  if (activeScan.value?.scanReason === 'rebuild-thumbnails') {
    return 'Regenerating thumbnails';
  }

  return 'Scanning library';
});

const stickyScanPhaseLabel = computed(() => getScanPhaseLabel(activeScan.value));
const stickyScanSummary = computed(() => getScanSummary(activeScan.value));
const stickyScanActionLine = computed(() => getScanActionLine(activeScan.value));
const stickyScanMetricLine = computed(() => getScanMetricLine(activeScan.value));
const stickyScanBarState = computed(() => getScanBarState(activeScan.value));

onMounted(() => {
  try {
    dismissedScanSession.value = window.localStorage.getItem(SCAN_BANNER_DISMISSED_KEY);
  } catch {
    dismissedScanSession.value = null;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  isStandaloneDisplay.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true;
});

// A finished scan clears the stored dismissal so the next run is announced once.
watch(
  () => activeScan.value?.isScanning ?? false,
  (isScanning) => {
    if (!isScanning && dismissedScanSession.value !== null) {
      expandScanBanner();
    }
  }
);
</script>

<style scoped>
.app-shell__scan-collapse {
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
}

.app-shell__scan-chip {
  cursor: pointer;
}

.app-shell__scan-chip-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: #38bdf8;
}

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

.app-shell__scan-bar {
  background: linear-gradient(90deg, #38bdf8 0%, #4ec5ff 48%, #f8fafc 100%);
}

.app-shell__scan-bar--indeterminate {
  animation: app-shell-scan-indeterminate 1.15s ease-in-out infinite;
}

.app-shell__scan-status {
  bottom: 1rem;
}

@media (max-width: 767.98px) {
  .app-shell--reels .app-shell__content {
    height: calc(100dvh - var(--mobile-bottom-nav-height));
    min-height: calc(100dvh - var(--mobile-bottom-nav-height));
  }

  .app-shell__scan-status {
    bottom: calc(var(--mobile-bottom-nav-height) + 1.65rem);
  }
}

@keyframes app-shell-scan-indeterminate {
  0% {
    transform: translateX(-110%);
  }

  100% {
    transform: translateX(260%);
  }
}
</style>
