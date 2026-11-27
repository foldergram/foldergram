import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import { appConfig } from '../config/env.js';
import { checkLocalSourceDirectory, listLocalSources } from '../sources/local-source.js';
import { getEffectiveExcludedFolderRules, matchesExcludedFolder, parseExcludedFolderRulesFromSetting } from '../utils/excluded-folder-rules.js';
import { EXCLUDED_FOLDERS_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository } from '../db/repositories.js';
import { scannerService } from './scanner-service.js';
import { log } from './log-service.js';
import { storageService } from './storage-service.js';
import { ensureWithinRoot, getRelativeGalleryPath, getSourceFolderPathFromRelativePath, isHiddenPath, matchesRelativeRoot } from '../utils/path-utils.js';
import { isExclusionMarkerFilename, readExclusionMarkerState } from '../utils/exclusion-marker.js';

const MAX_PENDING_PATHS_PER_SOURCE = 512;

class WatcherService {
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Map<number, Set<string>>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private fullRescanRequested = new Set<number>();
  private watcherReady = false;
  private batchRunning = false;
  private markerStates = new Map<string, boolean>();
  private markerChecks: Promise<void> = Promise.resolve();

  private getEffectiveExcludedFolderRules(): string[] {
    return getEffectiveExcludedFolderRules({
      envRules: appConfig.galleryExcludedFolders,
      customRules: parseExcludedFolderRulesFromSetting(appSettingsRepository.get(EXCLUDED_FOLDERS_SETTING_KEY))
    });
  }

  async start(): Promise<void> {
    if (this.watcher || !appConfig.isDevelopment || !appConfig.galleryWatchEnabled) {
      return;
    }

    const storageState = storageService.refreshAvailability();
    if (!storageState.libraryAvailable) {
      log.info('Gallery watcher not started because configured storage is unavailable', {
        reason: storageState.reason
      });
      return;
    }

    const sources = listLocalSources().flatMap(source => {
      if (!source.enabled) return [];
      if (source.managed_by === 'environment' && scannerService.isLibraryRebuildRequired(source.id)) return [];
      try {
        return [{ source, root: checkLocalSourceDirectory(source) }];
      } catch {
        return [];
      }
    });
    if (sources.length === 0) return;

    this.watcher = chokidar.watch(sources.map(({ root }) => root), {
      ignoreInitial: false,
      followSymlinks: true
    });

    this.watcher.on('all', async (eventName: string, absolutePath: string) => {
      const location = sources.find(({ root }) => ensureWithinRoot(root, path.resolve(absolutePath)));
      if (!location) return;
      const { source, root } = location;
      const ignores = source.managed_by === 'environment' ? appConfig.managedGalleryRelativeIgnores : [];
      const relativePath = getRelativeGalleryPath(root, absolutePath);
      const eventKey = `${source.id}:${relativePath}`;
      if (isExclusionMarkerFilename(relativePath.split('/').at(-1) ?? '')) {
        if (eventName !== 'add' && eventName !== 'unlink' && eventName !== 'change') return;

        const containingFolder = getSourceFolderPathFromRelativePath(relativePath);
        if (
          !containingFolder ||
          isHiddenPath(containingFolder) ||
          matchesRelativeRoot(containingFolder, ignores) ||
          matchesExcludedFolder(containingFolder, this.getEffectiveExcludedFolderRules())
        ) {
          return;
        }

        const initial = !this.watcherReady;
        this.markerChecks = this.markerChecks.then(async () => {
          const current = await readExclusionMarkerState(root, containingFolder) === true;
          const previous = this.markerStates.get(eventKey) ?? false;
          this.markerStates.set(eventKey, current);

          if (initial || (eventName === 'change' && previous === current)) return;
          this.fullRescanRequested.add(source.id);
          this.scheduleScan();
        }).catch((error: unknown) => {
          log.error('Unable to inspect gallery exclusion marker', error instanceof Error ? error.message : String(error));
          this.fullRescanRequested.add(source.id);
          this.scheduleScan();
        });
        return this.markerChecks;
      }

      if (!this.watcherReady) return;

      if (!relativePath || isHiddenPath(relativePath)) {
        return;
      }

      if (matchesRelativeRoot(relativePath, ignores)) {
        return;
      }

      const excludedFolderRules = this.getEffectiveExcludedFolderRules();
      const exclusionTargetPath =
        eventName === 'addDir' || eventName === 'unlinkDir'
          ? relativePath
          : (getSourceFolderPathFromRelativePath(relativePath) ?? relativePath);
      if (matchesExcludedFolder(exclusionTargetPath, excludedFolderRules)) {
        return;
      }

      if (eventName === 'addDir' || eventName === 'unlinkDir') {
        this.fullRescanRequested.add(source.id);
      } else if (!this.fullRescanRequested.has(source.id)) {
        const paths = this.pendingPaths.get(source.id) ?? new Set<string>();
        paths.add(relativePath);
        if (paths.size > MAX_PENDING_PATHS_PER_SOURCE) {
          this.pendingPaths.delete(source.id);
          this.fullRescanRequested.add(source.id);
        } else {
          this.pendingPaths.set(source.id, paths);
        }
      }

      this.scheduleScan();
    });

    // Initial add events establish marker types without requesting a scan.
    // Chokidar may later collapse unlink/add replacements into a change event.
    await new Promise<void>((resolve, reject) => {
      this.watcher!.on('ready', () => {
        this.watcherReady = true;
        void this.markerChecks.then(resolve);
      });
      this.watcher!.on('error', (error: unknown) => {
        log.error('Gallery watcher failed', error instanceof Error ? error.message : String(error));
        reject(error);
      });
    });

    log.info('Gallery watcher started');
  }

  private scheduleScan(): void {
    if (!this.watcher || this.batchRunning) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const watcher = this.watcher;
      this.batchRunning = true;
      const queued = new Map(this.pendingPaths);
      const full = new Set(this.fullRescanRequested);
      this.pendingPaths.clear();
      this.fullRescanRequested.clear();
      this.debounceTimer = null;

      try {
        for (const id of full) {
          if (this.watcher !== watcher) return;
          const sources = listLocalSources().filter(source => source.enabled);
          if (sources.length === 1 && sources[0].managed_by === 'environment') {
            await scannerService.scanAll('watcher', { allowDerivativeMigration: false });
          } else {
            await scannerService.scanSource(id, 'watcher', { allowDerivativeMigration: false });
          }
        }
        for (const [id, paths] of queued) {
          if (this.watcher !== watcher) return;
          if (!full.has(id)) {
            const primary = listLocalSources().find(source => source.managed_by === 'environment');
            if (id === primary?.id) await scannerService.scanChangedPaths([...paths], 'watcher');
            else await scannerService.scanChangedPaths([...paths], 'watcher', id);
          }
        }
      } catch (error) {
        log.error('Gallery watcher scan failed', error instanceof Error ? error.message : String(error));
      } finally {
        this.batchRunning = false;
        if (this.pendingPaths.size || this.fullRescanRequested.size) this.scheduleScan();
      }
    }, 700);
  }

  async refresh(): Promise<void> {
    if (!this.watcher) return;
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.watcherReady = false;
    const watcher = this.watcher;
    this.watcher = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (watcher) {
      await watcher.close();
      log.info('Gallery watcher stopped');
    }
    await this.markerChecks;
    this.markerStates.clear();
    this.pendingPaths.clear();
    this.fullRescanRequested.clear();
  }
}

export const watcherService = new WatcherService();
