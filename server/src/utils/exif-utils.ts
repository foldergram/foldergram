import exifr from 'exifr';
import type { ImageExifData, TakenAtSource } from '../types/models.js';

const EXIF_DATE_TAGS = ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime'] as const;
const EXIF_METADATA_PARSE_OPTIONS = {
  ifd0: {
    pick: ['Make', 'Model', 'DateTime', 'Orientation'],
    translateValues: false
  },
  exif: {
    pick: [...EXIF_DATE_TAGS, 'LensModel', 'FNumber', 'ExposureTime', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat']
  },
  gps: {
    pick: ['GPSAltitude']
  }
};

interface ExifDatePayload {
  DateTimeOriginal?: Date | string | number | null;
  DateTimeDigitized?: Date | string | number | null;
  DateTime?: Date | string | number | null;
}

interface ExifMetadataPayload extends ExifDatePayload {
  Orientation?: unknown;
  Make?: unknown;
  Model?: unknown;
  LensModel?: unknown;
  FNumber?: unknown;
  ExposureTime?: unknown;
  ISO?: unknown;
  FocalLength?: unknown;
  FocalLengthIn35mmFormat?: unknown;
  GPSAltitude?: unknown;
}

interface GpsPayload {
  latitude?: unknown;
  longitude?: unknown;
}

export interface ExtractedImageExif {
  orientation?: number;
  takenAt: number | null;
  exif: ImageExifData | null;
}

interface SerializeImageExifOptions {
  storeEmptyObject?: boolean;
}

export function normalizeTakenAtValue(value: Date | string | number | null | undefined): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
}

function normalizeExifText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeExifNumber(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length > 0 ? normalizeExifNumber(value[0]) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const fractionMatch = trimmed.match(/^([-+]?\d+(?:\.\d+)?)\s*\/\s*([-+]?\d+(?:\.\d+)?)$/);
    if (fractionMatch) {
      const numerator = Number.parseFloat(fractionMatch[1]);
      const denominator = Number.parseFloat(fractionMatch[2]);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        return numerator / denominator;
      }
    }

    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeLatitude(value: unknown): number | null {
  const latitude = normalizeExifNumber(value);
  return latitude !== null && latitude >= -90 && latitude <= 90 ? latitude : null;
}

function normalizeLongitude(value: unknown): number | null {
  const longitude = normalizeExifNumber(value);
  return longitude !== null && longitude >= -180 && longitude <= 180 ? longitude : null;
}

