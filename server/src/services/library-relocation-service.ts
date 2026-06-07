import fs from 'node:fs';
import path from 'node:path';

import { appConfig } from '../config/env.js';
import { LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository, folderRepository, imageRepository } from '../db/repositories.js';
import type { ImageRecord } from '../types/models.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import { normalizePath } from '../utils/path-utils.js';

export type LibraryRelocationValidationResult =
  | { status: 'not_needed' }
  | { status: 'validated'; checked: number; missing: number; refreshed: number }
  | { status: 'failed'; checked: number; missing: number; reason: string };

async function getStoredGalleryRoot(): Promise<string | null> {
  const storedGalleryRoot = await appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
  return storedGalleryRoot ? normalizePath(storedGalleryRoot) : null;
}

function validateSourceFile(row: ImageRecord): { ok: true } | { ok: false; missing: boolean; reason: string } {
  let sourcePath: string;

  try {
    sourcePath = resolveOriginalPath(row.relative_path);
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
  async validateCurrentGalleryRoot(): Promise<LibraryRelocationValidationResult> {
    const currentGalleryRoot = normalizePath(appConfig.galleryRoot);
    const storedGalleryRoot = await getStoredGalleryRoot();

    if (!storedGalleryRoot || storedGalleryRoot === currentGalleryRoot || (await folderRepository.getAll()).length === 0) {
      return { status: 'not_needed' };
    }

    let checked = 0;
    let missing = 0;

    for (const row of await imageRepository.listActive()) {
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
      refreshed: await imageRepository.refreshAbsolutePathsForGalleryRoot(appConfig.galleryRoot)
    };
  }
}

export const libraryRelocationService = new LibraryRelocationService();
