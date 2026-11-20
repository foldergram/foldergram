import fs from 'node:fs/promises';

import { appConfig } from '../config/env.js';
import { databaseManager } from '../db/database.js';
import { imageRepository } from '../db/repositories.js';
import { getLocalSource } from '../sources/local-source.js';
import type { ImageRecord, LocalVideoMetadata } from '../types/models.js';
import { createFingerprint } from '../utils/image-utils.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import { readMediaMetadata } from './derivative-service.js';
import { HlsDeliveryError } from './hls-encoder.js';
import { scannerService } from './scanner-service.js';

const probes = new Map<string, Promise<LocalVideoMetadata>>();

export function getIndexedLocalVideo(id: number): ImageRecord | undefined {
  const row = imageRepository.getById(id);
  if (!row || row.media_type !== 'video' || row.is_deleted || row.is_trashed || !getLocalSource(row.source_id)?.enabled) return;
  return row;
}

export async function resolveCurrentVideoOriginal(image: ImageRecord): Promise<string> {
  try {
    if (scannerService.isLibraryRebuildRequired(image.source_id)) throw new Error();
    const source = resolveOriginalPath(image.relative_path, image.source_id);
    const stats = await fs.stat(source);
    if (stats.isFile() && image.checksum_or_fingerprint === createFingerprint(image.relative_path, stats.size, stats.mtimeMs)) {
      await fs.access(source);
      return source;
    }
  } catch {
    // Avoid putting absolute gallery paths in API responses.
  }
  throw new HlsDeliveryError(409, 'The original video is unavailable or has changed. Check the source and scan for changes.');
}

export function indexedVideoMetadata(image: ImageRecord): LocalVideoMetadata | undefined {
  try {
    const metadata = image.video_metadata_json ? JSON.parse(image.video_metadata_json) as LocalVideoMetadata : undefined;
    if (metadata && (metadata.version === 1 || metadata.version === 2) && Array.isArray(metadata.audio)) return metadata;
  } catch {
    // A subsequent scan or bounded on-demand probe can replace unusable metadata.
  }
}

export async function ensureVideoMetadata(image: ImageRecord, source: string): Promise<LocalVideoMetadata> {
  const indexed = indexedVideoMetadata(image);
  const sar = indexed?.video?.sampleAspectRatio;
  if (indexed && (indexed.version === 2 || !sar || sar === '1:1' || sar === '0:1')) return indexed;
  const key = JSON.stringify([image.id, image.checksum_or_fingerprint]);
  const existing = probes.get(key);
  if (existing) return existing;
  if (probes.size >= appConfig.hlsTranscodeConcurrency) {
    throw new HlsDeliveryError(503, 'Video metadata is busy. Try again shortly.');
  }
  const probe = (async () => {
    try {
      const metadata = (await readMediaMetadata(source, 'video', { fileSize: image.file_size })).localVideoMetadata;
      if (!metadata) throw new Error();
      await resolveCurrentVideoOriginal(image);
      databaseManager.connection.prepare('UPDATE images SET video_metadata_json = ?, width = ?, height = ? WHERE id = ? AND checksum_or_fingerprint = ?')
        .run(JSON.stringify(metadata), metadata.displayWidth, metadata.displayHeight, image.id, image.checksum_or_fingerprint);
      return metadata;
    } catch (error) {
      if (error instanceof HlsDeliveryError) throw error;
      throw new HlsDeliveryError(422, 'The original video metadata could not be read.');
    } finally {
      probes.delete(key);
    }
  })();
  probes.set(key, probe);
  return probe;
}

export function originalVideoType(image: ImageRecord, metadata = indexedVideoMetadata(image)): string | undefined {
  const video = metadata?.video;
  if (!metadata || !video || video.pixelFormat !== 'yuv420p' ||
      video.colorTransfer === 'smpte2084' || video.colorTransfer === 'arib-std-b67' ||
      metadata.audio.some(audio => !audio.channels || audio.channels > 2)) return;
  const containers = metadata.container?.split(',') ?? [];
  const codec = video.codec === 'vp8' ? 'vp8' : video.codec === 'vp9' && video.profile === 'Profile 0' ? 'vp9' : null;
  if (image.extension.toLowerCase() === '.webm' && containers.includes('webm') && codec) {
    const audio = metadata.audio[0]?.codec;
    if (metadata.audio.every(track => track.codec === audio && (audio === 'opus' || audio === 'vorbis'))) {
      return 'video/webm; codecs="' + codec + (audio ? ', ' + audio : '') + '"';
    }
  }
  if (!/^\.(mp4|m4v)$/i.test(image.extension) || !containers.includes('mp4') ||
      metadata.majorBrand?.trim() === 'qt' || video.codec !== 'h264' ||
      metadata.audio.some(audio => audio.codec !== 'aac')) return;
  const profile = ({ 'Constrained Baseline': '42e0', Baseline: '4200', Main: '4d00', High: '6400' } as Record<string, string>)[video.profile ?? ''];
  if (!profile || !video.level || video.level < 9 || video.level > 62) return;
  const avc = 'avc1.' + profile + video.level.toString(16).padStart(2, '0');
  return 'video/mp4; codecs="' + avc + (metadata.audio.length ? ', mp4a.40.2' : '') + '"';
}
