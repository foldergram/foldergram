import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

import type { ImageExifData, MediaType, PlaybackStrategy } from '../types/models.js';
import { appConfig } from '../config/env.js';
import { extractImageExif, normalizeTakenAtValue } from '../utils/exif-utils.js';
import {
  PREVIEW_MAX_WIDTH,
  THUMBNAIL_SIZE,
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../utils/image-utils.js';
import { safeJoin } from '../utils/path-utils.js';

const execFileAsync = promisify(execFile);
const DIRECT_VIDEO_PLAYBACK_ALLOWED_AUDIO_CODECS = new Set(['aac']);
const DIRECT_VIDEO_PLAYBACK_ALLOWED_PIXEL_FORMATS = new Set(['yuv420p']);
export const VIDEO_PREVIEW_MAX_LONG_EDGE = 1280;
export const VIDEO_PREVIEW_MAX_SHORT_EDGE = 720;

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  duration?: string;
  nb_frames?: string;
  tags?: {
    creation_time?: string;
    rotate?: string;
    title?: string;
    handler_name?: string;
  };
  side_data_list?: Array<{
    rotation?: number;
  }>;
}

interface FfprobeFormat {
  duration?: string;
  format_name?: string;
  nb_streams?: number;
  tags?: {
    creation_time?: string;
    major_brand?: string;
    compatible_brands?: string;
  };
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export interface MediaMetadata {
  width: number;
  height: number;
  displayOrientation?: number | null;
  takenAt: number | null;
  exif?: ImageExifData | null;
  durationMs: number | null;
  mediaType: MediaType;
  playbackStrategy: PlaybackStrategy;
  isAnimated: boolean;
}

export interface DerivativeResult extends MediaMetadata {
  thumbnailPath: string;
  previewPath: string;
  generatedThumbnail: boolean;
  generatedPreview: boolean;
}

export interface ThumbnailDerivativeResult {
  thumbnailPath: string;
  generatedThumbnail: boolean;
}

export interface PreviewDerivativeResult {
  previewPath: string;
  generatedPreview: boolean;
}

export interface DerivativePathOverrides {
  thumbnailPath?: string;
  previewPath?: string;
}

interface ReadMediaMetadataOptions {
  fileSize?: number;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runBinary(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, {
    maxBuffer: 8 * 1024 * 1024
  });
}

async function readMediaProbe(sourcePath: string): Promise<FfprobePayload> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name,nb_streams:format_tags=creation_time,major_brand,compatible_brands:stream=codec_type,codec_name,width,height,pix_fmt,duration,nb_frames:stream_tags=creation_time,rotate,title,handler_name:stream_side_data=rotation',
      '-of',
      'json',
      sourcePath
    ],
    {
      maxBuffer: 2 * 1024 * 1024
    }
  );

  return JSON.parse(stdout) as FfprobePayload;
}

