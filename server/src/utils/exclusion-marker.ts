import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWithinRoot, normalizePath, safeJoin, splitPathSegments } from './path-utils.js';

export const EXCLUSION_MARKER_FILENAME = '.nofoldergram';

export function isExclusionMarkerFilename(filename: string): boolean {
  return filename === EXCLUSION_MARKER_FILENAME;
}

export function hasExclusionMarker(entries: Dirent[]): boolean {
  return entries.some((entry) => entry.isFile() && isExclusionMarkerFilename(entry.name));
}

async function allowMissing<T>(operation: Promise<T>): Promise<T | null> {
  return operation.catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
}

// Resolve the configured root (which may itself be a symlink), then reject
// symlink directory entries below it, just as full discovery does.
async function getGalleryDirectories(galleryRoot: string, relativeFolderPath: string): Promise<string[] | null> {
  const lexicalRoot = path.resolve(galleryRoot);
  const target = safeJoin(lexicalRoot, normalizePath(relativeFolderPath));
  const segments = splitPathSegments(path.relative(lexicalRoot, target));
  const resolvedRoot = await allowMissing(fs.realpath(lexicalRoot));
  if (!resolvedRoot) return null;

  const directories: string[] = [];
  let current = resolvedRoot;
  for (const segment of segments) {
    const candidate = path.join(current, segment);
    const entry = await allowMissing(fs.lstat(candidate));
    if (!entry?.isDirectory() || entry.isSymbolicLink()) return null;

    const resolved = await allowMissing(fs.realpath(candidate));
    if (!resolved || !ensureWithinRoot(resolvedRoot, resolved)) return null;
    current = resolved;
    directories.push(current);
  }
  return directories;
}

export async function readExclusionMarkerState(galleryRoot: string, relativeFolderPath: string): Promise<boolean | null> {
  const directories = await getGalleryDirectories(galleryRoot, relativeFolderPath);
  if (!directories) return null;
  const directory = directories.at(-1);
  if (!directory) return false;
  const marker = await allowMissing(fs.lstat(path.join(directory, EXCLUSION_MARKER_FILENAME)));
  return marker?.isFile() ?? false;
}

// null means the folder cannot be discovered (missing or reached through a
// directory symlink). Incremental scans must reconcile through a full scan.
// The gallery root itself never acts as an exclusion.
export async function hasAncestorExclusionMarker(galleryRoot: string, relativeFolderPath: string): Promise<boolean | null> {
  const directories = await getGalleryDirectories(galleryRoot, relativeFolderPath);
  if (!directories) return null;
  for (const directory of directories) {
    const marker = await allowMissing(fs.lstat(path.join(directory, EXCLUSION_MARKER_FILENAME)));
    if (marker?.isFile()) return true;
  }
  return false;
}
