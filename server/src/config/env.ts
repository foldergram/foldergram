import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

import { parseExcludedFolderRulesFromEnv } from '../utils/excluded-folder-rules.js';
import { getRelativePathWithinRoot, isSameOrWithinPath, normalizePath } from '../utils/path-utils.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(moduleDirectory, '../../..');

dotenv.config({ path: path.join(repositoryRoot, '.env') });

const envSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().optional(),
  DEV_SERVER_PORT: z.coerce.number().int().positive().optional(),
  DEV_CLIENT_PORT: z.coerce.number().int().positive().optional(),
  DATA_ROOT: z.string().default('./data'),
  DATA_DIR: z.string().optional(),
  GALLERY_ROOT: z.string().optional(),
  DB_DIR: z.string().optional(),
  THUMBNAILS_DIR: z.string().optional(),
  PREVIEWS_DIR: z.string().optional(),
  LOG_VERBOSE: z.string().optional(),
  SCAN_MEDIA_ERROR_MODE: z.enum(['skip', 'fail']).default('skip'),
  LIBRARY_AUTO_SCAN_ENABLED: z.string().default('true'),
  SCAN_DISCOVERY_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  SCAN_DERIVATIVE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  PUBLIC_DEMO_MODE: z.string().optional(),
  CSRF_TRUSTED_ORIGINS: z.string().optional(),
  GALLERY_EXCLUDED_FOLDERS: z.string().optional(),
  IMAGE_DETAIL_SOURCE: z.enum(['preview', 'original']).default('preview'),
  DERIVATIVE_MODE: z.enum(['eager', 'lazy']).default('eager'),
  VIDEO_HWACCEL: z.enum(['auto', 'vaapi', 'qsv', 'none']).default('auto'),
  VIDEO_HWACCEL_DEVICE: z.string().default('/dev/dri/renderD128'),
  FOLDERGRAM_RUNTIME: z.enum(['web', 'worker']).default('web'),
  WORKER_BASE_URL: z.string().url().optional(),
  WORKER_CONTROL_PORT: z.coerce.number().int().positive().default(4142),
  MEDIA_ACCEL_REDIRECT_PREFIX: z.string().default(''),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
});

const parsed = envSchema.parse(process.env);
const isProduction = parsed.NODE_ENV === 'production';
const devClientPort = parsed.DEV_CLIENT_PORT ?? 4141;
const serverPort = isProduction
  ? parsed.SERVER_PORT ?? 4141
  : parsed.DEV_SERVER_PORT ?? 4140;
const devClientPorts = Array.from({ length: 4 }, (_, index) => devClientPort + index);

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}

function resolveConfiguredPath(value: string | null | undefined, fallbackAbsolutePath: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return resolveFromRoot(value);
  }

  return fallbackAbsolutePath;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function parseBooleanFlag(value: string | undefined): boolean {
  return typeof value === 'string' && /^(1|true|yes|on)$/i.test(value.trim());
}

function normalizeConfiguredOrigin(origin: string): string {
  let parsedOrigin: URL;

  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error(`Invalid CSRF_TRUSTED_ORIGINS entry: ${origin}`);
  }

  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    throw new Error(`Invalid CSRF_TRUSTED_ORIGINS entry: ${origin}`);
  }

  return parsedOrigin.origin;
}

function parseConfiguredOrigins(value: string | undefined): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  return uniq(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => normalizeConfiguredOrigin(entry))
  );
}

const dataRoot = resolveConfiguredPath(parsed.DATA_ROOT ?? parsed.DATA_DIR, resolveFromRoot('./data'));
const galleryRoot = resolveConfiguredPath(parsed.GALLERY_ROOT, path.join(dataRoot, 'gallery'));
const dbDir = resolveConfiguredPath(parsed.DB_DIR, path.join(dataRoot, 'db'));
const geodataDir = path.join(dataRoot, 'geodata');
const thumbnailsDir = resolveConfiguredPath(parsed.THUMBNAILS_DIR, path.join(dataRoot, 'thumbnails'));
const previewsDir = resolveConfiguredPath(parsed.PREVIEWS_DIR, path.join(dataRoot, 'previews'));
const scanErrorReportDir = path.join(dataRoot, 'scan-errors');
const hlsCacheDir = path.join(dataRoot, 'hls-cache');
const logVerbose = parseBooleanFlag(parsed.LOG_VERBOSE);
const publicDemoMode = parseBooleanFlag(parsed.PUBLIC_DEMO_MODE);
const csrfTrustedOrigins = parseConfiguredOrigins(parsed.CSRF_TRUSTED_ORIGINS);
const galleryExcludedFolders = parseExcludedFolderRulesFromEnv(parsed.GALLERY_EXCLUDED_FOLDERS);
const mediaAccelRedirectPrefix = parsed.MEDIA_ACCEL_REDIRECT_PREFIX.replace(/\/+$/g, '');

