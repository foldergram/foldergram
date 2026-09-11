import fs from 'node:fs/promises';
import path from 'node:path';

import { appConfig } from '../config/env.js';
import { log } from './log-service.js';

const CACHE_GROUP_TOUCH_INTERVAL_MS = 10 * 60 * 1000;

interface HlsCacheGroup {
  path: string;
  parentPath: string;
  accessMs: number;
  sizeBytes: number;
}

export interface HlsCacheCleanupSummary {
  deletedGroups: number;
  expiredGroups: number;
  capacityGroups: number;
  freedBytes: number;
  remainingBytes: number;
}

const activeGroupCounts = new Map<string, number>();
const lastTouchedAt = new Map<string, number>();

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function listDirectories(directoryPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directoryPath, entry.name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function getDirectorySize(directoryPath: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
      continue;
    }

    if (entry.isFile()) {
      total += (await fs.stat(entryPath)).size;
    }
  }

  return total;
}

async function listCacheGroups(): Promise<HlsCacheGroup[]> {
  const groups: HlsCacheGroup[] = [];

  for (const mediaPath of await listDirectories(appConfig.hlsCacheDir)) {
    for (const groupPath of await listDirectories(mediaPath)) {
      try {
        const stats = await fs.stat(groupPath);
        groups.push({
          path: groupPath,
          parentPath: mediaPath,
          accessMs: stats.mtimeMs,
          sizeBytes: await getDirectorySize(groupPath)
        });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  }

  return groups;
}

function isActive(groupPath: string): boolean {
  return (activeGroupCounts.get(groupPath) ?? 0) > 0;
}

async function deleteGroup(group: HlsCacheGroup): Promise<boolean> {
  if (isActive(group.path)) return false;

  try {
    await fs.rm(group.path, { recursive: true, force: true });
    await fs.rmdir(group.parentPath).catch((error: unknown) => {
      if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error;
    });
    lastTouchedAt.delete(group.path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Marks one video-quality cache group as in use so maintenance never evicts it mid-transcode. */
export function acquireHlsCacheGroup(groupPath: string): () => void {
  activeGroupCounts.set(groupPath, (activeGroupCounts.get(groupPath) ?? 0) + 1);
  let released = false;

  return () => {
    if (released) return;
    released = true;

    const nextCount = (activeGroupCounts.get(groupPath) ?? 1) - 1;
    if (nextCount <= 0) {
      activeGroupCounts.delete(groupPath);
      return;
    }

    activeGroupCounts.set(groupPath, nextCount);
  };
}

/** Records cache-group use without turning every HLS segment request into a disk write. */
export async function touchHlsCacheGroup(groupPath: string): Promise<void> {
  const now = Date.now();
  if (now - (lastTouchedAt.get(groupPath) ?? 0) < CACHE_GROUP_TOUCH_INTERVAL_MS) return;

  lastTouchedAt.set(groupPath, now);
  try {
    await fs.utimes(groupPath, new Date(now), new Date(now));
  } catch (error) {
    if (!isMissing(error)) {
      log.info(`HLS cache access update skipped | ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Removes expired HLS groups first, then evicts least-recently-used groups until within the size limit. */
export async function cleanupHlsCache(now = Date.now()): Promise<HlsCacheCleanupSummary> {
  await fs.mkdir(appConfig.hlsCacheDir, { recursive: true });
  const cutoffMs = now - appConfig.hlsCacheMaxAgeDays * 24 * 60 * 60 * 1000;
  let groups = await listCacheGroups();
  let remainingBytes = groups.reduce((total, group) => total + group.sizeBytes, 0);
  let deletedGroups = 0;
  let expiredGroups = 0;
  let capacityGroups = 0;
  let freedBytes = 0;

  const deletedPaths = new Set<string>();
  for (const group of groups.filter((candidate) => candidate.accessMs < cutoffMs)) {
    if (!await deleteGroup(group)) continue;
    deletedPaths.add(group.path);
    deletedGroups += 1;
    expiredGroups += 1;
    freedBytes += group.sizeBytes;
    remainingBytes -= group.sizeBytes;
  }

  groups = groups.filter((group) => !deletedPaths.has(group.path));
  for (const group of groups.sort((left, right) => left.accessMs - right.accessMs)) {
    if (remainingBytes <= appConfig.hlsCacheMaxBytes) break;
    if (!await deleteGroup(group)) continue;
    deletedGroups += 1;
    capacityGroups += 1;
    freedBytes += group.sizeBytes;
    remainingBytes -= group.sizeBytes;
  }

  const summary = { deletedGroups, expiredGroups, capacityGroups, freedBytes, remainingBytes: Math.max(0, remainingBytes) };
  log.info('HLS cache cleanup complete', summary);
  return summary;
}
