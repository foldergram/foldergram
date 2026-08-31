<template>
  <section class="w-[min(100%,72rem)] mx-auto flex flex-col gap-[1.2rem]">
    <header class="flex items-end justify-between gap-4 pb-[0.8rem] max-sm:flex-col max-sm:items-start">
      <div>
        <span class="eyebrow">{{ t('settings.eyebrow') }}</span>
        <h1 class="mt-[0.15rem] mb-0 text-[clamp(1.55rem,2.4vw,2rem)] font-medium tracking-[-0.04em]">{{ t('settings.title') }}</h1>
        <p class="m-0 text-muted">{{ t('settings.description') }}</p>
      </div>
    </header>

    <section
      v-if="showScanErrorNotice"
      class="card grid gap-[1rem] p-8 border-[color-mix(in_srgb,#d2a133_45%,var(--border)_55%)]"
      style="background: radial-gradient(circle at top right, rgba(210,161,51,0.18), transparent 42%), linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, #fff4d1 8%) 0%, color-mix(in srgb, var(--surface) 86%, #ffeab1 14%) 100%);"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="grid gap-[0.35rem]">
          <span class="eyebrow text-[#9f6a00]">{{ t('settings.notices.scanError.eyebrow') }}</span>
          <h2 class="m-0 text-[1.1rem]">{{ t('settings.notices.scanError.title') }}</h2>
          <p class="m-0 text-muted">{{ scanErrorNoticeMessage }}</p>
          <p v-if="scanErrorNoticeDetail" class="m-0 font-mono text-[0.8rem] leading-[1.5] text-[#7c5800] break-all">
            {{ scanErrorNoticeDetail }}
          </p>
          <p v-if="scanErrorReportPath" class="m-0 font-mono text-[0.78rem] leading-[1.5] text-[#7c5800] break-all">
            {{ t('settings.notices.scanError.fullReportPrefix') }} {{ scanErrorReportPath }}
          </p>
        </div>
        <button
          class="inline-flex h-9 w-9 items-center justify-center rounded-full border-0 bg-[rgba(159,106,0,0.08)] text-[#9f6a00] cursor-pointer transition-colors duration-180 hover:bg-[rgba(159,106,0,0.14)]"
          type="button"
          :aria-label="t('settings.notices.scanError.dismissAria')"
          @click="dismissScanErrorNotice"
        >
          <span class="i-fluent-dismiss-20-filled h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div class="flex items-center gap-4 max-sm:flex-col-reverse max-sm:items-stretch">
        <p class="m-0 text-muted">{{ t('settings.notices.scanError.actionNote') }}</p>
        <button class="btn-primary min-w-[11.5rem]" type="button" :disabled="scanActionDisabled" @click="runManualScan">
          {{ scanButtonLabel }}
        </button>
      </div>
    </section>

    <section
      v-if="showScanWarningNotice"
      class="card grid gap-[0.45rem] px-5 py-4 border-[color-mix(in_srgb,#d2a133_35%,var(--border)_65%)]"
    >
      <span class="eyebrow text-[#9f6a00]">{{ t('settings.notices.scanWarning.eyebrow') }}</span>
      <h2 class="m-0 text-[1rem]">{{ t('settings.notices.scanWarning.title', { count: lastCompletedScan?.warning_count ?? 0 }) }}</h2>
      <p class="m-0 whitespace-pre-line text-[0.84rem] leading-[1.5] text-muted">{{ lastCompletedScan?.warning_text }}</p>
    </section>

    <section
      v-if="showIgnoredRootMediaNotice"
      class="card flex items-center justify-between gap-3 px-4 py-3 border-[color-mix(in_srgb,var(--border)_82%,#d2a133_18%)]"
      style="background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 97%, #fff9ea 3%) 0%, color-mix(in srgb, var(--surface) 94%, #fff3d8 6%) 100%);"
    >
      <p class="m-0 min-w-0 flex-1 break-words text-[0.8rem] leading-[1.45] text-muted">
        {{ ignoredRootMediaNoticeMessage }}
      </p>
      <button
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-[rgba(159,106,0,0.08)] text-[#9f6a00] cursor-pointer transition-colors duration-180 hover:bg-[rgba(159,106,0,0.14)]"
        type="button"
        :aria-label="t('settings.notices.ignoredRootMedia.dismissAria')"
        @click="dismissIgnoredRootMediaNotice"
      >
        <span class="i-fluent-dismiss-20-filled h-5 w-5" aria-hidden="true" />
      </button>
    </section>

    <section
      v-if="showPlacesOnboardingBanner"
      class="card grid cursor-pointer gap-[1rem] border-[color-mix(in_srgb,var(--border)_84%,#8cc8ff_16%)] p-6 transition-[transform,border-color] duration-180 hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--accent)_28%,var(--border)_72%)]"
      style="background: linear-gradient(135deg, color-mix(in srgb, var(--surface) 97%, #f7fbff 3%) 0%, color-mix(in srgb, var(--surface) 93%, #e6f3ff 7%) 100%);"
      @click="openPlacesTab"
    >
        <div class="flex items-start justify-between gap-4">
          <div class="grid gap-[0.3rem]">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="m-0 text-xl">{{ t('settings.places.banner.title') }}</h2>
              <span class="eyebrow inline-flex w-fit self-start text-xs">{{ t('common.newFeature') }}</span>
            </div>
          <p class="m-0 text-[0.95rem] font-medium text-text">{{ t('settings.places.banner.description') }}</p>
          <p class="m-0 text-muted">{{ t('settings.places.banner.helper') }}</p>
          </div>
          <button
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-[rgba(24,119,242,0.08)] text-accent-strong cursor-pointer transition-colors duration-180 hover:bg-[rgba(24,119,242,0.14)]"
            type="button"
            :aria-label="t('settings.places.banner.dismissAria')"
            @click.stop="dismissPlacesOnboardingBanner"
          >
          <span class="i-fluent-dismiss-20-filled h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div class="flex items-center gap-4 max-sm:flex-col max-sm:items-stretch">
        <button
          class="btn-primary min-w-[11.5rem]"
          type="button"
          @click.stop="openPlacesTab"
        >
          {{ t('settings.places.banner.setup') }}
        </button>
        <p class="m-0 text-muted">
          {{ t('settings.places.banner.availableLater') }}
        </p>
      </div>
    </section>

    <nav
      class="sticky top-3 z-20 grid w-full grid-cols-5 gap-1.5 rounded-[1.2rem] border border-border bg-[color-mix(in_srgb,var(--bg)_90%,var(--surface)_10%)] p-1.5 shadow-[0_12px_34px_rgba(15,20,25,0.08)] backdrop-blur-[18px] md:hidden"
      :aria-label="t('settings.sections.navigation')"
    >
      <button
        @click="currentCategory = 'library'"
        class="flex min-h-[3.15rem] items-center justify-center rounded-[0.95rem] border-0 bg-transparent p-0 text-muted transition-colors duration-150 cursor-pointer"
        :class="currentCategory === 'library' ? 'bg-surface-alt text-text' : 'hover:bg-surface-hover hover:text-text'"
        :aria-label="t('settings.sections.library.shortLabel')"
      >
        <span class="h-[1.55rem] w-[1.55rem]" :class="currentCategory === 'library' ? 'i-fluent-folder-sync-20-filled' : 'i-fluent-folder-sync-20-regular'" aria-hidden="true"></span>
      </button>
      <button
        @click="currentCategory = 'general'"
        class="flex min-h-[3.15rem] items-center justify-center rounded-[0.95rem] border-0 bg-transparent p-0 text-muted transition-colors duration-150 cursor-pointer"
        :class="currentCategory === 'general' ? 'bg-surface-alt text-text' : 'hover:bg-surface-hover hover:text-text'"
        :aria-label="t('settings.sections.general.label')"
      >
        <span class="h-[1.55rem] w-[1.55rem]" :class="currentCategory === 'general' ? 'i-fluent-settings-20-filled' : 'i-fluent-settings-20-regular'" aria-hidden="true"></span>
      </button>
      <button
        @click="currentCategory = 'places'"
        class="flex min-h-[3.15rem] items-center justify-center rounded-[0.95rem] border-0 bg-transparent p-0 text-muted transition-colors duration-150 cursor-pointer"
        :class="currentCategory === 'places' ? 'bg-surface-alt text-text' : 'hover:bg-surface-hover hover:text-text'"
        :aria-label="t('settings.sections.places.label')"
      >
        <span class="h-[1.55rem] w-[1.55rem]" :class="currentCategory === 'places' ? 'i-fluent-location-20-filled' : 'i-fluent-location-20-regular'" aria-hidden="true"></span>
      </button>
      <button
        @click="currentCategory = 'access'"
        class="flex min-h-[3.15rem] items-center justify-center rounded-[0.95rem] border-0 bg-transparent p-0 text-muted transition-colors duration-150 cursor-pointer"
        :class="currentCategory === 'access' ? 'bg-surface-alt text-text' : 'hover:bg-surface-hover hover:text-text'"
        :aria-label="t('settings.sections.access.shortLabel')"
      >
        <span class="h-[1.55rem] w-[1.55rem]" :class="currentCategory === 'access' ? 'i-fluent-lock-shield-20-filled' : 'i-fluent-lock-shield-20-regular'" aria-hidden="true"></span>
      </button>
      <button
        @click="currentCategory = 'status'"
        class="flex min-h-[3.15rem] items-center justify-center rounded-[0.95rem] border-0 bg-transparent p-0 text-muted transition-colors duration-150 cursor-pointer"
        :class="currentCategory === 'status' ? 'bg-surface-alt text-text' : 'hover:bg-surface-hover hover:text-text'"
        :aria-label="t('settings.sections.status.label')"
      >
        <span class="h-[1.55rem] w-[1.55rem]" :class="currentCategory === 'status' ? 'i-fluent-data-usage-20-filled' : 'i-fluent-data-usage-20-regular'" aria-hidden="true"></span>
      </button>
    </nav>

    <div class="flex flex-col md:flex-row gap-8 items-start mt-[0.5rem]">
      <!-- Navigation Sidebar -->
      <nav
        class="hidden w-full shrink-0 md:flex md:w-[16rem] md:flex-col md:gap-2 md:sticky md:top-[6.5rem]"
        :aria-label="t('settings.sections.navigation')"
      >
        <button
          @click="currentCategory = 'library'"
          class="flex items-start gap-3 rounded-[0.85rem] border-0 px-4 py-[0.85rem] text-left text-[1rem] transition-colors duration-150 cursor-pointer"
          :class="currentCategory === 'library' ? 'bg-surface-alt font-bold text-text' : 'bg-transparent text-muted hover:bg-surface-hover hover:text-text'"
        >
          <span class="mt-[0.1rem] h-[1.25rem] w-[1.25rem] shrink-0" :class="currentCategory === 'library' ? 'i-fluent-folder-sync-20-filled' : 'i-fluent-folder-sync-20-regular'" aria-hidden="true"></span>
          <span class="flex min-w-0 flex-col gap-[0.1rem]">
            <span>{{ t('settings.sections.library.label') }}</span>
            <span class="text-[0.75rem] font-normal text-muted">{{ t('settings.sections.library.description') }}</span>
          </span>
        </button>
        <button
          @click="currentCategory = 'general'"
          class="flex items-start gap-3 rounded-[0.85rem] border-0 px-4 py-[0.85rem] text-left text-[1rem] transition-colors duration-150 cursor-pointer"
          :class="currentCategory === 'general' ? 'bg-surface-alt font-bold text-text' : 'bg-transparent text-muted hover:bg-surface-hover hover:text-text'"
        >
          <span class="mt-[0.1rem] h-[1.25rem] w-[1.25rem] shrink-0" :class="currentCategory === 'general' ? 'i-fluent-settings-20-filled' : 'i-fluent-settings-20-regular'" aria-hidden="true"></span>
          <span class="flex flex-col gap-[0.1rem] min-w-0">
            <span class="truncate">{{ t('settings.sections.general.label') }}</span>
            <span class="text-[0.75rem] font-normal text-muted">{{ t('settings.sections.general.description') }}</span>
          </span>
        </button>
        <button
          @click="currentCategory = 'places'"
          class="flex items-start gap-3 rounded-[0.85rem] border-0 px-4 py-[0.85rem] text-left text-[1rem] transition-colors duration-150 cursor-pointer"
          :class="currentCategory === 'places' ? 'bg-surface-alt font-bold text-text' : 'bg-transparent text-muted hover:bg-surface-hover hover:text-text'"
        >
          <span class="mt-[0.1rem] h-[1.25rem] w-[1.25rem] shrink-0" :class="currentCategory === 'places' ? 'i-fluent-location-20-filled' : 'i-fluent-location-20-regular'" aria-hidden="true"></span>
          <span class="flex flex-col gap-[0.1rem] min-w-0">
            <span>{{ t('settings.sections.places.label') }}</span>
            <span class="text-[0.75rem] font-normal text-muted">{{ t('settings.sections.places.description') }}</span>
          </span>
        </button>
        <button
          @click="currentCategory = 'access'"
          class="flex items-start gap-3 rounded-[0.85rem] border-0 px-4 py-[0.85rem] text-left text-[1rem] transition-colors duration-150 cursor-pointer"
          :class="currentCategory === 'access' ? 'bg-surface-alt font-bold text-text' : 'bg-transparent text-muted hover:bg-surface-hover hover:text-text'"
        >
          <span class="mt-[0.1rem] h-[1.25rem] w-[1.25rem] shrink-0" :class="currentCategory === 'access' ? 'i-fluent-lock-shield-20-filled' : 'i-fluent-lock-shield-20-regular'" aria-hidden="true"></span>
          <span class="flex flex-col gap-[0.1rem] min-w-0">
            <span>{{ t('settings.sections.access.label') }}</span>
            <span class="text-[0.75rem] font-normal text-muted">{{ t('settings.sections.access.description') }}</span>
          </span>
        </button>
        <button
          @click="currentCategory = 'status'"
          class="flex items-start gap-3 rounded-[0.85rem] border-0 px-4 py-[0.85rem] text-left text-[1rem] transition-colors duration-150 cursor-pointer"
          :class="currentCategory === 'status' ? 'bg-surface-alt font-bold text-text' : 'bg-transparent text-muted hover:bg-surface-hover hover:text-text'"
        >
          <span class="mt-[0.1rem] h-[1.25rem] w-[1.25rem] shrink-0" :class="currentCategory === 'status' ? 'i-fluent-data-usage-20-filled' : 'i-fluent-data-usage-20-regular'" aria-hidden="true"></span>
          <span class="flex flex-col gap-[0.1rem] min-w-0">
            <span>{{ t('settings.sections.status.label') }}</span>
            <span class="text-[0.75rem] font-normal text-muted">{{ t('settings.sections.status.description') }}</span>
          </span>
        </button>
      </nav>

      <!-- Content Area -->
      <div class="flex-1 w-full min-w-0 flex flex-col gap-[1.15rem]">
        
        <!-- CATEGORY: ACCESS -->
        <template v-if="currentCategory === 'access'">
          <section class="card grid gap-[1.15rem] p-8">
            <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.access.section.title') }}</h2>
                <p class="m-0 mt-[0.35rem] text-muted">{{ t('settings.access.section.description') }}</p>
              </div>
              <span
                class="inline-flex items-center justify-center min-h-8 px-[0.7rem] py-[0.35rem] rounded-full text-[0.76rem] font-bold whitespace-nowrap"
                :class="authStore.enabled ? 'text-accent-strong bg-[color-mix(in_srgb,var(--accent-soft)_78%,transparent_22%)]' : 'text-muted bg-surface-alt'"
              >
                {{ authStore.enabled ? t('settings.access.section.locked') : t('settings.access.section.open') }}
              </span>
            </div>

            <p class="m-0 text-muted">
              {{ authProtectionDescription }}
            </p>

            <div v-if="authFeedback" class="rounded-[0.95rem] px-4 py-3 text-[0.9rem]" :class="authFeedback.tone === 'error' ? 'border border-[rgba(214,48,49,0.24)] text-[#c0392b] bg-[rgba(214,48,49,0.08)]' : 'border border-[rgba(24,119,242,0.2)] text-accent-strong bg-[rgba(24,119,242,0.08)]'">
              {{ authFeedback.message }}
            </div>

            <section v-if="!authStore.enabled" class="grid gap-[1rem]">
              <div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <label class="grid min-w-0 gap-[0.45rem]">
                  <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.adminPassword') }}</span>
                  <input
                    v-model="enablePassword"
                    class="h-12 min-w-0 w-full rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    type="password"
                    autocomplete="new-password"
                    :placeholder="t('settings.access.placeholders.minimumLength', { count: 8 })"
                    :disabled="authStore.loading"
                  />
                </label>
                <label class="grid min-w-0 gap-[0.45rem]">
                  <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.confirmPassword') }}</span>
                  <input
                    v-model="enablePasswordConfirmation"
                    class="h-12 min-w-0 w-full rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    type="password"
                    autocomplete="new-password"
                    :placeholder="t('settings.access.placeholders.repeatPassword')"
                    :disabled="authStore.loading"
                  />
                </label>
              </div>

              <div class="flex flex-col md:flex-row items-center gap-4 max-sm:items-stretch">
                <p class="m-0 flex-1 text-muted">{{ t('settings.access.enable.description') }}</p>
                <button class="btn-primary w-full sm:w-auto sm:min-w-[13rem]" type="button" :disabled="authStore.loading" @click="enableAccessProtection">
                  {{ authStore.loading ? t('settings.access.enable.buttonLoading') : t('settings.access.enable.buttonIdle') }}
                </button>
              </div>
            </section>

            <section v-else class="grid gap-[1rem]">
              <!-- Change Password -->
              <div class="grid gap-[0.9rem] rounded-[1.05rem] border border-border p-5">
                <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
                  <div>
                    <h3 class="m-0 text-[1rem]">{{ t('settings.access.change.title') }}</h3>
                    <p class="m-0 mt-[0.25rem] text-muted">{{ t('settings.access.change.description') }}</p>
                  </div>
                  <button
                    class="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-[rgba(24,119,242,0.2)] bg-[rgba(24,119,242,0.08)] px-4 text-[0.9rem] font-semibold text-accent-strong transition-colors duration-180 hover:bg-[rgba(24,119,242,0.16)] disabled:cursor-wait disabled:opacity-60 max-sm:w-full"
                    type="button"
                    :aria-expanded="showChangePasswordForm"
                    :disabled="authStore.loading"
                    @click="toggleChangePasswordForm"
                  >
                    {{ showChangePasswordForm ? t('settings.access.change.hideForm') : t('settings.access.change.showForm') }}
                  </button>
                </div>

                <template v-if="showChangePasswordForm">
                  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <label class="grid gap-[0.45rem]">
                      <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.currentPassword') }}</span>
                      <input
                        v-model="currentPassword"
                        class="h-12 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                        type="password"
                        autocomplete="current-password"
                        :disabled="authStore.loading"
                      />
                    </label>
                    <label class="grid gap-[0.45rem]">
                      <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.newPassword') }}</span>
                      <input
                        v-model="nextPassword"
                        class="h-12 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                        type="password"
                        autocomplete="new-password"
                        :disabled="authStore.loading"
                      />
                    </label>
                    <label class="grid gap-[0.45rem]">
                      <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.confirmNewPassword') }}</span>
                      <input
                        v-model="nextPasswordConfirmation"
                        class="h-12 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                        type="password"
                        autocomplete="new-password"
                        :disabled="authStore.loading"
                      />
                    </label>
                  </div>

                  <div class="flex flex-col md:flex-row items-center gap-4 max-sm:items-stretch">
                    <p class="m-0 flex-1 text-muted">{{ t('settings.access.change.helper') }}</p>
                    <button class="btn-primary min-w-[13rem]" type="button" :disabled="authStore.loading" @click="changeAccessPassword">
                      {{ authStore.loading ? t('settings.access.change.buttonLoading') : t('settings.access.change.buttonIdle') }}
                    </button>
                  </div>
                </template>
              </div>
              
              <!-- Viewer Access -->
              <div class="grid gap-[0.9rem] rounded-[1.05rem] border border-border p-5">
                <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
                  <div>
                    <h3 class="m-0 text-[1rem]">{{ t('settings.access.viewer.title') }}</h3>
                    <p class="m-0 mt-[0.25rem] text-muted">{{ t('settings.access.viewer.description') }}</p>
                  </div>
                  <span
                    class="inline-flex items-center justify-center min-h-8 px-[0.7rem] py-[0.35rem] rounded-full text-[0.76rem] font-bold whitespace-nowrap"
                    :class="viewerAccessStatusTone"
                  >
                    {{ viewerAccessStatusLabel }}
                  </span>
                </div>

                <div
                  class="rounded-[0.95rem] border px-4 py-3"
                  :class="viewerAccessActive ? 'border-[rgba(24,119,242,0.18)] bg-[rgba(24,119,242,0.06)]' : 'border-border bg-[color-mix(in_srgb,var(--surface-alt)_82%,transparent_18%)]'"
                >
                  <p class="m-0 text-[0.92rem] font-semibold text-text">{{ viewerAccessSummaryTitle }}</p>
                  <p class="m-0 mt-[0.3rem] text-[0.88rem] text-muted">{{ viewerAccessSummary }}</p>
                </div>

                <div class="grid gap-[0.7rem] mt-2">
                  <label class="flex items-start gap-3 rounded-[0.9rem] border border-border px-4 py-3 cursor-pointer">
                    <input v-model="viewerAccessMode" class="mt-[0.2rem]" type="radio" value="off" :disabled="authStore.loading" />
                    <span class="grid gap-[0.15rem]">
                      <span class="text-[0.92rem] font-semibold text-text">{{ t('settings.access.viewer.modes.adminOnlyTitle') }}</span>
                      <span class="text-[0.84rem] text-muted">{{ t('settings.access.viewer.modes.adminOnlyDescription') }}</span>
                    </span>
                  </label>
                  <label class="flex items-start gap-3 rounded-[0.9rem] border border-border px-4 py-3 cursor-pointer">
                    <input v-model="viewerAccessMode" class="mt-[0.2rem]" type="radio" value="password" :disabled="authStore.loading" />
                    <span class="grid gap-[0.15rem]">
                      <span class="text-[0.92rem] font-semibold text-text">{{ t('settings.access.viewer.modes.viewerPasswordTitle') }}</span>
                      <span class="text-[0.84rem] text-muted">{{ t('settings.access.viewer.modes.viewerPasswordDescription') }}</span>
                    </span>
                  </label>
                  <label class="flex items-start gap-3 rounded-[0.9rem] border border-border px-4 py-3 cursor-pointer">
                    <input v-model="viewerAccessMode" class="mt-[0.2rem]" type="radio" value="public" :disabled="authStore.loading" />
                    <span class="grid gap-[0.15rem]">
                      <span class="text-[0.92rem] font-semibold text-text">{{ t('settings.access.viewer.modes.publicTitle') }}</span>
                      <span class="text-[0.84rem] text-muted">{{ t('settings.access.viewer.modes.publicDescription') }}</span>
                    </span>
                  </label>
                </div>

                <div v-if="viewerAccessMode === 'password'" class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  <label class="grid gap-[0.45rem]">
                    <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.viewerPassword') }}</span>
                    <input
                      v-model="viewerPassword"
                      class="h-12 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                      type="password"
                      autocomplete="new-password"
                      :placeholder="viewerAccessEnabled ? t('settings.access.placeholders.enterNewViewerPassword') : t('settings.access.placeholders.minimumLength', { count: 8 })"
                      :disabled="authStore.loading"
                    />
                  </label>
                  <label class="grid gap-[0.45rem]">
                    <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.confirmViewerPassword') }}</span>
                    <input
                      v-model="viewerPasswordConfirmation"
                      class="h-12 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                      type="password"
                      autocomplete="new-password"
                      :placeholder="viewerAccessEnabled ? t('settings.access.placeholders.repeatNewViewerPassword') : t('settings.access.placeholders.repeatViewerPassword')"
                      :disabled="authStore.loading"
                    />
                  </label>
                </div>

                <div class="flex flex-col md:flex-row items-center gap-4 max-sm:items-stretch mt-3">
                  <p class="m-0 flex-1 text-muted">{{ viewerAccessDescription }}</p>
                  <button class="btn-primary min-w-[13rem]" type="button" :disabled="authStore.loading" @click="saveViewerAccess">
                    {{ authStore.loading ? 'Saving...' : viewerAccessButtonLabel }}
                  </button>
                </div>

                <div v-if="viewerFeedback" class="rounded-[0.95rem] px-4 py-3 text-[0.9rem] mt-2" :class="viewerFeedback.tone === 'error' ? 'border border-[rgba(214,48,49,0.24)] text-[#c0392b] bg-[rgba(214,48,49,0.08)]' : 'border border-[rgba(24,119,242,0.2)] text-accent-strong bg-[rgba(24,119,242,0.08)]'">
                  {{ viewerFeedback.message }}
                </div>
              </div>
              
            </section>
          </section>

          <!-- Danger Zone -->
          <div v-if="authStore.enabled" class="border border-[rgba(214,48,49,0.3)] rounded-[1.05rem] overflow-hidden">
            <div class="bg-[rgba(214,48,49,0.04)] px-6 py-4 border-b border-[rgba(214,48,49,0.1)]">
              <h3 class="m-0 text-[1rem] text-[#c0392b] font-bold">{{ t('settings.access.danger.title') }}</h3>
            </div>
            <div class="p-6 grid gap-[0.9rem] bg-surface">
              <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
                <div>
                  <h3 class="m-0 text-[1rem]">{{ t('settings.access.danger.disableTitle') }}</h3>
                  <p class="m-0 mt-[0.25rem] text-muted">{{ t('settings.access.danger.disableDescription') }}</p>
                </div>
                <button
                  class="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-[rgba(214,48,49,0.24)] bg-[rgba(214,48,49,0.08)] px-4 text-[0.9rem] font-semibold text-[#c0392b] transition-colors duration-180 hover:bg-[rgba(214,48,49,0.16)] disabled:cursor-wait disabled:opacity-60 max-sm:w-full"
                  type="button"
                  :aria-expanded="showDisablePasswordForm"
                  :disabled="authStore.loading"
                  @click="toggleDisablePasswordForm"
                >
                  {{ showDisablePasswordForm ? t('settings.access.danger.hideForm') : t('settings.access.danger.showForm') }}
                </button>
              </div>

              <template v-if="showDisablePasswordForm">
                <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-end max-lg:grid-cols-1 mt-2">
                  <label class="grid gap-[0.45rem]">
                    <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.access.fields.currentPassword') }}</span>
                    <input
                      v-model="disablePassword"
                      class="h-12 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                      type="password"
                      autocomplete="current-password"
                      :disabled="authStore.loading"
                    />
                  </label>
                  <button class="btn-primary min-w-[13rem] bg-[#d93025] hover:bg-[#c5281c] border-transparent text-white" type="button" :disabled="authStore.loading" @click="disableAccessProtection">
                    {{ authStore.loading ? t('settings.access.danger.buttonLoading') : t('settings.access.danger.buttonIdle') }}
                  </button>
                  <button class="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-border bg-transparent px-4 text-[0.92rem] font-semibold text-text transition-colors duration-180 hover:bg-surface-alt disabled:cursor-wait disabled:opacity-60" type="button" :disabled="authStore.loading" @click="signOut">
                    {{ t('settings.access.danger.signOut') }}
                  </button>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- CATEGORY: GENERAL -->
        <template v-if="currentCategory === 'general'">
          <section
            v-if="showCarouselsMigrationNotice"
            class="card grid gap-[1rem] p-6 border-[color-mix(in_srgb,#d2a133_42%,var(--border)_58%)]"
            style="background: radial-gradient(circle at top right, rgba(210,161,51,0.18), transparent 40%), linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, #fff3cf 6%) 0%, color-mix(in srgb, var(--surface) 88%, #ffe6a6 12%) 100%);"
          >
            <div class="grid gap-[0.3rem]">
              <span class="eyebrow text-[#9f6a00]">{{ t('settings.general.carouselsMigration.eyebrow') }}</span>
              <h2 class="m-0 text-[1.1rem]">{{ t('settings.general.carouselsMigration.title') }}</h2>
              <p class="m-0 text-muted">{{ t('settings.general.carouselsMigration.description') }}</p>
            </div>
            <div class="flex flex-col md:flex-row items-center gap-3 max-sm:items-stretch">
              <button class="btn-primary min-w-[13rem]" type="button" :disabled="savingGeneralSettings" @click="chooseCarouselsMigrationMode(false)">
                {{ t('settings.general.carouselsMigration.useFeature') }}
              </button>
              <button class="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-border bg-transparent px-4 text-[0.92rem] font-semibold text-text" type="button" :disabled="savingGeneralSettings" @click="chooseCarouselsMigrationMode(true)">
                {{ t('settings.general.carouselsMigration.keepFolders') }}
              </button>
            </div>
            <p class="m-0 text-muted">{{ t('settings.general.carouselsMigration.helper') }}</p>
          </section>

          <section
            v-else-if="showCarouselsAnnouncementCard"
            class="card grid gap-[1rem] border-[color-mix(in_srgb,var(--border)_84%,#8cc8ff_16%)] p-6"
            style="background: linear-gradient(135deg, color-mix(in srgb, var(--surface) 97%, #f7fbff 3%) 0%, color-mix(in srgb, var(--surface) 93%, #e6f3ff 7%) 100%);"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="grid gap-[0.3rem]">
                <div class="flex items-center gap-2">
                  <h2 class="m-0 text-xl">{{ t('settings.general.carouselsAnnouncement.title') }}</h2>
                  <span class="eyebrow inline-flex w-fit self-start text-xs">{{ t('common.newFeature') }}</span>
                </div>
                <p class="m-0 text-[0.95rem] font-medium text-text">{{ t('settings.general.carouselsAnnouncement.headline') }}</p>
                <p class="m-0 text-muted">
                  {{ t('settings.general.carouselsAnnouncement.description') }}
                  <button
                    class="ml-1 inline-flex border-0 bg-transparent p-0 text-[0.92em] font-semibold text-accent-strong underline underline-offset-[0.18em] cursor-pointer transition-opacity duration-180 hover:opacity-80"
                    type="button"
                    :aria-expanded="showCarouselsAnnouncementStructure"
                    @click="toggleCarouselsAnnouncementStructure"
                  >
                    {{ showCarouselsAnnouncementStructure ? t('settings.general.carouselsAnnouncement.hideStructure') : t('settings.general.carouselsAnnouncement.showStructure') }}
                  </button>
                </p>
              </div>
              <button
                class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-[rgba(24,119,242,0.08)] text-accent-strong cursor-pointer transition-colors duration-180 hover:bg-[rgba(24,119,242,0.14)]"
                type="button"
                :aria-label="t('settings.general.carouselsAnnouncement.dismissAria')"
                @click="dismissCarouselsAnnouncement"
              >
                <span class="i-fluent-dismiss-20-filled h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <pre v-if="showCarouselsAnnouncementStructure" class="m-0 overflow-x-auto rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_82%,transparent_18%)] p-4 text-[0.78rem] leading-[1.55] text-muted"><code>gallery/
