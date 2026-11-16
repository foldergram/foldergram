import fs from 'node:fs';
import path from 'node:path';

import { imageRepository } from '../../db/repositories.js';
import { checkLocalSourceDirectory, getLocalSource, resolveLocalPath, type LocalSource } from '../../sources/local-source.js';
import type { ImageRecord } from '../../types/models.js';
import { createFingerprint } from '../../utils/image-utils.js';
import type { HeicSource } from './service.js';

export function heicScanSource(
  source: LocalSource,
  root: string,
  relativePath: string,
  sourcePath: string,
  fingerprint: string
): HeicSource {
  return {
    key: JSON.stringify([source.id, source.generation, relativePath, fingerprint]),
    isCurrent: () => {
      const current = getLocalSource(source.id);
      if (!current?.enabled || current.generation !== source.generation) return false;
      try {
        if (checkLocalSourceDirectory(current) !== root) return false;
        const resolved = resolveLocalPath(current, relativePath, { scanRoot: root });
        const stat = fs.lstatSync(resolved);
        return resolved === sourcePath && stat.isFile()
          && createFingerprint(relativePath, stat.size, stat.mtimeMs) === fingerprint;
      } catch {
        return false;
      }
    }
  };
}

export function indexedHeicSource(
  row: ImageRecord,
  sourcePath: string,
  { scanRoot, allowTrashed = false }: { scanRoot?: string; allowTrashed?: boolean } = {}
): HeicSource {
  const source = getLocalSource(row.source_id);
  const fingerprint = row.checksum_or_fingerprint;
  const assetKey = row.asset_key;
  const id = row.id;
  return {
    key: JSON.stringify([row.source_id, source?.generation, id, assetKey, fingerprint, scanRoot, allowTrashed]),
    isCurrent: () => {
      const current = getLocalSource(row.source_id);
      const indexed = imageRepository.getById(id);
      if (!source || !current?.enabled || current.generation !== source.generation ||
          !indexed || indexed.is_deleted || (indexed.is_trashed && !allowTrashed) || indexed.source_id !== row.source_id ||
          indexed.relative_path !== row.relative_path || indexed.asset_key !== assetKey ||
          indexed.thumbnail_path !== row.thumbnail_path || indexed.preview_path !== row.preview_path ||
          indexed.checksum_or_fingerprint !== fingerprint) {
        return false;
      }
      try {
        if (scanRoot && checkLocalSourceDirectory(current) !== scanRoot) return false;
        const resolved = resolveLocalPath(current, row.relative_path, { scanRoot });
        const stat = fs.lstatSync(resolved);
        return path.normalize(resolved) === path.normalize(sourcePath) && stat.isFile()
          && createFingerprint(row.relative_path, stat.size, stat.mtimeMs) === fingerprint;
      } catch {
        return false;
      }
    }
  };
}
