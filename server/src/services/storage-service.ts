import fs from 'node:fs';

import { appConfig } from '../config/env.js';
import { log } from './log-service.js';

interface StorageState {
  libraryAvailable: boolean;
  reason: string | null;
  usingInMemoryDatabase: boolean;
  databasePath: string;
}

interface DirectoryStatus {
  available: boolean;
  reason: string | null;
}

function formatDirectoryError(label: string, directoryPath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${label} unavailable at ${directoryPath}: ${message}`;
}

class StorageService {
  private prepared = false;
  private state: StorageState = {
    libraryAvailable: true,
    reason: null,
    usingInMemoryDatabase: false,
    databasePath: appConfig.databasePath
  };

  prepareStartup(): StorageState {
    if (this.prepared) {
      return this.state;
    }

    const databaseDirectory = this.ensureDirectory(appConfig.dbDir, 'Database directory');
    const libraryAvailability = this.checkLibraryAvailability();

    this.state = {
      libraryAvailable: libraryAvailability.available,
      reason: libraryAvailability.reason,
      usingInMemoryDatabase: !databaseDirectory.available,
      databasePath: databaseDirectory.available ? appConfig.databasePath : ':memory:'
    };
    this.prepared = true;

    if (!databaseDirectory.available) {
      log.info('Configured database directory is unavailable; using in-memory SQLite', {
        reason: databaseDirectory.reason
      });
    }

    if (!libraryAvailability.available) {
      log.info('Configured library storage is unavailable', {
        reason: libraryAvailability.reason
      });
    }

    return this.state;
  }

  refreshAvailability(): StorageState {
    const current = this.prepareStartup();
    const libraryAvailability = this.checkLibraryAvailability();

    this.state = {
      ...current,
      libraryAvailable: libraryAvailability.available,
      reason: libraryAvailability.reason
    };

    return this.state;
  }

  getState(): StorageState {
    return this.refreshAvailability();
  }

  getDatabasePath(): string {
    return this.prepareStartup().databasePath;
  }

  private checkLibraryAvailability(): DirectoryStatus {
    const issues = [
      this.ensureDirectory(appConfig.galleryRoot, 'Gallery directory'),
      this.ensureDirectory(appConfig.thumbnailsDir, 'Thumbnails directory'),
      this.ensureDirectory(appConfig.previewsDir, 'Previews directory'),
      this.ensureDirectory(appConfig.hlsCacheDir, 'HLS cache directory')
    ]
      .filter((entry) => !entry.available)
      .map((entry) => entry.reason)
      .filter((entry): entry is string => Boolean(entry));

    return {
      available: issues.length === 0,
      reason: issues.length > 0 ? issues.join(' | ') : null
    };
  }

  private ensureDirectory(directoryPath: string, label: string): DirectoryStatus {
    try {
      fs.mkdirSync(directoryPath, { recursive: true });

      if (!fs.statSync(directoryPath).isDirectory()) {
        return {
          available: false,
          reason: `${label} path is not a directory: ${directoryPath}`
        };
      }

      return {
        available: true,
        reason: null
      };
    } catch (error) {
      return {
        available: false,
        reason: formatDirectoryError(label, directoryPath, error)
      };
    }
  }
}

export const storageService = new StorageService();
