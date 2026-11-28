<template>
  <section class="card grid min-w-0 gap-6 p-6 max-sm:p-4" aria-labelledby="sources-title" :aria-busy="initialLoading">
    <header class="grid gap-2">
      <h2 id="sources-title" class="m-0 text-xl">{{ t('sources.title') }}</h2>
      <p class="m-0 text-[0.9rem] text-muted">{{ t('sources.description') }}</p>
    </header>

    <p v-if="error" role="alert" class="m-0 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[0.85rem] text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-if="notice" role="status" class="m-0 rounded-lg bg-accent-soft p-3 text-[0.85rem] text-accent-strong">{{ notice }}</p>

    <div v-if="!sourcesLoaded" class="grid min-h-64 place-items-center text-[0.85rem] text-muted" role="status">
      <span v-if="initialLoading">Loading sources…</span>
      <button v-else type="button" class="btn-ghost" @click="loadInitialSources">Try again</button>
    </div>
    <template v-else-if="!formOpen && !localForm">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="busy" @click="openLocal()">{{ t('sources.local.add') }}</button>
        <button type="button" class="btn-ghost" :disabled="busy" @click="newSource">{{ t('sources.connectImmich') }}</button>
      </div>
      <article v-for="source in sources" :key="source.id" class="grid min-w-0 gap-4 rounded-xl border border-border p-4">
        <div class="flex items-start gap-3">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-strong"><svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 3 4 4m5 1 4 4M7 7l10 10M9 5l-3 3a5 5 0 0 0 0 7l3 3m6-12 3 3a5 5 0 0 1 0 7l-3 3M3 21l4-4m10-10 4-4" /></svg></span>
          <div class="grid min-w-0 flex-1 gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong>{{ source.name }}</strong>
              <span v-if="source.kind === 'local'" class="text-xs text-muted">{{ t('sources.local.type') }}</span>
              <span class="rounded-full bg-surface-alt px-2 py-0.5 text-xs text-muted">{{ source.kind === 'local' ? localStatus(source) : source.enabled ? (source.syncing ? 'Syncing' : source.status === 'ready' ? 'Connected' : source.status === 'error' || source.status === 'revoked' ? 'Needs attention' : 'Not synced yet') : 'Disabled' }}</span>
              <span v-if="source.managed_by === 'environment'" class="text-xs text-muted">Environment managed</span>
            </div>
            <p class="m-0 break-all text-[0.8rem] text-muted">{{ source.kind === 'local' ? source.rootPath : source.server_url }}</p>
          </div>
        </div>
        <p class="m-0 text-[0.85rem]">{{ source.kind === 'local' ? t('sources.local.counts', { assets: source.asset_count.toLocaleString(), folders: source.folder_count }) : `${source.asset_count.toLocaleString()} photos and videos · ${source.folder_count} groups` }}</p>
        <p v-if="source.syncing" role="status" class="m-0 text-[0.85rem] text-muted">{{ source.kind === 'local' ? t('sources.local.progress', { progress: source.progress }) : `Finding your media… ${source.progress} found so far.` }}</p>
        <p v-if="source.last_error" role="alert" class="m-0 break-words text-[0.85rem] text-red-600 dark:text-red-400">{{ source.last_error }}</p>
        <p v-if="source.status === 'ready' && !source.asset_count" class="m-0 text-[0.85rem] text-muted">{{ source.kind === 'local' ? t('sources.local.noMedia') : 'No media in this selection. Edit the source to choose folders or albums.' }}</p>
        <div class="flex flex-wrap items-start gap-2">
          <button type="button" class="btn-ghost" :disabled="busy || source.syncing || !source.enabled" @click="sync(source)">{{ t('sources.syncNow') }}</button>
          <button v-if="source.kind === 'local' && source.status === 'empty_review'" type="button" class="btn-ghost" :disabled="busy || source.syncing" @click="reviewEmpty(source)">{{ t('sources.local.confirmEmpty') }}</button>
          <button v-if="source.kind !== 'local' || source.managed_by !== 'environment'" type="button" class="btn-ghost" :disabled="busy || source.syncing" @click="source.kind === 'local' ? openLocal(source) : edit(source)">{{ source.managed_by === 'environment' ? 'View configuration' : t('sources.edit') }}</button>
          <button v-if="source.kind !== 'local' && source.managed_by !== 'environment'" type="button" class="btn-ghost" :disabled="busy || source.syncing" @click="edit(source, 'connection')">Edit connection</button>
          <details class="min-w-0 flex-1 text-[0.8rem]">
            <summary class="min-h-9 cursor-pointer px-2 py-2 text-muted">More options</summary>
            <div class="grid gap-3 pt-3">
              <p class="m-0 text-muted">Last synced: {{ source.last_success ? new Date(source.last_success).toLocaleString() : 'Never' }}</p>
              <div class="flex flex-wrap gap-2">
                <button v-if="source.managed_by !== 'environment'" type="button" class="btn-ghost" :disabled="busy || source.syncing" @click="toggle(source)">{{ source.enabled ? 'Disable' : 'Enable' }}</button>
                <button v-if="source.kind !== 'local'" type="button" class="btn-ghost" :disabled="busy || source.syncing" @click="clearCache(source)">Clear cache</button>
                <button v-if="source.managed_by !== 'environment'" type="button" class="btn-ghost text-red-600 dark:text-red-400" :disabled="busy || source.syncing" @click="remove(source)">Remove</button>
              </div>
            </div>
          </details>
        </div>
      </article>
    </template>

    <form v-else-if="localForm" class="grid min-w-0 gap-5 border-t border-border pt-5" :aria-busy="busy" @submit.prevent="saveLocal">
      <h3 ref="formHeading" tabindex="-1" class="m-0 text-base focus:outline-none">{{ localFormId ? localForm.name : t('sources.local.add') }}</h3>
      <p class="m-0 text-sm text-muted">{{ t('sources.local.pathHelp') }}</p>
      <fieldset :disabled="busy" class="m-0 grid min-w-0 gap-4 border-0 p-0">
        <label class="grid gap-2 text-sm font-medium">{{ t('sources.local.name') }}
          <input v-model.trim="localForm.name" required maxlength="100" class="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-text focus:outline-accent" />
        </label>
        <label class="grid gap-2 text-sm font-medium">{{ t('sources.local.path') }}
          <input v-model.trim="localForm.rootPath" required maxlength="4096" :readonly="localFormId !== null" spellcheck="false" placeholder="/sources/pictures" class="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-text focus:outline-accent" @input="pathCheck = null" />
        </label>
        <p class="m-0 text-xs text-muted">{{ t('sources.local.discoveryHelp') }}</p>
        <label class="flex items-start gap-2 text-sm">
          <input v-model="localForm.readOnlyOriginals" type="checkbox" class="mt-1 accent-accent" />
          <span>{{ t('sources.local.readOnly') }}<span class="block text-xs text-muted">{{ t('sources.local.readOnlyHelp') }}</span></span>
        </label>
      </fieldset>
      <p v-if="pathCheck" role="status" class="m-0 text-sm text-accent-strong">
        {{ t('sources.local.pathValid') }}
        {{ pathCheck.partial ? t('sources.local.sampled') : '' }}
        {{ pathCheck.ignoredRootMediaCount ? t('sources.local.ignored', { count: pathCheck.ignoredRootMediaCount }) : '' }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button v-if="localFormId === null" type="button" class="btn-ghost" :disabled="busy || !localForm.rootPath" @click="validatePath">{{ t('sources.local.validate') }}</button>
        <button type="submit" class="btn-primary" :disabled="busy">{{ localFormId ? t('sources.local.save') : t('sources.local.saveSync') }}</button>
        <button type="button" class="btn-ghost" :disabled="busy" @click="localForm = null">{{ t('common.cancel') }}</button>
      </div>
    </form>

    <form v-else class="grid min-w-0 gap-6 border-t border-border pt-5" :aria-busy="busy" @submit.prevent="step === 'connection' ? detect() : save()">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 ref="formHeading" tabindex="-1" class="m-0 text-base focus:outline-none">{{ editingId ? form.name : 'Connect Immich' }}</h3>
        <ol v-if="!editingId" class="m-0 flex list-none items-center gap-3 p-0 text-xs text-muted" aria-label="Connection steps">
          <li :aria-current="step === 'connection' ? 'step' : undefined" :class="step === 'connection' ? 'font-semibold text-accent-strong' : ''">1. Connect</li>
          <li aria-hidden="true">/</li>
          <li :aria-current="step === 'content' ? 'step' : undefined" :class="step === 'content' ? 'font-semibold text-accent-strong' : ''">2. Choose content</li>
        </ol>
      </div>
      <p v-if="environmentManaged" class="m-0 text-[0.85rem] text-muted">This configuration is read-only. Environment values take precedence for this source; change them and restart Foldergram.</p>

      <fieldset :disabled="busy || environmentManaged" class="m-0 grid min-w-0 gap-5 border-0 p-0">
        <template v-if="step === 'connection'">
          <label class="grid gap-2 text-[0.85rem] font-medium">Immich server URL
            <input v-model.trim="form.serverUrl" type="url" required placeholder="http://localhost:2283" spellcheck="false" class="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5 text-text focus:outline-accent" @input="connectionChanged(true)" />
          </label>
          <label class="grid gap-2 text-[0.85rem] font-medium">API key
            <input v-model.trim="apiKey" type="password" autocomplete="new-password" :required="requiresApiKey" :placeholder="requiresApiKey ? 'Paste your Immich API key' : 'Leave blank to keep your current key'" class="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5 text-text focus:outline-accent" @input="connectionChanged(false)" />
          </label>
          <p v-if="addressChanged" class="m-0 text-[0.8rem] text-muted">Enter an API key again to verify the new address. You can reuse your key if it still has access to the same library.</p>
          <details class="text-[0.8rem] text-muted">
            <summary class="cursor-pointer">Need help connecting?</summary>
            <div class="grid gap-3 pt-3 leading-relaxed">
              <p class="m-0">Create an API key in Immich’s Account Settings → API Keys. Enable server.about, asset.read and asset.view; add album.read for albums. library.read is optional for external folder discovery.</p>
              <p class="m-0">Enter the base URL without <code>/api</code>. Use <code>http://localhost:2283</code> when Foldergram runs on the same host as Immich’s published port, or use your configured host port. If both apps run in Docker on a shared network, use Immich’s service name, such as <code>http://immich-server:2283</code>. You can also use a LAN or reverse proxy URL reachable from Foldergram.</p>
            </div>
          </details>
        </template>

        <template v-else>
          <div class="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-surface-alt px-3 py-2.5 text-[0.8rem]">
            <div class="grid min-w-0 flex-1 gap-0.5">
              <span v-if="detection" class="flex items-center gap-1.5 font-semibold text-green-700 dark:text-green-400" role="status">
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
                Connected to Immich
              </span>
              <span class="break-all text-muted">{{ form.serverUrl }}</span>
            </div>
            <button v-if="!environmentManaged" type="button" class="cursor-pointer border-0 bg-transparent p-1 text-accent-strong" @click="step = 'connection'">Edit connection</button>
          </div>
          <fieldset class="m-0 min-w-0 border-0 p-0">
            <legend class="mb-3 text-[0.95rem] font-semibold">What would you like to connect?</legend>
            <div class="grid grid-cols-3 gap-2">
              <label v-for="mode in modes" :key="mode.value" class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent max-sm:min-h-12 max-sm:items-center max-sm:justify-center max-sm:gap-0 max-sm:px-2 max-sm:text-center" :class="form.selection.mode === mode.value ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-hover'">
                <input v-model="form.selection.mode" type="radio" name="immich-mode" :value="mode.value" class="mt-1 shrink-0 accent-accent max-sm:sr-only" />
                <span class="grid min-w-0 gap-1"><strong class="text-[0.85rem]">{{ mode.label }}</strong><span class="text-xs font-normal text-muted max-sm:hidden">{{ mode.description }}</span></span>
              </label>
            </div>
          </fieldset>

          <details :open="selectionOpen" class="group rounded-xl border" :class="detection ? 'border-green-600/50 dark:border-green-400/45' : 'border-border'" data-test="customize-selection" @toggle="updateSelectionOpen">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 group-open:rounded-b-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden" :class="detection ? 'bg-green-500/8' : 'bg-surface-alt'">
              <span class="grid min-w-0 gap-1">
                <span class="text-[0.9rem] font-semibold">Customize selection</span>
                <span class="text-xs text-muted" aria-live="polite">{{ selectionSummary }}</span>
              </span>
              <svg class="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </summary>
            <div class="grid min-w-0 gap-5 border-t border-border p-4">
              <div class="grid gap-1">
                <p class="m-0 text-[0.8rem] text-muted">{{ editingId ? 'Your saved selection is kept. Uncheck anything you want to leave out.' : 'Everything found is selected to start. Uncheck anything you want to leave out.' }}</p>
                <p v-if="form.selection.mode === 'both'" class="m-0 text-xs text-muted">Photos in both a folder and an album appear only once in Home.</p>
              </div>
              <label v-if="folderOptions.length + albumOptions.length > 6" class="grid gap-2 text-[0.8rem]">Search folders and albums
                <input v-model="selectionSearch" type="search" placeholder="Search by name or path" class="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent" />
              </label>
              <fieldset v-if="form.selection.mode !== 'albums'" class="m-0 grid min-w-0 gap-2 border-0 p-0" data-test="folder-selection">
                <legend class="mb-2 text-[0.85rem] font-semibold">Folders</legend>
                <div v-if="folderOptions.length" class="flex flex-wrap items-center gap-3 text-xs">
                  <span class="mr-auto text-muted">Includes subfolders</span>
                  <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-accent-strong" @click="selectAllFolders">Select all folders</button>
                  <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-muted" @click="form.selection.roots = []">Deselect all folders</button>
                </div>
                <p v-else class="m-0 text-[0.8rem] text-muted">No external folders found. Try Albums for uploaded photos.</p>
                <div class="grid max-h-64 gap-1 overflow-y-auto overscroll-contain">
                  <label v-for="root in filteredFolders" :key="`${root.libraryId}:${root.path}`" class="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-hover">
                    <input type="checkbox" :checked="hasRoot(root.libraryId, root.path)" class="h-4 w-4 shrink-0 accent-accent" @change="toggleRoot(root.libraryId, root.path)" />
                    <span class="grid min-w-0 gap-0.5"><span class="break-all text-[0.85rem]">{{ root.name }}</span><span v-if="root.name !== root.path" class="break-all text-xs text-muted">{{ root.path }}</span></span>
                  </label>
                </div>
                <p v-if="folderOptions.length && !filteredFolders.length" class="m-0 text-[0.8rem] text-muted">No matching folders.</p>
              </fieldset>
              <fieldset v-if="form.selection.mode !== 'folders'" class="m-0 grid min-w-0 gap-2 border-0 p-0" data-test="album-selection">
                <legend class="mb-2 text-[0.85rem] font-semibold">Albums</legend>
                <div v-if="albumOptions.length" class="flex flex-wrap items-center gap-3 text-xs">
                  <span class="mr-auto text-muted">Owned and shared with you</span>
                  <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-accent-strong" @click="form.selection.albumIds = albumOptions.map(album => album.id)">Select all albums</button>
                  <button type="button" class="cursor-pointer border-0 bg-transparent p-1 text-muted" @click="form.selection.albumIds = []">Deselect all albums</button>
                </div>
                <p v-else class="m-0 text-[0.8rem] text-muted">No albums found. You can use Folders instead.</p>
                <div class="grid max-h-64 gap-1 overflow-y-auto overscroll-contain">
                  <label v-for="album in filteredAlbums" :key="album.id" class="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-hover">
                    <input v-model="form.selection.albumIds" type="checkbox" :value="album.id" class="h-4 w-4 shrink-0 accent-accent" />
                    <span class="min-w-0 break-words text-[0.85rem]">{{ album.albumName }}<span v-if="album.shared" class="text-xs text-muted"> · Shared</span></span>
                  </label>
                </div>
                <p v-if="albumOptions.length && !filteredAlbums.length" class="m-0 text-[0.8rem] text-muted">No matching albums.</p>
              </fieldset>
              <label v-if="detection?.uploadCount || form.selection.includeUnfiled" class="flex items-start gap-3 border-t border-border pt-4">
                <input v-model="form.selection.includeUnfiled" type="checkbox" class="mt-1 h-4 w-4 shrink-0 accent-accent" />
                <span class="grid gap-1 text-[0.85rem]">Uploads outside selected albums<span class="text-xs text-muted">Adds an “Unfiled uploads” folder. This also includes uploads in albums you unchecked.</span></span>
              </label>
              <p class="m-0 text-xs text-muted">New albums need to be selected here later. New subfolders inside a selected folder are included when you sync.</p>
            </div>
          </details>

          <details class="text-[0.8rem]" data-test="advanced-options">
            <summary class="cursor-pointer py-1 text-muted">Advanced options{{ exclusionText.trim() ? ' · Folder exclusions active' : '' }}</summary>
            <div class="grid min-w-0 gap-4 pt-4">
              <label class="grid gap-2">Source name<input v-model="form.name" required maxlength="100" class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent" /></label>
              <label class="grid gap-2">Sync interval in minutes<input v-model.number="form.selection.intervalMinutes" type="number" min="0" max="525600" class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent" /><span class="text-xs text-muted">0 for manual sync, or at least 5 minutes.</span></label>
              <label class="flex items-start gap-3"><input v-model="form.selection.allowOriginals" type="checkbox" class="mt-1 accent-accent" /><span>Allow original downloads<span class="block text-xs text-muted">Requires asset.download permission.</span></span></label>
              <label class="grid gap-2">
                {{ t('sources.immichImageQuality.label') }}
                <select v-model="form.selection.homeFeedImageQuality" data-test="home-feed-image-quality" class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent">
                  <option value="standard">{{ t('sources.immichImageQuality.standard') }}</option>
                  <option value="high">{{ t('sources.immichImageQuality.high') }}</option>
                </select>
                <span class="text-xs text-muted">{{ t('sources.immichImageQuality.description') }}</span>
              </label>
              <label class="grid gap-2">Exclude folder paths, one per line<textarea v-model="exclusionText" rows="3" placeholder="/photos/folder-to-skip" class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent" /><span class="text-xs text-muted">Includes subfolders. Applies to Folders; selected albums can still contain this media.</span></label>
              <details>
                <summary class="cursor-pointer text-muted">Add a folder or album manually</summary>
                <div class="grid gap-3 pt-3">
                  <label class="grid gap-1">Library ID<input v-model="manualLibrary" class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent" /></label>
                  <label class="grid gap-1">External folder path<input v-model="manualRoot" placeholder="/mnt/photos" class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent" /></label>
                  <button type="button" class="btn-ghost justify-self-start" :disabled="!manualLibrary.trim() || !manualRoot.trim()" @click="addManualRoot">Add folder</button>
                  <label class="grid gap-1">Album ID<input v-model="manualAlbum" class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-text focus:outline-accent" /></label>
                  <button type="button" class="btn-ghost justify-self-start" :disabled="!manualAlbum.trim()" @click="addManualAlbum">Add album</button>
                </div>
              </details>
              <details v-if="detection">
                <summary class="cursor-pointer text-muted">Connection details{{ detection.warnings.length ? ` · ${detection.warnings.length} notices` : '' }}</summary>
                <div class="grid gap-2 pt-3 text-muted">
                  <p class="m-0">Immich {{ detection.version }} · {{ detection.assetCount.toLocaleString() }} accessible photos and videos · {{ detection.uploadCount.toLocaleString() }} uploads</p>
                  <p v-for="warning in detection.warnings" :key="warning" class="m-0">{{ warning }}</p>
                </div>
              </details>
            </div>
          </details>
        </template>
      </fieldset>

      <div class="grid gap-3 border-t border-border pt-4">
        <p v-if="step === 'content' && !hasSelection && !busy" class="m-0 text-[0.8rem] text-muted" role="status">Choose at least one folder, album, or uploads outside selected albums to continue.</p>
        <div class="flex flex-wrap gap-2">
          <button v-if="!environmentManaged && step === 'connection'" type="submit" class="btn-primary min-w-28" :disabled="busy || !form.serverUrl || (requiresApiKey && !apiKey)">{{ busy ? 'Connecting…' : editingId ? 'Check connection' : 'Continue' }}<svg v-if="!busy" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></button>
          <button v-if="!environmentManaged && step === 'content'" type="submit" class="btn-primary" :disabled="busy || !hasSelection || needsConnectionCheck">{{ busy ? 'Please wait…' : editingId ? 'Save and sync' : 'Connect and sync' }}</button>
          <button type="button" class="btn-ghost" :disabled="busy" @click="closeForm">{{ environmentManaged ? 'Close' : 'Cancel' }}</button>
        </div>
        <p v-if="!environmentManaged" class="m-0 text-xs text-muted">Read-only connection. Your originals stay in Immich.</p>
      </div>
    </form>

    <details class="border-t border-border pt-4 text-[0.8rem] text-muted">
      <summary class="cursor-pointer">Using local folders too?</summary>
      <p class="mb-3 leading-relaxed">Foldergram can scan local folders as well as connect to Immich. If both include the same photos, they appear twice. To skip those local folders, use Settings → General Settings → Excluded source folders, save your rules, then run a scan in Scan &amp; Library.</p>
      <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-accent-strong" @click="emit('manage-local-exclusions')">Open folder exclusions</button>
    </details>
    <ConfirmDialog v-if="confirmAction" :title="confirmAction.source.kind === 'local' ? t('sources.local.changeTitle') : 'Update Immich source'" :message="confirmMessage" :confirm-label="confirmAction?.kind === 'remove' ? 'Remove source' : 'Continue'" @cancel="confirmAction=null" @confirm="confirmChange" />
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { requestJson } from '../api/http';
import ConfirmDialog from './ConfirmDialog.vue';
import { useSourcesStore } from '../stores/sources';
interface Selection {
    mode: 'folders' | 'albums' | 'both';
    initializedModes?: Array<'folders' | 'albums'>;
    roots: Array<{
        libraryId: string;
        path: string;
    }>;
    albumIds: string[];
    exclusions: string[];
    includeUnfiled: boolean;
    allowOriginals: boolean;
    homeFeedImageQuality: 'standard' | 'high';
    intervalMinutes: number;
}
interface SourceBase {
    id: number;
    name: string;
    enabled: number;
    managed_by: string;
    status: string;
    last_error: string | null;
    last_success: string | null;
    asset_count: number;
    folder_count: number;
    progress: number;
    syncing: boolean;
}
type ImmichSource = SourceBase & { kind?: 'immich'; server_url: string; selection: Selection };
type LocalSource = SourceBase & { kind: 'local'; rootPath: string; available: boolean; readOnlyOriginals: boolean };
type Source = ImmichSource | LocalSource;
interface Detection {
    version: string;
    assetCount: number;
    uploadCount: number;
    warnings: string[];
    suggestedMode: Selection['mode'];
    libraries: Array<{
        id: string;
        name: string;
        importPaths: string[];
    }>;
    roots: Array<{
        libraryId: string;
        path: string;
        count: number;
    }>;
    albums: Array<{
        id: string;
        albumName: string;
        shared?: boolean;
    }>;
}
const { t } = useI18n();
const localForm = ref<{ name: string; rootPath: string; readOnlyOriginals: boolean } | null>(null);
const localFormId = ref<number | null>(null);
const pathCheck = ref<{ ignoredRootMediaCount: number; partial: boolean } | null>(null);
const emit = defineEmits<{ 'manage-local-exclusions': [] }>();
const sources = ref<Source[]>([]), error = ref(''), notice = ref(''), busy = ref(false), formOpen = ref(false), apiKey = ref(''), editingId = ref<number | null>(null), environmentManaged = ref(false), detection = ref<Detection | null>(null);
const sourcesLoaded = ref(false), initialLoading = ref(true);
const initial = () => ({ name: 'Immich', serverUrl: '', enabled: true, selection: { mode: 'folders' as Selection['mode'], initializedModes: [], roots: [], albumIds: [], exclusions: [], includeUnfiled: false, allowOriginals: false, homeFeedImageQuality: 'standard', intervalMinutes: 0 } as Selection });
const form = ref(initial()), manualLibrary = ref(''), manualRoot = ref(''), manualAlbum = ref(''), exclusionText = ref('');
const step = ref<'connection' | 'content'>('connection'), selectionSearch = ref(''), selectionInitialized = ref(false);
const formHeading = ref<HTMLElement | null>(null);
const selectionOpen = ref(false);
const savedServerUrl = ref('');
const addressChanged = computed(() => {
    if (!editingId.value) return false;
    try {
        return new URL(form.value.serverUrl).toString().replace(/\/+$/, '') !== savedServerUrl.value;
    } catch {
        return form.value.serverUrl !== savedServerUrl.value;
    }
});
const requiresApiKey = computed(() => !editingId.value || addressChanged.value);
const needsConnectionCheck = computed(() => !detection.value && (requiresApiKey.value || Boolean(apiKey.value)));
function updateSelectionOpen(event: Event) {
    selectionOpen.value = (event.currentTarget as HTMLDetailsElement).open;
}
const knownRoots = ref<Selection['roots']>([]), knownAlbumIds = ref<string[]>([]);
const modes: Array<{ value: Selection['mode']; label: string; description: string }> = [
    { value: 'folders', label: 'Folders', description: 'Your external library folders' },
    { value: 'albums', label: 'Albums', description: 'Your Immich albums' },
    { value: 'both', label: 'Both', description: 'Folders and albums together' }
];
function isWithinFolder(path: string, root: string) { return path === root || path.startsWith(root === '/' ? '/' : `${root}/`); }
const discoveredFolders = computed(() => {
    const candidates = [
        ...(detection.value?.libraries.flatMap(library => library.importPaths.map(path => ({ libraryId: library.id, path, name: library.name }))) ?? []),
        ...(detection.value?.roots.map(root => ({ ...root, name: root.path })) ?? [])
    ];
    // Roots include descendants on the server. Present disjoint choices so an
    // unchecked folder cannot still be included through another default root.
    return candidates.filter((root, index) => !candidates.some((other, otherIndex) =>
        other.libraryId === root.libraryId && (other.path === root.path ? otherIndex < index : isWithinFolder(root.path, other.path))
    ));
});
const folderOptions = computed(() => [
    ...discoveredFolders.value,
    ...knownRoots.value.filter(root => !discoveredFolders.value.some(other => other.libraryId === root.libraryId && other.path === root.path)).map(root => ({ ...root, name: root.path }))
]);
const albumOptions = computed(() => [
    ...(detection.value?.albums ?? []),
    ...knownAlbumIds.value.filter(id => !detection.value?.albums.some(album => album.id === id)).map(id => ({ id, albumName: `Album · ${id}`, shared: false }))
]);
const filteredFolders = computed(() => folderOptions.value.filter(root => `${root.name} ${root.path}`.toLowerCase().includes(selectionSearch.value.trim().toLowerCase())));
const filteredAlbums = computed(() => albumOptions.value.filter(album => album.albumName.toLowerCase().includes(selectionSearch.value.trim().toLowerCase())));
const hasSelection = computed(() => (form.value.selection.mode !== 'albums' && form.value.selection.roots.length > 0) || (form.value.selection.mode !== 'folders' && form.value.selection.albumIds.length > 0) || form.value.selection.includeUnfiled);
const selectionSummary = computed(() => {
    const parts: string[] = [];
    const { mode, roots, albumIds, includeUnfiled } = form.value.selection;
    if (includeUnfiled && (mode === 'albums' || !roots.length) && (mode === 'folders' || !albumIds.length)) return 'Uploaded photos and videos selected';
    if (mode !== 'albums') parts.push(`${roots.length} ${roots.length === 1 ? 'folder' : 'folders'}`);
    if (mode !== 'folders') parts.push(`${albumIds.length} ${albumIds.length === 1 ? 'album' : 'albums'}`);
    if (includeUnfiled) parts.push('uploads outside selected albums');
    return `${parts.join(' · ')} selected`;
});
const confirmAction = ref<{
    kind: 'remove' | 'disable' | 'cache' | 'empty';
    source: Source;
} | null>(null), confirmMessage = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
function invalidate() { void useSourcesStore().refresh(); }
async function load() {
    const next = await requestJson<{
        items: Source[];
        bootstrapError?: string | null;
    }>('/api/admin/sources');
    sources.value = next.items;
    sourcesLoaded.value = true;
    if (next.bootstrapError)
        error.value = next.bootstrapError;
}
async function loadInitialSources() {
    initialLoading.value = true;
    error.value = '';
    try {
        await load();
    }
    catch (e) {
        error.value = e instanceof Error ? e.message : 'Could not load sources.';
    }
    finally {
        initialLoading.value = false;
    }
}
async function perform(action: () => Promise<void>) {
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        await action();
        await load();
    }
    catch (e) {
        error.value = e instanceof Error ? e.message : 'Source operation failed.';
    }
    finally {
        busy.value = false;
    }
}
function resetFormState() {
    apiKey.value = '';
    detection.value = null;
    error.value = '';
    notice.value = '';
    selectionSearch.value = '';
    manualLibrary.value = '';
    manualRoot.value = '';
    manualAlbum.value = '';
    knownRoots.value = [];
    knownAlbumIds.value = [];
    selectionInitialized.value = false;
    selectionOpen.value = false;
    savedServerUrl.value = '';
}
function newSource() {
    resetFormState();
    form.value = initial();
    editingId.value = null;
    environmentManaged.value = false;
    exclusionText.value = '';
    step.value = 'connection';
    formOpen.value = true;
}
function edit(source: ImmichSource, section: 'connection' | 'content' = 'content') {
    resetFormState();
    form.value = { name: source.name, serverUrl: source.server_url, enabled: Boolean(source.enabled), selection: JSON.parse(JSON.stringify(source.selection)) };
    form.value.selection.homeFeedImageQuality ??= 'standard';
    // Older sources have no initialization markers. Keep active selections and
    // infer that an empty, inactive category has not been configured yet.
    form.value.selection.initializedModes ??= [
        ...(source.selection.mode !== 'albums' || source.selection.roots.length ? ['folders' as const] : []),
        ...(source.selection.mode !== 'folders' || source.selection.albumIds.length ? ['albums' as const] : [])
    ];
    editingId.value = source.id;
    savedServerUrl.value = source.server_url;
    environmentManaged.value = source.managed_by === 'environment';
    knownRoots.value = [...source.selection.roots];
    knownAlbumIds.value = [...source.selection.albumIds];
    exclusionText.value = source.selection.exclusions.join('\n');
    step.value = section;
    formOpen.value = true;
    if (section === 'content') void detect();
}
function closeForm() { formOpen.value = false; apiKey.value = ''; error.value = ''; }
function connectionChanged(serverChanged: boolean) {
    detection.value = null;
    error.value = '';
    if (serverChanged && !editingId.value) {
        selectionInitialized.value = false;
        selectionOpen.value = false;
        form.value.selection = initial().selection;
        knownRoots.value = [];
        knownAlbumIds.value = [];
        selectionSearch.value = '';
    }
}
function selectAllFolders() { form.value.selection.roots = folderOptions.value.map(({ libraryId, path }) => ({ libraryId, path })); }
function initializeModeSelection(mode: Selection['mode']) {
    if (!detection.value || environmentManaged.value) return;
    const initialized = form.value.selection.initializedModes ??= [];
    if (mode !== 'albums' && !initialized.includes('folders')) {
        selectAllFolders();
        initialized.push('folders');
    }
    if (mode !== 'folders' && !initialized.includes('albums')) {
        form.value.selection.albumIds = albumOptions.value.map(album => album.id);
        initialized.push('albums');
    }
}
watch(() => form.value.selection.mode, initializeModeSelection);
function hasRoot(libraryId: string, path: string) { return form.value.selection.roots.some(r => r.libraryId === libraryId && r.path === path); }
function toggleRoot(libraryId: string, path: string) {
    if (hasRoot(libraryId, path))
        form.value.selection.roots = form.value.selection.roots.filter(r => r.libraryId !== libraryId || r.path !== path);
    else
        form.value.selection.roots.push({ libraryId, path });
}
function addManualRoot() {
    const root = { libraryId: manualLibrary.value.trim(), path: manualRoot.value.trim() };
    if (!root.libraryId || !root.path) return;
    if (!folderOptions.value.some(other => other.libraryId === root.libraryId && other.path === root.path))
        knownRoots.value.push(root);
    if (!hasRoot(root.libraryId, root.path))
        form.value.selection.roots.push(root);
    manualLibrary.value = '';
    manualRoot.value = '';
}
function addManualAlbum() {
    const id = manualAlbum.value.trim();
    if (!id) return;
    if (!albumOptions.value.some(album => album.id === id))
        knownAlbumIds.value.push(id);
    if (!form.value.selection.albumIds.includes(id))
        form.value.selection.albumIds.push(id);
    manualAlbum.value = '';
}
async function detect() {
    if (busy.value || !form.value.serverUrl || (requiresApiKey.value && !apiKey.value)) return;
    await perform(async () => {
        detection.value = await requestJson<Detection>('/api/admin/sources/immich/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverUrl: form.value.serverUrl, apiKey: apiKey.value || undefined, sourceId: editingId.value || undefined }) });
        if (!editingId.value && !selectionInitialized.value) {
            form.value.selection.mode = detection.value.suggestedMode;
            selectAllFolders();
            form.value.selection.albumIds = detection.value.albums.map(album => album.id);
            form.value.selection.initializedModes = ['folders', 'albums'];
            form.value.selection.includeUnfiled = !folderOptions.value.length && !detection.value.albums.length && detection.value.uploadCount > 0;
            selectionInitialized.value = true;
            selectionOpen.value = true;
        }
        if (addressChanged.value) selectionOpen.value = true;
        initializeModeSelection(form.value.selection.mode);
        step.value = 'content';
        await nextTick();
        formHeading.value?.focus();
    });
}
async function save() {
    if (busy.value || environmentManaged.value || !hasSelection.value || needsConnectionCheck.value) return;
    await perform(async () => {
        form.value.selection.exclusions = exclusionText.value.split('\n').map(v => v.trim()).filter(Boolean);
        const source = await requestJson<Source>(editingId.value ? `/api/admin/sources/${editingId.value}` : '/api/admin/sources', { method: editingId.value ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'immich', ...form.value, apiKey: apiKey.value || undefined }) });
        apiKey.value = '';
        if (editingId.value && source.enabled)
            await requestJson(`/api/admin/sources/${source.id}/sync`, { method: 'POST' });
        formOpen.value = false;
        notice.value = 'Source saved. Synchronization is running in the background.';
        invalidate();
    });
}
function localStatus(source: LocalSource): string {
    if (!source.enabled) return t('sources.local.disabled');
    if (source.syncing) return t('sources.local.syncing');
    if (source.status === 'empty_review') return t('sources.local.review');
    if (!source.available) return t('sources.local.unavailable');
    if (source.status === 'ready') return t('sources.local.ready');
    if (source.status === 'error') return t('sources.local.error');
    return t('sources.local.pending');
}
function openLocal(source?: LocalSource) {
    resetFormState();
    pathCheck.value = null;
    localFormId.value = source?.id ?? null;
    localForm.value = { name: source?.name ?? '', rootPath: source?.rootPath ?? '', readOnlyOriginals: source?.readOnlyOriginals ?? true };
    void nextTick(() => formHeading.value?.focus());
}
async function validatePath() {
    if (!localForm.value || busy.value) return;
    pathCheck.value = null;
    await perform(async () => {
        pathCheck.value = await requestJson('/api/admin/sources/local/test', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rootPath: localForm.value?.rootPath })
        });
    });
}
async function saveLocal() {
    if (!localForm.value || busy.value) return;
    const input = { kind: 'local', ...localForm.value };
    const id = localFormId.value;
    await perform(async () => {
        await requestJson(id === null ? '/api/admin/sources' : `/api/admin/sources/${id}`, {
            method: id === null ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
        });
        localForm.value = null;
        notice.value = t(id === null ? 'sources.local.queued' : 'sources.local.saved');
        invalidate();
    });
}
async function sync(source: Source) {
    await perform(async () => {
        await requestJson(`/api/admin/sources/${source.id}/sync`, { method: 'POST' });
        notice.value = source.kind === 'local' ? t('sources.local.queued') : 'Synchronization started.';
        invalidate();
    });
}
function reviewEmpty(source: LocalSource) {
    confirmAction.value = { kind: 'empty', source };
    confirmMessage.value = t('sources.local.emptyMessage');
}
function toggle(source: Source) {
    if (source.enabled) {
        confirmAction.value = { kind: 'disable', source };
        confirmMessage.value = source.kind === 'local' ? t('sources.local.disableMessage') : 'Disable this source? Its content and shares become unavailable immediately. The Foldergram index, likes, saved items and cache are retained. Enable and sync to restore it.';
    }
    else
        void perform(async () => { await updateEnabled(source, true); });
}
async function updateEnabled(source: Source, enabled: boolean) {
    await requestJson(`/api/admin/sources/${source.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source.kind === 'local' ? { kind: 'local', enabled } : { kind: 'immich', name: source.name, serverUrl: source.server_url, selection: source.selection, enabled }) });
    if (enabled)
        await requestJson(`/api/admin/sources/${source.id}/sync`, { method: 'POST' });
    invalidate();
}
function remove(source: Source) { confirmAction.value = { kind: 'remove', source }; confirmMessage.value = source.kind === 'local' ? t('sources.local.removeMessage') : 'Remove this source and its Foldergram index, likes, saved memberships, shares and cache? Immich media will remain unchanged.'; }
function clearCache(source: Source) { confirmAction.value = { kind: 'cache', source }; confirmMessage.value = 'Clear cached Immich derivatives? They will be fetched lazily again. Uncached media requires Immich to be online.'; }
async function confirmChange() {
    const action = confirmAction.value;
    if (!action)
        return;
    confirmAction.value = null;
    await perform(async () => {
        if (action.kind === 'disable')
            await updateEnabled(action.source, false);
        else if (action.kind === 'empty')
            await requestJson(`/api/admin/sources/${action.source.id}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmEmpty: true }) });
        else
            await requestJson(`/api/admin/sources/${action.source.id}${action.kind === 'cache' ? '/cache' : ''}`, { method: 'DELETE' });
        invalidate();
    });
}
onMounted(() => {
    void loadInitialSources();
    timer = setInterval(() => {
        if (sourcesLoaded.value) void load().catch(e => error.value = e.message);
    }, 2000);
});
onBeforeUnmount(() => {
    if (timer)
        clearInterval(timer);
    apiKey.value = '';
});
</script>