function parseFfprobeFloat(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFfprobeInteger(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeVideoRotation(rotation: number | string | null | undefined): number {
  if (rotation === null || rotation === undefined || rotation === '') {
    return 0;
  }

  const parsedRotation = typeof rotation === 'number' ? rotation : Number.parseFloat(rotation);
  if (!Number.isFinite(parsedRotation)) {
    return 0;
  }

  return ((Math.round(parsedRotation) % 360) + 360) % 360;
}

function resolveVideoDisplayDimensions(videoStream: FfprobeStream | undefined): Pick<MediaMetadata, 'width' | 'height'> {
  const width = videoStream?.width ?? THUMBNAIL_SIZE;
  const height = videoStream?.height ?? THUMBNAIL_SIZE;
  const rotation =
    videoStream?.side_data_list?.find((sideData) => typeof sideData.rotation === 'number')?.rotation
    ?? videoStream?.tags?.rotate;
  const normalizedRotation = normalizeVideoRotation(rotation);

  if (normalizedRotation % 180 === 90) {
    return {
      width: height,
      height: width
    };
  }

  return {
    width,
    height
  };
}

function normalizeImageOrientation(orientation: number | null | undefined): number | null {
  if (typeof orientation !== 'number' || !Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    return null;
  }

  return orientation;
}

function resolveImageDisplayDimensions(
  metadata: sharp.Metadata,
  displayOrientation: number
): Pick<MediaMetadata, 'width' | 'height'> {
  const width = metadata.width ?? THUMBNAIL_SIZE;
  const height = metadata.height ?? THUMBNAIL_SIZE;

  if (displayOrientation >= 5) {
    return {
      width: height,
      height: width
    };
  }

  return {
    width,
    height
  };
}

async function readImageMetadata(sourcePath: string): Promise<MediaMetadata> {
  const [metadata, imageExif] = await Promise.all([
    sharp(sourcePath, { animated: false }).metadata(),
    extractImageExif(sourcePath)
  ]);
  const displayOrientation = normalizeImageOrientation(metadata.orientation) ?? 1;
  const displayDimensions = resolveImageDisplayDimensions(metadata, displayOrientation);

  return {
    width: displayDimensions.width,
    height: displayDimensions.height,
    displayOrientation,
    takenAt: imageExif.takenAt,
    exif: imageExif.exif,
    durationMs: null,
    mediaType: 'image',
    playbackStrategy: 'preview',
    isAnimated: (metadata.pages ?? 1) > 1
  };
}

interface AvifAnimatedSource {
  stream: FfprobeStream;
  videoStreamIndex: number;
}

interface AvifSourceDescriptor {
  metadata: MediaMetadata;
  animatedVideoStreamIndex: number | null;
}

function getVideoStreams(payload: FfprobePayload): FfprobeStream[] {
  return payload.streams?.filter((stream) => stream.codec_type === 'video') ?? [];
}

function getAvifMajorBrand(payload: FfprobePayload): string {
  return payload.format?.tags?.major_brand?.toLowerCase() ?? '';
}

function getAvifCompatibleBrands(payload: FfprobePayload): string {
  return payload.format?.tags?.compatible_brands?.toLowerCase() ?? '';
}

function resolveAnimatedAvifSource(payload: FfprobePayload): AvifAnimatedSource | null {
  const videoStreams = getVideoStreams(payload);
  if (videoStreams.length === 0) {
    return null;
  }

  const animatedStream = videoStreams.find((stream) => {
    const frameCount = parseFfprobeInteger(stream.nb_frames);
    if (frameCount !== null && frameCount > 1) {
      return true;
    }

    const durationSeconds = parseFfprobeFloat(stream.duration);
    return durationSeconds !== null && durationSeconds > 0;
  });

  if (animatedStream) {
    return {
      stream: animatedStream,
      videoStreamIndex: videoStreams.indexOf(animatedStream)
    };
  }

  const majorBrand = getAvifMajorBrand(payload);
  const compatibleBrands = getAvifCompatibleBrands(payload);
  const isSequenceContainer = majorBrand === 'avis' || compatibleBrands.includes('avis');

  if (!isSequenceContainer) {
    return null;
  }

  const fallbackStream = videoStreams.at(-1);
  if (!fallbackStream) {
    return null;
  }

  return {
    stream: fallbackStream,
    videoStreamIndex: videoStreams.length - 1
  };
}

async function createAnimatedAvifMetadata(
  sourcePath: string,
  animatedSource: AvifAnimatedSource
): Promise<MediaMetadata> {
  const imageExif = await extractImageExif(sourcePath);
  const displayDimensions = resolveVideoDisplayDimensions(animatedSource.stream);

  return {
    width: displayDimensions.width,
    height: displayDimensions.height,
    takenAt: imageExif.takenAt,
    exif: imageExif.exif,
    durationMs: null,
    mediaType: 'image',
    playbackStrategy: 'preview',
    isAnimated: true
  };
}

async function inspectAvifSource(
  sourcePath: string,
  options: {
    requireAnimatedVideoStreamIndex?: boolean;
  } = {}
): Promise<AvifSourceDescriptor> {
  let sharpMetadataError: unknown = null;

  try {
    const sharpMetadata = await readImageMetadata(sourcePath);
    if (!sharpMetadata.isAnimated || !options.requireAnimatedVideoStreamIndex) {
      return {
        metadata: sharpMetadata,
        animatedVideoStreamIndex: null
      };
    }
  } catch (error) {
    sharpMetadataError = error;
  }

  const payload = await readMediaProbe(sourcePath);
  const animatedSource = resolveAnimatedAvifSource(payload);

  if (!animatedSource) {
    if (sharpMetadataError) {
      throw sharpMetadataError;
    }

    return {
      metadata: await readImageMetadata(sourcePath),
      animatedVideoStreamIndex: null
    };
  }

  return {
    metadata: await createAnimatedAvifMetadata(sourcePath, animatedSource),
    animatedVideoStreamIndex: animatedSource.videoStreamIndex
  };
}

async function readAvifMetadata(sourcePath: string): Promise<MediaMetadata> {
  return (await inspectAvifSource(sourcePath)).metadata;
}

async function resolveVideoPlaybackStrategy(
  sourcePath: string,
  payload: FfprobePayload
): Promise<PlaybackStrategy> {
  if (path.extname(sourcePath).toLowerCase() !== '.mp4') {
    return 'preview';
  }

  const videoStream = payload.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = payload.streams?.find((stream) => stream.codec_type === 'audio');
  const formatName = payload.format?.format_name?.toLowerCase() ?? '';

  if (!videoStream) {
    return 'preview';
  }

  const hasCompatibleContainer = formatName.includes('mp4');
  const hasCompatibleVideoCodec = videoStream.codec_name === 'h264';
  const hasCompatiblePixelFormat = DIRECT_VIDEO_PLAYBACK_ALLOWED_PIXEL_FORMATS.has(videoStream.pix_fmt ?? '');
  const hasCompatibleAudioCodec = !audioStream || DIRECT_VIDEO_PLAYBACK_ALLOWED_AUDIO_CODECS.has(audioStream.codec_name ?? '');

  return hasCompatibleContainer &&
    hasCompatibleVideoCodec &&
    hasCompatiblePixelFormat &&
    hasCompatibleAudioCodec
    ? 'original'
    : 'preview';
}

async function readVideoMetadata(sourcePath: string, options: ReadMediaMetadataOptions = {}): Promise<MediaMetadata> {
  const payload = await readMediaProbe(sourcePath);
  const videoStream = payload.streams?.find((stream) => stream.codec_type === 'video');
  const durationSeconds = parseFfprobeFloat(payload.format?.duration);
  const durationMs = durationSeconds !== null ? Math.round(durationSeconds * 1000) : null;
  const takenAt = normalizeTakenAtValue(videoStream?.tags?.creation_time ?? payload.format?.tags?.creation_time ?? null);
  const displayDimensions = resolveVideoDisplayDimensions(videoStream);

  return {
    width: displayDimensions.width,
    height: displayDimensions.height,
    takenAt,
    exif: null,
    durationMs,
    mediaType: 'video',
    playbackStrategy: await resolveVideoPlaybackStrategy(sourcePath, payload),
    isAnimated: false
  };
}

export async function readMediaMetadata(
  sourcePath: string,
  mediaType: MediaType,
  options: ReadMediaMetadataOptions = {}
): Promise<MediaMetadata> {
  if (mediaType === 'video') {
    return readVideoMetadata(sourcePath, options);
  }

  return path.extname(sourcePath).toLowerCase() === '.avif'
    ? readAvifMetadata(sourcePath)
    : readImageMetadata(sourcePath);
}

async function writeImageThumbnail(sourcePath: string, thumbnailAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(thumbnailAbsolutePath);
  await sharp(sourcePath, { animated: false })
    .rotate()
    .resize({
      width: THUMBNAIL_SIZE,
      withoutEnlargement: true
    })
    .webp({ quality: 82, effort: 4 })
    .toFile(thumbnailAbsolutePath);
}

export async function writeImagePreview(sourcePath: string, previewAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(previewAbsolutePath);
  await sharp(sourcePath, { animated: true })
    .rotate()
    .resize({
      width: PREVIEW_MAX_WIDTH,
      withoutEnlargement: true
    })
    .webp({ quality: 86, effort: 4 })
    .toFile(previewAbsolutePath);
}

async function writeAnimatedAvifThumbnail(
  sourcePath: string,
  thumbnailAbsolutePath: string,
  videoStreamIndex: number
): Promise<void> {
  await ensureParentDirectory(thumbnailAbsolutePath);

  await runBinary('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    sourcePath,
    '-map',
    `0:v:${videoStreamIndex}`,
    '-vf',
    `thumbnail,scale='min(${THUMBNAIL_SIZE},iw)':-2:flags=lanczos`,
    '-frames:v',
    '1',
    '-c:v',
    'libwebp',
    '-quality',
    '82',
    '-compression_level',
    '4',
    thumbnailAbsolutePath
  ]);
}

async function writeAnimatedAvifPreview(
  sourcePath: string,
  previewAbsolutePath: string,
  videoStreamIndex: number
): Promise<void> {
  await ensureParentDirectory(previewAbsolutePath);

  await runBinary('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    sourcePath,
    '-map',
    `0:v:${videoStreamIndex}`,
    '-vf',
    `scale='min(${PREVIEW_MAX_WIDTH},iw)':-2:flags=lanczos`,
    '-c:v',
    'libwebp',
    '-quality',
    '86',
    '-compression_level',
    '4',
    '-loop',
    '0',
    previewAbsolutePath
  ]);
}

