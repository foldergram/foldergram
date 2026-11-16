import { createHash, randomBytes } from 'node:crypto';

import type { MediaType } from '../types/models.js';

export const DERIVATIVE_STORAGE_LAYOUT_VERSION = '3';
export type DerivativeStorageLayoutVersion = '2' | typeof DERIVATIVE_STORAGE_LAYOUT_VERSION;
export const LEGACY_DERIVATIVE_STORAGE_LAYOUT_VERSIONS: DerivativeStorageLayoutVersion[] = ['2'];
const ASSET_KEY_BYTES = 16;

function normalizeAssetKey(assetKey: string): string {
  return assetKey.trim().toLowerCase();
}

function getShardSegment(assetKey: string, start: number): string {
  const normalized = normalizeAssetKey(assetKey);
  return normalized.slice(start, start + 2).padEnd(2, '0');
}

export function generateAssetKey(): string {
  return randomBytes(ASSET_KEY_BYTES).toString('hex');
}

export function getDerivativeShard(
  assetKey: string,
  layoutVersion: DerivativeStorageLayoutVersion = DERIVATIVE_STORAGE_LAYOUT_VERSION
): string {
  const normalized = normalizeAssetKey(assetKey);
  if (layoutVersion === '2') {
    return `${getShardSegment(normalized, 0)}/${getShardSegment(normalized, 2)}`;
  }

  return getShardSegment(normalized, 0);
}

export function getThumbnailPathForAssetKey(
  assetKey: string,
  layoutVersion: DerivativeStorageLayoutVersion = DERIVATIVE_STORAGE_LAYOUT_VERSION,
  revision?: string
): string {
  return getPreviewPathForAssetKey(assetKey, 'image', layoutVersion, revision);
}

export function getPreviewPathForAssetKey(
  assetKey: string,
  mediaType: MediaType,
  layoutVersion: DerivativeStorageLayoutVersion = DERIVATIVE_STORAGE_LAYOUT_VERSION,
  revision?: string
): string {
  const normalized = normalizeAssetKey(assetKey);
  const extension = mediaType === 'video' ? '.mp4' : '.webp';
  const suffix = revision ? `-${createHash('sha256').update(revision).digest('hex').slice(0, 16)}` : '';
  return `${getDerivativeShard(normalized, layoutVersion)}/${normalized}${suffix}${extension}`;
}
