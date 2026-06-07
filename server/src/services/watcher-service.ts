import chokidar, { type FSWatcher } from 'chokidar';

import { appConfig } from '../config/env.js';
import { getEffectiveExcludedFolderRules, matchesExcludedFolder, parseExcludedFolderRulesFromSetting } from '../utils/excluded-folder-rules.js';
import { EXCLUDED_FOLDERS_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository } from '../db/repositories.js';
import { scannerService } from './scanner-service.js';
import { log } from './log-service.js';
import { storageService } from './storage-service.js';
import { getRelativeGalleryPath, getSourceFolderPathFromRelativePath, isHiddenPath, matchesRelativeRoot } from '../utils/path-utils.js';

class WatcherService {
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private fullRescanRequested = false;

  private async getEffectiveExcludedFolderRules(): Promise<string[]> {
    return getEffectiveExcludedFolderRules({
      envRules: appConfig.galleryExcludedFolders,
      customRules: parseExcludedFolderRulesFromSetting(await appSettingsRepository.get(EXCLUDED_FOLDERS_SETTING_KEY))
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
      ignoreInitial: true
    });

    this.watcher.on('all', async (eventName: string, absolutePath: string) => {
      const relativePath = getRelativeGalleryPath(appConfig.galleryRoot, absolutePath);
      if (!relativePath || isHiddenPath(relativePath)) {
        return;
      }

      if (matchesRelativeRoot(relativePath, appConfig.managedGalleryRelativeIgnores)) {
        return;
      }

      const excludedFolderRules = await this.getEffectiveExcludedFolderRules();
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
    });

    log.info('Gallery watcher started');
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      log.info('Gallery watcher stopped');
    }
  }
}

export const watcherService = new WatcherService();