async function writeVideoThumbnail(sourcePath: string, thumbnailAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(thumbnailAbsolutePath);
  await runBinary('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    sourcePath,
    '-vf',
    `thumbnail,scale='min(${THUMBNAIL_SIZE},iw)':-2:flags=lanczos`,
    '-frames:v',
    '1',
    '-c:v',
    'libwebp',
    '-quality',
    '82',
    '-compression_level',
    '4',
    thumbnailAbsolutePath
  ]);
}

export async function writeVideoPreview(sourcePath: string, previewAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(previewAbsolutePath);
  // Landscape videos target up to 1280x720. Portrait and square videos cap their
  // short edge at 720 while preserving aspect ratio. Output dimensions are rounded
  // to even numbers for yuv420p compatibility.
  const scaleFilter =
    `scale=` +
    `'trunc(if(gt(iw,ih),min(${VIDEO_PREVIEW_MAX_LONG_EDGE},iw),min(${VIDEO_PREVIEW_MAX_SHORT_EDGE},iw))/2)*2':` +
    `'trunc(if(gt(iw,ih),min(${VIDEO_PREVIEW_MAX_LONG_EDGE},iw)*ih/iw,min(${VIDEO_PREVIEW_MAX_SHORT_EDGE},iw)*ih/iw)/2)*2':flags=lanczos`;
  await runBinary('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    scaleFilter,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    previewAbsolutePath
  ]);
}

