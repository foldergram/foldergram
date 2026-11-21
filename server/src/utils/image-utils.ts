import fs from 'node:fs/promises';
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

const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);

export function isHeicMimeType(mimeType: string | null | undefined): boolean {
  return mimeType !== null && mimeType !== undefined && HEIC_MIME_TYPES.has(mimeType);
}

/**
 * Whether an indexed image is HEIC: by extension, or because the scanner found
 * HEIC content in a file with another extension (iOS can export HEIC photos as
 * `IMG_1234.HEIC.jpeg`) and stored `image/heic` as its MIME type.
 */
export function isHeicImage(image: { relative_path: string; mime_type?: string | null }): boolean {
  return isHeicFile(image.relative_path) || isHeicMimeType(image.mime_type);
}

/** Extensions whose files the scanner checks for HEIC content. */
export const HEIC_CONTENT_CHECK_EXTENSIONS = new Set(['.jpg', '.jpeg']);

const HEIC_HEADER_BYTES = 256;
// Still-image HEVC brands the HEIC worker decodes. `mif1` alone is not enough
// (AVIF uses it too), and image sequences (`msf1`, `hevc`, `hevx`) are not
// supported by the worker.
const HEIC_BRANDS = new Set(['heic', 'heix']);
const NON_HEIC_MAJOR_BRANDS = new Set(['msf1', 'hevc', 'hevx', 'avif', 'avis']);

/** The major and compatible brands of a leading ISO-BMFF `ftyp` box, or null when there is none. */
export function readFtypBrands(header: Buffer): string[] | null {
  if (header.length < 16 || header.toString('latin1', 4, 8) !== 'ftyp') {
    return null;
  }

  const boxSize = header.readUInt32BE(0);
  if (boxSize < 16) {
    return null;
  }

  const end = Math.min(boxSize, header.length);
  const brands = [header.toString('latin1', 8, 12)];
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(header.toString('latin1', offset, offset + 4));
  }
  return brands;
}

export function isHeicHeader(header: Buffer): boolean {
  const brands = readFtypBrands(header);
  if (!brands || NON_HEIC_MAJOR_BRANDS.has(brands[0])) {
    return false;
  }
  return brands.some((brand) => HEIC_BRANDS.has(brand));
}

/**
 * Reads at most the first 256 bytes of a file and reports whether they start a
 * HEIC image. Read errors report false: the regular decode path then surfaces
 * the real error, as it did before this check existed.
 */
export async function hasHeicContent(absolutePath: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(absolutePath, 'r');
    const header = Buffer.alloc(HEIC_HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, HEIC_HEADER_BYTES, 0);
    return isHeicHeader(header.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
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