function extractTakenAtFromPayload(metadata: ExifDatePayload | null | undefined): number | null {
  if (!metadata) {
    return null;
  }

  for (const tag of EXIF_DATE_TAGS) {
    const parsed = normalizeTakenAtValue(metadata[tag]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeImageExifData(input: unknown): ImageExifData | null {
  if (!isRecord(input)) {
    return null;
  }

  const normalized: ImageExifData = {};
  const cameraMake = normalizeExifText(input.cameraMake);
  const cameraModel = normalizeExifText(input.cameraModel);
  const lensModel = normalizeExifText(input.lensModel);
  const fNumber = normalizeExifNumber(input.fNumber);
  const exposureTimeSeconds = normalizeExifNumber(input.exposureTimeSeconds);
  const iso = normalizeExifNumber(input.iso);
  const focalLengthMm = normalizeExifNumber(input.focalLengthMm);
  const focalLength35mmMm = normalizeExifNumber(input.focalLength35mmMm);
  const latitude = normalizeLatitude(input.latitude);
  const longitude = normalizeLongitude(input.longitude);
  const altitudeMeters = normalizeExifNumber(input.altitudeMeters);

  if (cameraMake) {
    normalized.cameraMake = cameraMake;
  }

  if (cameraModel) {
    normalized.cameraModel = cameraModel;
  }

  if (lensModel) {
    normalized.lensModel = lensModel;
  }

  if (fNumber !== null && fNumber > 0) {
    normalized.fNumber = fNumber;
  }

  if (exposureTimeSeconds !== null && exposureTimeSeconds > 0) {
    normalized.exposureTimeSeconds = exposureTimeSeconds;
  }

  if (iso !== null && iso > 0) {
    normalized.iso = iso;
  }

  if (focalLengthMm !== null && focalLengthMm > 0) {
    normalized.focalLengthMm = focalLengthMm;
  }

  if (focalLength35mmMm !== null && focalLength35mmMm > 0) {
    normalized.focalLength35mmMm = focalLength35mmMm;
  }

  if (latitude !== null) {
    normalized.latitude = latitude;
  }

  if (longitude !== null) {
    normalized.longitude = longitude;
  }

  if (altitudeMeters !== null) {
    normalized.altitudeMeters = altitudeMeters;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function serializeImageExifData(input: ImageExifData | null | undefined, options: SerializeImageExifOptions = {}): string | null {
  const normalized = normalizeImageExifData(input);
  if (normalized) {
    return JSON.stringify(normalized);
  }

  return options.storeEmptyObject ? '{}' : null;
}

export function deserializeImageExifData(serialized: string | null | undefined): ImageExifData | null {
  if (!serialized) {
    return null;
  }

  try {
    return normalizeImageExifData(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export async function extractTakenAt(sourcePath: string): Promise<number | null> {
  let metadata: ExifDatePayload | null;

  try {
    metadata = (await exifr.parse(sourcePath, [...EXIF_DATE_TAGS])) as ExifDatePayload | null;
  } catch {
    return null;
  }

  return extractTakenAtFromPayload(metadata);
}

export async function extractImageExif(sourcePath: string | Uint8Array): Promise<ExtractedImageExif> {
  const [metadata, gps] = await Promise.all([
    (async () => {
      try {
        return (await exifr.parse(sourcePath, EXIF_METADATA_PARSE_OPTIONS)) as ExifMetadataPayload | null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        return (await exifr.gps(sourcePath)) as GpsPayload | null;
      } catch {
        return null;
      }
    })()
  ]);

  const orientation = typeof metadata?.Orientation === 'number' && Number.isInteger(metadata.Orientation)
    && metadata.Orientation >= 1 && metadata.Orientation <= 8 ? metadata.Orientation : undefined;
  return {
    ...(orientation === undefined ? {} : { orientation }),
    takenAt: extractTakenAtFromPayload(metadata),
    exif: normalizeImageExifData({
      cameraMake: metadata?.Make,
      cameraModel: metadata?.Model,
      lensModel: metadata?.LensModel,
      fNumber: metadata?.FNumber,
      exposureTimeSeconds: metadata?.ExposureTime,
      iso: metadata?.ISO,
      focalLengthMm: metadata?.FocalLength,
      focalLength35mmMm: metadata?.FocalLengthIn35mmFormat,
      latitude: gps?.latitude,
      longitude: gps?.longitude,
      altitudeMeters: metadata?.GPSAltitude
    })
  };
}

interface ResolveTakenAtInput {
  exifTakenAt: number | null;
  existingTakenAt: number | null | undefined;
  existingTakenAtSource?: TakenAtSource | null | undefined;
  existingSortTimestamp?: number | null | undefined;
  existingFirstSeenAt?: string | null | undefined;
  existingMtimeMs?: number | null | undefined;
  fileMtimeMs: number;
  firstSeenAt: string;
  stableFallbackTimestamp: number;
}

export interface ResolvedTakenAt {
  takenAt: number;
  source: TakenAtSource;
}

function inferFallbackSource(
  stableFallbackTimestamp: number,
  firstSeenAt: string,
  fileMtimeMs: number
): TakenAtSource {
  const firstSeenTimestamp = Date.parse(firstSeenAt);
  if (Number.isFinite(firstSeenTimestamp) && firstSeenTimestamp === stableFallbackTimestamp) {
    return 'first_seen';
  }

  if (Math.round(fileMtimeMs) === stableFallbackTimestamp) {
    return 'mtime';
  }

  return 'sort_timestamp';
}

export function resolveTakenAt(input: ResolveTakenAtInput): ResolvedTakenAt {
  if (input.exifTakenAt !== null) {
    return {
      takenAt: input.exifTakenAt,
      source: 'exif'
    };
  }

  if (input.existingTakenAt !== null && input.existingTakenAt !== undefined) {
    if (input.existingTakenAtSource) {
      return {
        takenAt: input.existingTakenAt,
        source: input.existingTakenAtSource
      };
    }

    const inferredExistingSource =
      input.existingFirstSeenAt && Date.parse(input.existingFirstSeenAt) === input.existingTakenAt
        ? 'first_seen'
        : input.existingMtimeMs !== null &&
            input.existingMtimeMs !== undefined &&
            Math.round(input.existingMtimeMs) === input.existingTakenAt
          ? 'mtime'
          : input.existingSortTimestamp !== null &&
              input.existingSortTimestamp !== undefined &&
              input.existingSortTimestamp === input.existingTakenAt
            ? inferFallbackSource(input.existingSortTimestamp, input.existingFirstSeenAt ?? input.firstSeenAt, input.existingMtimeMs ?? input.fileMtimeMs)
            : 'sort_timestamp';

    return {
      takenAt: input.existingTakenAt,
      source: inferredExistingSource
    };
  }

  return {
    takenAt: input.stableFallbackTimestamp,
    source: inferFallbackSource(input.stableFallbackTimestamp, input.firstSeenAt, input.fileMtimeMs)
  };
}
