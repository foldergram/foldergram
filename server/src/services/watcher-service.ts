import path from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import { appConfig } from '../config/env.js';
import { getEffectiveExcludedFolderRules, matchesExcludedFolder, parseExcludedFolderRulesFromSetting } from '../utils/excluded-folder-rules.js';
import { EXCLUDED_FOLDERS_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository } from '../db/repositories.js';
import { scannerService } from './scanner-service.js';
import { log } from './log-service.js';
import { storageService } from './storage-service.js';
import { getRelativeGalleryPath, getSourceFolderPathFromRelativePath, isHiddenPath, matchesRelativeRoot } from '../utils/path-utils.js';

const INTERNAL_DELETE_SUPPRESSION_MS = 15_000;

class WatcherService {
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private pendingDirectoryPaths = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private fullRescanRequested = false;
  private scanInFlight = false;
  private watcherReady = false;
  private internalDeletionSuppressions = new Map<string, number>();

  /**
   * Permanent deletion moves gallery files through its private quarantine before the
   * database commit. Those unlink events are internal bookkeeping, not new library
   * changes, so re-indexing them would wake a scan immediately after a delete.
   */
  suppressInternalDeletions(relativePaths: readonly string[]): void {
    const expiresAt = Date.now() + INTERNAL_DELETE_SUPPRESSION_MS;

    for (const relativePath of relativePaths) {
      let currentPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
      while (currentPath && currentPath !== '.') {
        this.internalDeletionSuppressions.set(currentPath, expiresAt);
        const parentPath = path.posix.dirname(currentPath);
        if (parentPath === currentPath) break;
        currentPath = parentPath;
      }
    }
  }

  private shouldIgnoreInternalDeletion(eventName: string, relativePath: string): boolean {
    if (eventName !== 'unlink' && eventName !== 'unlinkDir') {
      return false;
    }

    const now = Date.now();
    for (const [pathKey, expiresAt] of this.internalDeletionSuppressions) {
      if (expiresAt <= now) this.internalDeletionSuppressions.delete(pathKey);
    }

    return (this.internalDeletionSuppressions.get(relativePath) ?? 0) > now;
  }

  private getEffectiveExcludedFolderRules(): string[] {
    return getEffectiveExcludedFolderRules({
      envRules: appConfig.galleryExcludedFolders,
      customRules: parseExcludedFolderRulesFromSetting(appSettingsRepository.get(EXCLUDED_FOLDERS_SETTING_KEY))
    });
  }

  async start(): Promise<void> {
    // Production needs the same live gallery updates as development. Tests do not
    // start a filesystem watcher because their temporary roots are short-lived.
    if (this.watcher || appConfig.nodeEnv === 'test') {
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
      ignoreInitial: true,
      // NAS copies can expose a large video before the transfer is complete. Wait
      // until its size is stable so derivatives are generated from the full file.
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 100
      }
    });

    // NAS mounts can emit add/addDir events while chokidar is taking its initial
    // snapshot. Those events describe the existing library, not new media.
    this.watcherReady = false;
    this.watcher.once('ready', () => {
      this.watcherReady = true;
      log.info('Gallery watcher ready');
    });

    this.watcher.on('all', async (eventName: string, absolutePath: string) => {
      if (!this.watcherReady) {
        return;
      }

      const relativePath = getRelativeGalleryPath(appConfig.galleryRoot, absolutePath);
      if (!relativePath || isHiddenPath(relativePath)) {
        return;
      }

      if (this.shouldIgnoreInternalDeletion(eventName, relativePath)) {
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
        // A new or removed directory only affects that subtree. Scan it
        // incrementally instead of re-walking the whole library, which would
        // re-queue derivatives for every indexed file.
        this.pendingDirectoryPaths.add(relativePath);
      } else {
        this.pendingPaths.add(relativePath);
      }

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.processPendingScans();
      }, 700);
    });

    log.info('Gallery watcher started');
  }

  private schedulePendingScan(delayMs = 250): void {
    if (this.debounceTimer) {
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.processPendingScans();
    }, delayMs);
  }

  private async processPendingScans(): Promise<void> {
    // Coalesce filesystem events while derivatives are being generated instead of
    // queueing repeated scans of the same folder behind one another.
    if (this.scanInFlight) {
      return;
    }

    const queued = [...this.pendingPaths];
    this.pendingPaths.clear();
    const queuedDirectories = [...this.pendingDirectoryPaths];
    this.pendingDirectoryPaths.clear();
    const fullRescan = this.fullRescanRequested;
    this.fullRescanRequested = false;

    if (!fullRescan && queued.length === 0 && queuedDirectories.length === 0) {
      return;
    }

    this.scanInFlight = true;
    try {
      if (fullRescan) {
        // Watcher-triggered full scans only need to index new or changed media.
        // Re-verifying derivatives for every unchanged file defeats the folder
        // signature shortcut and can take many minutes on a NAS library.
        await scannerService.scanAll('watcher', {
          allowDerivativeMigration: false,
          repairUnchangedDerivatives: false
        });
      } else {
        await scannerService.scanChangedPaths([...queued, ...queuedDirectories], 'watcher');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Gallery watcher scan failed', message);
    } finally {
      this.scanInFlight = false;
      if (this.fullRescanRequested || this.pendingPaths.size > 0 || this.pendingDirectoryPaths.size > 0) {
        this.schedulePendingScan();
      }
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingPaths.clear();
    this.pendingDirectoryPaths.clear();
    this.fullRescanRequested = false;
    this.internalDeletionSuppressions.clear();
    this.watcherReady = false;

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      log.info('Gallery watcher stopped');
    }
  }
}

export const watcherService = new WatcherService();