└─ AnimalPlanet/
   ├─ cover.jpg
   ├─ post-1.jpg
   └─ carousels/
      ├─ Safari/
      │  ├─ 01-arrival.jpg
      │  ├─ 02-lions.mp4
      │  └─ 03-sunset.jpg
      └─ Portraits/
         ├─ front.jpg
         └─ detail.jpg</code></pre>
          </section>

          <section
            v-if="showStoriesMigrationNotice"
            class="card grid gap-[1rem] p-6 border-[color-mix(in_srgb,#d2a133_42%,var(--border)_58%)]"
            style="background: radial-gradient(circle at top right, rgba(210,161,51,0.18), transparent 40%), linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, #fff3cf 6%) 0%, color-mix(in srgb, var(--surface) 88%, #ffe6a6 12%) 100%);"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="grid gap-[0.3rem]">
                <span class="eyebrow text-[#9f6a00]">{{ t('settings.general.migration.eyebrow') }}</span>
                <h2 class="m-0 text-[1.1rem]">{{ t('settings.general.migration.title') }}</h2>
                <p class="m-0 text-muted">{{ t('settings.general.migration.description') }}</p>
              </div>
              <button
                class="inline-flex h-9 w-9 items-center justify-center rounded-full border-0 bg-[rgba(159,106,0,0.08)] text-[#9f6a00] cursor-pointer transition-colors duration-180 hover:bg-[rgba(159,106,0,0.14)]"
                type="button"
                :aria-label="t('settings.general.migration.dismissAria')"
                @click="dismissStoriesMigrationNotice"
              >
                <span class="i-fluent-dismiss-20-filled h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div class="flex flex-col md:flex-row items-center gap-3 max-sm:items-stretch">
              <button
                class="btn-primary min-w-[13rem]"
                type="button"
                :disabled="savingGeneralSettings || waitingForInitialStatus"
                @click="chooseStoriesMigrationMode(false)"
              >
                {{ t('settings.general.migration.useFeature') }}
              </button>
              <button
                class="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-border bg-transparent px-4 text-[0.92rem] font-semibold text-text transition-colors duration-180 hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                :disabled="savingGeneralSettings || waitingForInitialStatus"
                @click="chooseStoriesMigrationMode(true)"
              >
                {{ t('settings.general.migration.keepLegacy') }}
              </button>
            </div>
            <p class="m-0 text-muted">{{ storiesMigrationActionHelper }}</p>
          </section>

          <section
            v-else-if="showStoriesAnnouncementCard"
            class="card grid gap-[1rem] border-[color-mix(in_srgb,var(--border)_84%,#8cc8ff_16%)] p-6"
            style="background: linear-gradient(135deg, color-mix(in srgb, var(--surface) 97%, #f7fbff 3%) 0%, color-mix(in srgb, var(--surface) 93%, #e6f3ff 7%) 100%);"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="grid gap-[0.3rem]">
                <div class="flex items-center gap-2">
                  <h2 class="m-0 text-xl">{{ t('settings.general.announcement.title') }}</h2>
                  <span class="eyebrow inline-flex w-fit self-start text-xs">{{ t('common.newFeature') }}</span>
                </div>
                <p class="m-0 text-[0.95rem] font-medium text-text">{{ t('settings.general.announcement.headline') }}</p>
                <p class="m-0 text-muted">
                  {{ t('settings.general.announcement.description') }}
                  <button
                    class="ml-1 inline-flex border-0 bg-transparent p-0 text-[0.92em] font-semibold text-accent-strong underline underline-offset-[0.18em] cursor-pointer transition-opacity duration-180 hover:opacity-80"
                    type="button"
                    :aria-expanded="showStoriesAnnouncementStructure"
                    @click="toggleStoriesAnnouncementStructure"
                  >
                    {{ showStoriesAnnouncementStructure ? t('settings.general.announcement.hideStructure') : t('settings.general.announcement.showStructure') }}
                  </button>
                </p>
              </div>
              <button
                class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-[rgba(24,119,242,0.08)] text-accent-strong cursor-pointer transition-colors duration-180 hover:bg-[rgba(24,119,242,0.14)]"
                type="button"
                :aria-label="t('settings.general.announcement.dismissAria')"
                @click="dismissStoriesAnnouncement"
              >
                <span class="i-fluent-dismiss-20-filled h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <pre v-if="showStoriesAnnouncementStructure" class="m-0 overflow-x-auto rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_82%,transparent_18%)] p-4 text-[0.78rem] leading-[1.55] text-muted"><code>gallery/
