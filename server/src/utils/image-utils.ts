import path from 'node:path';

import type { MediaType } from '../types/models.js';
import { normalizePath } from './path-utils.js';

export const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
export const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

export const THUMBNAIL_SIZE = 640;
export const PREVIEW_MAX_WIDTH = 1500;

export function isHeicFile(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  return extension === '.heic' || extension === '.heif';
}

export function isSupportedImageFile(filename: string, includeHeic = false): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase()) || (includeHeic && isHeicFile(filename));
}

export function isSupportedVideoFile(filename: string): boolean {
  return SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export function isSupportedMediaFile(filename: string, includeHeic = false): boolean {
  return isSupportedImageFile(filename, includeHeic) || isSupportedVideoFile(filename);
}

export function createFingerprint(relativePath: string, fileSize: number, mtimeMs: number): string {
  return `${normalizePath(relativePath)}:${fileSize}:${Math.round(mtimeMs)}`;
}

function replaceExtension(relativePath: string, nextExtension: string): string {
  const normalized = normalizePath(relativePath);
  const extension = path.extname(normalized);
  return normalized.slice(0, normalized.length - extension.length) + nextExtension;
}

export function getMediaTypeFromExtension(extension: string): MediaType {
  return SUPPORTED_VIDEO_EXTENSIONS.has(extension.toLowerCase()) ? 'video' : 'image';
}

export function getThumbnailRelativePath(relativePath: string): string {
  return replaceExtension(relativePath, '.webp');
}

export function getPreviewRelativePath(relativePath: string, mediaType: MediaType): string {
  return replaceExtension(relativePath, mediaType === 'video' ? '.mp4' : '.webp');
}

export function getDerivativeRelativePath(relativePath: string): string {
  return getThumbnailRelativePath(relativePath);
}

export function getMimeTypeFromExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.m4v':
      return 'video/x-m4v';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    default:
      return 'application/octet-stream';
  }
}

export function getStableSortTimestamp(existing: { sortTimestamp?: number; firstSeenAt?: string } | null, mtimeMs: number): number {
  if (existing?.sortTimestamp) {
    return existing.sortTimestamp;
  }

  if (existing?.firstSeenAt) {
    return Date.parse(existing.firstSeenAt);
  }

  return Math.round(mtimeMs);
}
