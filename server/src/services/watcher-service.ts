import chokidar, { type FSWatcher } from 'chokidar';

import { appConfig } from '../config/env.js';
import { getEffectiveExcludedFolderRules, matchesExcludedFolder, parseExcludedFolderRulesFromSetting } from '../utils/excluded-folder-rules.js';
import { EXCLUDED_FOLDERS_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository } from '../db/repositories.js';
import { scannerService } from './scanner-service.js';
import { log } from './log-service.js';
import { storageService } from './storage-service.js';
import { getRelativeGalleryPath, getSourceFolderPathFromRelativePath, isHiddenPath, matchesRelativeRoot } from '../utils/path-utils.js';
import { isExclusionMarkerFilename, readExclusionMarkerState } from '../utils/exclusion-marker.js';

class WatcherService {
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private fullRescanRequested = false;
  private watcherReady = false;
  private markerStates = new Map<string, boolean>();
  private markerChecks: Promise<void> = Promise.resolve();

  private getEffectiveExcludedFolderRules(): string[] {
    return getEffectiveExcludedFolderRules({
      envRules: appConfig.galleryExcludedFolders,
      customRules: parseExcludedFolderRulesFromSetting(appSettingsRepository.get(EXCLUDED_FOLDERS_SETTING_KEY))
    });
  }

  async start(): Promise<void> {
    if (this.watcher || !appConfig.isDevelopment) {
      return;
    }

    const storageState = storageService.refreshAvailability();
    if (!storageState.libraryAvailable) {
      log.info('Gallery watcher not started because configured storage is unavailable', {
        reason: storageState.reason
      });
      return;
    }

    this.watcher = chokidar.watch(appConfig.galleryRoot, {
      ignoreInitial: false
    });

    this.watcher.on('all', async (eventName: string, absolutePath: string) => {
      const relativePath = getRelativeGalleryPath(appConfig.galleryRoot, absolutePath);
      if (isExclusionMarkerFilename(relativePath.split('/').at(-1) ?? '')) {
        if (eventName !== 'add' && eventName !== 'unlink' && eventName !== 'change') return;

        const containingFolder = getSourceFolderPathFromRelativePath(relativePath);
        if (
          !containingFolder ||
          isHiddenPath(containingFolder) ||
          matchesRelativeRoot(containingFolder, appConfig.managedGalleryRelativeIgnores) ||
          matchesExcludedFolder(containingFolder, this.getEffectiveExcludedFolderRules())
        ) {
          return;
        }

        const initial = !this.watcherReady;
        this.markerChecks = this.markerChecks.then(async () => {
          const current = await readExclusionMarkerState(appConfig.galleryRoot, containingFolder) === true;
          const previous = this.markerStates.get(relativePath) ?? false;
          this.markerStates.set(relativePath, current);

          if (initial || (eventName === 'change' && previous === current)) return;
          this.fullRescanRequested = true;
          this.scheduleScan();
        }).catch((error: unknown) => {
          log.error('Unable to inspect gallery exclusion marker', error instanceof Error ? error.message : String(error));
          this.fullRescanRequested = true;
          this.scheduleScan();
        });
        return this.markerChecks;
      }

      if (!this.watcherReady) return;

      if (!relativePath || isHiddenPath(relativePath)) {
        return;
      }

      if (matchesRelativeRoot(relativePath, appConfig.managedGalleryRelativeIgnores)) {
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
        this.fullRescanRequested = true;
      } else {
        this.pendingPaths.add(relativePath);
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
    if (!this.watcher) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const queued = [...this.pendingPaths];
      this.pendingPaths.clear();
      this.debounceTimer = null;

      if (this.fullRescanRequested) {
        this.fullRescanRequested = false;
        await scannerService.scanAll('watcher', {
          allowDerivativeMigration: false
        });
        return;
      }

      if (queued.length > 0) {
        await scannerService.scanChangedPaths(queued, 'watcher');
      }
    }, 700);
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
    this.fullRescanRequested = false;
  }
}

export const watcherService = new WatcherService();