async function generateImageDerivatives(
  sourcePath: string,
  thumbnailAbsolutePath: string,
  previewAbsolutePath: string,
  force: boolean
): Promise<Pick<DerivativeResult, 'generatedThumbnail' | 'generatedPreview'>> {
  const shouldWriteThumbnail = force || !(await fileExists(thumbnailAbsolutePath));
  const shouldWritePreview = force || !(await fileExists(previewAbsolutePath));

  if (shouldWriteThumbnail) {
    await writeImageThumbnail(sourcePath, thumbnailAbsolutePath);
  }

  if (shouldWritePreview) {
    await writeImagePreview(sourcePath, previewAbsolutePath);
  }

  return {
    generatedThumbnail: shouldWriteThumbnail,
    generatedPreview: shouldWritePreview
  };
}

async function generateAnimatedAvifDerivatives(
  sourcePath: string,
  thumbnailAbsolutePath: string,
  previewAbsolutePath: string,
  force: boolean,
  videoStreamIndex: number
): Promise<Pick<DerivativeResult, 'generatedThumbnail' | 'generatedPreview'>> {
  const shouldWriteThumbnail = force || !(await fileExists(thumbnailAbsolutePath));
  const shouldWritePreview = force || !(await fileExists(previewAbsolutePath));

  if (shouldWriteThumbnail) {
    await writeAnimatedAvifThumbnail(sourcePath, thumbnailAbsolutePath, videoStreamIndex);
  }

  if (shouldWritePreview) {
    await writeAnimatedAvifPreview(sourcePath, previewAbsolutePath, videoStreamIndex);
  }

  return {
    generatedThumbnail: shouldWriteThumbnail,
    generatedPreview: shouldWritePreview
  };
}

function requireAnimatedAvifVideoStreamIndex(descriptor: AvifSourceDescriptor): number {
  if (descriptor.animatedVideoStreamIndex === null) {
    throw new Error('Animated AVIF source stream not found.');
  }

  return descriptor.animatedVideoStreamIndex;
}

// Videos are played from the original file or from on-demand HLS segments, so
// the scan only needs a poster frame. Full-length preview transcodes used to
// dominate scan time (hundreds of hours on a large library) and produced files
// nothing reads anymore.
async function generateVideoDerivatives(
  sourcePath: string,
  thumbnailAbsolutePath: string,
  _previewAbsolutePath: string,
  force: boolean
): Promise<Pick<DerivativeResult, 'generatedThumbnail' | 'generatedPreview'>> {
  const shouldWriteThumbnail = force || !(await fileExists(thumbnailAbsolutePath));

  if (shouldWriteThumbnail) {
    await writeVideoThumbnail(sourcePath, thumbnailAbsolutePath);
  }

  return {
    generatedThumbnail: shouldWriteThumbnail,
    generatedPreview: false
  };
}