└─ AnimalPlanet/
   ├─ cover.jpg
   ├─ post-1.jpg
   └─ stories/
      ├─ story-1.mp4
      ├─ story-2.jpg
      ├─ Lions/
      │  ├─ clip-1.mp4
      │  └─ nested-1/
      │     └─ clip-2.jpg
      └─ Tigers/
         └─ tiger-1.jpg</code></pre>
          </section>

          <section class="card overflow-visible p-0">
            <div class="border-b border-border px-6 py-5">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.general.card.title') }}</h2>
                <p class="m-0 mt-[0.25rem] text-muted">{{ t('settings.general.card.description') }}</p>
              </div>
            </div>

            <div
              v-if="generalSettingsFeedback"
              class="mx-6 mt-5 rounded-[0.95rem] px-4 py-3 text-[0.9rem]"
              :class="generalSettingsFeedback.tone === 'error' ? 'border border-[rgba(214,48,49,0.24)] text-[#c0392b] bg-[rgba(214,48,49,0.08)]' : 'border border-[rgba(24,119,242,0.2)] text-accent-strong bg-[rgba(24,119,242,0.08)]'"
            >
              {{ generalSettingsFeedback.message }}
            </div>

            <div class="divide-y divide-border">
              <div class="px-6 py-4">
                <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div class="min-w-0">
                    <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.language.label') }}</p>
                    <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.language.description') }}</p>
                    <p class="m-0 mt-[0.4rem] text-[0.78rem] text-muted">{{ t('settings.general.language.helper') }}</p>
                  </div>

                  <div class="relative w-full md:w-[18rem] md:justify-self-end">
                    <label class="sr-only" :for="localeSelectId">{{ t('settings.general.language.selectLabel') }}</label>
                    <select
                      :id="localeSelectId"
                      class="h-[3.2rem] w-full appearance-none rounded-[0.9rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent_20%)] px-3 pr-11 text-[0.9rem] font-semibold text-text outline-none transition-[border-color,box-shadow] duration-180 hover:border-[color-mix(in_srgb,var(--accent)_22%,var(--border)_78%)] hover:bg-surface-hover focus:border-[color-mix(in_srgb,var(--accent)_35%,var(--border)_65%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                      :disabled="savingGeneralSettings || waitingForInitialStatus"
                      :value="appStore.locale"
                      @change="handleLocaleChange"
                    >
                      <option v-for="locale in supportedLocaleOptions" :key="locale.id" :value="locale.id">
                        {{ locale.label }}
                      </option>
                    </select>
                    <span
                      class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
                      aria-hidden="true"
                    >
                      <span class="i-fluent-chevron-down-20-regular block h-5 w-5" />
                    </span>
                  </div>
                </div>

                <div
                  v-if="showSavedDefaultLocaleNotice"
                  data-testid="locale-override-notice"
                  role="status"
                  class="mt-3 rounded-[0.95rem] border border-[rgba(24,119,242,0.2)] bg-[rgba(24,119,242,0.08)] px-4 py-3 text-[0.82rem] leading-[1.5] text-accent-strong"
                >
                  {{ t('settings.general.language.overrideNotice', { savedLabel: savedLocaleOptionLabel, currentLabel: selectedLocaleOptionLabel }) }}
                </div>
              </div>

              <div class="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div class="min-w-0">
                  <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.homeFeed.label') }}</p>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.homeFeed.description') }}</p>
                </div>

                <div class="relative w-full md:w-[18rem] md:justify-self-end" @keydown.escape.stop.prevent="closeGeneralSettingsMenu">
                  <button
                    class="inline-flex w-full items-center justify-between gap-3 rounded-[0.9rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent_20%)] px-3 py-[0.85rem] text-left transition-[border-color,box-shadow] duration-180 hover:border-[color-mix(in_srgb,var(--accent)_22%,var(--border)_78%)] hover:bg-surface-hover focus-visible:border-[color-mix(in_srgb,var(--accent)_35%,var(--border)_65%)] focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    type="button"
                    :aria-expanded="activeGeneralSettingsMenu === 'home'"
                    :disabled="savingGeneralSettings || waitingForInitialStatus"
                    @click="toggleGeneralSettingsMenu('home')"
                  >
                    <span class="min-w-0 truncate text-[0.9rem] font-semibold text-text">
                      {{ selectedHomeFeedDefaultOption.label }}
                    </span>
                    <span
                      class="i-fluent-chevron-down-20-regular h-5 w-5 shrink-0 text-muted transition-transform duration-180"
                      :class="activeGeneralSettingsMenu === 'home' ? 'rotate-180 text-text' : ''"
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    v-if="activeGeneralSettingsMenu === 'home'"
                    class="fixed inset-0 z-40 border-0 bg-transparent"
                    type="button"
                    :aria-label="t('settings.general.homeFeed.closeMenuAria')"
                    @click="closeGeneralSettingsMenu"
                  />

                  <div
                    v-if="activeGeneralSettingsMenu === 'home'"
                    class="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-full overflow-hidden rounded-[1rem] border border-border bg-[color-mix(in_srgb,var(--surface)_97%,var(--bg)_3%)] shadow-[0_28px_70px_rgba(0,0,0,0.16)]"
                  >
                    <div class="border-b border-border px-4 py-3">
                      <p class="m-0 text-[0.83rem] font-semibold text-text">{{ t('settings.general.homeFeed.label') }}</p>
                    </div>
                    <div class="grid gap-1 p-2">
                      <button
                        v-for="mode in homeFeedDefaultOptions"
                        :key="mode.id"
                        class="flex items-start gap-3 rounded-[0.85rem] border-0 px-3 py-3 text-left cursor-pointer transition-colors duration-150 hover:bg-surface-hover"
                        :class="homeFeedDefaultMode === mode.id ? 'bg-[color-mix(in_srgb,var(--accent-soft)_72%,transparent_28%)]' : 'bg-transparent'"
                        type="button"
                        @click="selectHomeFeedDefault(mode.id)"
                      >
                        <span class="mt-[0.05rem] inline-flex h-5 w-5 items-center justify-center shrink-0 text-accent-strong">
                          <span v-if="homeFeedDefaultMode === mode.id" class="i-fluent-checkmark-20-filled h-4 w-4" aria-hidden="true" />
                        </span>
                        <span class="grid min-w-0 gap-[0.08rem]">
                          <span class="text-[0.9rem] font-semibold text-text">{{ mode.label }}</span>
                          <span class="text-[0.78rem] text-muted">{{ mode.description }}</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div class="min-w-0">
                  <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.reelsFeed.label') }}</p>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.reelsFeed.description') }}</p>
                </div>

                <div class="relative w-full md:w-[18rem] md:justify-self-end" @keydown.escape.stop.prevent="closeGeneralSettingsMenu">
                  <button
                    class="inline-flex w-full items-center justify-between gap-3 rounded-[0.9rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent_20%)] px-3 py-[0.85rem] text-left transition-[border-color,box-shadow] duration-180 hover:border-[color-mix(in_srgb,var(--accent)_22%,var(--border)_78%)] hover:bg-surface-hover focus-visible:border-[color-mix(in_srgb,var(--accent)_35%,var(--border)_65%)] focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    type="button"
                    :aria-expanded="activeGeneralSettingsMenu === 'reels'"
                    :disabled="savingGeneralSettings || waitingForInitialStatus"
                    @click="toggleGeneralSettingsMenu('reels')"
                  >
                    <span class="min-w-0 truncate text-[0.9rem] font-semibold text-text">
                      {{ selectedReelsFeedDefaultOption.label }}
                    </span>
                    <span
                      class="i-fluent-chevron-down-20-regular h-5 w-5 shrink-0 text-muted transition-transform duration-180"
                      :class="activeGeneralSettingsMenu === 'reels' ? 'rotate-180 text-text' : ''"
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    v-if="activeGeneralSettingsMenu === 'reels'"
                    class="fixed inset-0 z-40 border-0 bg-transparent"
                    type="button"
                    :aria-label="t('settings.general.reelsFeed.closeMenuAria')"
                    @click="closeGeneralSettingsMenu"
                  />

                  <div
                    v-if="activeGeneralSettingsMenu === 'reels'"
                    class="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-full overflow-hidden rounded-[1rem] border border-border bg-[color-mix(in_srgb,var(--surface)_97%,var(--bg)_3%)] shadow-[0_28px_70px_rgba(0,0,0,0.16)]"
                  >
                    <div class="border-b border-border px-4 py-3">
                      <p class="m-0 text-[0.83rem] font-semibold text-text">{{ t('settings.general.reelsFeed.label') }}</p>
                    </div>
                    <div class="grid gap-1 p-2">
                      <button
                        v-for="mode in reelsFeedDefaultOptions"
                        :key="mode.id"
                        class="flex items-start gap-3 rounded-[0.85rem] border-0 px-3 py-3 text-left cursor-pointer transition-colors duration-150 hover:bg-surface-hover"
                        :class="reelsFeedDefaultMode === mode.id ? 'bg-[color-mix(in_srgb,var(--accent-soft)_72%,transparent_28%)]' : 'bg-transparent'"
                        type="button"
                        @click="selectReelsFeedDefault(mode.id)"
                      >
                        <span class="mt-[0.05rem] inline-flex h-5 w-5 items-center justify-center shrink-0 text-accent-strong">
                          <span v-if="reelsFeedDefaultMode === mode.id" class="i-fluent-checkmark-20-filled h-4 w-4" aria-hidden="true" />
                        </span>
                        <span class="grid min-w-0 gap-[0.08rem]">
                          <span class="text-[0.9rem] font-semibold text-text">{{ mode.label }}</span>
                          <span class="text-[0.78rem] text-muted">{{ mode.description }}</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div class="min-w-0">
                  <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.folderOrder.label') }}</p>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.folderOrder.description') }}</p>
                </div>

                <div class="relative w-full md:w-[18rem] md:justify-self-end" @keydown.escape.stop.prevent="closeGeneralSettingsMenu">
                  <button
                    class="inline-flex w-full items-center justify-between gap-3 rounded-[0.9rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent_20%)] px-3 py-[0.85rem] text-left transition-[border-color,box-shadow] duration-180 hover:border-[color-mix(in_srgb,var(--accent)_22%,var(--border)_78%)] hover:bg-surface-hover focus-visible:border-[color-mix(in_srgb,var(--accent)_35%,var(--border)_65%)] focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    type="button"
                    :aria-expanded="activeGeneralSettingsMenu === 'folder'"
                    :disabled="savingGeneralSettings || waitingForInitialStatus"
                    @click="toggleGeneralSettingsMenu('folder')"
                  >
                    <span class="min-w-0 truncate text-[0.9rem] font-semibold text-text">
                      {{ selectedFolderImageOrderOption.label }}
                    </span>
                    <span
                      class="i-fluent-chevron-down-20-regular h-5 w-5 shrink-0 text-muted transition-transform duration-180"
                      :class="activeGeneralSettingsMenu === 'folder' ? 'rotate-180 text-text' : ''"
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    v-if="activeGeneralSettingsMenu === 'folder'"
                    class="fixed inset-0 z-40 border-0 bg-transparent"
                    type="button"
                    :aria-label="t('settings.general.folderOrder.closeMenuAria')"
                    @click="closeGeneralSettingsMenu"
                  />

                  <div
                    v-if="activeGeneralSettingsMenu === 'folder'"
                    class="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-full overflow-hidden rounded-[1rem] border border-border bg-[color-mix(in_srgb,var(--surface)_97%,var(--bg)_3%)] shadow-[0_28px_70px_rgba(0,0,0,0.16)]"
                  >
                    <div class="border-b border-border px-4 py-3">
                      <p class="m-0 text-[0.83rem] font-semibold text-text">{{ t('settings.general.folderOrder.label') }}</p>
                    </div>
                    <div class="grid gap-1 p-2">
                      <button
                        v-for="mode in folderImageOrderOptions"
                        :key="mode.id"
                        class="flex items-start gap-3 rounded-[0.85rem] border-0 px-3 py-3 text-left cursor-pointer transition-colors duration-150 hover:bg-surface-hover"
                        :class="folderImageOrderDefault === mode.id ? 'bg-[color-mix(in_srgb,var(--accent-soft)_72%,transparent_28%)]' : 'bg-transparent'"
                        type="button"
                        @click="selectFolderImageOrderDefault(mode.id)"
                      >
                        <span class="mt-[0.05rem] inline-flex h-5 w-5 items-center justify-center shrink-0 text-accent-strong">
                          <span v-if="folderImageOrderDefault === mode.id" class="i-fluent-checkmark-20-filled h-4 w-4" aria-hidden="true" />
                        </span>
                        <span class="grid min-w-0 gap-[0.08rem]">
                          <span class="text-[0.9rem] font-semibold text-text">{{ mode.label }}</span>
                          <span class="text-[0.78rem] text-muted">{{ mode.description }}</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div class="min-w-0">
                  <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.nestedFolderTitle.label') }}</p>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.nestedFolderTitle.description') }}</p>
                </div>

                <div class="relative w-full md:w-[18rem] md:justify-self-end" @keydown.escape.stop.prevent="closeGeneralSettingsMenu">
                  <button
                    class="inline-flex w-full items-center justify-between gap-3 rounded-[0.9rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent_20%)] px-3 py-[0.85rem] text-left transition-[border-color,box-shadow] duration-180 hover:border-[color-mix(in_srgb,var(--accent)_22%,var(--border)_78%)] hover:bg-surface-hover focus-visible:border-[color-mix(in_srgb,var(--accent)_35%,var(--border)_65%)] focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    type="button"
                    :aria-expanded="activeGeneralSettingsMenu === 'nestedTitle'"
                    :disabled="savingGeneralSettings || waitingForInitialStatus"
                    @click="toggleGeneralSettingsMenu('nestedTitle')"
                  >
                    <span class="min-w-0 truncate text-[0.9rem] font-semibold text-text">
                      {{ selectedNestedFolderTitleOption.label }}
                    </span>
                    <span
                      class="i-fluent-chevron-down-20-regular h-5 w-5 shrink-0 text-muted transition-transform duration-180"
                      :class="activeGeneralSettingsMenu === 'nestedTitle' ? 'rotate-180 text-text' : ''"
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    v-if="activeGeneralSettingsMenu === 'nestedTitle'"
                    class="fixed inset-0 z-40 border-0 bg-transparent"
                    type="button"
                    :aria-label="t('settings.general.nestedFolderTitle.closeMenuAria')"
                    @click="closeGeneralSettingsMenu"
                  />

                  <div
                    v-if="activeGeneralSettingsMenu === 'nestedTitle'"
                    class="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-full overflow-hidden rounded-[1rem] border border-border bg-[color-mix(in_srgb,var(--surface)_97%,var(--bg)_3%)] shadow-[0_28px_70px_rgba(0,0,0,0.16)]"
                  >
                    <div class="border-b border-border px-4 py-3">
                      <p class="m-0 text-[0.83rem] font-semibold text-text">{{ t('settings.general.nestedFolderTitle.label') }}</p>
                    </div>
                    <div class="grid gap-1 p-2">
                      <button
                        v-for="option in nestedFolderTitleOptions"
                        :key="option.id"
                        class="flex items-start gap-3 rounded-[0.85rem] border-0 px-3 py-3 text-left cursor-pointer transition-colors duration-150 hover:bg-surface-hover"
                        :class="nestedFolderTitleFormat === option.id ? 'bg-[color-mix(in_srgb,var(--accent-soft)_72%,transparent_28%)]' : 'bg-transparent'"
                        type="button"
                        @click="selectNestedFolderTitleFormat(option.id)"
                      >
                        <span class="mt-[0.05rem] inline-flex h-5 w-5 items-center justify-center shrink-0 text-accent-strong">
                          <span v-if="nestedFolderTitleFormat === option.id" class="i-fluent-checkmark-20-filled h-4 w-4" aria-hidden="true" />
                        </span>
                        <span class="grid min-w-0 gap-[0.08rem]">
                          <span class="text-[0.9rem] font-semibold text-text">{{ option.label }}</span>
                          <span class="text-[0.78rem] text-muted">{{ option.description }}</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div class="min-w-0">
                  <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.videoPlaybackQuality.label') }}</p>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.videoPlaybackQuality.description') }}</p>
                  <p
                    v-if="videoPlaybackQualityDeviceOverride"
                    class="m-0 mt-[0.35rem] flex flex-wrap items-center gap-2 text-[0.8rem] text-muted"
                  >
                    <span>
                      {{ t('settings.general.videoPlaybackQuality.deviceOverride', { value: videoPlaybackQualityOverrideLabel }) }}
                    </span>
                    <button
                      class="inline-flex items-center rounded-full border-0 bg-surface-alt px-2 py-[0.2rem] text-[0.76rem] font-semibold text-accent-strong cursor-pointer transition-colors duration-150 hover:bg-surface-hover"
                      type="button"
                      @click="clearVideoPlaybackQualityOverride"
                    >
                      {{ t('settings.general.videoPlaybackQuality.useLibraryDefault') }}
                    </button>
                  </p>
                </div>

                <div class="relative w-full md:w-[18rem] md:justify-self-end" @keydown.escape.stop.prevent="closeGeneralSettingsMenu">
                  <button
                    class="inline-flex w-full items-center justify-between gap-3 rounded-[0.9rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent_20%)] px-3 py-[0.85rem] text-left transition-[border-color,box-shadow] duration-180 hover:border-[color-mix(in_srgb,var(--accent)_22%,var(--border)_78%)] hover:bg-surface-hover focus-visible:border-[color-mix(in_srgb,var(--accent)_35%,var(--border)_65%)] focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    type="button"
                    :aria-expanded="activeGeneralSettingsMenu === 'videoQuality'"
                    :disabled="savingGeneralSettings || waitingForInitialStatus"
                    @click="toggleGeneralSettingsMenu('videoQuality')"
                  >
                    <span class="min-w-0 truncate text-[0.9rem] font-semibold text-text">
                      {{ selectedVideoPlaybackQualityOption.label }}
                    </span>
                    <span
                      class="i-fluent-chevron-down-20-regular h-5 w-5 shrink-0 text-muted transition-transform duration-180"
                      :class="activeGeneralSettingsMenu === 'videoQuality' ? 'rotate-180 text-text' : ''"
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    v-if="activeGeneralSettingsMenu === 'videoQuality'"
                    class="fixed inset-0 z-40 border-0 bg-transparent"
                    type="button"
                    :aria-label="t('settings.general.videoPlaybackQuality.closeMenuAria')"
                    @click="closeGeneralSettingsMenu"
                  />

                  <div
                    v-if="activeGeneralSettingsMenu === 'videoQuality'"
                    class="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-full overflow-hidden rounded-[1rem] border border-border bg-[color-mix(in_srgb,var(--surface)_97%,var(--bg)_3%)] shadow-[0_28px_70px_rgba(0,0,0,0.16)]"
                  >
                    <div class="border-b border-border px-4 py-3">
                      <p class="m-0 text-[0.83rem] font-semibold text-text">{{ t('settings.general.videoPlaybackQuality.label') }}</p>
                    </div>
                    <div class="grid gap-1 p-2">
                      <button
                        v-for="option in videoPlaybackQualityOptions"
                        :key="option.id"
                        class="flex items-start gap-3 rounded-[0.85rem] border-0 px-3 py-3 text-left cursor-pointer transition-colors duration-150 hover:bg-surface-hover"
                        :class="videoPlaybackQuality === option.id ? 'bg-[color-mix(in_srgb,var(--accent-soft)_72%,transparent_28%)]' : 'bg-transparent'"
                        type="button"
                        @click="selectVideoPlaybackQuality(option.id)"
                      >
                        <span class="mt-[0.05rem] inline-flex h-5 w-5 items-center justify-center shrink-0 text-accent-strong">
                          <span v-if="videoPlaybackQuality === option.id" class="i-fluent-checkmark-20-filled h-4 w-4" aria-hidden="true" />
                        </span>
                        <span class="grid min-w-0 gap-[0.08rem]">
                          <span class="text-[0.9rem] font-semibold text-text">{{ option.label }}</span>
                          <span class="text-[0.78rem] text-muted">{{ option.description }}</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-3 border-t border-border px-6 py-4">
                <div class="min-w-0">
                  <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.sharePublicBaseUrl.label') }}</p>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.sharePublicBaseUrl.description') }}</p>
                </div>

                <label class="grid gap-[0.45rem]">
                  <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.general.sharePublicBaseUrl.fieldLabel') }}</span>
                  <input
                    v-model="sharePublicBaseUrlDraft"
                    class="min-h-11 rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 text-[0.95rem] text-text outline-none transition-[border-color,box-shadow] duration-180 placeholder:text-muted focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    data-test="share-public-base-url"
                    type="url"
                    inputmode="url"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="https://gallery.example.com"
                    :disabled="savingGeneralSettings || waitingForInitialStatus"
                    @input="clearGeneralSettingsFeedback"
                  />
                </label>

                <p class="m-0 text-[0.82rem] text-muted">{{ t('settings.general.sharePublicBaseUrl.helper') }}</p>
              </div>

              <div class="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.storiesMode.label') }}</p>
                    <span class="inline-flex items-center rounded-full bg-surface-alt px-2 py-[0.2rem] text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">
                      {{ t('settings.general.storiesMode.scanRequired') }}
                    </span>
                    <div class="group relative inline-flex">
                      <button
                        class="inline-flex h-6 w-6 items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted cursor-help transition-colors duration-150 hover:text-text focus-visible:text-text"
                        type="button"
                        :aria-label="t('settings.general.storiesMode.explainAria')"
                      >
                        <span class="i-fluent-info-16-regular h-4 w-4" aria-hidden="true" />
                      </button>
                      <div class="pointer-events-none absolute left-0 top-[calc(100%+0.55rem)] z-30 hidden w-[min(20rem,calc(100vw-2.5rem))] rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface)_97%,var(--bg)_3%)] px-3 py-3 text-[0.78rem] leading-[1.5] text-muted shadow-[0_20px_50px_rgba(0,0,0,0.16)] group-hover:block group-focus-within:block">
                        {{ t('settings.general.storiesMode.explainDescription') }}
                      </div>
                    </div>
                  </div>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ storiesModeLabelDescription }}</p>
                </div>

                <button
                  class="inline-flex items-center justify-end border-0 bg-transparent p-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  role="switch"
                  :aria-checked="storiesMode"
                  :disabled="savingGeneralSettings || waitingForInitialStatus"
                  @click="toggleStoriesModeSetting"
                >
                  <span class="sr-only">{{ t('settings.general.storiesMode.toggleLabel') }}</span>
                  <span
                    class="inline-flex h-7 w-12 items-center rounded-full p-[0.15rem] transition-colors duration-180"
                    :class="storiesMode ? 'bg-accent' : 'bg-[color-mix(in_srgb,var(--border)_88%,var(--surface-alt)_12%)]'"
                  >
                    <span
                      class="h-[1.35rem] w-[1.35rem] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] transition-transform duration-180"
                      :class="storiesMode ? 'translate-x-[1.2rem]' : 'translate-x-0'"
                    />
                  </span>
                </button>
              </div>

              <div class="grid gap-3 border-t border-border px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.carouselsMode.label') }}</p>
                    <span class="inline-flex items-center rounded-full bg-surface-alt px-2 py-[0.2rem] text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">
                      {{ t('settings.general.storiesMode.scanRequired') }}
                    </span>
                  </div>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ carouselsModeLabelDescription }}</p>
                </div>
                <button
                  class="inline-flex items-center justify-end border-0 bg-transparent p-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  role="switch"
                  :aria-checked="carouselsMode"
                  :disabled="savingGeneralSettings || waitingForInitialStatus"
                  @click="toggleCarouselsModeSetting"
                >
                  <span class="sr-only">{{ t('settings.general.carouselsMode.toggleLabel') }}</span>
                  <span class="inline-flex h-7 w-12 items-center rounded-full p-[0.15rem] transition-colors duration-180" :class="carouselsMode ? 'bg-accent' : 'bg-[color-mix(in_srgb,var(--border)_88%,var(--surface-alt)_12%)]'">
                    <span class="h-[1.35rem] w-[1.35rem] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] transition-transform duration-180" :class="carouselsMode ? 'translate-x-[1.2rem]' : 'translate-x-0'" />
                  </span>
                </button>
              </div>

              <div class="grid gap-4 px-6 py-4">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="m-0 text-[0.96rem] font-semibold text-text">{{ t('settings.general.excludedFolders.label') }}</p>
                    <span class="inline-flex items-center rounded-full bg-surface-alt px-2 py-[0.2rem] text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">
                      {{ t('settings.general.storiesMode.scanRequired') }}
                    </span>
                  </div>
                  <p class="m-0 mt-[0.25rem] text-[0.84rem] text-muted">{{ t('settings.general.excludedFolders.description') }}</p>
                </div>

                <label class="grid gap-[0.45rem]">
                  <span class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.general.excludedFolders.customRules') }}</span>
                  <textarea
                    v-model="customExcludedFoldersDraft"
                    class="min-h-[10rem] rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_84%,transparent_16%)] px-4 py-3 text-[0.95rem] leading-[1.55] text-text outline-none transition-[border-color,box-shadow] duration-180 placeholder:text-muted focus:border-[color-mix(in_srgb,var(--accent)_48%,var(--border)_52%)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_76%,transparent_24%)]"
                    :disabled="savingGeneralSettings || adminStats === null"
                    rows="5"
                    placeholder="@eaDir&#10;thumbnails&#10;Archive/cache"
                    spellcheck="false"
                    @input="clearGeneralSettingsFeedback"
                  />
                </label>

                <div class="grid gap-3 lg:grid-cols-2">
                  <div class="rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_78%,transparent_22%)] px-4 py-4">
                    <p class="m-0 text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-muted">{{ t('settings.general.excludedFolders.envRulesLabel') }}</p>
                    <p class="m-0 mt-[0.35rem] text-[0.82rem] text-muted">{{ t('settings.general.excludedFolders.envRulesDescription') }}</p>
                    <div v-if="envExcludedFolders.length > 0" class="mt-3 flex flex-wrap gap-2">
                      <span
                        v-for="rule in envExcludedFolders"
                        :key="`env-${rule}`"
                        class="inline-flex items-center rounded-full bg-[rgba(24,119,242,0.08)] px-3 py-[0.35rem] text-[0.78rem] font-medium text-accent-strong"
                      >
                        {{ rule }}
                      </span>
                    </div>
                    <p v-else class="m-0 mt-3 text-[0.84rem] text-muted">{{ t('settings.general.excludedFolders.envRulesEmpty') }}</p>
                  </div>

                  <div class="rounded-[0.95rem] border border-border bg-[color-mix(in_srgb,var(--surface-alt)_78%,transparent_22%)] px-4 py-4">
                    <p class="m-0 text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-muted">{{ t('settings.general.excludedFolders.activeRulesLabel') }}</p>
                    <p class="m-0 mt-[0.35rem] text-[0.82rem] text-muted">{{ t('settings.general.excludedFolders.activeRulesDescription') }}</p>
                    <div v-if="effectiveExcludedFolders.length > 0" class="mt-3 flex flex-wrap gap-2">
                      <span
                        v-for="rule in effectiveExcludedFolders"
                        :key="`effective-${rule}`"
                        class="inline-flex items-center rounded-full bg-surface px-3 py-[0.35rem] text-[0.78rem] font-medium text-text"
                      >
                        {{ rule }}
                      </span>
                    </div>
                    <p v-else class="m-0 mt-3 text-[0.84rem] text-muted">{{ t('settings.general.excludedFolders.activeRulesEmpty') }}</p>
                  </div>
                </div>
              </div>

            </div>

            <div ref="generalSettingsSaveArea" class="rounded-b-[1.05rem] border-t border-border bg-[color-mix(in_srgb,var(--surface)_96%,var(--accent-soft)_4%)] px-6 py-5">
              <div
                v-if="showGeneralSettingsRescanNotice"
                class="mb-4 rounded-[0.95rem] border border-[rgba(210,161,51,0.28)] bg-[rgba(210,161,51,0.08)] px-4 py-3 text-[0.88rem] text-[#9f6a00]"
              >
                {{ generalSettingsRescanNotice }}
              </div>

              <div class="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
                <p class="m-0 flex-1 text-[0.84rem] text-muted">{{ generalSettingsActionNote }}</p>
                <button
                  class="btn-primary min-w-[10.5rem] self-end max-sm:self-stretch"
                  type="button"
                  :disabled="generalSettingsSaveDisabled"
                  :style="generalSettingsButtonStyle"
                  @click="saveGeneralSettings"
                >
                  {{ generalSettingsButtonLabel }}
                </button>
              </div>
            </div>
          </section>

        </template>

        <!-- CATEGORY: PLACES -->
        <template v-if="currentCategory === 'places'">
          <section class="card grid gap-[1.15rem] p-8">
            <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.places.section.title') }}</h2>
                <p class="m-0 mt-[0.35rem] text-muted">{{ t('settings.places.section.description') }}</p>
              </div>
              <span
                class="inline-flex items-center justify-center min-h-8 px-[0.7rem] py-[0.35rem] rounded-full text-[0.76rem] font-bold whitespace-nowrap"
                :class="placesStore.status?.prepared ? 'text-accent-strong bg-[color-mix(in_srgb,var(--accent-soft)_78%,transparent_22%)]' : 'text-muted bg-surface-alt'"
              >
                {{ placesStore.status?.prepared ? t('settings.places.section.prepared') : t('settings.places.section.notPrepared') }}
              </span>
            </div>

            <dl class="grid grid-cols-2 gap-4 m-0 max-sm:grid-cols-1">
              <div class="rounded-[0.95rem] border border-border bg-surface-alt p-4">
                <dt class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.places.section.datasetLabel') }}</dt>
                <dd class="m-0 mt-1 text-[0.95rem] font-semibold">{{ placesStore.status?.metadata?.source ?? t('settings.places.section.fallbackDataset') }}</dd>
              </div>
              <div class="rounded-[0.95rem] border border-border bg-surface-alt p-4">
                <dt class="text-[0.76rem] font-bold uppercase tracking-[0.08em] text-muted">{{ t('settings.places.section.rowsLabel') }}</dt>
                <dd class="m-0 mt-1 text-[0.95rem] font-semibold">{{ placesStore.status?.metadata ? formatCount(placesStore.status.metadata.rowCount) : t('settings.places.section.notImported') }}</dd>
              </div>
            </dl>

            <p v-if="placesStore.status?.metadata" class="m-0 text-muted">
              {{ t('settings.places.section.importedAt', { value: formatDateTime(placesStore.status.metadata.importedAt) }) }}
            </p>
            <p v-if="placesStore.statusError" class="m-0 text-[#c0392b]">
              {{ placesStore.statusError }}
            </p>
            <p v-if="placesStore.actionMessage" class="m-0 text-muted">
              {{ placesStore.actionMessage }}
            </p>

            <div class="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                class="btn-primary w-full sm:w-auto sm:min-w-[12rem]"
                type="button"
                :disabled="placesStore.preparing"
                @click="placesStore.prepareGeodata"
              >
                {{ placesStore.preparing ? t('settings.places.section.preparingButton') : t('settings.places.section.prepareButton') }}
              </button>
              <button
                class="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-border bg-surface-alt px-4 text-center text-[0.9rem] font-semibold text-text transition-colors duration-180 hover:bg-surface-hover disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                type="button"
                :disabled="placesStore.rebuilding || !placesStore.status?.prepared"
                @click="placesStore.rebuildAssignments"
              >
                {{ placesStore.rebuilding ? t('settings.places.section.rebuildingButton') : t('settings.places.section.rebuildButton') }}
              </button>
            </div>
          </section>

        </template>

        <!-- CATEGORY: LIBRARY -->
        <template v-if="currentCategory === 'library'">
          <section class="card grid gap-[1.15rem] p-8">
            <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.library.scanCard.title') }}</h2>
                <p class="m-0 mt-[0.35rem] text-muted">{{ t('settings.library.scanCard.description') }}</p>
              </div>
              <span
                class="inline-flex items-center justify-center min-h-8 px-[0.7rem] py-[0.35rem] rounded-full text-[0.76rem] font-bold whitespace-nowrap"
                :class="{
                  'text-muted bg-surface-alt': statusTone === 'idle',
                  'text-accent-strong bg-[color-mix(in_srgb,var(--accent-soft)_78%,transparent_22%)]': statusTone === 'active',
                  'text-[#b76e00] bg-[rgba(242,164,30,0.14)]': statusTone === 'warning',
                  'text-[#c0392b] bg-[rgba(214,48,49,0.12)]': statusTone === 'danger',
                }"
              >{{ statusLabel }}</span>
            </div>

            <div
              v-if="appStore.isCarouselsReconciliationPending"
              class="rounded-[0.95rem] border border-[rgba(210,161,51,0.28)] bg-[rgba(210,161,51,0.08)] px-4 py-3 text-[#9f6a00]"
            >
              <p class="m-0 text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.library.carouselReconciliation.title') }}</p>
              <p class="m-0 mt-1 text-[0.9rem] leading-relaxed">
                {{ appStore.isLibraryRebuildRequired ? t('settings.library.carouselReconciliation.rebuildDescription') : t('settings.library.carouselReconciliation.scanDescription') }}
              </p>
            </div>

            <div
              v-if="legacyDerivativeMigrationPending"
              class="rounded-[0.95rem] border border-[rgba(210,161,51,0.28)] bg-[rgba(210,161,51,0.08)] px-4 py-3 text-[#9f6a00]"
            >
              <div class="flex items-start justify-between gap-3 max-sm:flex-col max-sm:items-start">
                <div>
                  <p class="m-0 text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.library.legacyMigration.title') }}</p>
                  <p class="m-0 mt-1 text-[0.9rem] leading-relaxed">{{ legacyDerivativeMigrationMessage }}</p>
                </div>
                <span class="inline-flex items-center justify-center min-h-8 px-[0.7rem] py-[0.35rem] rounded-full text-[0.76rem] font-bold whitespace-nowrap text-[#9f6a00] bg-[rgba(210,161,51,0.14)]">
                  {{ formatCount(legacyDerivativeMigrationCount) }}
                </span>
              </div>
            </div>

            <div class="flex flex-col md:flex-row items-center gap-4 max-sm:items-stretch mt-4">
              <p class="m-0 flex-1 text-muted">{{ scanActionNote }}</p>
              <button
                class="btn-primary min-w-[13rem]"
                type="button"
                :disabled="scanActionDisabled"
                @click="runManualScan"
              >
                {{ scanButtonLabel }}
              </button>
            </div>

            <p v-if="scanError" class="m-0 px-4 py-[0.85rem] border border-[rgba(214,48,49,0.24)] rounded-[0.9rem] text-[#c0392b] bg-[rgba(214,48,49,0.08)]">{{ scanError }}</p>
          </section>

          <section class="card grid gap-[1.15rem] p-8">
             <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.library.thumbnailCard.title') }}</h2>
                <p class="m-0 mt-[0.35rem] text-muted">{{ t('settings.library.thumbnailCard.description') }}</p>
              </div>
            </div>

            <div class="flex flex-col md:flex-row items-center gap-4 max-sm:items-stretch mt-4">
              <p class="m-0 flex-1 text-muted">{{ thumbnailRebuildActionNote }}</p>
              <button class="btn-primary min-w-[13rem]" type="button" :disabled="thumbnailRebuildActionDisabled" @click="confirmThumbnailRebuildOpen = true">
                {{ thumbnailRebuildButtonLabel }}
              </button>
            </div>
            
            <p v-if="thumbnailRebuildError" class="m-0 px-4 py-[0.85rem] border border-[rgba(214,48,49,0.24)] rounded-[0.9rem] text-[#c0392b] bg-[rgba(214,48,49,0.08)]">{{ thumbnailRebuildError }}</p>
          </section>

          <!-- Danger Zone -->
          <div class="border border-[rgba(214,48,49,0.3)] rounded-[1.05rem] overflow-hidden" :class="highlightRebuildAction ? 'ring-2 ring-[color-mix(in_srgb,var(--accent)_45%,transparent_55%)]' : ''">
            <div class="bg-[rgba(214,48,49,0.04)] px-6 py-4 border-b border-[rgba(214,48,49,0.1)] flex items-center justify-between">
              <h3 class="m-0 text-[1rem] text-[#c0392b] font-bold">{{ t('settings.library.dangerZone.title') }}</h3>
              <span
                v-if="appStore.isLibraryRebuildRequired"
                class="inline-flex items-center justify-center min-h-8 px-[0.7rem] py-[0.35rem] rounded-full text-[0.76rem] font-bold whitespace-nowrap text-[#9f6a00] bg-[rgba(210,161,51,0.14)]"
              >
                {{ t('settings.library.dangerZone.recommended') }}
              </span>
            </div>
            <div class="p-6 grid gap-[1.15rem] bg-surface">
              <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
                <div>
                  <h3 class="m-0 text-[1rem]">{{ t('settings.library.dangerZone.rebuildTitle') }}</h3>
                  <p class="m-0 mt-[0.25rem] text-muted">{{ t('settings.library.dangerZone.rebuildDescription') }}</p>
                </div>
              </div>

              <dl class="grid gap-[0.8rem] m-0 mb-2">
                <div class="px-4 py-[0.85rem] rounded-[0.85rem] border border-border bg-surface-alt">
                  <dt class="m-0 mb-[0.25rem] text-muted text-[0.72rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.library.dangerZone.currentGalleryRoot') }}</dt>
                  <dd class="m-0 text-[0.92rem] font-semibold break-all">{{ adminStats?.libraryIndex.currentGalleryRoot ?? t('settings.status.storage.unavailable') }}</dd>
                </div>
                <div v-if="adminStats?.libraryIndex.previousGalleryRoot" class="px-4 py-[0.85rem] rounded-[0.85rem] border border-[#d2a133] bg-[rgba(210,161,51,0.04)]">
                  <dt class="m-0 mb-[0.25rem] text-[#b76e00] text-[0.72rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.library.dangerZone.previousGalleryRoot') }}</dt>
                  <dd class="m-0 text-[0.92rem] font-semibold break-all">{{ adminStats.libraryIndex.previousGalleryRoot }}</dd>
                </div>
              </dl>

              <div class="flex flex-col md:flex-row items-center gap-4 max-sm:items-stretch">
                <p class="m-0 flex-1 text-muted">{{ rebuildActionNote }}</p>
                <button class="btn-primary min-w-[13rem] bg-[#d93025] hover:bg-[#c5281c] border-transparent text-white" type="button" :disabled="rebuildActionDisabled" @click="confirmRebuildOpen = true">
                  {{ rebuildButtonLabel }}
                </button>
              </div>
              <p v-if="rebuildError" class="m-0 px-4 py-[0.85rem] border border-[rgba(214,48,49,0.24)] rounded-[0.9rem] text-[#c0392b] bg-[rgba(214,48,49,0.08)]">{{ rebuildError }}</p>
            </div>
          </div>
        </template>

        <!-- CATEGORY: STATUS -->
        <template v-if="currentCategory === 'status'">
          <section class="card grid gap-[1.15rem] p-8">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.status.libraryStatus.title') }}</h2>
                <p class="m-0 mt-[0.35rem] text-muted">{{ t('settings.status.libraryStatus.description') }}</p>
              </div>
            </div>
            <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 m-0 mt-4">
              <div class="flex flex-col gap-1 py-3 border-b border-border">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.libraryStatus.storage') }}</dt>
                <dd class="m-0 text-[1.45rem] font-medium tracking-tight" :class="appStore.isLibraryUnavailable ? 'text-[#c0392b]' : 'text-text'">{{ storageLabel }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b border-border">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.libraryStatus.folders') }}</dt>
                <dd class="m-0 text-[1.45rem] font-medium tracking-tight">{{ formatCount(appStore.stats?.folders ?? 0) }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b border-border md:border-b-0">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.libraryStatus.indexedPosts') }}</dt>
                <dd class="m-0 text-[1.45rem] font-medium tracking-tight">{{ formatCount(appStore.stats?.indexedImages ?? 0) }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b-0">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.libraryStatus.indexedVideos') }}</dt>
                <dd class="m-0 text-[1.45rem] font-medium tracking-tight">{{ formatCount(appStore.stats?.indexedVideos ?? 0) }}</dd>
              </div>
            </dl>
          </section>

          <section class="card grid gap-[1.15rem] p-8">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.status.lastScan.title') }}</h2>
                <p class="m-0 mt-[0.35rem] text-muted">{{ t('settings.status.lastScan.description') }}</p>
              </div>
            </div>
            <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 m-0 mt-4">
              <div class="flex flex-col gap-1 py-3 border-b border-border">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.lastScan.status') }}</dt>
                <dd class="m-0 text-[1.2rem] font-medium tracking-tight capitalize">{{ lastScanStatus }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b border-border">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.lastScan.finished') }}</dt>
                <dd class="m-0 text-[1.2rem] font-medium tracking-tight">{{ lastScanFinishedAt }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b border-border md:border-b-0">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.lastScan.filesScanned') }}</dt>
                <dd class="m-0 text-[1.45rem] font-medium tracking-tight">{{ formatCount(lastCompletedScan?.scanned_files ?? 0) }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b-0">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.lastScan.changes') }}</dt>
                <dd class="m-0 text-[1rem] font-medium leading-relaxed whitespace-pre-line">{{ lastScanChangeSummary }}</dd>
              </div>
            </dl>
          </section>

          <section class="card grid gap-[1.15rem] p-8">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="m-0 text-[1.18rem]">{{ t('settings.status.todayChanges.title') }}</h2>
                <p class="m-0 mt-[0.35rem] text-muted">{{ t('settings.status.todayChanges.description') }}</p>
              </div>
            </div>
            <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 m-0 mt-4">
              <div class="flex flex-col gap-1 py-3 border-b border-border">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.todayChanges.scans') }}</dt>
                <dd class="m-0 text-[1.45rem] font-medium tracking-tight">{{ formatCount(adminStats?.todayScanChanges.scan_count ?? 0) }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b border-border">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.todayChanges.filesScanned') }}</dt>
                <dd class="m-0 text-[1.45rem] font-medium tracking-tight">{{ formatCount(adminStats?.todayScanChanges.scanned_files ?? 0) }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b border-border md:border-b-0">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.todayChanges.changes') }}</dt>
                <dd class="m-0 text-[1rem] font-medium leading-relaxed whitespace-pre-line">{{ todayScanChangeSummary }}</dd>
              </div>
              <div class="flex flex-col gap-1 py-3 border-b-0">
                <dt class="m-0 text-muted text-[0.76rem] font-bold tracking-[0.08em] uppercase">{{ t('settings.status.todayChanges.latestFinished') }}</dt>
                <dd class="m-0 text-[1.2rem] font-medium tracking-tight">{{ formatDateTime(adminStats?.todayScanChanges.latest_finished_at) }}</dd>
              </div>
            </dl>
          </section>
        </template>
      </div>
    </div>

    <!-- Dialogs -->
    <ConfirmDialog
      v-if="confirmRebuildOpen"
      :title="t('settings.library.dialogs.rebuildTitle')"
      :message="t('settings.library.dialogs.rebuildMessage')"
      :confirm-label="t('settings.library.dialogs.rebuildConfirm')"
      :loading-label="t('settings.library.dialogs.rebuildLoading')"
      :loading="rebuilding"
      @cancel="confirmRebuildOpen = false"
      @confirm="runLibraryRebuild"
    />
    <ConfirmDialog
      v-if="confirmThumbnailRebuildOpen"
      :title="t('settings.library.dialogs.thumbnailsTitle')"
      :message="t('settings.library.dialogs.thumbnailsMessage')"
      :confirm-label="t('settings.library.dialogs.thumbnailsConfirm')"
      :loading-label="t('settings.library.dialogs.thumbnailsLoading')"
      :loading="rebuildingThumbnails"
      @cancel="confirmThumbnailRebuildOpen = false"
      @confirm="runThumbnailRebuild"
    />
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import ConfirmDialog from '../components/ConfirmDialog.vue';
import {
  fetchAdminStats,
  triggerLibraryRebuild,
  triggerManualScan,
  triggerThumbnailRebuild,
  updateAppLocale,
  updateExcludedFolders,
  updateFolderImageOrderDefault,
  updateHomeFeedDefault,
  updateNestedFolderTitleFormat,
  updateReelsFeedDefault,
  updateSharePublicBaseUrl,
  updateVideoPlaybackQuality,
  updateStoriesMode,
  updateCarouselsMode
} from '../api/gallery';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../locales';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useFeedStore } from '../stores/feed';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import { useMomentsStore } from '../stores/moments';
import { usePlacesStore } from '../stores/places';
import { useViewerStore } from '../stores/viewer';
import type {
  AppStats,
  FeedMode,
  FolderImageOrder,
  NestedFolderTitleFormat,
  ReelsFeedMode,
  VideoPlaybackQuality,
  ViewerAccessMode
} from '../types/api';

const { t, locale } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const feedStore = useFeedStore();
const foldersStore = useFoldersStore();
const likesStore = useLikesStore();
const momentsStore = useMomentsStore();
const placesStore = usePlacesStore();
const viewerStore = useViewerStore();
const route = useRoute();
const currentCategory = ref<'library' | 'general' | 'places' | 'access' | 'status'>('library');
const scanError = ref<string | null>(null);
const rebuildError = ref<string | null>(null);
const thumbnailRebuildError = ref<string | null>(null);
const requestingScan = ref(false);
const rebuilding = ref(false);
const rebuildingThumbnails = ref(false);
const savingGeneralSettings = ref(false);
const confirmRebuildOpen = ref(false);
const confirmThumbnailRebuildOpen = ref(false);
const authFeedback = ref<{ tone: 'success' | 'error'; message: string } | null>(null);
const viewerFeedback = ref<{ tone: 'success' | 'error'; message: string } | null>(null);
const generalSettingsFeedback = ref<{ tone: 'success' | 'error'; message: string } | null>(null);
const adminStats = ref<AppStats | null>(null);
const showChangePasswordForm = ref(false);
const showDisablePasswordForm = ref(false);
const enablePassword = ref('');
const enablePasswordConfirmation = ref('');
const currentPassword = ref('');
const nextPassword = ref('');
const nextPasswordConfirmation = ref('');
const disablePassword = ref('');
const homeFeedDefaultMode = ref<FeedMode>('random');
const reelsFeedDefaultMode = ref<ReelsFeedMode>('random');
const folderImageOrderDefault = ref<FolderImageOrder>('newest');
const nestedFolderTitleFormat = ref<NestedFolderTitleFormat>('folder');
const videoPlaybackQuality = ref<VideoPlaybackQuality>('auto');
const sharePublicBaseUrlDraft = ref('');
const savedLocaleSelection = ref<SupportedLocale | null>(appStore.savedDefaultLocale);
const localeSelectionHydrated = ref(false);
const storiesMode = ref(false);
const carouselsMode = ref(false);
const feedDefaultsHydrated = ref(false);
const storiesModeHydrated = ref(false);
const carouselsModeHydrated = ref(false);
const activeGeneralSettingsMenu = ref<'home' | 'reels' | 'folder' | 'nestedTitle' | 'videoQuality' | null>(null);
const showStoriesAnnouncementStructure = ref(false);
const showCarouselsAnnouncementStructure = ref(false);
const generalSettingsSaveArea = ref<HTMLElement | null>(null);
const localeSelectId = 'settings-language-select';
const acknowledgedStoriesMigrationChoice = ref(false);
const viewerAccessMode = ref<ViewerAccessMode>(authStore.accessMode);
const viewerPassword = ref('');
const viewerPasswordConfirmation = ref('');
const customExcludedFoldersDraft = ref('');
const SCAN_ERROR_NOTICE_STORAGE_KEY = 'foldergram-scan-error-notice-dismissal';
const IGNORED_ROOT_MEDIA_NOTICE_STORAGE_KEY = 'foldergram-ignored-root-media-notice-dismissal';
const NOTICE_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const STORIES_MIGRATION_NOTICE_STORAGE_KEY = 'foldergram-stories-migration-dismissed';
const STORIES_ANNOUNCEMENT_STORAGE_KEY = 'foldergram-stories-announcement-dismissed';
const CAROUSELS_ANNOUNCEMENT_STORAGE_KEY = 'foldergram-carousels-announcement-dismissed:v1';
const PLACES_ONBOARDING_STORAGE_KEY = 'foldergram:places-onboarding-dismissed:v1';
const EXCLUDED_FOLDER_EDGE_SLASH_PATTERN = /^\/+|\/+$/g;
const EXCLUDED_FOLDER_UNSUPPORTED_PATTERN = /[*?]/;
const excludedFoldersHydrated = ref(false);

function normalizeExcludedFolderRuleInput(rule: string): string {
  const segments = rule
    .replace(/\\/g, '/')
    .trim()
    .replace(EXCLUDED_FOLDER_EDGE_SLASH_PATTERN, '')
    .split('/')
    .filter(Boolean);

  if (segments.length === 0) {
    throw new Error('Excluded folder rules cannot be empty.');
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid excluded folder rule: ${rule}`);
  }

  if (segments.some((segment) => EXCLUDED_FOLDER_UNSUPPORTED_PATTERN.test(segment))) {
    throw new Error(`Unsupported excluded folder rule: ${rule}`);
  }

  return segments.join('/');
}

function parseExcludedFolderRulesDraft(value: string): string[] {
  const normalized: string[] = [];

  for (const entry of value.split(/\r?\n/u)) {
    const trimmedEntry = entry.trim();
    if (trimmedEntry.length === 0) {
      continue;
    }

    const normalizedEntry = normalizeExcludedFolderRuleInput(trimmedEntry);
    if (!normalized.includes(normalizedEntry)) {
      normalized.push(normalizedEntry);
    }
  }

  return normalized;
}

function formatExcludedFolderRules(rules: string[]): string {
  return rules.join('\n');
}

function loadDismissedScanErrorNotice(): { scanId: number; dismissedUntil: number } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(SCAN_ERROR_NOTICE_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as { scanId?: unknown; dismissedUntil?: unknown };
    if (
      typeof parsed.scanId !== 'number' ||
      !Number.isFinite(parsed.scanId) ||
      typeof parsed.dismissedUntil !== 'number' ||
      !Number.isFinite(parsed.dismissedUntil)
    ) {
      return null;
    }

    return {
      scanId: parsed.scanId,
      dismissedUntil: parsed.dismissedUntil
    };
  } catch {
    return null;
  }
}

const dismissedScanErrorNotice = ref(loadDismissedScanErrorNotice());
const dismissedIgnoredRootMediaNotice = ref(loadDismissedIgnoredRootMediaNotice());
const dismissedStoriesMigrationNotice = ref(loadDismissedStoriesNotice(STORIES_MIGRATION_NOTICE_STORAGE_KEY));
const dismissedStoriesAnnouncement = ref(loadDismissedStoriesNotice(STORIES_ANNOUNCEMENT_STORAGE_KEY));
const dismissedCarouselsAnnouncement = ref(loadDismissedStoriesNotice(CAROUSELS_ANNOUNCEMENT_STORAGE_KEY));
const dismissedPlacesOnboardingBanner = ref(loadDismissedStoriesNotice(PLACES_ONBOARDING_STORAGE_KEY));

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatCount(value: number) {
  return new Intl.NumberFormat(locale.value).format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return t('settings.status.never');
  }

  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function clearAuthFeedback() {
  authFeedback.value = null;
  authStore.clearError();
}

function clearViewerFeedback() {
  viewerFeedback.value = null;
  authStore.clearError();
}

function clearGeneralSettingsFeedback() {
  generalSettingsFeedback.value = null;
}

function handleLocaleChange(event: Event) {
  const nextLocale = (event.target as HTMLSelectElement).value as SupportedLocale;
  clearGeneralSettingsFeedback();
  closeGeneralSettingsMenu();
  appStore.setLocale(nextLocale);
}

async function scrollToGeneralSettingsSaveArea() {
  await nextTick();
  generalSettingsSaveArea.value?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

function setAuthError(message: string) {
  authFeedback.value = {
    tone: 'error',
    message
  };
}

function setAuthSuccess(message: string) {
  authFeedback.value = {
    tone: 'success',
    message
  };
}

function setViewerError(message: string) {
  viewerFeedback.value = {
    tone: 'error',
    message
  };
}

function setViewerSuccess(message: string) {
  viewerFeedback.value = {
    tone: 'success',
    message
  };
}

function setGeneralSettingsFeedback(tone: 'success' | 'error', message: string) {
  generalSettingsFeedback.value = {
    tone,
    message
  };
}

function resetChangePasswordFields() {
  currentPassword.value = '';
  nextPassword.value = '';
  nextPasswordConfirmation.value = '';
}

function resetDisablePasswordField() {
  disablePassword.value = '';
}

function toggleChangePasswordForm() {
  showChangePasswordForm.value = !showChangePasswordForm.value;
  if (!showChangePasswordForm.value) {
    resetChangePasswordFields();
  }
}

function toggleDisablePasswordForm() {
  showDisablePasswordForm.value = !showDisablePasswordForm.value;
  if (!showDisablePasswordForm.value) {
    resetDisablePasswordField();
  }
}

function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return t('settings.access.validation.minLength', { count: MIN_PASSWORD_LENGTH });
  }

  if (password.trim().length === 0) {
    return t('settings.access.validation.empty');
  }

  if (password !== confirmation) {
    return t('settings.access.validation.mismatch');
  }

  return null;
}

function syncFeedDefaultsFromSaved() {
  homeFeedDefaultMode.value = appStore.defaultHomeFeedMode;
  reelsFeedDefaultMode.value = appStore.defaultReelsFeedMode;
  folderImageOrderDefault.value = appStore.defaultFolderImageOrder;
  nestedFolderTitleFormat.value = appStore.nestedFolderTitleFormat;
  videoPlaybackQuality.value = appStore.savedVideoPlaybackQuality;
  sharePublicBaseUrlDraft.value = appStore.sharePublicBaseUrl ?? '';
  feedDefaultsHydrated.value = true;
}

function syncLocaleSelectionFromSaved() {
  savedLocaleSelection.value = appStore.savedDefaultLocale;
  localeSelectionHydrated.value = true;
}

function syncStoriesModeFromSaved() {
  storiesMode.value = appStore.treatStoriesAsFolders;
  storiesModeHydrated.value = true;
}

function syncCarouselsModeFromSaved() {
  carouselsMode.value = appStore.treatCarouselsAsFolders;
  carouselsModeHydrated.value = true;
}

function syncExcludedFoldersFromSaved() {
  customExcludedFoldersDraft.value = formatExcludedFolderRules(adminStats.value?.excludedFolders.customExcludedFolders ?? []);
  excludedFoldersHydrated.value = true;
}

const scan = computed(() => appStore.stats?.scan ?? null);
const lastCompletedScan = computed(() => adminStats.value?.lastScan ?? scan.value?.lastCompletedScan ?? null);
const activeScanReason = computed(() => scan.value?.scanReason ?? null);
const supportedLocaleOptions = computed<Array<{ id: SupportedLocale; label: string }>>(() =>
  SUPPORTED_LOCALES.map((locale) => ({
    id: locale,
    label: t(`settings.general.language.options.${locale}`)
  }))
);
const homeFeedDefaultOptions = computed<Array<{ id: FeedMode; label: string; description: string }>>(() => [
  {
    id: 'random',
    label: t('settings.general.homeFeed.options.random.label'),
    description: t('settings.general.homeFeed.options.random.description')
  },
  {
    id: 'recent',
    label: t('settings.general.homeFeed.options.recent.label'),
    description: t('settings.general.homeFeed.options.recent.description')
  },
  {
    id: 'rediscover',
    label: t('settings.general.homeFeed.options.rediscover.label'),
    description: t('settings.general.homeFeed.options.rediscover.description')
  }
]);
const reelsFeedDefaultOptions = computed<Array<{ id: ReelsFeedMode; label: string; description: string }>>(() => [
  {
    id: 'random',
    label: t('settings.general.reelsFeed.options.random.label'),
    description: t('settings.general.reelsFeed.options.random.description')
  },
  {
    id: 'recent',
    label: t('settings.general.reelsFeed.options.recent.label'),
    description: t('settings.general.reelsFeed.options.recent.description')
  },
  {
    id: 'recommended',
    label: t('settings.general.reelsFeed.options.recommended.label'),
    description: t('settings.general.reelsFeed.options.recommended.description')
  }
]);
const folderImageOrderOptions = computed<Array<{ id: FolderImageOrder; label: string; description: string }>>(() => [
  {
    id: 'newest',
    label: t('settings.general.folderOrder.options.newest.label'),
    description: t('settings.general.folderOrder.options.newest.description')
  },
  {
    id: 'oldest',
    label: t('settings.general.folderOrder.options.oldest.label'),
    description: t('settings.general.folderOrder.options.oldest.description')
  }
]);
const nestedFolderTitleOptions = computed<Array<{ id: NestedFolderTitleFormat; label: string; description: string }>>(() => [
  {
    id: 'folder',
    label: t('settings.general.nestedFolderTitle.options.folder.label'),
    description: t('settings.general.nestedFolderTitle.options.folder.description')
  },
  {
    id: 'parent-plus-folder',
    label: t('settings.general.nestedFolderTitle.options.parentPlusFolder.label'),
    description: t('settings.general.nestedFolderTitle.options.parentPlusFolder.description')
  }
]);
const videoPlaybackQualityOptions = computed<Array<{ id: VideoPlaybackQuality; label: string; description: string }>>(() => [
  {
    id: 'original',
    label: t('settings.general.videoPlaybackQuality.options.original.label'),
    description: t('settings.general.videoPlaybackQuality.options.original.description')
  }
]);
const isLibraryRebuildActive = computed(
  () => rebuilding.value || (appStore.isScanning && activeScanReason.value === 'rebuild')
);
const isThumbnailRebuildActive = computed(
  () => rebuildingThumbnails.value || (appStore.isScanning && activeScanReason.value === 'rebuild-thumbnails')
);
const isRebuildOperationActive = computed(() => isLibraryRebuildActive.value || isThumbnailRebuildActive.value);
const scanProgressActive = computed(() => requestingScan.value || Boolean(scan.value?.isScanning && !isRebuildOperationActive.value));
const highlightRebuildAction = computed(() => route.query.action === 'rebuild');
const waitingForInitialStatus = computed(() => !appStore.stats || appStore.loadingStats);
const savedHomeFeedDefaultMode = computed(() => appStore.defaultHomeFeedMode);
const savedReelsFeedDefaultMode = computed(() => appStore.defaultReelsFeedMode);
const savedFolderImageOrderDefault = computed(() => appStore.defaultFolderImageOrder);
const savedNestedFolderTitleFormat = computed(() => appStore.nestedFolderTitleFormat);
const savedVideoPlaybackQuality = computed(() => appStore.savedVideoPlaybackQuality);
const savedSharePublicBaseUrl = computed(() => appStore.sharePublicBaseUrl ?? '');
const videoPlaybackQualityDeviceOverride = computed(() => appStore.videoPlaybackQualityOverride);
const videoPlaybackQualityOverrideLabel = computed(
  () =>
    videoPlaybackQualityOptions.value.find((option) => option.id === videoPlaybackQualityDeviceOverride.value)?.label ??
    t('settings.general.videoPlaybackQuality.options.auto.label')
);
const savedStoriesMode = computed(() => appStore.treatStoriesAsFolders);
const savedCarouselsMode = computed(() => appStore.treatCarouselsAsFolders);
const savedCustomExcludedFolders = computed(() => adminStats.value?.excludedFolders.customExcludedFolders ?? []);
const envExcludedFolders = computed(() => adminStats.value?.excludedFolders.envExcludedFolders ?? []);
const effectiveExcludedFolders = computed(() => adminStats.value?.excludedFolders.effectiveExcludedFolders ?? []);
const legacyDerivativeMigrationPending = computed(
  () => adminStats.value?.libraryIndex.legacyDerivativeMigrationPending === true
);
const legacyDerivativeMigrationCount = computed(() => adminStats.value?.libraryIndex.pendingDerivativeMigrationRows ?? 0);
const storiesModeRequiresDecision = computed(() => appStore.stats?.storiesMigration.decisionPending === true);
const carouselsModeRequiresDecision = computed(() => appStore.stats?.carouselsMigration?.decisionPending === true);
const savedHomeFeedDefaultModeLabel = computed(
  () => homeFeedDefaultOptions.value.find((mode) => mode.id === savedHomeFeedDefaultMode.value)?.label ?? t('settings.general.homeFeed.options.random.label')
);
const selectedLocaleOptionLabel = computed(
  () => supportedLocaleOptions.value.find((option) => option.id === appStore.locale)?.label ?? t('settings.general.language.options.en')
);
const savedLocaleOptionLabel = computed(
  () =>
    supportedLocaleOptions.value.find((option) => option.id === savedLocaleSelection.value)?.label ??
    t('settings.general.language.options.en')
);
const savedReelsFeedDefaultModeLabel = computed(
  () => reelsFeedDefaultOptions.value.find((mode) => mode.id === savedReelsFeedDefaultMode.value)?.label ?? t('settings.general.reelsFeed.options.random.label')
);
const savedFolderImageOrderDefaultLabel = computed(
  () => folderImageOrderOptions.value.find((mode) => mode.id === savedFolderImageOrderDefault.value)?.label ?? t('settings.general.folderOrder.options.newest.label')
);
const selectedHomeFeedDefaultOption = computed(
  () => homeFeedDefaultOptions.value.find((mode) => mode.id === homeFeedDefaultMode.value) ?? homeFeedDefaultOptions.value[0]
);
const selectedReelsFeedDefaultOption = computed(
  () => reelsFeedDefaultOptions.value.find((mode) => mode.id === reelsFeedDefaultMode.value) ?? reelsFeedDefaultOptions.value[0]
);
const selectedFolderImageOrderOption = computed(
  () => folderImageOrderOptions.value.find((mode) => mode.id === folderImageOrderDefault.value) ?? folderImageOrderOptions.value[0]
);
const selectedNestedFolderTitleOption = computed(
  () => nestedFolderTitleOptions.value.find((option) => option.id === nestedFolderTitleFormat.value) ?? nestedFolderTitleOptions.value[0]
);
const selectedVideoPlaybackQualityOption = computed(
  () =>
    videoPlaybackQualityOptions.value.find((option) => option.id === videoPlaybackQuality.value) ??
    videoPlaybackQualityOptions.value[0]
);
const localeDirty = computed(
  () => localeSelectionHydrated.value && (savedLocaleSelection.value === null || appStore.locale !== savedLocaleSelection.value)
);
const homeFeedDefaultDirty = computed(
  () => feedDefaultsHydrated.value && homeFeedDefaultMode.value !== savedHomeFeedDefaultMode.value
);
const reelsFeedDefaultDirty = computed(
  () => feedDefaultsHydrated.value && reelsFeedDefaultMode.value !== savedReelsFeedDefaultMode.value
);
const folderImageOrderDirty = computed(
  () => feedDefaultsHydrated.value && folderImageOrderDefault.value !== savedFolderImageOrderDefault.value
);
const nestedFolderTitleDirty = computed(
  () => feedDefaultsHydrated.value && nestedFolderTitleFormat.value !== savedNestedFolderTitleFormat.value
);
const videoPlaybackQualityDirty = computed(
  () => feedDefaultsHydrated.value && videoPlaybackQuality.value !== savedVideoPlaybackQuality.value
);
const sharePublicBaseUrlDirty = computed(
  () => feedDefaultsHydrated.value && sharePublicBaseUrlDraft.value.trim() !== savedSharePublicBaseUrl.value
);
const defaultSettingsDirtyCount = computed(
  () =>
    [
      localeDirty.value,
      homeFeedDefaultDirty.value,
      reelsFeedDefaultDirty.value,
      folderImageOrderDirty.value,
      nestedFolderTitleDirty.value,
      videoPlaybackQualityDirty.value,
      sharePublicBaseUrlDirty.value
    ].filter(Boolean).length
);
const feedDefaultsDirty = computed(
  () =>
    homeFeedDefaultDirty.value ||
    reelsFeedDefaultDirty.value ||
    folderImageOrderDirty.value ||
    nestedFolderTitleDirty.value ||
    videoPlaybackQualityDirty.value ||
    sharePublicBaseUrlDirty.value
);
const storiesModeDirty = computed(() => storiesModeHydrated.value && storiesMode.value !== savedStoriesMode.value);
const carouselsModeDirty = computed(() => carouselsModeHydrated.value && carouselsMode.value !== savedCarouselsMode.value);
const storiesScanRequired = computed(() => storiesModeDirty.value || storiesModeRequiresDecision.value);
const carouselsScanRequired = computed(
  () => carouselsModeDirty.value || carouselsModeRequiresDecision.value || appStore.isCarouselsReconciliationPending
);
const hasUnsavedReservedFolderRuleChanges = computed(
  () => storiesModeDirty.value || storiesModeRequiresDecision.value || carouselsModeDirty.value || carouselsModeRequiresDecision.value
);
const excludedFoldersDirty = computed(() => {
  if (!excludedFoldersHydrated.value) {
    return false;
  }

  try {
    const currentRules = parseExcludedFolderRulesDraft(customExcludedFoldersDraft.value);
    return JSON.stringify(currentRules) !== JSON.stringify(savedCustomExcludedFolders.value);
  } catch {
    return true;
  }
});
const hasUnsavedFolderRuleChanges = computed(
  () => excludedFoldersDirty.value || hasUnsavedReservedFolderRuleChanges.value
);
const generalSettingsDirty = computed(
  () => localeDirty.value || feedDefaultsDirty.value || storiesModeDirty.value || carouselsModeDirty.value || excludedFoldersDirty.value || storiesModeRequiresDecision.value || carouselsModeRequiresDecision.value
);
const showSavedDefaultLocaleNotice = computed(
  () => savedLocaleSelection.value !== null && appStore.locale !== savedLocaleSelection.value
);
const showGeneralSettingsRescanNotice = computed(
  () => storiesScanRequired.value || carouselsScanRequired.value || excludedFoldersDirty.value
);
const generalSettingsSaveDisabled = computed(
  () => waitingForInitialStatus.value || savingGeneralSettings.value || !generalSettingsDirty.value
);
const generalSettingsButtonLabel = computed(() => {
  if (savingGeneralSettings.value) {
    return t('common.saving');
  }

  return generalSettingsDirty.value ? t('common.saveChanges') : t('common.saved');
});
const generalSettingsButtonStyle = computed(() =>
  generalSettingsSaveDisabled.value ? { cursor: savingGeneralSettings.value ? 'wait' : 'not-allowed' } : undefined
);
const generalSettingsActionNote = computed(() => {
  if (waitingForInitialStatus.value) {
    return t('settings.general.actionNote.loading');
  }

  if (excludedFoldersDirty.value && (hasUnsavedReservedFolderRuleChanges.value || defaultSettingsDirtyCount.value > 0)) {
    return t('settings.general.actionNote.excludedAndOther');
  }

  if (excludedFoldersDirty.value) {
    return t('settings.general.actionNote.excludedOnly');
  }

  if (hasUnsavedReservedFolderRuleChanges.value && defaultSettingsDirtyCount.value > 0) {
    return t('settings.general.actionNote.storiesAndDefaults');
  }

  if (hasUnsavedReservedFolderRuleChanges.value) {
    return t('settings.general.actionNote.storiesOnly');
  }

  if (defaultSettingsDirtyCount.value > 1) {
    return t('settings.general.actionNote.multipleDefaults');
  }

  if (localeDirty.value) {
    return t('settings.general.actionNote.languageOnly');
  }

  if (homeFeedDefaultDirty.value) {
    return t('settings.general.actionNote.homeOnly');
  }

  if (reelsFeedDefaultDirty.value) {
    return t('settings.general.actionNote.reelsOnly');
  }

  if (folderImageOrderDirty.value) {
    return t('settings.general.actionNote.folderOnly');
  }

  if (nestedFolderTitleDirty.value) {
    return t('settings.general.actionNote.nestedFolderTitleOnly');
  }

  if (sharePublicBaseUrlDirty.value) {
    return t('settings.general.actionNote.sharePublicBaseUrlOnly');
  }

  if (appStore.isCarouselsReconciliationPending) {
    return t('settings.general.actionNote.carouselReconciliation');
  }

  return t('settings.general.actionNote.idle');
});
const generalSettingsRescanNotice = computed(() => {
  if (appStore.isLibraryRebuildRequired) {
    return hasUnsavedFolderRuleChanges.value
      ? t('settings.general.rescanNotice.rebuildRequired')
      : t('settings.general.rescanNotice.pendingRebuild');
  }

  if (appStore.isCarouselsReconciliationPending && !hasUnsavedFolderRuleChanges.value) {
    return t('settings.general.rescanNotice.pendingCarousels');
  }

  if (excludedFoldersDirty.value && (storiesScanRequired.value || carouselsScanRequired.value)) {
    return t('settings.general.rescanNotice.excludedAndStories');
  }

  if (excludedFoldersDirty.value) {
    return t('settings.general.rescanNotice.excludedOnly');
  }

  if (storiesScanRequired.value && carouselsScanRequired.value) {
    return t('settings.general.rescanNotice.storiesAndCarousels');
  }

  if (carouselsScanRequired.value) {
    return t('settings.general.rescanNotice.carouselsOnly');
  }

  return t('settings.general.rescanNotice.storiesOnly');
});
const storiesModeLabelDescription = computed(() =>
  storiesMode.value
    ? t('settings.general.storiesMode.enabledDescription')
    : t('settings.general.storiesMode.disabledDescription')
);
const carouselsModeLabelDescription = computed(() =>
  carouselsMode.value
    ? t('settings.general.carouselsMode.enabledDescription')
    : t('settings.general.carouselsMode.disabledDescription')
);
const showCarouselsMigrationNotice = computed(() =>
  appStore.stats?.carouselsMigration?.hasLegacyCarouselsCandidates === true &&
  carouselsModeRequiresDecision.value
);
const showCarouselsAnnouncementCard = computed(
  () =>
    appStore.stats?.carouselsMigration?.hasLegacyCarouselsCandidates === false &&
    appStore.stats?.carouselsMigration?.decisionPending === true &&
    !dismissedCarouselsAnnouncement.value
);
const storiesMigrationActionHelper = computed(() => {
  if (savingGeneralSettings.value) {
    return t('settings.general.migration.helperSaving');
  }

  return t('settings.general.migration.helper');
});
const showStoriesMigrationNotice = computed(
  () =>
    appStore.stats?.storiesMigration.hasLegacyStoriesCandidates === true &&
    appStore.stats?.storiesMigration.decisionPending === true &&
    !dismissedStoriesMigrationNotice.value &&
    !acknowledgedStoriesMigrationChoice.value
);
const showStoriesAnnouncementCard = computed(
  () =>
    appStore.stats?.storiesMigration.hasLegacyStoriesCandidates === false &&
    appStore.stats?.storiesMigration.decisionPending === true &&
    !dismissedStoriesAnnouncement.value
);
const showPlacesOnboardingBanner = computed(
  () =>
    currentCategory.value !== 'places' &&
    placesStore.status?.prepared === false &&
    !dismissedPlacesOnboardingBanner.value
);
const scanActionDisabled = computed(
  () =>
    waitingForInitialStatus.value ||
    appStore.isLibraryUnavailable ||
    appStore.isLibraryRebuildRequired ||
    appStore.isScanning ||
    requestingScan.value ||
    rebuilding.value ||
    rebuildingThumbnails.value
);
const rebuildActionDisabled = computed(
  () =>
    waitingForInitialStatus.value ||
    appStore.isLibraryUnavailable ||
    appStore.isScanning ||
    requestingScan.value ||
    rebuilding.value ||
    rebuildingThumbnails.value
);
const thumbnailRebuildActionDisabled = computed(
  () =>
    waitingForInitialStatus.value ||
    appStore.isLibraryUnavailable ||
    appStore.isLibraryRebuildRequired ||
    appStore.isScanning ||
    requestingScan.value ||
    rebuilding.value ||
    rebuildingThumbnails.value
);
const rebuildCardStyle = computed(() =>
  appStore.isLibraryRebuildRequired
    ? 'background: radial-gradient(circle at top right, rgba(210,161,51,0.2), transparent 42%), linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 88%, #fff3c3 12%) 100%);'
    : 'background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, var(--accent) 4%) 0%, var(--surface) 100%);'
);
const statusTone = computed(() => {
  if (appStore.isLibraryUnavailable) {
    return 'danger';
  }

  if (scanProgressActive.value || isRebuildOperationActive.value) {
    return 'active';
  }

  if (lastCompletedScan.value?.status === 'completed_with_errors') {
    return 'warning';
  }

  return 'idle';
});
const statusLabel = computed(() => {
  if (appStore.isLibraryUnavailable) {
    return t('settings.library.statusLabel.storageUnavailable');
  }

  if (scanProgressActive.value) {
    return t('settings.library.statusLabel.scanInProgress');
  }

  if (isRebuildOperationActive.value) {
    return t('settings.library.statusLabel.rebuildActive');
  }

  return t('settings.library.statusLabel.ready');
});
const scanButtonLabel = computed(() => {
  if (scanProgressActive.value) {
    return t('settings.library.scanButton.active');
  }

  return t('settings.library.scanButton.idle');
});
const scanActionNote = computed(() => {
  if (waitingForInitialStatus.value) {
    return t('settings.library.scanActionNote.loading');
  }

  if (appStore.isLibraryUnavailable) {
    return appStore.libraryUnavailableReason;
  }

  if (appStore.isLibraryRebuildRequired) {
    return t('settings.library.scanActionNote.rebuildRequired');
  }

  if (isRebuildOperationActive.value) {
    return t('settings.library.scanActionNote.otherTaskActive');
  }

  if (scanProgressActive.value) {
    return t('settings.library.scanActionNote.progress');
  }

  if (legacyDerivativeMigrationPending.value) {
    return t('settings.library.scanActionNote.legacyMigration');
  }

  if (appStore.isCarouselsReconciliationPending) {
    return t('settings.library.scanActionNote.carouselReconciliation');
  }

  return t('settings.library.scanActionNote.idle');
});
const rebuildButtonLabel = computed(() => {
  if (isLibraryRebuildActive.value) {
    return t('settings.library.rebuildButton.active');
  }

  return t('settings.library.rebuildButton.idle');
});
const thumbnailRebuildButtonLabel = computed(() => {
  if (isThumbnailRebuildActive.value) {
    return t('settings.library.thumbnailButton.active');
  }

  return t('settings.library.thumbnailButton.idle');
});
const rebuildActionNote = computed(() => {
  if (waitingForInitialStatus.value) {
    return t('settings.library.rebuildActionNote.loading');
  }

  if (appStore.isLibraryUnavailable) {
    return appStore.libraryUnavailableReason;
  }

  if (isLibraryRebuildActive.value) {
    return t('settings.library.rebuildActionNote.progress');
  }

  if (isThumbnailRebuildActive.value) {
    return t('settings.library.rebuildActionNote.thumbnailActive');
  }

  if (appStore.isScanning) {
    return t('settings.library.rebuildActionNote.scanActive');
  }

  if (appStore.isLibraryRebuildRequired) {
    return t('settings.library.rebuildActionNote.rebuildRequired');
  }

  return t('settings.library.rebuildActionNote.idle');
});
const thumbnailRebuildActionNote = computed(() => {
  if (waitingForInitialStatus.value) {
    return t('settings.library.thumbnailActionNote.loading');
  }

  if (appStore.isLibraryUnavailable) {
    return appStore.libraryUnavailableReason;
  }

  if (appStore.isLibraryRebuildRequired) {
    return t('settings.library.thumbnailActionNote.rebuildRequired');
  }

  if (isThumbnailRebuildActive.value) {
    return t('settings.library.thumbnailActionNote.progress');
  }

  if (isLibraryRebuildActive.value) {
    return t('settings.library.thumbnailActionNote.rebuildActive');
  }

  if (appStore.isScanning) {
    return t('settings.library.thumbnailActionNote.scanActive');
  }

  if (legacyDerivativeMigrationPending.value) {
    return t('settings.library.thumbnailActionNote.legacyMigration');
  }

  return t('settings.library.thumbnailActionNote.idle');
});
const authProtectionDescription = computed(() =>
  authStore.enabled
    ? t('settings.access.authProtection.enabled')
    : t('settings.access.authProtection.disabled')
);
const viewerAccessActive = computed(() => authStore.enabled && authStore.accessMode !== 'off');
const viewerAccessEnabled = computed(() => authStore.enabled && authStore.accessMode === 'password');
const viewerAccessStatusLabel = computed(() => {
  if (!authStore.enabled) {
    return t('settings.access.viewer.status.adminPasswordOff');
  }

  if (authStore.accessMode === 'password') {
    return t('settings.access.viewer.status.viewerPasswordOn');
  }

  if (authStore.accessMode === 'public') {
    return t('settings.access.viewer.status.publicViewerOn');
  }

  return t('settings.access.viewer.status.adminOnly');
});
const viewerAccessStatusTone = computed(() => {
  if (!authStore.enabled) {
    return 'text-muted bg-surface-alt';
  }

  if (authStore.accessMode === 'password') {
    return 'text-accent-strong bg-[color-mix(in_srgb,var(--accent-soft)_78%,transparent_22%)]';
  }

  if (authStore.accessMode === 'public') {
    return 'text-[#0f766e] bg-[rgba(15,118,110,0.12)]';
  }

  return 'text-muted bg-surface-alt';
});
const viewerAccessSummaryTitle = computed(() => {
  if (!authStore.enabled) {
    return t('settings.access.viewer.summary.enableAdminFirst');
  }

  if (authStore.accessMode === 'password') {
    return t('settings.access.viewer.summary.viewerPasswordEnabled');
  }

  if (authStore.accessMode === 'public') {
    return t('settings.access.viewer.summary.publicEnabled');
  }

  return t('settings.access.viewer.summary.off');
});
const viewerAccessSummary = computed(() => {
  if (!authStore.enabled) {
    return t('settings.access.viewer.summaryCopy.enableAdminFirst');
  }

  if (authStore.accessMode === 'password') {
    return t('settings.access.viewer.summaryCopy.viewerPasswordEnabled');
  }

  if (authStore.accessMode === 'public') {
    return t('settings.access.viewer.summaryCopy.publicEnabled');
  }

  return t('settings.access.viewer.summaryCopy.off');
});
const viewerAccessDescription = computed(() => {
  if (viewerAccessMode.value === 'password') {
    return viewerAccessEnabled.value
      ? t('settings.access.viewer.helper.viewerPasswordRotate')
      : t('settings.access.viewer.helper.viewerPasswordNew');
  }

  if (viewerAccessMode.value === 'public') {
    return t('settings.access.viewer.helper.public');
  }

  return authStore.accessMode === 'password'
    ? t('settings.access.viewer.helper.disableFromPassword')
    : authStore.accessMode === 'public'
      ? t('settings.access.viewer.helper.disableFromPublic')
    : t('settings.access.viewer.helper.off');
});
const viewerAccessButtonLabel = computed(() => {
  if (viewerAccessMode.value === 'password') {
    return viewerAccessEnabled.value
      ? t('settings.access.viewer.buttons.updateViewerPassword')
      : t('settings.access.viewer.buttons.enableViewerAccess');
  }

  if (viewerAccessMode.value === 'public') {
    return authStore.accessMode === 'public'
      ? t('settings.access.viewer.buttons.savePublicAccess')
      : t('settings.access.viewer.buttons.enablePublicAccess');
  }

  return authStore.accessMode === 'password' || authStore.accessMode === 'public'
    ? t('settings.access.viewer.buttons.disableViewerAccess')
    : t('settings.access.viewer.buttons.saveViewerAccess');
});
const storageLabel = computed(() =>
  appStore.isLibraryUnavailable ? t('settings.status.storage.unavailable') : t('settings.status.storage.available')
);
const lastScanStatus = computed(() => {
  if (!lastCompletedScan.value) {
    return t('settings.status.lastScan.statusValues.none');
  }

  switch (lastCompletedScan.value.status) {
    case 'completed':
      return t('settings.status.lastScan.statusValues.completed');
    case 'completed_with_errors':
      return t('settings.status.lastScan.statusValues.completedWithErrors');
    case 'failed':
      return t('settings.status.lastScan.statusValues.failed');
    case 'running':
      return t('settings.status.lastScan.statusValues.running');
    default:
      return lastCompletedScan.value.status.replaceAll('_', ' ');
  }
});
const lastScanFinishedAt = computed(() => formatDateTime(lastCompletedScan.value?.finished_at));
const lastScanChangeSummary = computed(() => {
  if (!lastCompletedScan.value) {
    return `${formatCount(0)} ${t('settings.status.lastScan.changeValues.new')}\n${formatCount(0)} ${t('settings.status.lastScan.changeValues.updated')}\n${formatCount(0)} ${t('settings.status.lastScan.changeValues.removed')}`;
  }

  return `${formatCount(lastCompletedScan.value.new_files)} ${t('settings.status.lastScan.changeValues.new')}\n${formatCount(lastCompletedScan.value.updated_files)} ${t('settings.status.lastScan.changeValues.updated')}\n${formatCount(lastCompletedScan.value.removed_files)} ${t('settings.status.lastScan.changeValues.removed')}`;
});
const todayScanChangeSummary = computed(() => {
  const changes = adminStats.value?.todayScanChanges;
  return `${formatCount(changes?.new_files ?? 0)} ${t('settings.status.lastScan.changeValues.new')}
${formatCount(changes?.updated_files ?? 0)} ${t('settings.status.lastScan.changeValues.updated')}
${formatCount(changes?.removed_files ?? 0)} ${t('settings.status.lastScan.changeValues.removed')}`;
});
const showScanErrorNotice = computed(() => {
  if (appStore.isLibraryUnavailable || appStore.isScanning) {
    return false;
  }

  if (lastCompletedScan.value?.status !== 'completed_with_errors') {
    return false;
  }

  const dismissed = dismissedScanErrorNotice.value;
  if (!dismissed) {
    return true;
  }

  if (dismissed.scanId !== lastCompletedScan.value.id) {
    return true;
  }

  return Date.now() >= dismissed.dismissedUntil;
});
const showScanWarningNotice = computed(() =>
  !appStore.isLibraryUnavailable &&
  !appStore.isScanning &&
  lastCompletedScan.value?.status === 'completed' &&
  (lastCompletedScan.value.warning_count ?? 0) > 0
);
const ignoredRootMediaCount = computed(() => appStore.stats?.libraryIndex.ignoredRootMediaCount ?? 0);
const showIgnoredRootMediaNotice = computed(() => {
  if (appStore.isLibraryUnavailable || (appStore.stats?.folders ?? 0) === 0 || ignoredRootMediaCount.value === 0) {
    return false;
  }

  const dismissed = dismissedIgnoredRootMediaNotice.value;
  if (!dismissed) {
    return true;
  }

  const currentGalleryRoot = adminStats.value?.libraryIndex.currentGalleryRoot ?? '';
  if (dismissed.galleryRoot !== currentGalleryRoot) {
    return true;
  }

  if (dismissed.ignoredRootMediaCount !== ignoredRootMediaCount.value) {
    return true;
  }

  return Date.now() >= dismissed.dismissedUntil;
});
const scanErrorNoticeMessage = computed(() => {
  const errorText = lastCompletedScan.value?.error_text?.trim() ?? '';
  if (errorText.length === 0) {
    return t('settings.notices.scanError.messages.genericNoDetails');
  }

  if (/spawn ffprobe ENOENT/i.test(errorText) || /spawn ffmpeg ENOENT/i.test(errorText)) {
    return t('settings.notices.scanError.messages.ffmpegMissing');
  }

  if (scanErrorReportPath.value) {
    return t('settings.notices.scanError.messages.withReport');
  }

  return t('settings.notices.scanError.messages.withSample');
});
const scanErrorReportPath = computed(() => {
  const errorText = lastCompletedScan.value?.error_text?.trim() ?? '';
  const match = errorText.match(/^Full error report: (.+)$/m);
  return match?.[1]?.trim() || null;
});
const scanErrorNoticeDetail = computed(() => {
  const errorText = lastCompletedScan.value?.error_text?.trim() ?? '';
  if (errorText.length === 0) {
    return null;
  }

  const [firstLine] = errorText.split('\n');
  const remainingCount = errorText.split('\n').filter((line) => line.trim().length > 0).length - 1;
  if (!firstLine) {
    return null;
  }

  if (remainingCount <= 0) {
    return firstLine;
  }

  return t('settings.notices.scanError.detailMore', { line: firstLine, count: formatCount(remainingCount) });
});
const ignoredRootMediaNoticeMessage = computed(() => {
  return ignoredRootMediaCount.value === 1
    ? t('settings.notices.ignoredRootMedia.messageOne', { count: formatCount(ignoredRootMediaCount.value) })
    : t('settings.notices.ignoredRootMedia.messageOther', { count: formatCount(ignoredRootMediaCount.value) });
});
const legacyDerivativeMigrationMessage = computed(() => {
  const count = legacyDerivativeMigrationCount.value;
  return count === 1
    ? t('settings.library.legacyMigration.messageOne', { count: formatCount(count) })
    : t('settings.library.legacyMigration.messageOther', { count: formatCount(count) });
});

function dismissScanErrorNotice() {
  const scanId = lastCompletedScan.value?.id;
  if (!scanId) {
    return;
  }

  const nextDismissal = {
    scanId,
    dismissedUntil: Date.now() + NOTICE_DISMISS_MS
  };

  dismissedScanErrorNotice.value = nextDismissal;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SCAN_ERROR_NOTICE_STORAGE_KEY, JSON.stringify(nextDismissal));
  }
}

function loadDismissedIgnoredRootMediaNotice(): { galleryRoot: string; ignoredRootMediaCount: number; dismissedUntil: number } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(IGNORED_ROOT_MEDIA_NOTICE_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      galleryRoot?: unknown;
      ignoredRootMediaCount?: unknown;
      dismissedUntil?: unknown;
    };
    if (
      typeof parsed.galleryRoot !== 'string' ||
      typeof parsed.ignoredRootMediaCount !== 'number' ||
      !Number.isFinite(parsed.ignoredRootMediaCount) ||
      typeof parsed.dismissedUntil !== 'number' ||
      !Number.isFinite(parsed.dismissedUntil)
    ) {
      return null;
    }

    return {
      galleryRoot: parsed.galleryRoot,
      ignoredRootMediaCount: parsed.ignoredRootMediaCount,
      dismissedUntil: parsed.dismissedUntil
    };
  } catch {
    return null;
  }
}

function dismissIgnoredRootMediaNotice() {
  const currentGalleryRoot = adminStats.value?.libraryIndex.currentGalleryRoot;
  if (!currentGalleryRoot || ignoredRootMediaCount.value === 0) {
    return;
  }

  const nextDismissal = {
    galleryRoot: currentGalleryRoot,
    ignoredRootMediaCount: ignoredRootMediaCount.value,
    dismissedUntil: Date.now() + NOTICE_DISMISS_MS
  };

  dismissedIgnoredRootMediaNotice.value = nextDismissal;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(IGNORED_ROOT_MEDIA_NOTICE_STORAGE_KEY, JSON.stringify(nextDismissal));
  }
}

function loadDismissedStoriesNotice(storageKey: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(storageKey) === '1';
}

function dismissStoriesMigrationNotice() {
  dismissedStoriesMigrationNotice.value = true;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORIES_MIGRATION_NOTICE_STORAGE_KEY, '1');
  }
}

function dismissStoriesAnnouncement() {
  dismissedStoriesAnnouncement.value = true;
  showStoriesAnnouncementStructure.value = false;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORIES_ANNOUNCEMENT_STORAGE_KEY, '1');
  }
}

function dismissCarouselsAnnouncement() {
  dismissedCarouselsAnnouncement.value = true;
  showCarouselsAnnouncementStructure.value = false;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CAROUSELS_ANNOUNCEMENT_STORAGE_KEY, '1');
  }
}

function dismissPlacesOnboardingBanner() {
  dismissedPlacesOnboardingBanner.value = true;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PLACES_ONBOARDING_STORAGE_KEY, '1');
  }
}

function openPlacesTab() {
  currentCategory.value = 'places';
}

function toggleStoriesAnnouncementStructure() {
  showStoriesAnnouncementStructure.value = !showStoriesAnnouncementStructure.value;
}

function toggleCarouselsAnnouncementStructure() {
  showCarouselsAnnouncementStructure.value = !showCarouselsAnnouncementStructure.value;
}

async function enableAccessProtection() {
  if (authStore.loading) {
    return;
  }

  clearAuthFeedback();
  clearViewerFeedback();
  const validationError = validatePasswordConfirmation(enablePassword.value, enablePasswordConfirmation.value);
  if (validationError) {
    setAuthError(validationError);
    return;
  }

  try {
    await authStore.enablePassword(enablePassword.value);
    enablePassword.value = '';
    enablePasswordConfirmation.value = '';
    setAuthSuccess(t('settings.access.enable.success'));
  } catch (error) {
    setAuthError(error instanceof Error ? error.message : t('settings.access.enable.error'));
  }
}

async function changeAccessPassword() {
  if (authStore.loading) {
    return;
  }

  clearAuthFeedback();
  clearViewerFeedback();
  if (currentPassword.value.length === 0) {
    setAuthError(t('settings.access.change.missingCurrent'));
    return;
  }

  const validationError = validatePasswordConfirmation(nextPassword.value, nextPasswordConfirmation.value);
  if (validationError) {
    setAuthError(validationError);
    return;
  }

  try {
    await authStore.changePassword(currentPassword.value, nextPassword.value);
    resetChangePasswordFields();
    showChangePasswordForm.value = false;
    setAuthSuccess(t('settings.access.change.success'));
  } catch (error) {
    setAuthError(error instanceof Error ? error.message : t('settings.access.change.error'));
  }
}

async function disableAccessProtection() {
  if (authStore.loading) {
    return;
  }

  clearAuthFeedback();
  clearViewerFeedback();
  if (disablePassword.value.length === 0) {
    setAuthError(t('settings.access.danger.missingCurrent'));
    return;
  }

  try {
    await authStore.disablePassword(disablePassword.value);
    resetDisablePasswordField();
    resetChangePasswordFields();
    showChangePasswordForm.value = false;
    showDisablePasswordForm.value = false;
    viewerAccessMode.value = 'off';
    viewerPassword.value = '';
    viewerPasswordConfirmation.value = '';
    setAuthSuccess(t('settings.access.danger.success'));
  } catch (error) {
    setAuthError(error instanceof Error ? error.message : t('settings.access.danger.error'));
  }
}

async function saveViewerAccess() {
  if (authStore.loading || !authStore.enabled) {
    return;
  }

  clearAuthFeedback();
  clearViewerFeedback();

  if (viewerAccessMode.value === 'password') {
    const validationError = validatePasswordConfirmation(viewerPassword.value, viewerPasswordConfirmation.value);
    if (validationError) {
      setViewerError(validationError);
      return;
    }
  }

  try {
    await authStore.configureViewerAccess(
      viewerAccessMode.value,
      viewerAccessMode.value === 'password' ? viewerPassword.value : undefined
    );
    viewerPassword.value = '';
    viewerPasswordConfirmation.value = '';
    setViewerSuccess(
      viewerAccessMode.value === 'password'
        ? t('settings.access.viewer.success.password')
        : viewerAccessMode.value === 'public'
          ? t('settings.access.viewer.success.public')
        : t('settings.access.viewer.success.off')
    );
  } catch (error) {
    setViewerError(error instanceof Error ? error.message : t('settings.access.viewer.error'));
  }
}

async function signOut() {
  if (authStore.loading) {
    return;
  }

  clearAuthFeedback();

  try {
    await authStore.logout();
  } catch (error) {
    setAuthError(error instanceof Error ? error.message : t('settings.access.danger.signOutError'));
  }
}

function closeGeneralSettingsMenu() {
  activeGeneralSettingsMenu.value = null;
}

function toggleGeneralSettingsMenu(menu: 'home' | 'reels' | 'folder' | 'nestedTitle' | 'videoQuality') {
  clearGeneralSettingsFeedback();
  activeGeneralSettingsMenu.value = activeGeneralSettingsMenu.value === menu ? null : menu;
}

function acknowledgeStoriesMigrationChoice() {
  acknowledgedStoriesMigrationChoice.value = true;
}

function selectStoriesMode(value: boolean, options?: { acknowledgeMigrationChoice?: boolean; scrollToSaveArea?: boolean }) {
  clearGeneralSettingsFeedback();
  closeGeneralSettingsMenu();
  storiesMode.value = value;

  if (options?.acknowledgeMigrationChoice) {
    acknowledgeStoriesMigrationChoice();
  }

  if (options?.scrollToSaveArea) {
    void scrollToGeneralSettingsSaveArea();
  }
}

function toggleStoriesModeSetting() {
  const shouldAcknowledgeMigrationChoice = showStoriesMigrationNotice.value;
  selectStoriesMode(!storiesMode.value, {
    acknowledgeMigrationChoice: shouldAcknowledgeMigrationChoice,
    scrollToSaveArea: shouldAcknowledgeMigrationChoice
  });
}

function chooseStoriesMigrationMode(value: boolean) {
  selectStoriesMode(value, {
    acknowledgeMigrationChoice: true,
    scrollToSaveArea: true
  });
}

function selectCarouselsMode(value: boolean, scrollToSaveArea = false) {
  clearGeneralSettingsFeedback();
  carouselsMode.value = value;
  if (scrollToSaveArea) void scrollToGeneralSettingsSaveArea();
}

function toggleCarouselsModeSetting() {
  selectCarouselsMode(!carouselsMode.value, showCarouselsMigrationNotice.value);
}

function chooseCarouselsMigrationMode(value: boolean) {
  selectCarouselsMode(value, true);
}

function selectHomeFeedDefault(mode: FeedMode) {
  clearGeneralSettingsFeedback();
  homeFeedDefaultMode.value = mode;
  closeGeneralSettingsMenu();
}

function selectReelsFeedDefault(mode: ReelsFeedMode) {
  clearGeneralSettingsFeedback();
  reelsFeedDefaultMode.value = mode;
  closeGeneralSettingsMenu();
}

function selectFolderImageOrderDefault(order: FolderImageOrder) {
  clearGeneralSettingsFeedback();
  folderImageOrderDefault.value = order;
  closeGeneralSettingsMenu();
}

function selectNestedFolderTitleFormat(value: NestedFolderTitleFormat) {
  clearGeneralSettingsFeedback();
  nestedFolderTitleFormat.value = value;
  closeGeneralSettingsMenu();
}

function selectVideoPlaybackQuality(value: VideoPlaybackQuality) {
  clearGeneralSettingsFeedback();
  videoPlaybackQuality.value = value;
  closeGeneralSettingsMenu();
}

function clearVideoPlaybackQualityOverride() {
  clearGeneralSettingsFeedback();
  appStore.setVideoPlaybackQualityOverride(null);
}

async function saveGeneralSettings() {
  if (generalSettingsSaveDisabled.value) {
    return;
  }

  const shouldSaveLocale = localeDirty.value;
  const shouldSaveExcludedFolders = excludedFoldersDirty.value;
  const shouldSaveStories = storiesModeDirty.value || storiesModeRequiresDecision.value;
  const shouldSaveCarousels = carouselsModeDirty.value || carouselsModeRequiresDecision.value;
  const shouldSaveHome = homeFeedDefaultDirty.value;
  const shouldSaveReels = reelsFeedDefaultDirty.value;
  const shouldSaveFolderOrder = folderImageOrderDirty.value;
  const shouldSaveNestedFolderTitle = nestedFolderTitleDirty.value;
  const shouldSaveVideoPlaybackQuality = videoPlaybackQualityDirty.value;
  const shouldSaveSharePublicBaseUrl = sharePublicBaseUrlDirty.value;
  const shouldSaveAnyDefault =
    shouldSaveLocale ||
    shouldSaveHome ||
    shouldSaveReels ||
    shouldSaveFolderOrder ||
    shouldSaveNestedFolderTitle ||
    shouldSaveVideoPlaybackQuality ||
    shouldSaveSharePublicBaseUrl;
  const savedDefaultCount = [
    shouldSaveLocale,
    shouldSaveHome,
    shouldSaveReels,
    shouldSaveFolderOrder,
    shouldSaveNestedFolderTitle,
    shouldSaveVideoPlaybackQuality,
    shouldSaveSharePublicBaseUrl
  ].filter(Boolean).length;
  const savedParts: string[] = [];
  const savedFolderRuleCount = [shouldSaveExcludedFolders, shouldSaveStories, shouldSaveCarousels].filter(Boolean).length;
  let nextExcludedFolders: string[] = [];

  if (shouldSaveExcludedFolders) {
    try {
      nextExcludedFolders = parseExcludedFolderRulesDraft(customExcludedFoldersDraft.value);
    } catch (error) {
      setGeneralSettingsFeedback('error', error instanceof Error ? error.message : t('settings.general.errors.validateExcludedFolders'));
      return;
    }
  }

  savingGeneralSettings.value = true;
  closeGeneralSettingsMenu();
  clearGeneralSettingsFeedback();

  try {
    if (shouldSaveLocale) {
      const payload = await updateAppLocale(appStore.locale);
      savedParts.push(t('settings.general.feedback.parts.appLanguage'));

      if (appStore.stats) {
        appStore.stats.preferences.defaultLocale = payload.defaultLocale;
      }

      savedLocaleSelection.value = payload.defaultLocale;
    }

    if (shouldSaveExcludedFolders) {
      const payload = await updateExcludedFolders(nextExcludedFolders);
      savedParts.push(t('settings.general.feedback.parts.excludedFolders'));
      customExcludedFoldersDraft.value = formatExcludedFolderRules(payload.customExcludedFolders);

      if (adminStats.value) {
        adminStats.value = {
          ...adminStats.value,
          excludedFolders: {
            envExcludedFolders: payload.envExcludedFolders,
            customExcludedFolders: payload.customExcludedFolders,
            effectiveExcludedFolders: payload.effectiveExcludedFolders
          }
        };
      }
    }

    if (shouldSaveStories) {
      const payload = await updateStoriesMode(storiesMode.value);
      savedParts.push(t('settings.general.feedback.parts.storiesFolderHandling'));
      storiesMode.value = payload.treatStoriesAsFolders;

      if (appStore.stats) {
        appStore.stats.preferences.treatStoriesAsFolders = payload.treatStoriesAsFolders;
        if (appStore.stats.storiesMigration) {
          appStore.stats.storiesMigration.decisionPending = false;
        }
      }
    }

    if (shouldSaveCarousels) {
      const payload = await updateCarouselsMode(carouselsMode.value);
      savedParts.push(t('settings.general.feedback.parts.carouselsFolderHandling'));
      carouselsMode.value = payload.preferences.treatCarouselsAsFolders;
      if (appStore.stats) {
        appStore.stats.preferences.treatCarouselsAsFolders = payload.preferences.treatCarouselsAsFolders;
        if (appStore.stats.carouselsMigration) {
          appStore.stats.carouselsMigration.decisionPending = false;
        }
      }
    }

    if (shouldSaveHome) {
      const payload = await updateHomeFeedDefault(homeFeedDefaultMode.value);
      savedParts.push(t('settings.general.feedback.parts.homeFeedDefault'));
      if (appStore.stats) {
        appStore.stats.preferences.defaultHomeFeedMode = payload.defaultMode;
      }
      homeFeedDefaultMode.value = payload.defaultMode;
    }

    if (shouldSaveReels) {
      const payload = await updateReelsFeedDefault(reelsFeedDefaultMode.value);
      savedParts.push(t('settings.general.feedback.parts.reelsFeedDefault'));
      if (appStore.stats) {
        appStore.stats.preferences.defaultReelsFeedMode = payload.defaultMode;
      }
      reelsFeedDefaultMode.value = payload.defaultMode;
    }

    if (shouldSaveFolderOrder) {
      const payload = await updateFolderImageOrderDefault(folderImageOrderDefault.value);
      savedParts.push(t('settings.general.feedback.parts.appFolderOrder'));
      if (appStore.stats) {
        appStore.stats.preferences.defaultFolderImageOrder = payload.defaultOrder;
      }
      folderImageOrderDefault.value = payload.defaultOrder;
    }

    if (shouldSaveNestedFolderTitle) {
      const payload = await updateNestedFolderTitleFormat(nestedFolderTitleFormat.value);
      savedParts.push(t('settings.general.feedback.parts.nestedFolderTitles'));
      if (appStore.stats) {
        appStore.stats.preferences.nestedFolderTitleFormat = payload.titleFormat;
      }
      nestedFolderTitleFormat.value = payload.titleFormat;
    }

    if (shouldSaveVideoPlaybackQuality) {
      const payload = await updateVideoPlaybackQuality(videoPlaybackQuality.value);
      savedParts.push(t('settings.general.feedback.parts.videoPlaybackQuality'));
      if (appStore.stats) {
        appStore.stats.preferences.videoPlaybackQuality = payload.videoPlaybackQuality;
      }
      videoPlaybackQuality.value = payload.videoPlaybackQuality;
      // Saving the library default is an explicit choice, so a stale per-device
      // override must not keep shadowing it.
      appStore.setVideoPlaybackQualityOverride(null);
    }

    if (shouldSaveSharePublicBaseUrl) {
      const trimmed = sharePublicBaseUrlDraft.value.trim();
      const payload = await updateSharePublicBaseUrl(trimmed.length > 0 ? trimmed : null);
      savedParts.push(t('settings.general.feedback.parts.sharePublicBaseUrl'));

      if (appStore.stats) {
        appStore.stats.preferences.sharePublicBaseUrl = payload.sharePublicBaseUrl;
      }

      sharePublicBaseUrlDraft.value = payload.sharePublicBaseUrl ?? '';
    }

    await appStore.fetchStats({ background: true });

    if (shouldSaveStories || shouldSaveCarousels || shouldSaveExcludedFolders) {
      await loadAdminStats().catch(() => {});
    }

    if (savedFolderRuleCount > 0 && appStore.isLibraryRebuildRequired) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.folderRulesSavedRebuild'));
    } else if (savedFolderRuleCount > 0 && shouldSaveAnyDefault) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.settingsAndFolderRulesSaved'));
    } else if (savedFolderRuleCount > 1) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.folderRulesSaved'));
    } else if (shouldSaveExcludedFolders) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.excludedFoldersSaved'));
    } else if (shouldSaveStories && shouldSaveAnyDefault) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.settingsAndStoriesSaved'));
    } else if (shouldSaveStories) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.storiesSaved'));
    } else if (shouldSaveCarousels) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.carouselsSaved'));
    } else if (savedDefaultCount > 1) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.defaultsSaved'));
    } else if (shouldSaveLocale) {
      setGeneralSettingsFeedback(
        'success',
        t('settings.general.feedback.languageSaved', { label: selectedLocaleOptionLabel.value })
      );
    } else if (shouldSaveHome) {
      setGeneralSettingsFeedback(
        'success',
        t('settings.general.feedback.homeSaved', { label: selectedHomeFeedDefaultOption.value.label })
      );
    } else if (shouldSaveReels) {
      setGeneralSettingsFeedback(
        'success',
        t('settings.general.feedback.reelsSaved', { label: selectedReelsFeedDefaultOption.value.label })
      );
    } else if (shouldSaveFolderOrder) {
      setGeneralSettingsFeedback(
        'success',
        t('settings.general.feedback.folderOrderSaved', { label: selectedFolderImageOrderOption.value.label })
      );
    } else if (shouldSaveNestedFolderTitle) {
      setGeneralSettingsFeedback(
        'success',
        t('settings.general.feedback.nestedFolderTitleSaved', { label: selectedNestedFolderTitleOption.value.label })
      );
    } else if (shouldSaveVideoPlaybackQuality) {
      setGeneralSettingsFeedback(
        'success',
        t('settings.general.feedback.videoPlaybackQualitySaved', { label: selectedVideoPlaybackQualityOption.value.label })
      );
    } else if (shouldSaveSharePublicBaseUrl) {
      setGeneralSettingsFeedback('success', t('settings.general.feedback.sharePublicBaseUrlSaved'));
    }
  } catch (error) {
    await appStore.fetchStats({ background: true }).catch(() => {});
    if (shouldSaveStories || shouldSaveCarousels || shouldSaveExcludedFolders) {
      await loadAdminStats().catch(() => {});
    }

    const message = error instanceof Error ? error.message : t('settings.general.errors.update');

    if (savedParts.length > 0) {
      setGeneralSettingsFeedback(
        'error',
        t('settings.general.errors.partialUpdate', { parts: savedParts.join(', '), message })
      );
    } else {
      setGeneralSettingsFeedback('error', message);
    }
  } finally {
    savingGeneralSettings.value = false;
  }
}

async function warmScanStatus() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(attempt === 0 ? 150 : 250);

    try {
      await appStore.fetchStats({ background: true });
    } catch {
      // The rescan request may win the race; keep polling until scan state flips or the request finishes.
    }

    if (appStore.stats?.scan.isScanning) {
      return;
    }
  }
}

async function loadAdminStats() {
  adminStats.value = await fetchAdminStats();

  if (!excludedFoldersHydrated.value || savingGeneralSettings.value || !excludedFoldersDirty.value) {
    syncExcludedFoldersFromSaved();
  }
}

async function runManualScan() {
  if (scanActionDisabled.value) {
    return;
  }

  requestingScan.value = true;
  scanError.value = null;

  try {
    const request = triggerManualScan();
    void warmScanStatus();
    await request;
    await appStore.fetchStats({ background: true });
    await loadAdminStats().catch(() => {});
    await Promise.all([foldersStore.fetchFolders(true), feedStore.loadInitial(true)]);
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : t('settings.library.errors.startScan');
  } finally {
    requestingScan.value = false;
  }
}

async function runLibraryRebuild() {
  if (rebuildActionDisabled.value) {
    return;
  }

  rebuilding.value = true;
  rebuildError.value = null;
  confirmRebuildOpen.value = false;
  appStore.markLibraryRebuildStarted();
  feedStore.resetForRebuild();
  foldersStore.resetForRebuild();
  likesStore.resetForRebuild();
  momentsStore.resetForRebuild();
  viewerStore.reset();

  try {
    const request = triggerLibraryRebuild();
    void warmScanStatus();
    await request;
    await appStore.fetchStats({ background: true });
    await loadAdminStats().catch(() => {});
    await Promise.all([
      foldersStore.fetchFolders(true),
      feedStore.loadInitial(true),
      likesStore.initialize(true),
      momentsStore.fetchMoments(true)
    ]);
  } catch (error) {
    rebuildError.value = error instanceof Error ? error.message : t('settings.library.errors.rebuild');
    await appStore.fetchStats({ background: true });
    await loadAdminStats().catch(() => {});
  } finally {
    rebuilding.value = false;
  }
}

async function runThumbnailRebuild() {
  if (thumbnailRebuildActionDisabled.value) {
    return;
  }

  rebuildingThumbnails.value = true;
  thumbnailRebuildError.value = null;
  confirmThumbnailRebuildOpen.value = false;

  try {
    const request = triggerThumbnailRebuild();
    void warmScanStatus();
    await request;
    await appStore.fetchStats({ background: true });
    await loadAdminStats().catch(() => {});
    await Promise.all([
      foldersStore.fetchFolders(true),
      feedStore.loadInitial(true),
      likesStore.initialize(true),
      momentsStore.fetchMoments(true)
    ]);
  } catch (error) {
    thumbnailRebuildError.value = error instanceof Error ? error.message : t('settings.library.errors.regenerate');
    await appStore.fetchStats({ background: true });
    await loadAdminStats().catch(() => {});
  } finally {
    rebuildingThumbnails.value = false;
  }
}

onMounted(async () => {
  if (!appStore.stats && !appStore.loadingStats) {
    await appStore.fetchStats();
  }

  if (appStore.stats) {
    syncLocaleSelectionFromSaved();
    syncFeedDefaultsFromSaved();
    syncStoriesModeFromSaved();
    syncCarouselsModeFromSaved();
  }
  await placesStore.fetchStatus();
  await loadAdminStats().catch(() => {});
});

watch(
  () =>
    [
      appStore.stats,
      appStore.loadingStats,
      savedHomeFeedDefaultMode.value,
      savedReelsFeedDefaultMode.value,
      savedFolderImageOrderDefault.value,
      savedStoriesMode.value,
      savedCarouselsMode.value
    ] as const,
  ([stats, loadingStats]) => {
    if (!stats || loadingStats) {
      return;
    }

    if (!localeSelectionHydrated.value || savingGeneralSettings.value || !localeDirty.value) {
      syncLocaleSelectionFromSaved();
    }

    if (!feedDefaultsHydrated.value || savingGeneralSettings.value || !feedDefaultsDirty.value) {
      syncFeedDefaultsFromSaved();
    }

    if (!storiesModeHydrated.value || savingGeneralSettings.value || !storiesModeDirty.value) {
      syncStoriesModeFromSaved();
    }

    if (!carouselsModeHydrated.value || savingGeneralSettings.value || !carouselsModeDirty.value) {
      syncCarouselsModeFromSaved();
    }
  },
  {
    immediate: true
  }
);

watch(
  () => storiesModeRequiresDecision.value,
  (requiresDecision) => {
    if (requiresDecision) {
      return;
    }

    acknowledgedStoriesMigrationChoice.value = false;
  }
);

watch(
  () => authStore.enabled,
  (enabled) => {
    if (!enabled) {
      showChangePasswordForm.value = false;
      showDisablePasswordForm.value = false;
      resetChangePasswordFields();
      resetDisablePasswordField();
      clearViewerFeedback();
    }
  }
);

watch(viewerAccessMode, (mode) => {
  if (mode !== 'password') {
    viewerPassword.value = '';
    viewerPasswordConfirmation.value = '';
  }
});

watch(
  () => authStore.accessMode,
  (accessMode) => {
    viewerAccessMode.value = accessMode;
  },
  {
    immediate: true
  }
);

watch(
  () => authStore.enabled,
  (enabled) => {
    if (enabled) {
      return;
    }

    clearViewerFeedback();
    viewerAccessMode.value = 'off';
    viewerPassword.value = '';
    viewerPasswordConfirmation.value = '';
  }
);
</script>