if (mediaAccelRedirectPrefix && !mediaAccelRedirectPrefix.startsWith('/')) {
  throw new Error('MEDIA_ACCEL_REDIRECT_PREFIX must start with /.');
}

const derivativeDirectoriesOverlap =
  isSameOrWithinPath(thumbnailsDir, previewsDir) || isSameOrWithinPath(previewsDir, thumbnailsDir);

if (derivativeDirectoriesOverlap) {
  throw new Error('Invalid storage configuration: THUMBNAILS_DIR and PREVIEWS_DIR must point to separate non-overlapping directories.');
}

const scanErrorReportDirectoryOverlapsServedMedia =
  isSameOrWithinPath(scanErrorReportDir, thumbnailsDir) ||
  isSameOrWithinPath(thumbnailsDir, scanErrorReportDir) ||
  isSameOrWithinPath(scanErrorReportDir, previewsDir) ||
  isSameOrWithinPath(previewsDir, scanErrorReportDir);

if (scanErrorReportDirectoryOverlapsServedMedia) {
  throw new Error('Invalid storage configuration: scan error reports must not overlap THUMBNAILS_DIR or PREVIEWS_DIR.');
}

if (isSameOrWithinPath(thumbnailsDir, galleryRoot)) {
  throw new Error('Invalid storage configuration: THUMBNAILS_DIR cannot contain GALLERY_ROOT.');
}

if (isSameOrWithinPath(previewsDir, galleryRoot)) {
  throw new Error('Invalid storage configuration: PREVIEWS_DIR cannot contain GALLERY_ROOT.');
}

const managedGalleryRelativeIgnores = uniq(
  [dbDir, thumbnailsDir, previewsDir, scanErrorReportDir, hlsCacheDir]
    .map((directoryPath) => getRelativePathWithinRoot(galleryRoot, directoryPath))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => normalizePath(value))
);

export const appConfig = {
  port: serverPort,
  devClientPort,
  devClientPorts,
  nodeEnv: parsed.NODE_ENV,
  isDevelopment: parsed.NODE_ENV === 'development',
  dataRoot,
  galleryRoot,
  dbDir,
  geodataDir,
  thumbnailsDir,
  previewsDir,
  scanErrorReportDir,
  hlsCacheDir,
  managedGalleryRelativeIgnores,
  galleryExcludedFolders,
  logVerbose,
  scanMediaErrorMode: parsed.SCAN_MEDIA_ERROR_MODE,
  libraryAutoScanEnabled: parseBooleanFlag(parsed.LIBRARY_AUTO_SCAN_ENABLED),
  publicDemoMode,
  csrfTrustedOrigins,
  scanDiscoveryConcurrency: parsed.SCAN_DISCOVERY_CONCURRENCY,
  scanDerivativeConcurrency: parsed.SCAN_DERIVATIVE_CONCURRENCY,
  databasePath: path.join(dbDir, 'gallery.sqlite'),
  geodataPath: path.join(geodataDir, 'geonames-cities500.sqlite'),
  geodataMetadataPath: path.join(geodataDir, 'geonames-cities500.meta.json'),
  imageDetailSource: parsed.IMAGE_DETAIL_SOURCE,
  derivativeMode: parsed.DERIVATIVE_MODE,
  videoHwaccel: parsed.VIDEO_HWACCEL,
  videoHwaccelDevice: parsed.VIDEO_HWACCEL_DEVICE,
  runtime: parsed.FOLDERGRAM_RUNTIME,
  workerBaseUrl: parsed.WORKER_BASE_URL?.replace(/\/+$/g, '') ?? null,
  workerControlPort: parsed.WORKER_CONTROL_PORT,
  mediaAccelRedirectPrefix
};
