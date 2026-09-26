import fs from 'node:fs/promises';
import path from 'node:path';

import { appConfig } from '../config/env.js';
import { log } from './log-service.js';

/**
 * Thumbnails and previews are regenerable: `routes/lazy-derivatives.ts` rebuilds any
 * missing file on request, so the derivative directories can be treated as an
 * evictable cache on a small SSD volume. Cleanup deletes expired files first, then
 * evicts the oldest (least-recently generated) files until the combined size of
 * THUMBNAILS_DIR + PREVIEWS_DIR fits the configured cap.
 */

export interface DerivativeCacheCleanupSummary {
  scannedFiles: number;
  expiredFiles: number;
  evictedFiles: number;
  freedBytes: number;
  remainingBytes: number;
}

/** Files written within this window are never evicted, so in-flight generation is safe. */
const ACTIVE_WRITE_GRACE_MS = 60 * 1000;

interface DerivativeFile {
  path: string;
  parentPath: string;
  mtimeMs: number;
  sizeBytes: number;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function collectFilesRecursive(directoryPath: string, files: DerivativeFile[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, String(entry.name));
    if (entry.isDirectory()) {
      await collectFilesRecursive(entryPath, files);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const stats = await fs.stat(entryPath);
      files.push({
        path: entryPath,
        parentPath: directoryPath,
        mtimeMs: stats.mtimeMs,
        sizeBytes: stats.size
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

async function deleteFile(file: DerivativeFile): Promise<boolean> {
  try {
    await fs.rm(file.path, { force: true });
  } catch (error) {
    if (!isMissing(error)) throw error;
    return false;
  }

  // Keep the directory tree tidy; ignore races where a sibling file appeared.
  await fs.rmdir(file.parentPath).catch(() => undefined);
  return true;
}

/** Removes expired derivative files, then evicts oldest files until within the size cap. */
export async function cleanupDerivativeCache(now = Date.now()): Promise<DerivativeCacheCleanupSummary> {
  const summary: DerivativeCacheCleanupSummary = {
    scannedFiles: 0,
    expiredFiles: 0,
    evictedFiles: 0,
    freedBytes: 0,
    remainingBytes: 0
  };

  // 0 (the default) disables the cap so single-machine setups keep every derivative.
  if (appConfig.derivativeCacheMaxBytes <= 0) {
    return summary;
  }

  await fs.mkdir(appConfig.thumbnailsDir, { recursive: true });
  await fs.mkdir(appConfig.previewsDir, { recursive: true });

  const files: DerivativeFile[] = [];
  await collectFilesRecursive(appConfig.thumbnailsDir, files);
  await collectFilesRecursive(appConfig.previewsDir, files);
  summary.scannedFiles = files.length;

  const cutoffMs = now - appConfig.derivativeCacheMaxAgeDays * 24 * 60 * 60 * 1000;
  const survivors: DerivativeFile[] = [];

  for (const file of files) {
    if (file.mtimeMs < cutoffMs && now - file.mtimeMs >= ACTIVE_WRITE_GRACE_MS) {
      if (await deleteFile(file)) {
        summary.expiredFiles += 1;
        summary.freedBytes += file.sizeBytes;
      }
      continue;
    }

    survivors.push(file);
  }

  // Newest writes stay; the stalest derivatives go first. Regeneration is lazy, so an
  // evicted file only costs a rebuild the next time its card is requested.
  let remainingBytes = survivors.reduce((total, file) => total + file.sizeBytes, 0);
  for (const file of survivors.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (remainingBytes <= appConfig.derivativeCacheMaxBytes) break;
    if (now - file.mtimeMs < ACTIVE_WRITE_GRACE_MS) continue;

    if (await deleteFile(file)) {
      summary.evictedFiles += 1;
      summary.freedBytes += file.sizeBytes;
      remainingBytes -= file.sizeBytes;
    }
  }

  summary.remainingBytes = Math.max(0, remainingBytes);
  log.info('Derivative cache cleanup complete', summary);
  return summary;
}
