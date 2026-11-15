import fs from 'node:fs';
import path from 'node:path';

import { appConfig } from '../config/env.js';
import { LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository, folderRepository, imageRepository } from '../db/repositories.js';
import type { ImageRecord } from '../types/models.js';
import { primaryLocalSource, resolveLocalPath, validateLocalPath } from '../sources/local-source.js';
import { normalizePath } from '../utils/path-utils.js';

export type LibraryRelocationValidationResult =
  | { status: 'not_needed' }
  | { status: 'validated'; checked: number; missing: number; refreshed: number }
  | { status: 'failed'; checked: number; missing: number; reason: string };

function getStoredGalleryRoot(): string | null {
  const storedGalleryRoot = appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
  return storedGalleryRoot ? normalizePath(storedGalleryRoot) : null;
}

function validateSourceFile(row: ImageRecord): { ok: true } | { ok: false; missing: boolean; reason: string } {
  let sourcePath: string;

  try {
    sourcePath = resolveLocalPath(primaryLocalSource(), row.relative_path, { rootPath: appConfig.galleryRoot });
  } catch {
    return {
      ok: false,
      missing: true,
      reason: `Indexed relative path escapes the gallery root: ${row.relative_path}`
    };
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(sourcePath);
  } catch {
    return {
      ok: false,
      missing: true,
      reason: `Indexed source file is missing: ${row.relative_path}`
    };
  }

  if (!stats.isFile()) {
    return {
      ok: false,
      missing: true,
      reason: `Indexed source path is not a file: ${row.relative_path}`
    };
  }

  if (stats.size !== row.file_size) {
    return {
      ok: false,
      missing: false,
      reason: `Indexed source file size changed: ${row.relative_path}`
    };
  }

  if (Math.round(stats.mtimeMs) !== Math.round(row.mtime_ms)) {
    return {
      ok: false,
      missing: false,
      reason: `Indexed source file mtime changed: ${row.relative_path}`
    };
  }

  if (path.extname(row.relative_path).toLowerCase() !== row.extension.toLowerCase()) {
    return {
      ok: false,
      missing: false,
      reason: `Indexed source file extension changed: ${row.relative_path}`
    };
  }

  return { ok: true };
}

class LibraryRelocationService {
  validateCurrentGalleryRoot(): LibraryRelocationValidationResult {
    const currentGalleryRoot = normalizePath(appConfig.galleryRoot);
    const storedGalleryRoot = getStoredGalleryRoot();

    if (!storedGalleryRoot || storedGalleryRoot === currentGalleryRoot || folderRepository.getAll().length === 0) {
      return { status: 'not_needed' };
    }

    const primary = primaryLocalSource();
    try {
      validateLocalPath(appConfig.galleryRoot, primary.id, true);
    } catch (error) {
      return { status: 'failed', checked: 0, missing: 0, reason: error instanceof Error ? error.message : 'Gallery unavailable.' };
    }
    let checked = 0;
    let missing = 0;

    for (const row of imageRepository.listActive(primary.id)) {
      checked += 1;
      const validation = validateSourceFile(row);

      if (!validation.ok) {
        if (validation.missing) {
          missing += 1;
        }

        return {
          status: 'failed',
          checked,
          missing,
          reason: validation.reason
        };
      }
    }

    return {
      status: 'validated',
      checked,
      missing,
      refreshed: imageRepository.refreshAbsolutePathsForGalleryRoot(appConfig.galleryRoot)
    };
  }
}

export const libraryRelocationService = new LibraryRelocationService();