export async function generateThumbnailDerivative(
  sourcePath: string,
  relativePath: string,
  force = false,
  overrides: DerivativePathOverrides = {}
): Promise<ThumbnailDerivativeResult> {
  const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
  const isAvif = path.extname(relativePath).toLowerCase() === '.avif';
  const thumbnailPath = overrides.thumbnailPath ?? getThumbnailRelativePath(relativePath);
  const thumbnailAbsolutePath = safeJoin(appConfig.thumbnailsDir, thumbnailPath);
  const shouldWriteThumbnail = force || !(await fileExists(thumbnailAbsolutePath));

  if (shouldWriteThumbnail) {
    if (mediaType === 'video') {
      await writeVideoThumbnail(sourcePath, thumbnailAbsolutePath);
    } else if (isAvif) {
      const avifSource = await inspectAvifSource(sourcePath, {
        requireAnimatedVideoStreamIndex: true
      });

      if (avifSource.metadata.isAnimated) {
        await writeAnimatedAvifThumbnail(
          sourcePath,
          thumbnailAbsolutePath,
          requireAnimatedAvifVideoStreamIndex(avifSource)
        );
      } else {
        await writeImageThumbnail(sourcePath, thumbnailAbsolutePath);
      }
    } else {
      await writeImageThumbnail(sourcePath, thumbnailAbsolutePath);
    }
  }

  return {
    thumbnailPath,
    generatedThumbnail: shouldWriteThumbnail
  };
}

export async function generatePreviewDerivative(
  sourcePath: string,
  relativePath: string,
  force = false,
  overrides: DerivativePathOverrides = {}
): Promise<PreviewDerivativeResult> {
  const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
  const isAvif = path.extname(relativePath).toLowerCase() === '.avif';
  const previewPath = overrides.previewPath ?? getPreviewRelativePath(relativePath, mediaType);
  const previewAbsolutePath = safeJoin(appConfig.previewsDir, previewPath);
  const shouldWritePreview = force || !(await fileExists(previewAbsolutePath));

  if (shouldWritePreview) {
    if (mediaType === 'video') {
      // Video playback never reads a preview file; see generateVideoDerivatives.
      return {
        previewPath,
        generatedPreview: false
      };
    } else if (isAvif) {
      const avifSource = await inspectAvifSource(sourcePath, {
        requireAnimatedVideoStreamIndex: true
      });

      if (avifSource.metadata.isAnimated) {
        await writeAnimatedAvifPreview(
          sourcePath,
          previewAbsolutePath,
          requireAnimatedAvifVideoStreamIndex(avifSource)
        );
      } else {
        await writeImagePreview(sourcePath, previewAbsolutePath);
      }
    } else {
      await writeImagePreview(sourcePath, previewAbsolutePath);
    }
  }

  return {
    previewPath,
    generatedPreview: shouldWritePreview
  };
}

export async function generateDerivatives(
  sourcePath: string,
  relativePath: string,
  force = false,
  overrides: DerivativePathOverrides = {}
): Promise<DerivativeResult> {
  const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
  const isAvif = path.extname(relativePath).toLowerCase() === '.avif';
  const thumbnailPath = overrides.thumbnailPath ?? getThumbnailRelativePath(relativePath);
  const previewPath = overrides.previewPath ?? getPreviewRelativePath(relativePath, mediaType);
  const thumbnailAbsolutePath = safeJoin(appConfig.thumbnailsDir, thumbnailPath);
  const previewAbsolutePath = safeJoin(appConfig.previewsDir, previewPath);
  let metadata: MediaMetadata;
  let generated: Pick<DerivativeResult, 'generatedThumbnail' | 'generatedPreview'>;

  if (mediaType === 'video') {
    metadata = await readVideoMetadata(sourcePath);
    generated = await generateVideoDerivatives(sourcePath, thumbnailAbsolutePath, previewAbsolutePath, force);
  } else if (isAvif) {
    const avifSource = await inspectAvifSource(sourcePath, {
      requireAnimatedVideoStreamIndex: true
    });
    metadata = avifSource.metadata;
    generated = metadata.isAnimated
      ? await generateAnimatedAvifDerivatives(
          sourcePath,
          thumbnailAbsolutePath,
          previewAbsolutePath,
          force,
          requireAnimatedAvifVideoStreamIndex(avifSource)
        )
      : await generateImageDerivatives(sourcePath, thumbnailAbsolutePath, previewAbsolutePath, force);
  } else {
    metadata = await readImageMetadata(sourcePath);
    generated = await generateImageDerivatives(sourcePath, thumbnailAbsolutePath, previewAbsolutePath, force);
  }

  return {
    ...metadata,
    thumbnailPath,
    previewPath,
    generatedThumbnail: generated.generatedThumbnail,
    generatedPreview: generated.generatedPreview
  };
}
