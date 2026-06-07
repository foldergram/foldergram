import type { Stats } from 'node:fs';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import pLimit from 'p-limit';

import {
  AVIF_METADATA_REPAIR_VERSION_SETTING_KEY,
  EXCLUDED_FOLDERS_SETTING_KEY,
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
  LIBRARY_REBUILD_REQUIRED_SETTING_KEY,
  PREVIOUS_GALLERY_ROOT_SETTING_KEY,
  TREAT_STORIES_AS_FOLDERS_SETTING_KEY
} from '../constants/app-setting-keys.js';
import { appConfig } from '../config/env.js';
import {
  appSettingsRepository,
  folderRepository,
  folderScanStateRepository,
  imageRepository,
  maintenanceRepository,
  scanRunRepository,
  statsRepository
} from '../db/repositories.js';
import { generateDerivatives, generateThumbnailDerivative, readMediaMetadata } from './derivative-service.js';
import {
  derivativeMigrationService,
  type DerivativeMigrationOperation,
  type DerivativeMigrationProgress,
  type DerivativeMigrationSummary
} from './derivative-migration-service.js';
import { libraryRelocationService } from './library-relocation-service.js';
import { log } from './log-service.js';
import { placeResolutionService } from './place-service.js';
import { storageService } from './storage-service.js';
import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getStableSortTimestamp,
  isSupportedMediaFile
} from '../utils/image-utils.js';
import { generateAssetKey, getPreviewPathForAssetKey, getThumbnailPathForAssetKey } from '../utils/derivative-paths.js';
import { resolveTakenAt, serializeImageExifData } from '../utils/exif-utils.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import {
  getFolderDisplayInfo,
  getRelativeGalleryPath,
  matchesRelativeRoot,
  getSourceFolderPathFromRelativePath,
  isHiddenPath,
  normalizePath
} from '../utils/path-utils.js';
import {
  getEffectiveExcludedFolderRules,
  matchesExcludedFolder,
  parseExcludedFolderRulesFromSetting
} from '../utils/excluded-folder-rules.js';
import {
  findReservedStoriesOwnerPath,
  isStoriesFolderName,
  parseTreatStoriesAsFoldersSetting
} from '../utils/stories-utils.js';
import {
  createFolderScanSignature,
  resolveFullScanOptions,
  shouldQueueDerivativeJobForStatus,
  shouldRefreshUnchangedImage,
  shouldSkipFolderBySignature,
  type FullScanOptions,
  type IndexedFileStatus
} from '../utils/scan-utils.js';
import { resolveUniqueSlug, slugifyFolderPath } from '../utils/slug.js';
import type { FolderRecord, FolderRole, FolderScanStateRecord, ImageRecord, ScanRunRecord } from '../types/models.js';

interface ScanSummary {
  status: string;
  scanned_files: number;
  new_files: number;
  updated_files: number;
  removed_files: number;
  error_text: string | null;
}

interface DerivativeJob {
  absolutePath: string;
  relativePath: string;
  thumbnailPath: string;
  previewPath?: string;
  force: boolean;
  kind: 'all' | 'thumbnail';
}

interface ProcessedFileSummary {
  status: IndexedFileStatus;
  derivativeJob: DerivativeJob | null;
  refreshedIndexedRow: boolean;
  relativePath: string;
}

interface IndexedFileCandidate {
  absolutePath: string;
  relativePath: string;
  stats: Stats;
}

interface SourceFolderCandidate {
  absolutePath: string;
  relativePath: string;
}

interface ResolvedFolderResult {
  folder: FolderRecord;
  wroteFolder: boolean;
}

interface ResolvedFolderOptions {
  role?: FolderRole;
  storyOwnerFolderId?: number | null;
}

interface IndexedFolderScanOptions {
  folderPath: string;
  scannedFileCount: number;
  activeRelativePaths: string[];
  discoveredFiles: IndexedFileCandidate[];
  existingFolders: FolderRecord[];
  usedSlugs: Set<string>;
  folderScanStates: Map<string, FolderScanStateRecord>;
  derivativeJobs: Map<string, DerivativeJob>;
  errors: ScanErrorCollector;
  options: FullScanOptions;
  context: ImageProcessingContext;
  logLabel: string;
  role?: FolderRole;
  storyOwnerFolderId?: number | null;
  folderHadErrors?: boolean;
}

interface IndexedFileReference {
  absolutePath: string;
  relativePath: string;
}

interface StatIndexedFilesResult {
  activeRelativePaths: string[];
  discoveredFiles: IndexedFileCandidate[];
  folderHadErrors: boolean;
}

interface SourceFolderScanResult {
  folder: FolderRecord | null;
  sourceFolderPath: string;
  discoveredDirectImages: boolean;
  wroteFolder: boolean;
  scannedFiles: number;
  newFiles: number;
  updatedFiles: number;
  removedFiles: number;
  unchangedFiles: number;
  refreshedUnchangedRows: number;
  skippedUnchangedRows: number;
  usedFolderShortcut: boolean;
}

interface ImageProcessingContext {
  galleryRootChanged: boolean;
  hasStoredGalleryRoot: boolean;
  avifMetadataRepairPending: boolean;
  moveReconciliationEnabled: boolean;
  claimedMoveImageIds: Set<number>;
  rebuildDerivativeReuseIndex?: RebuildDerivativeReuseIndex;
}

interface RebuildDerivativeReuseIndex {
  byRelativePath: Map<string, ImageRecord>;
  bySignature: Map<string, ImageRecord[]>;
  claimedImageIds: Set<number>;
}

interface FullScanMetrics {
  folderShortcutHits: number;
  folderShortcutImagesSkipped: number;
  folderShortcutMisses: number;
  folderWritesCommitted: number;
  folderWritesSkipped: number;
  unchangedFiles: number;
  unchangedFilesQueuedForDerivativeVerification: number;
  unchangedFilesSkippedDerivativeVerification: number;
  unchangedRowsRefreshed: number;
  unchangedRowsSkippedRefresh: number;
  discoveryDurationMs: number;
  derivativeJobsQueued: number;
  removedFolderStateRows: number;
}

interface DerivativeProcessingSummary {
  durationMs: number;
  generatedPreviews: number;
  generatedThumbnails: number;
  queuedJobs: number;
}

interface FullScanContextOptions {
  rebuildDerivativeReuseIndex?: RebuildDerivativeReuseIndex;
}

type ScanPhase = 'idle' | 'migration' | 'discovery' | 'derivatives';
export type ScanOperation =
  | DerivativeMigrationOperation
  | 'discovering_media'
  | 'generating_thumbnail'
  | 'generating_preview'
  | 'generating_thumbnail_and_preview';
type StartupAction = 'scan' | 'idle' | 'blocked';

export interface ScanProgressSnapshot {
  isScanning: boolean;
  scanReason: string | null;
  phase: ScanPhase;
  startedAt: string | null;
  runId: number | null;
  migrationTotalRows: number;
  processedMigrationRows: number;
  migratedDerivativeFiles: number;
  missingDerivativeFiles: number;
  repairedDerivativeFiles: number;
  backfilledAssetKeys: number;
  discoveredFolders: number;
  processedFolders: number;
  discoveredImages: number;
  processedImages: number;
  queuedDerivativeJobs: number;
  processedDerivativeJobs: number;
  generatedThumbnails: number;
  generatedPreviews: number;
  currentOperation: ScanOperation | null;
  currentFile: string | null;
  currentPhaseMessage: string | null;
  currentFolder: string | null;
  lastCompletedScan: ScanRunRecord | null;
}

const folderLimit = pLimit(appConfig.scanFolderConcurrency);
const discoveryLimit = pLimit(appConfig.scanDiscoveryConcurrency);
const derivativeLimit = pLimit(appConfig.scanDerivativeConcurrency);
const HEARTBEAT_INTERVAL_MS = 5000;
const DERIVATIVE_CACHE_KEEP_FILE = '.gitkeep';
const ROOT_DISCOVERY_LABEL = '(root)';
const CURRENT_AVIF_METADATA_REPAIR_VERSION = '1';
const MAX_SCAN_ERROR_TEXT_LENGTH = 8000;
const MAX_SCAN_ERROR_LINE_LENGTH = 2000;
export const LIBRARY_REBUILD_REQUIRED_MESSAGE =
  'Library rebuild required before scanning because the configured gallery root changed.';

function createEmptySummary(): ScanSummary {
  return {
    status: 'completed',
    scanned_files: 0,
    new_files: 0,
    updated_files: 0,
    removed_files: 0,
    error_text: null
  };
}

function createIdleProgress(lastCompletedScan: ScanRunRecord | null = null): ScanProgressSnapshot {
  return {
    isScanning: false,
    scanReason: null,
    phase: 'idle',
    startedAt: null,
    runId: null,
    migrationTotalRows: 0,
    processedMigrationRows: 0,
    migratedDerivativeFiles: 0,
    missingDerivativeFiles: 0,
    repairedDerivativeFiles: 0,
    backfilledAssetKeys: 0,
    discoveredFolders: 0,
    processedFolders: 0,
    discoveredImages: 0,
    processedImages: 0,
    queuedDerivativeJobs: 0,
    processedDerivativeJobs: 0,
    generatedThumbnails: 0,
    generatedPreviews: 0,
    currentOperation: null,
    currentFile: null,
    currentPhaseMessage: null,
    currentFolder: null,
    lastCompletedScan
  };
}

function getDiscoveryPhaseMessage(scanReason: string | null): string {
  if (scanReason === 'rebuild-thumbnails') {
    return 'Loading indexed media before thumbnail regeneration starts.';
  }

  if (scanReason === 'rebuild') {
    return 'Discovering folders and media for the current gallery root.';
  }

  return 'Discovering folders and media...';
}

function getMigrationPhaseMessage(): string {
  return 'Upgrading legacy thumbnails and previews before indexing starts.';
}

function getDerivativePhaseMessage(scanReason: string | null): string {
  if (scanReason === 'rebuild-thumbnails') {
    return 'Generating feed thumbnails, profile thumbnails, and video posters.';
  }

  if (scanReason === 'rebuild') {
    return 'Generating any missing thumbnails and previews for the rebuilt library.';
  }

  return 'Generating thumbnails and previews for queued changes.';
}

function getDerivativeOperationForJob(job: DerivativeJob): ScanOperation {
  if (job.kind === 'thumbnail') {
    return 'generating_thumbnail';
  }

  return job.previewPath ? 'generating_thumbnail_and_preview' : 'generating_preview';
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) {
    return '00:00';
  }

  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function formatStep(label: string, value: string | number): string {
  return `${label} ${value}`;
}

function formatDuration(durationMs: number): string {
  return `${durationMs}ms`;
}

function formatToggle(value: boolean): string {
  return value ? 'yes' : 'no';
}

function joinLogParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' | ');
}

function createReusableDerivativeSignature(fileSize: number, mtimeMs: number, extension: string): string {
  return `${fileSize}:${Math.round(mtimeMs)}:${extension.toLowerCase()}`;
}

function sanitizeReportFilenamePart(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized.slice(0, 48) : 'scan';
}

function formatScanError(relativePath: string, message: string, options: { sourcePath?: string | null } = {}): string {
  const sourcePath = options.sourcePath ? normalizePath(options.sourcePath) : null;
  return sourcePath ? `${relativePath}: ${message} (source: ${sourcePath})` : `${relativePath}: ${message}`;
}

function truncateScanErrorLine(value: string): string {
  if (value.length <= MAX_SCAN_ERROR_LINE_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_SCAN_ERROR_LINE_LENGTH - 15)}...[truncated]`;
}

class ScanErrorCollector {
  private readonly reportPath: string;
  private readonly sampleLines: string[] = [];
  private sampleLength = 0;
  private stream: fsSync.WriteStream | null = null;
  private reportError: string | null = null;
  count = 0;

  constructor(
    private readonly runId: number,
    private readonly reason: string
  ) {
    this.reportPath = path.join(
      appConfig.scanErrorReportDir,
      `scan-${runId}-${sanitizeReportFilenamePart(reason)}.log`
    );
  }

  get hasErrors(): boolean {
    return this.count > 0;
  }

  get sampleText(): string {
    return this.sampleLines.join('\n');
  }

  async add(error: string): Promise<string> {
    const normalizedError = truncateScanErrorLine(error.replace(/\s+/g, ' ').trim());
    this.count += 1;
    this.rememberSample(normalizedError);
    await this.write(`${this.count}. ${normalizedError}\n`);
    return normalizedError;
  }

  async finalize(summary: ScanSummary): Promise<{ reportPath: string | null; errorMessage: string | null } | null> {
    if (!this.hasErrors) {
      return null;
    }

    await this.write([
      '',
      'Summary:',
      `Status: ${summary.status}`,
      `Error count: ${this.count}`,
      `Scanned files: ${summary.scanned_files}`,
      `New files: ${summary.new_files}`,
      `Updated files: ${summary.updated_files}`,
      `Removed files: ${summary.removed_files}`,
      ''
    ].join('\n'));

    if (this.stream) {
      await new Promise<void>((resolve) => {
        this.stream?.end(resolve);
      });
    }

    if (this.reportError) {
      return {
        reportPath: null,
        errorMessage: this.reportError
      };
    }

    return {
      reportPath: this.reportPath,
      errorMessage: null
    };
  }

  private rememberSample(error: string): void {
    if (this.sampleLength >= MAX_SCAN_ERROR_TEXT_LENGTH) {
      return;
    }

    const nextLineLength = error.length + (this.sampleLines.length > 0 ? 1 : 0);
    if (this.sampleLength + nextLineLength > MAX_SCAN_ERROR_TEXT_LENGTH) {
      const remaining = MAX_SCAN_ERROR_TEXT_LENGTH - this.sampleLength - (this.sampleLines.length > 0 ? 1 : 0);
      if (remaining > 0) {
        this.sampleLines.push(error.slice(0, remaining));
        this.sampleLength = MAX_SCAN_ERROR_TEXT_LENGTH;
      }
      return;
    }

    this.sampleLines.push(error);
    this.sampleLength += nextLineLength;
  }

  private ensureStream(): fsSync.WriteStream | null {
    if (this.stream || this.reportError) {
      return this.stream;
    }

    try {
      fsSync.mkdirSync(appConfig.scanErrorReportDir, { recursive: true });
      this.stream = fsSync.createWriteStream(this.reportPath, {
        flags: 'w',
        mode: 0o600
      });
      this.stream.on('error', (error) => {
        this.reportError = error.message;
      });
      this.stream.write([
        'Foldergram scan error report',
        `Generated at: ${new Date().toISOString()}`,
        `Run ID: ${this.runId}`,
        `Reason: ${this.reason}`,
        `Gallery root: ${normalizePath(appConfig.galleryRoot)}`,
        '',
        'Errors:',
        ''
      ].join('\n'));
    } catch (error) {
      this.reportError = error instanceof Error ? error.message : String(error);
      this.stream = null;
    }

    return this.stream;
  }

  private async write(value: string): Promise<void> {
    const stream = this.ensureStream();
    if (!stream || this.reportError) {
      return;
    }

    await new Promise<void>((resolve) => {
      stream.write(value, (error?: Error | null) => {
        if (error) {
          this.reportError = error.message;
        }
        resolve();
      });
    });
  }
}

class ScannerService {
  private queue = Promise.resolve<ScanSummary>(createEmptySummary());
  private progress = createIdleProgress(null);
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    const lastCompleted = await scanRunRepository.latestCompleted();
    this.progress = createIdleProgress(lastCompleted ?? null);
  }

  getProgress(): ScanProgressSnapshot {
    return {
      ...this.progress,
      lastCompletedScan: this.progress.lastCompletedScan ? { ...this.progress.lastCompletedScan } : null
    };
  }

  async isLibraryRebuildRequired(): Promise<boolean> {
    return await appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY) === '1';
  }

  async handleStartup(reason = 'startup'): Promise<StartupAction> {
    const options = resolveFullScanOptions({
      repairUnchangedDerivatives: false,
      allowDerivativeMigration: false
    });
    const currentGalleryRoot = normalizePath(appConfig.galleryRoot);
    const storedGalleryRoot = await appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
    const normalizedStoredGalleryRoot = storedGalleryRoot ? normalizePath(storedGalleryRoot) : null;
    const hasStoredGalleryRoot = normalizedStoredGalleryRoot !== null;
    const galleryRootChanged = normalizedStoredGalleryRoot !== currentGalleryRoot;
    const hasIndexedFolders = (await folderRepository.getAll()).length > 0;
    const pendingDerivativeMigrationRows = await imageRepository.countPendingDerivativeMigrationRows();
    const requiresDerivativeMigration = pendingDerivativeMigrationRows > 0;

    if (galleryRootChanged && normalizedStoredGalleryRoot && hasIndexedFolders) {
      const relocationValidation = await libraryRelocationService.validateCurrentGalleryRoot();

      if (relocationValidation.status === 'validated') {
        await this.clearLibraryRebuildRequirement();
        await appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, currentGalleryRoot);
        log.info(
          joinLogParts([
            'Gallery root relocation validated',
            formatStep('previous', normalizedStoredGalleryRoot),
            formatStep('current', currentGalleryRoot),
            formatStep('checked', relocationValidation.checked),
            formatStep('refreshed', relocationValidation.refreshed)
          ])
        );
      } else {
        await this.markLibraryRebuildRequired(normalizedStoredGalleryRoot);
        log.info(
          joinLogParts([
            'Startup scan deferred',
            'rebuild required',
            formatStep('previous', normalizedStoredGalleryRoot),
            formatStep('current', currentGalleryRoot),
            relocationValidation.status === 'failed' ? relocationValidation.reason : null
          ])
        );
        return 'blocked';
      }
    }

    if (!galleryRootChanged || !hasStoredGalleryRoot || !hasIndexedFolders) {
      await this.clearLibraryRebuildRequirement();
    }

    if (!hasIndexedFolders) {
      log.info(
        joinLogParts([
          'Startup scan queued',
          formatStep('reason', reason),
          formatStep('repair-derivatives', formatToggle(options.repairUnchangedDerivatives))
        ])
      );
      void this.scanAll(reason, options).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Startup scan failed (${reason})`, message);
      });
      return 'scan';
    }

    if (requiresDerivativeMigration) {
      log.info(
        joinLogParts([
          'Startup scan skipped',
          formatStep('reason', reason),
          formatStep('pending-legacy-derivatives', pendingDerivativeMigrationRows),
          'waiting for a manual library scan'
        ])
      );
      return 'idle';
    }

    log.info(
      joinLogParts([
        'Startup scan skipped',
        formatStep('reason', reason),
        'using existing index'
      ])
    );
    return 'idle';
  }

  async scanAll(reason = 'manual', options: Partial<FullScanOptions> = {}): Promise<ScanRunRecord | undefined> {
    const resolvedOptions = resolveFullScanOptions({
      allowDerivativeMigration: reason !== 'startup' && !reason.startsWith('watcher'),
      ...options
    });

    await this.enqueue(async () => this.performFullScan(reason, resolvedOptions));
    return scanRunRepository.latest();
  }

  async rebuildLibraryIndex(reason = 'rebuild'): Promise<ScanRunRecord | undefined> {
    const resolvedOptions = resolveFullScanOptions({
      repairUnchangedDerivatives: false,
      forceNewFileDerivatives: false,
      allowDerivativeMigration: true
    });

    await this.enqueue(async () => this.performLibraryRebuild(reason, resolvedOptions));
    return scanRunRepository.latest();
  }

  async rebuildThumbnails(reason = 'rebuild-thumbnails'): Promise<ScanRunRecord | undefined> {
    await this.enqueue(async () => this.performThumbnailRebuild(reason));
    return scanRunRepository.latest();
  }

  async scanChangedPaths(relativePaths: string[], reason = 'watcher'): Promise<ScanRunRecord | undefined> {
    if (relativePaths.length === 0) {
      return await scanRunRepository.latest();
    }

    await this.enqueue(async () => this.performIncrementalScan(relativePaths, reason));
    return scanRunRepository.latest();
  }

  private async enqueue(job: () => Promise<ScanSummary>): Promise<ScanSummary> {
    this.queue = this.queue.then(job, job);
    return this.queue;
  }

  private beginProgress(reason: string, runId: number): void {
    this.progress = {
      ...createIdleProgress(this.progress.lastCompletedScan),
      isScanning: true,
      scanReason: reason,
      phase: 'discovery',
      startedAt: new Date().toISOString(),
      runId,
      currentOperation: 'discovering_media',
      currentPhaseMessage: getDiscoveryPhaseMessage(reason)
    };

    this.startHeartbeat();
    this.logProgress('started');
  }

  private updateMigrationProgress(progress: DerivativeMigrationProgress): void {
    this.setProgress({
      migrationTotalRows: progress.totalRows,
      processedMigrationRows: progress.processedRows,
      migratedDerivativeFiles: progress.movedFiles,
      missingDerivativeFiles: progress.missingFiles,
      repairedDerivativeFiles: progress.repairedFiles,
      backfilledAssetKeys: progress.backfilledAssetKeys,
      currentOperation: progress.currentOperation,
      currentFile: progress.currentFile,
      currentFolder: progress.currentFile ? getSourceFolderPathFromRelativePath(progress.currentFile) : null,
      currentPhaseMessage: progress.currentPhaseMessage
    });
  }

  private setProgress(patch: Partial<Omit<ScanProgressSnapshot, 'lastCompletedScan'>>): void {
    this.progress = {
      ...this.progress,
      ...patch
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.logProgress('heartbeat');
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private logProgress(kind: 'started' | 'heartbeat' | 'folder' | 'phase' = 'heartbeat'): void {
    if (!this.progress.isScanning) {
      return;
    }

    if (kind === 'folder') {
      return;
    }

    const elapsed = formatElapsed(this.progress.startedAt);
    if (kind === 'started') {
      log.info(
        joinLogParts([
          'Scan started',
          formatStep('reason', this.progress.scanReason ?? 'unknown'),
          formatStep('phase', this.progress.phase),
          formatStep('elapsed', elapsed)
        ])
      );
      return;
    }

    if (this.progress.phase === 'derivatives') {
      log.info(
        joinLogParts([
          'Derivatives',
          formatStep('jobs', `${this.progress.processedDerivativeJobs}/${this.progress.queuedDerivativeJobs}`),
          formatStep('thumbnails', this.progress.generatedThumbnails),
          formatStep('previews', this.progress.generatedPreviews),
          this.progress.currentOperation ? formatStep('operation', this.progress.currentOperation) : null,
          this.progress.currentFile ? formatStep('file', this.progress.currentFile) : null,
          this.progress.currentFolder ? formatStep('current', this.progress.currentFolder) : null,
          formatStep('elapsed', elapsed)
        ])
      );
      return;
    }

    if (this.progress.phase === 'migration') {
      const totalRows = this.progress.migrationTotalRows || '?';
      log.info(
        joinLogParts([
          'Migration',
          formatStep('assets', `${this.progress.processedMigrationRows}/${totalRows}`),
          formatStep('backfilled', this.progress.backfilledAssetKeys),
          formatStep('moved', this.progress.migratedDerivativeFiles),
          formatStep('repaired', this.progress.repairedDerivativeFiles),
          formatStep('missing', this.progress.missingDerivativeFiles),
          this.progress.currentOperation ? formatStep('operation', this.progress.currentOperation) : null,
          this.progress.currentFile ? formatStep('file', this.progress.currentFile) : null,
          formatStep('elapsed', elapsed)
        ])
      );
      return;
    }

    log.info(
      joinLogParts([
        'Discovery',
        formatStep('folders', `${this.progress.processedFolders}/${this.progress.discoveredFolders}`),
        formatStep('images', `${this.progress.processedImages}/${this.progress.discoveredImages}`),
        this.progress.currentOperation ? formatStep('operation', this.progress.currentOperation) : null,
        this.progress.currentFolder ? formatStep('current', this.progress.currentFolder) : null,
        formatStep('elapsed', elapsed)
      ])
    );
  }

  private async finishProgress(): Promise<void> {
    this.stopHeartbeat();
    this.progress = createIdleProgress((await scanRunRepository.latestCompleted()) ?? this.progress.lastCompletedScan);
  }

  private async finishRun(runId: number, summary: ScanSummary): Promise<void> {
    await scanRunRepository.finish(runId, {
      ...summary,
      finished_at: new Date().toISOString()
    });
    await statsRepository.refresh();
  }

  private async applyScanErrors(summary: ScanSummary, errors: ScanErrorCollector): Promise<void> {
    if (!errors.hasErrors) {
      return;
    }

    if (summary.status !== 'failed') {
      summary.status = 'completed_with_errors';
    }

    let reportNotice = '';
    const reportResult = await errors.finalize(summary);

    if (reportResult?.reportPath) {
      reportNotice = `\n\nFull error report: ${normalizePath(reportResult.reportPath)}`;
      log.info(
        joinLogParts([
          'Scan error report written',
          formatStep('errors', errors.count),
          formatStep('path', normalizePath(reportResult.reportPath))
        ])
      );
    } else if (reportResult?.errorMessage) {
      reportNotice = `\n\nUnable to write full error report: ${reportResult.errorMessage}`;
      log.error('Failed to write scan error report', reportResult.errorMessage);
    }

    const sampleLimit = Math.max(0, MAX_SCAN_ERROR_TEXT_LENGTH - reportNotice.length);
    summary.error_text = `${errors.sampleText.slice(0, sampleLimit)}${reportNotice}`;
  }

  private async finishUnavailableRun(runId: number, reason: string): Promise<ScanSummary> {
    const storageState = storageService.refreshAvailability();
    const summary = {
      ...createEmptySummary(),
      status: 'skipped_unavailable',
      error_text: storageState.reason ?? 'Configured library storage is unavailable'
    };

    await this.finishRun(runId, summary);
    await this.finishProgress();

    log.info(
      joinLogParts([
        `Skipped scan (${reason})`,
        'storage unavailable',
        storageState.reason
      ])
    );

    return summary;
  }

  private async markLibraryRebuildRequired(previousGalleryRoot: string): Promise<void> {
    await appSettingsRepository.set(LIBRARY_REBUILD_REQUIRED_SETTING_KEY, '1');
    await appSettingsRepository.set(PREVIOUS_GALLERY_ROOT_SETTING_KEY, previousGalleryRoot);
  }

  private async clearLibraryRebuildRequirement(): Promise<void> {
    await appSettingsRepository.remove(LIBRARY_REBUILD_REQUIRED_SETTING_KEY);
    await appSettingsRepository.remove(PREVIOUS_GALLERY_ROOT_SETTING_KEY);
  }

  private async isAvifMetadataRepairPending(): Promise<boolean> {
    return await appSettingsRepository.get(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY) !== CURRENT_AVIF_METADATA_REPAIR_VERSION;
  }

  private async markAvifMetadataRepairComplete(): Promise<void> {
    await appSettingsRepository.set(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY, CURRENT_AVIF_METADATA_REPAIR_VERSION);
  }

  private async resetDerivativeDirectory(targetDirectory: string): Promise<void> {
    await fs.rm(targetDirectory, { recursive: true, force: true });
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(path.join(targetDirectory, DERIVATIVE_CACHE_KEEP_FILE), '');
  }

  private async clearThumbnailCache(): Promise<void> {
    await this.resetDerivativeDirectory(appConfig.thumbnailsDir);
  }

  private isManagedGalleryPath(relativePath: string): boolean {
    return matchesRelativeRoot(relativePath, appConfig.managedGalleryRelativeIgnores);
  }

  private async getCustomExcludedFolderRules(): Promise<string[]> {
    return parseExcludedFolderRulesFromSetting(await appSettingsRepository.get(EXCLUDED_FOLDERS_SETTING_KEY));
  }

  private async getEffectiveExcludedFolderRules(): Promise<string[]> {
    return getEffectiveExcludedFolderRules({
      envRules: appConfig.galleryExcludedFolders,
      customRules: await this.getCustomExcludedFolderRules()
    });
  }

  private async shouldTreatStoriesAsFolders(): Promise<boolean> {
    return parseTreatStoriesAsFoldersSetting(await appSettingsRepository.get(TREAT_STORIES_AS_FOLDERS_SETTING_KEY));
  }

  private async walkMediaSourceFolders(
    currentAbsolutePath: string,
    onSourceFolder: (sourceFolder: SourceFolderCandidate) => Promise<void>,
    currentRelativePath: string | null,
    treatStoriesAsFolders: boolean,
    excludedFolderRules: string[]
  ): Promise<void> {
    if (currentRelativePath && matchesExcludedFolder(currentRelativePath, excludedFolderRules)) {
      return;
    }

    this.setProgress({
      currentFolder: currentRelativePath ? normalizePath(currentRelativePath) : ROOT_DISCOVERY_LABEL
    });

    const entries = await fs
      .readdir(currentAbsolutePath, { withFileTypes: true })
      .catch((error: unknown) => {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

    if (!entries) {
      return;
    }

    const childDirectories: Array<{ absolutePath: string; relativePath: string }> = [];
    let hasDirectImages = false;

    for (const entry of entries) {
      const relativeEntryPath = currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name;
      if (isHiddenPath(relativeEntryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (this.isManagedGalleryPath(relativeEntryPath) || matchesExcludedFolder(relativeEntryPath, excludedFolderRules)) {
          continue;
        }

        childDirectories.push({
          absolutePath: path.join(currentAbsolutePath, entry.name),
          relativePath: relativeEntryPath
        });
        continue;
      }

      if (currentRelativePath && entry.isFile() && isSupportedMediaFile(entry.name)) {
        hasDirectImages = true;
      }
    }

    if (currentRelativePath && hasDirectImages) {
      const normalizedRelativePath = normalizePath(currentRelativePath);
      this.setProgress({
        discoveredFolders: this.progress.discoveredFolders + 1,
        currentFolder: normalizedRelativePath
      });
      await onSourceFolder({
        absolutePath: currentAbsolutePath,
        relativePath: normalizedRelativePath
      });
    }

    for (const childDirectory of childDirectories) {
      if (!treatStoriesAsFolders && currentRelativePath && hasDirectImages && isStoriesFolderName(path.basename(childDirectory.relativePath))) {
        continue;
      }

      await this.walkMediaSourceFolders(
        childDirectory.absolutePath,
        onSourceFolder,
        childDirectory.relativePath,
        treatStoriesAsFolders,
        excludedFolderRules
      );
    }
  }

  private async clearIndexedFolder(sourceFolderPath: string, existingFolders: FolderRecord[]): Promise<SourceFolderScanResult> {
    const existingFolder = existingFolders.find(
      (folder) => normalizePath(folder.folder_path) === normalizePath(sourceFolderPath)
    );
    const removedFiles = existingFolder ? await imageRepository.markAllDeletedByFolder(existingFolder.id) : 0;

    if (existingFolder) {
      await folderRepository.setAvatar(existingFolder.id, null, 'auto');
    }

    await folderScanStateRepository.delete(sourceFolderPath);

    return {
      folder: existingFolder ?? null,
      sourceFolderPath,
      discoveredDirectImages: false,
      wroteFolder: false,
      scannedFiles: 0,
      newFiles: 0,
      updatedFiles: 0,
      removedFiles,
      unchangedFiles: 0,
      refreshedUnchangedRows: 0,
      skippedUnchangedRows: 0,
      usedFolderShortcut: false
    };
  }

  private async scanSourceFolder(
    sourceFolder: SourceFolderCandidate,
    existingFolders: FolderRecord[],
    usedSlugs: Set<string>,
    folderScanStates: Map<string, FolderScanStateRecord>,
    derivativeJobs: Map<string, DerivativeJob>,
    errors: ScanErrorCollector,
    options: FullScanOptions,
    context: ImageProcessingContext
  ): Promise<SourceFolderScanResult> {
    const sourceFolderPath = normalizePath(sourceFolder.relativePath);
    const folderStartedAt = performance.now();
    const entries = await fs
      .readdir(sourceFolder.absolutePath, { withFileTypes: true })
      .catch((error: unknown) => {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

    if (!entries) {
      return await this.clearIndexedFolder(sourceFolderPath, existingFolders);
    }

    const imageFiles = entries.filter(
      (entry) => entry.isFile() && isSupportedMediaFile(entry.name) && !entry.name.startsWith('.')
    );

    if (imageFiles.length === 0) {
      return await this.clearIndexedFolder(sourceFolderPath, existingFolders);
    }

    this.setProgress({
      currentFolder: sourceFolderPath,
      discoveredImages: this.progress.discoveredImages + imageFiles.length
    });

    const statResult = await this.statIndexedFiles(
      imageFiles.map((entry) => {
        const absolutePath = path.join(sourceFolder.absolutePath, entry.name);
        return {
          absolutePath,
          relativePath: getRelativeGalleryPath(appConfig.galleryRoot, absolutePath)
        };
      }),
      errors
    );

    const result = await this.scanIndexedFolderFiles({
      folderPath: sourceFolderPath,
      scannedFileCount: imageFiles.length,
      activeRelativePaths: statResult.activeRelativePaths,
      discoveredFiles: statResult.discoveredFiles,
      existingFolders,
      usedSlugs,
      folderScanStates,
      derivativeJobs,
      errors,
      options,
      context,
      logLabel: 'App folder indexed',
      folderHadErrors: statResult.folderHadErrors
    });

    log.info(
      joinLogParts([
        'App folder indexed',
        sourceFolderPath,
        formatStep('scanned', imageFiles.length),
        formatStep('new', result.newFiles),
        formatStep('updated', result.updatedFiles),
        formatStep('removed', result.removedFiles),
        formatStep('unchanged', result.unchangedFiles),
        formatStep('duration', formatDuration(elapsedMilliseconds(folderStartedAt)))
      ])
    );

    return result;
  }

  private async statIndexedFiles(files: IndexedFileReference[], errors: ScanErrorCollector): Promise<StatIndexedFilesResult> {
    const activeRelativePaths: string[] = [];
    const discoveredFiles: IndexedFileCandidate[] = [];
    let folderHadErrors = false;

    const statFile = async (file: IndexedFileReference) => {
      activeRelativePaths.push(file.relativePath);

      try {
        const stats = await fs.stat(file.absolutePath);
        discoveredFiles.push({
          absolutePath: file.absolutePath,
          relativePath: file.relativePath,
          stats
        });
      } catch (error) {
        folderHadErrors = true;
        const message = error instanceof Error ? error.message : String(error);
        const detail = formatScanError(file.relativePath, message, {
          sourcePath: file.absolutePath
        });
        await errors.add(detail);
        this.setProgress({
          processedImages: this.progress.processedImages + 1
        });
        log.error(joinLogParts(['Failed to stat media during discovery', formatStep('file', file.relativePath), message]));

        if (appConfig.scanMediaErrorMode === 'fail') {
          throw new Error(detail);
        }
      }
    };

    if (appConfig.scanMediaErrorMode === 'fail') {
      for (const file of files) {
        await statFile(file);
      }
    } else {
      await Promise.all(files.map((file) => discoveryLimit(() => statFile(file))));
    }

    return {
      activeRelativePaths,
      discoveredFiles,
      folderHadErrors
    };
  }

  private async collectRecursiveMediaFiles(
    currentAbsolutePath: string,
    currentRelativePath: string,
    excludedFolderRules: string[]
  ): Promise<IndexedFileReference[]> {
    if (matchesExcludedFolder(currentRelativePath, excludedFolderRules)) {
      return [];
    }

    const entries = await fs
      .readdir(currentAbsolutePath, { withFileTypes: true })
      .catch((error: unknown) => {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

    if (!entries) {
      return [];
    }

    const files: IndexedFileReference[] = [];

    for (const entry of entries) {
      const relativeEntryPath = normalizePath(`${currentRelativePath}/${entry.name}`);
      if (isHiddenPath(relativeEntryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (this.isManagedGalleryPath(relativeEntryPath) || matchesExcludedFolder(relativeEntryPath, excludedFolderRules)) {
          continue;
        }

        files.push(...await this.collectRecursiveMediaFiles(path.join(currentAbsolutePath, entry.name), relativeEntryPath, excludedFolderRules));
        continue;
      }

      if (entry.isFile() && isSupportedMediaFile(entry.name)) {
        files.push({
          absolutePath: path.join(currentAbsolutePath, entry.name),
          relativePath: relativeEntryPath
        });
      }
    }

    return files;
  }

  private async scanStoryFoldersForOwnerFolder(
    ownerFolder: FolderRecord,
    sourceFolder: SourceFolderCandidate,
    existingFolders: FolderRecord[],
    usedSlugs: Set<string>,
    folderScanStates: Map<string, FolderScanStateRecord>,
    derivativeJobs: Map<string, DerivativeJob>,
    errors: ScanErrorCollector,
    options: FullScanOptions,
    context: ImageProcessingContext,
    excludedFolderRules: string[]
  ): Promise<SourceFolderScanResult[]> {
    const ownerEntries = await fs
      .readdir(sourceFolder.absolutePath, { withFileTypes: true })
      .catch((error: unknown) => {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

    if (!ownerEntries) {
      return [];
    }

    const storiesDirectory = ownerEntries.find((entry) => {
      if (!entry.isDirectory()) {
        return false;
      }

      const relativeEntryPath = normalizePath(`${sourceFolder.relativePath}/${entry.name}`);
      return (
        !isHiddenPath(relativeEntryPath) &&
        !this.isManagedGalleryPath(relativeEntryPath) &&
        !matchesExcludedFolder(relativeEntryPath, excludedFolderRules) &&
        isStoriesFolderName(entry.name)
      );
    });

    if (!storiesDirectory) {
      return [];
    }

    const storiesAbsolutePath = path.join(sourceFolder.absolutePath, storiesDirectory.name);
    const storiesRelativePath = normalizePath(`${sourceFolder.relativePath}/${storiesDirectory.name}`);
    const storiesEntries = await fs
      .readdir(storiesAbsolutePath, { withFileTypes: true })
      .catch((error: unknown) => {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

    if (!storiesEntries) {
      return [];
    }

    const storyResults: SourceFolderScanResult[] = [];
    const directStoryFiles = storiesEntries
      .filter((entry) => entry.isFile() && isSupportedMediaFile(entry.name) && !entry.name.startsWith('.'))
      .map((entry) => ({
        absolutePath: path.join(storiesAbsolutePath, entry.name),
        relativePath: normalizePath(`${storiesRelativePath}/${entry.name}`)
      }));

    if (directStoryFiles.length > 0) {
      const startedAt = performance.now();
      this.setProgress({
        currentFolder: storiesRelativePath,
        discoveredImages: this.progress.discoveredImages + directStoryFiles.length
      });
      const statResult = await this.statIndexedFiles(directStoryFiles, errors);
      const result = await this.scanIndexedFolderFiles({
        folderPath: storiesRelativePath,
        scannedFileCount: directStoryFiles.length,
        activeRelativePaths: statResult.activeRelativePaths,
        discoveredFiles: statResult.discoveredFiles,
        existingFolders,
        usedSlugs,
        folderScanStates,
        derivativeJobs,
        errors,
        options,
        context,
        logLabel: 'Story root indexed',
        role: 'story_root',
        storyOwnerFolderId: ownerFolder.id,
        folderHadErrors: statResult.folderHadErrors
      });

      log.info(
        joinLogParts([
          'Story root indexed',
          storiesRelativePath,
          formatStep('scanned', directStoryFiles.length),
          formatStep('new', result.newFiles),
          formatStep('updated', result.updatedFiles),
          formatStep('removed', result.removedFiles),
          formatStep('unchanged', result.unchangedFiles),
          formatStep('duration', formatDuration(elapsedMilliseconds(startedAt)))
        ])
      );

      storyResults.push(result);
    }

    for (const entry of storiesEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const capsuleRelativePath = normalizePath(`${storiesRelativePath}/${entry.name}`);
      if (
        isHiddenPath(capsuleRelativePath) ||
        this.isManagedGalleryPath(capsuleRelativePath) ||
        matchesExcludedFolder(capsuleRelativePath, excludedFolderRules)
      ) {
        continue;
      }

      const startedAt = performance.now();
      const nestedFiles = await this.collectRecursiveMediaFiles(
        path.join(storiesAbsolutePath, entry.name),
        capsuleRelativePath,
        excludedFolderRules
      );
      if (nestedFiles.length === 0) {
        continue;
      }

      this.setProgress({
        currentFolder: capsuleRelativePath,
        discoveredImages: this.progress.discoveredImages + nestedFiles.length
      });
      const statResult = await this.statIndexedFiles(nestedFiles, errors);
      const result = await this.scanIndexedFolderFiles({
        folderPath: capsuleRelativePath,
        scannedFileCount: nestedFiles.length,
        activeRelativePaths: statResult.activeRelativePaths,
        discoveredFiles: statResult.discoveredFiles,
        existingFolders,
        usedSlugs,
        folderScanStates,
        derivativeJobs,
        errors,
        options,
        context,
        logLabel: 'Story capsule indexed',
        role: 'story_capsule',
        storyOwnerFolderId: ownerFolder.id,
        folderHadErrors: statResult.folderHadErrors
      });

      log.info(
        joinLogParts([
          'Story capsule indexed',
          capsuleRelativePath,
          formatStep('scanned', nestedFiles.length),
          formatStep('new', result.newFiles),
          formatStep('updated', result.updatedFiles),
          formatStep('removed', result.removedFiles),
          formatStep('unchanged', result.unchangedFiles),
          formatStep('duration', formatDuration(elapsedMilliseconds(startedAt)))
        ])
      );

      storyResults.push(result);
    }

    return storyResults;
  }

  private async scanIndexedFolderFiles({
    folderPath,
    scannedFileCount,
    activeRelativePaths,
    discoveredFiles,
    existingFolders,
    usedSlugs,
    folderScanStates,
    derivativeJobs,
    errors,
    options,
    context,
    role = 'normal',
    storyOwnerFolderId = null,
    folderHadErrors = false
  }: IndexedFolderScanOptions): Promise<SourceFolderScanResult> {
    const normalizedFolderPath = normalizePath(folderPath);

    if (discoveredFiles.length === 0) {
      if (activeRelativePaths.length > 0) {
        const resolvedFolder = await this.resolveFolder(existingFolders, usedSlugs, normalizedFolderPath, {
          role,
          storyOwnerFolderId
        });

        return {
          folder: resolvedFolder.folder,
          sourceFolderPath: normalizedFolderPath,
          discoveredDirectImages: true,
          wroteFolder: resolvedFolder.wroteFolder,
          scannedFiles: scannedFileCount,
          newFiles: 0,
          updatedFiles: 0,
          removedFiles: 0,
          unchangedFiles: 0,
          refreshedUnchangedRows: 0,
          skippedUnchangedRows: 0,
          usedFolderShortcut: false
        };
      }

      return await this.clearIndexedFolder(normalizedFolderPath, existingFolders);
    }

    const resolvedFolder = await this.resolveFolder(existingFolders, usedSlugs, normalizedFolderPath, {
      role,
      storyOwnerFolderId
    });
    const folder = resolvedFolder.folder;
    let unchangedFiles = 0;
    let newFiles = 0;
    let updatedFiles = 0;
    let refreshedUnchangedRows = 0;
    let skippedUnchangedRows = 0;
    let usedFolderShortcut = false;

    const folderSignature = createFolderScanSignature(
      discoveredFiles.map((file) => ({
        relativePath: file.relativePath,
        fileSize: file.stats.size,
        mtimeMs: file.stats.mtimeMs
      }))
    );
    const storedFolderState = folderScanStates.get(normalizedFolderPath);
    const hasCompleteTakenAtMetadata = (await imageRepository.countMissingTimestampMetadataByFolder(folder.id)) === 0;
    const hasCompletePlaybackStrategyMetadata = (await imageRepository.countMissingPlaybackStrategyByFolder(folder.id)) === 0;
    const countByFolder = await imageRepository.countByFolder(folder.id);
    const allImagesMatch = await Promise.all(
      discoveredFiles.map(async (file) => {
        const existingImage = await imageRepository.getByRelativePath(file.relativePath);
        return existingImage?.folder_id === folder.id && existingImage?.is_deleted === 0;
      })
    );
    const hasMatchingIndexedFiles =
      discoveredFiles.length > 0 &&
      hasCompleteTakenAtMetadata &&
      hasCompletePlaybackStrategyMetadata &&
      countByFolder === discoveredFiles.length &&
      allImagesMatch.every(Boolean);

    if (
      !folderHadErrors &&
      shouldSkipFolderBySignature({
        currentSignature: folderSignature.signature,
        galleryRootChanged: context.galleryRootChanged,
        hasStoredGalleryRoot: context.hasStoredGalleryRoot,
        hasMatchingIndexedFiles,
        repairUnchangedDerivatives: options.repairUnchangedDerivatives,
        storedSignature: storedFolderState?.signature ?? null
      })
    ) {
      usedFolderShortcut = true;
      this.setProgress({
        processedImages: this.progress.processedImages + discoveredFiles.length
      });

      return {
        folder,
        sourceFolderPath: normalizedFolderPath,
        discoveredDirectImages: true,
        wroteFolder: resolvedFolder.wroteFolder,
        scannedFiles: scannedFileCount,
        newFiles: 0,
        updatedFiles: 0,
        removedFiles: 0,
        unchangedFiles: discoveredFiles.length,
        refreshedUnchangedRows: 0,
        skippedUnchangedRows: discoveredFiles.length,
        usedFolderShortcut
      };
    }

    const scanFile = async (file: IndexedFileCandidate) => {
      try {
        const result = await this.processImageFile(folder, file, options, context);

        if (result.status === 'new') {
          newFiles += 1;
        }

        if (result.status === 'updated') {
          updatedFiles += 1;
        }

        if (result.status === 'unchanged') {
          unchangedFiles += 1;
          if (result.refreshedIndexedRow) {
            refreshedUnchangedRows += 1;
          } else {
            skippedUnchangedRows += 1;
          }
        }

        if (result.derivativeJob) {
          this.queueDerivativeJob(derivativeJobs, result.derivativeJob);
        }
      } catch (error) {
        folderHadErrors = true;
        const message = error instanceof Error ? error.message : String(error);
        const detail = formatScanError(file.relativePath, message, {
          sourcePath: file.absolutePath
        });
        await errors.add(detail);
        log.error(joinLogParts(['Failed to index media', formatStep('file', file.relativePath), message]));

        if (appConfig.scanMediaErrorMode === 'fail') {
          throw new Error(detail);
        }
      } finally {
        this.setProgress({
          processedImages: this.progress.processedImages + 1
        });
      }
    };

    if (appConfig.scanMediaErrorMode === 'fail') {
      for (const file of discoveredFiles) {
        await scanFile(file);
      }
    } else {
      await Promise.all(discoveredFiles.map((file) => discoveryLimit(() => scanFile(file))));
    }

    const removedFiles = await imageRepository.markFolderImagesDeleted(folder.id, activeRelativePaths);
    await folderRepository.syncAvatarSelection(folder.id);
    await folderRepository.updateCounts(folder.id);

    if (!folderHadErrors) {
      await folderScanStateRepository.upsert({
        folderPath: normalizedFolderPath,
        signature: folderSignature.signature,
        fileCount: folderSignature.fileCount,
        maxMtimeMs: folderSignature.maxMtimeMs,
        totalSize: folderSignature.totalSize
      });
      folderScanStates.set(normalizedFolderPath, {
        folder_path: normalizedFolderPath,
        signature: folderSignature.signature,
        file_count: folderSignature.fileCount,
        max_mtime_ms: folderSignature.maxMtimeMs,
        total_size: folderSignature.totalSize,
        updated_at: new Date().toISOString()
      });
    }

    return {
      folder,
      sourceFolderPath: normalizedFolderPath,
      discoveredDirectImages: true,
      wroteFolder: resolvedFolder.wroteFolder,
      scannedFiles: scannedFileCount,
      newFiles,
      updatedFiles,
      removedFiles,
      unchangedFiles,
      refreshedUnchangedRows,
      skippedUnchangedRows,
      usedFolderShortcut
    };
  }

  private async performLibraryRebuild(reason: string, options: FullScanOptions): Promise<ScanSummary> {
    const storageState = storageService.refreshAvailability();
    if (!storageState.libraryAvailable) {
      throw new Error(storageState.reason ?? 'Configured library storage is unavailable');
    }

    log.info(
      joinLogParts([
        'Rebuild library index',
        formatStep('reason', reason),
        formatStep('root', normalizePath(appConfig.galleryRoot))
      ])
    );

    const rebuildDerivativeReuseIndex = this.createRebuildDerivativeReuseIndex(await imageRepository.listActive());
    await maintenanceRepository.resetLibraryIndex();
    await appSettingsRepository.remove(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);

    const summary = await this.performFullScan(reason, options, {
      rebuildDerivativeReuseIndex
    });
    if (summary.status !== 'failed' && summary.status !== 'skipped_unavailable') {
      await this.clearLibraryRebuildRequirement();
    }

    return summary;
  }

  private async performThumbnailRebuild(reason: string): Promise<ScanSummary> {
    if (await this.isLibraryRebuildRequired()) {
      throw new Error(LIBRARY_REBUILD_REQUIRED_MESSAGE);
    }

    const runId = await scanRunRepository.start();
    const summary = createEmptySummary();
    const errors = new ScanErrorCollector(runId, reason);
    let derivativeSummary: DerivativeProcessingSummary = {
      durationMs: 0,
      generatedPreviews: 0,
      generatedThumbnails: 0,
      queuedJobs: 0
    };
    const rebuildStartedAt = performance.now();

    if (!storageService.refreshAvailability().libraryAvailable) {
      return this.finishUnavailableRun(runId, reason);
    }

    this.beginProgress(reason, runId);
    log.info(
      joinLogParts([
        'Rebuild thumbnails',
        formatStep('reason', reason),
        formatStep('root', normalizePath(appConfig.galleryRoot)),
        formatStep('media-errors', appConfig.scanMediaErrorMode)
      ])
    );

    try {
      const indexedImages = await imageRepository.listActive();
      const indexedFolders = new Set(
        indexedImages
          .map((image) => getSourceFolderPathFromRelativePath(image.relative_path))
          .filter((folderPath): folderPath is string => Boolean(folderPath))
      );
      const derivativeJobs: DerivativeJob[] = indexedImages.map((image) => ({
        absolutePath: resolveOriginalPath(image.relative_path),
        relativePath: image.relative_path,
        thumbnailPath: image.thumbnail_path,
        previewPath: image.preview_path,
        force: true,
        kind: 'thumbnail'
      }));

      summary.scanned_files = indexedImages.length;
      this.setProgress({
        discoveredFolders: indexedFolders.size,
        processedFolders: indexedFolders.size,
        discoveredImages: indexedImages.length,
        processedImages: indexedImages.length,
        queuedDerivativeJobs: 0,
        processedDerivativeJobs: 0,
        generatedThumbnails: 0,
        generatedPreviews: 0,
        currentOperation: 'discovering_media',
        currentFile: null,
        currentPhaseMessage: getDiscoveryPhaseMessage(reason),
        currentFolder: null
      });

      await this.clearThumbnailCache();
      derivativeSummary = await this.processDerivativeJobs(derivativeJobs, errors);
    } catch (error) {
      summary.status = 'failed';
      summary.error_text = error instanceof Error ? error.message : String(error);
      log.error('Thumbnail rebuild failed', summary.error_text);
    }

    await this.applyScanErrors(summary, errors);

    await this.finishRun(runId, summary);
    log.table(
      `Finished thumbnail rebuild (${reason})`,
      [
        ['Status', summary.status],
        ['Indexed media', summary.scanned_files],
        ['Thumbnails', derivativeSummary.generatedThumbnails],
        ['Previews', derivativeSummary.generatedPreviews],
        ['Duration', formatDuration(elapsedMilliseconds(rebuildStartedAt))]
      ],
      summary.status === 'completed' ? 'success' : summary.status === 'completed_with_errors' ? 'warning' : 'error'
    );
    await this.finishProgress();

    return summary;
  }

  private async performFullScan(
    reason: string,
    options: FullScanOptions,
    contextOptions: FullScanContextOptions = {}
  ): Promise<ScanSummary> {
    const runId = await scanRunRepository.start();
    const summary = createEmptySummary();
    const errors = new ScanErrorCollector(runId, reason);
    const derivativeJobs = new Map<string, DerivativeJob>();
    const metrics: FullScanMetrics = {
      folderShortcutHits: 0,
      folderShortcutImagesSkipped: 0,
      folderShortcutMisses: 0,
      folderWritesCommitted: 0,
      folderWritesSkipped: 0,
      unchangedFiles: 0,
      unchangedFilesQueuedForDerivativeVerification: 0,
      unchangedFilesSkippedDerivativeVerification: 0,
      unchangedRowsRefreshed: 0,
      unchangedRowsSkippedRefresh: 0,
      discoveryDurationMs: 0,
      derivativeJobsQueued: 0,
      removedFolderStateRows: 0
    };
    let derivativeSummary: DerivativeProcessingSummary = {
      durationMs: 0,
      generatedPreviews: 0,
      generatedThumbnails: 0,
      queuedJobs: 0
    };
    const scanStartedAt = performance.now();
    const currentGalleryRoot = normalizePath(appConfig.galleryRoot);
    const storedGalleryRoot = await appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
    const normalizedStoredGalleryRoot = storedGalleryRoot ? normalizePath(storedGalleryRoot) : null;
    const hasStoredGalleryRoot = normalizedStoredGalleryRoot !== null;
    const galleryRootChanged = normalizedStoredGalleryRoot !== currentGalleryRoot;
    const avifMetadataRepairPending = await this.isAvifMetadataRepairPending();
    const imageProcessingContext: ImageProcessingContext = {
      galleryRootChanged,
      hasStoredGalleryRoot,
      avifMetadataRepairPending,
      moveReconciliationEnabled: false,
      claimedMoveImageIds: new Set<number>(),
      rebuildDerivativeReuseIndex: contextOptions.rebuildDerivativeReuseIndex
    };
    const treatStoriesAsFolders = await this.shouldTreatStoriesAsFolders();
    const excludedFolderRules = await this.getEffectiveExcludedFolderRules();

    if (!storageService.refreshAvailability().libraryAvailable) {
      return this.finishUnavailableRun(runId, reason);
    }

    this.beginProgress(reason, runId);
    log.info(
      joinLogParts([
        `Starting full scan (${reason})`,
        formatStep('repair-derivatives', formatToggle(options.repairUnchangedDerivatives)),
        formatStep('storage-migration', formatToggle(options.allowDerivativeMigration)),
        formatStep('root-changed', formatToggle(galleryRootChanged)),
        formatStep('stored-root', formatToggle(hasStoredGalleryRoot)),
        formatStep('avif-repair', formatToggle(avifMetadataRepairPending)),
        formatStep('media-errors', appConfig.scanMediaErrorMode),
        formatStep('stories-as-folders', formatToggle(treatStoriesAsFolders)),
        excludedFolderRules.length > 0 ? formatStep('excluded-folders', excludedFolderRules.join(',')) : null,
        appConfig.managedGalleryRelativeIgnores.length > 0
          ? formatStep('ignored-managed-paths', appConfig.managedGalleryRelativeIgnores.join(','))
          : null,
        formatStep('folder-concurrency', appConfig.scanFolderConcurrency),
        formatStep('discovery-concurrency', appConfig.scanDiscoveryConcurrency),
        formatStep('derivative-concurrency', appConfig.scanDerivativeConcurrency)
      ])
    );

    try {
      const migrationPending = !(await derivativeMigrationService.isMigrationComplete());
      const requiresDerivativeMigration = options.allowDerivativeMigration && migrationPending;
      if (requiresDerivativeMigration) {
        const imageCountForMigration = await imageRepository.countAll();
        this.setProgress({
          phase: 'migration',
          currentOperation: imageCountForMigration > 0 ? 'checking_derivatives' : null,
          currentFile: null,
          currentPhaseMessage: getMigrationPhaseMessage(),
          currentFolder: null,
          discoveredFolders: 0,
          processedFolders: 0,
          discoveredImages: 0,
          processedImages: 0,
          queuedDerivativeJobs: 0,
          processedDerivativeJobs: 0,
          generatedThumbnails: 0,
          generatedPreviews: 0,
          repairedDerivativeFiles: 0,
          backfilledAssetKeys: 0
        });
        this.updateMigrationProgress({
          totalRows: imageCountForMigration,
          processedRows: 0,
          movedFiles: 0,
          missingFiles: 0,
          repairedFiles: 0,
          backfilledAssetKeys: 0,
          currentOperation: imageCountForMigration > 0 ? 'checking_derivatives' : null,
          currentFile: null,
          currentPhaseMessage: getMigrationPhaseMessage()
        });
        this.logProgress('phase');
      }

      let migrationSummary: DerivativeMigrationSummary = {
        totalRows: 0,
        processedRows: 0,
        movedFiles: 0,
        missingFiles: 0,
        repairedFiles: 0,
        backfilledAssetKeys: 0,
        currentOperation: null,
        currentFile: null,
        currentPhaseMessage: getMigrationPhaseMessage(),
        migratedRows: 0,
        repairedRows: 0,
        repairErrors: 0,
        complete: await derivativeMigrationService.isMigrationComplete()
      };
      if (requiresDerivativeMigration) {
        migrationSummary = await derivativeMigrationService.ensureMigrated({
          onProgress: (progress) => {
            this.updateMigrationProgress(progress);
          },
          onError: async (error) => {
            await errors.add(formatScanError(error.currentFile, error.message, {
              sourcePath: error.sourcePath
            }));
          }
        });
      }
      if (requiresDerivativeMigration) {
        this.updateMigrationProgress(migrationSummary);
        this.setProgress({
          phase: 'discovery',
          currentOperation: 'discovering_media',
          currentFile: null,
          currentPhaseMessage: getDiscoveryPhaseMessage(reason),
          currentFolder: null
        });
        this.logProgress('phase');
      }
      imageProcessingContext.moveReconciliationEnabled =
        !galleryRootChanged && migrationSummary.complete && (await derivativeMigrationService.isMigrationComplete());

      const existingFolders = await folderRepository.getAll();
      if (galleryRootChanged && normalizedStoredGalleryRoot && existingFolders.length > 0) {
        await this.markLibraryRebuildRequired(normalizedStoredGalleryRoot);
        log.info(
          joinLogParts([
            'Gallery root changed',
            formatStep('previous', normalizedStoredGalleryRoot),
            formatStep('current', currentGalleryRoot)
          ])
        );
      }
      const folderScanStates = new Map(
        (await folderScanStateRepository.getAll()).map((state) => [normalizePath(state.folder_path), state])
      );
      const usedSlugs = new Set(existingFolders.map((folder) => folder.slug));
      const activeFolderPaths = new Set<string>();
      const discoveredFolderIds = new Set<number>();
      const discoveryStartedAt = performance.now();
      let discoveredSourceFolders = 0;

      const applyScanResult = (result: SourceFolderScanResult) => {
        summary.scanned_files += result.scannedFiles;
        summary.new_files += result.newFiles;
        summary.updated_files += result.updatedFiles;
        summary.removed_files += result.removedFiles;
        metrics.unchangedFiles += result.unchangedFiles;
        metrics.unchangedRowsRefreshed += result.refreshedUnchangedRows;
        metrics.unchangedRowsSkippedRefresh += result.skippedUnchangedRows;

        if (result.discoveredDirectImages && result.folder) {
          activeFolderPaths.add(result.sourceFolderPath);
          discoveredFolderIds.add(result.folder.id);
          if (result.wroteFolder) {
            metrics.folderWritesCommitted += 1;
          } else {
            metrics.folderWritesSkipped += 1;
          }
        }

        if (result.usedFolderShortcut) {
          metrics.folderShortcutHits += 1;
          metrics.folderShortcutImagesSkipped += result.unchangedFiles;
          metrics.unchangedFilesSkippedDerivativeVerification += result.unchangedFiles;

          log.info(
            joinLogParts([
              'Folder shortcut',
              result.sourceFolderPath,
              formatStep('files', result.unchangedFiles)
            ])
          );
        } else {
          metrics.folderShortcutMisses += 1;
          if (options.repairUnchangedDerivatives) {
            metrics.unchangedFilesQueuedForDerivativeVerification += result.unchangedFiles;
          } else {
            metrics.unchangedFilesSkippedDerivativeVerification += result.unchangedFiles;
          }
        }
      };

      // Phase 1: Discover all source folders (filesystem traversal only, no DB)
      const sourceFolderCandidates: SourceFolderCandidate[] = [];
      await this.walkMediaSourceFolders(appConfig.galleryRoot, async (sourceFolder) => {
        discoveredSourceFolders += 1;
        sourceFolderCandidates.push(sourceFolder);
      }, null, treatStoriesAsFolders, excludedFolderRules);

      // Phase 2: Process folders with bounded concurrency
      await Promise.all(sourceFolderCandidates.map((sourceFolder) => folderLimit(async () => {
        const result = await this.scanSourceFolder(
          sourceFolder,
          existingFolders,
          usedSlugs,
          folderScanStates,
          derivativeJobs,
          errors,
          options,
          imageProcessingContext
        );

        applyScanResult(result);

        if (!treatStoriesAsFolders && result.folder && result.discoveredDirectImages) {
          const storyResults = await this.scanStoryFoldersForOwnerFolder(
            result.folder,
            sourceFolder,
            existingFolders,
            usedSlugs,
            folderScanStates,
            derivativeJobs,
            errors,
            options,
            imageProcessingContext,
            excludedFolderRules
          );

          for (const storyResult of storyResults) {
            applyScanResult(storyResult);
          }
        }

        this.setProgress({
          processedFolders: this.progress.processedFolders + 1
        });
        this.logProgress('folder');
      })));

      for (const folder of existingFolders) {
        if (!discoveredFolderIds.has(folder.id)) {
          summary.removed_files += await imageRepository.markAllDeletedByFolder(folder.id);
          await folderRepository.setAvatar(folder.id, null, 'auto');
        }
      }

      metrics.removedFolderStateRows = await folderScanStateRepository.deleteMissing([...activeFolderPaths]);

      metrics.discoveryDurationMs = elapsedMilliseconds(discoveryStartedAt);
      metrics.derivativeJobsQueued = derivativeJobs.size;

      log.table('Discovery complete', [
        ['Folders', discoveredSourceFolders],
        ['Files', summary.scanned_files],
        ['New', summary.new_files],
        ['Updated', summary.updated_files],
        ['Removed', summary.removed_files],
        ['Shortcuts', metrics.folderShortcutHits],
        ['Queued derivatives', metrics.derivativeJobsQueued],
        ['Duration', formatDuration(metrics.discoveryDurationMs)]
      ]);

      derivativeSummary = await this.processDerivativeJobs([...derivativeJobs.values()], errors);

      if (summary.status !== 'failed' && !errors.hasErrors && (await derivativeMigrationService.isMigrationComplete())) {
        await derivativeMigrationService.cleanupStaleDerivatives();
      }
    } catch (error) {
      summary.status = 'failed';
      summary.error_text = error instanceof Error ? error.message : String(error);
      log.error('Full scan failed', summary.error_text);
    }

    await this.applyScanErrors(summary, errors);

    if (summary.status !== 'failed') {
      await appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, currentGalleryRoot);
    }

    if (summary.status === 'completed' && avifMetadataRepairPending) {
      await this.markAvifMetadataRepairComplete();
    }

    await this.finishRun(runId, summary);
    log.table(`Finished full scan (${reason})`, [
      ['Status', summary.status],
      ['Files', summary.scanned_files],
      ['New', summary.new_files],
      ['Updated', summary.updated_files],
      ['Removed', summary.removed_files],
      ['Thumbnails', derivativeSummary.generatedThumbnails],
      ['Previews', derivativeSummary.generatedPreviews],
      ['Duration', formatDuration(elapsedMilliseconds(scanStartedAt))]
    ], summary.status === 'completed' ? 'success' : summary.status === 'completed_with_errors' ? 'warning' : 'error');
    await this.finishProgress();

    return summary;
  }

  private async performIncrementalScan(relativePaths: string[], reason: string): Promise<ScanSummary> {
    const runId = await scanRunRepository.start();
    const summary = createEmptySummary();
    const errors = new ScanErrorCollector(runId, reason);
    const derivativeJobs = new Map<string, DerivativeJob>();
    let fallbackReason: string | null = null;

    if (!storageService.refreshAvailability().libraryAvailable) {
      return this.finishUnavailableRun(runId, reason);
    }

    const normalizedPaths = [...new Set(relativePaths.map((value) => normalizePath(value)).filter(Boolean))];
    const impactedSourceFolders = new Set<string>();
    const treatStoriesAsFolders = await this.shouldTreatStoriesAsFolders();
    const excludedFolderRules = await this.getEffectiveExcludedFolderRules();

    for (const relativePath of normalizedPaths) {
      if (isHiddenPath(relativePath)) {
        continue;
      }

      if (this.isManagedGalleryPath(relativePath)) {
        continue;
      }

      if (!isSupportedMediaFile(path.basename(relativePath))) {
        continue;
      }

      const sourceFolderPath = getSourceFolderPathFromRelativePath(relativePath);
      const exclusionTargetPath = sourceFolderPath ?? relativePath;
      if (matchesExcludedFolder(exclusionTargetPath, excludedFolderRules)) {
        continue;
      }

      if (!treatStoriesAsFolders && findReservedStoriesOwnerPath(relativePath)) {
        fallbackReason = `${reason}:fallback`;
        break;
      }

      if (!sourceFolderPath) {
        fallbackReason = `${reason}:fallback`;
        break;
      }

      impactedSourceFolders.add(sourceFolderPath);
    }

    this.beginProgress(reason, runId);
    this.setProgress({
      discoveredFolders: impactedSourceFolders.size,
      discoveredImages: 0
    });

    log.info(
      joinLogParts([
        `Starting incremental scan (${reason})`,
        formatStep('files', normalizedPaths.length),
        formatStep('source-folders', impactedSourceFolders.size),
        formatStep('media-errors', appConfig.scanMediaErrorMode)
      ])
    );

    try {
      const existingFolders = await folderRepository.getAll();
      const usedSlugs = new Set(existingFolders.map((folder) => folder.slug));
      const folderScanStates = new Map(
        (await folderScanStateRepository.getAll()).map((state) => [normalizePath(state.folder_path), state])
      );
      const imageProcessingContext: ImageProcessingContext = {
        galleryRootChanged: false,
        hasStoredGalleryRoot: (await appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY)) !== null,
        avifMetadataRepairPending: false,
        moveReconciliationEnabled: false,
        claimedMoveImageIds: new Set<number>()
      };
      const incrementalOptions = resolveFullScanOptions({
        repairUnchangedDerivatives: false,
        allowDerivativeMigration: false
      });

      for (const sourceFolderPath of impactedSourceFolders) {
        const result = await this.scanSourceFolder(
          {
            absolutePath: path.join(appConfig.galleryRoot, sourceFolderPath),
            relativePath: sourceFolderPath
          },
          existingFolders,
          usedSlugs,
          folderScanStates,
          derivativeJobs,
          errors,
          incrementalOptions,
          imageProcessingContext
        );

        summary.scanned_files += result.scannedFiles;
        summary.new_files += result.newFiles;
        summary.updated_files += result.updatedFiles;
        summary.removed_files += result.removedFiles;

        this.setProgress({
          processedFolders: this.progress.processedFolders + 1
        });
        this.logProgress('folder');
      }

      if (fallbackReason === null) {
        await this.processDerivativeJobs([...derivativeJobs.values()], errors);
      }
    } catch (error) {
      summary.status = 'failed';
      summary.error_text = error instanceof Error ? error.message : String(error);
      log.error('Incremental scan failed', summary.error_text);
    }

    await this.applyScanErrors(summary, errors);

    await this.finishRun(runId, summary);
    log.table(`Finished incremental scan (${reason})`, [
      ['Status', summary.status],
      ['Files', summary.scanned_files],
      ['New', summary.new_files],
      ['Updated', summary.updated_files],
      ['Removed', summary.removed_files]
    ], summary.status === 'completed' ? 'success' : summary.status === 'completed_with_errors' ? 'warning' : 'error');
    await this.finishProgress();

    if (fallbackReason) {
      return this.performFullScan(
        fallbackReason,
        resolveFullScanOptions({
          allowDerivativeMigration: false
        })
      );
    }

    return summary;
  }

  private queueDerivativeJob(queue: Map<string, DerivativeJob>, job: DerivativeJob): void {
    const existing = queue.get(job.relativePath);

    if (!existing) {
      queue.set(job.relativePath, job);
      return;
    }

    queue.set(job.relativePath, {
      ...job,
      force: existing.force || job.force,
      kind: existing.kind === 'all' || job.kind === 'all' ? 'all' : 'thumbnail'
    });
  }

  private async processDerivativeJobs(jobs: DerivativeJob[], errors: ScanErrorCollector): Promise<DerivativeProcessingSummary> {
    const startedAt = performance.now();
    let generatedThumbnails = 0;
    let generatedPreviews = 0;

    if (jobs.length === 0) {
      this.setProgress({
        queuedDerivativeJobs: 0,
        processedDerivativeJobs: 0,
        currentOperation: null,
        currentFile: null,
        currentPhaseMessage: getDerivativePhaseMessage(this.progress.scanReason),
        currentFolder: null
      });

      return {
        durationMs: 0,
        generatedPreviews: 0,
        generatedThumbnails: 0,
        queuedJobs: 0
      };
    }

    this.setProgress({
      phase: 'derivatives',
      queuedDerivativeJobs: jobs.length,
      processedDerivativeJobs: 0,
      currentOperation: jobs[0] ? getDerivativeOperationForJob(jobs[0]) : null,
      currentFile: jobs[0]?.relativePath ?? null,
      currentPhaseMessage: getDerivativePhaseMessage(this.progress.scanReason),
      currentFolder: jobs[0] ? getSourceFolderPathFromRelativePath(jobs[0].relativePath) : null
    });
    this.logProgress('phase');
    log.info(
      joinLogParts([
        'Starting derivative phase',
        formatStep('jobs', jobs.length),
        formatStep('concurrency', appConfig.scanDerivativeConcurrency),
        formatStep('media-errors', appConfig.scanMediaErrorMode)
      ])
    );

    const processJob = async (job: DerivativeJob) => {
      try {
        this.setProgress({
          currentOperation: getDerivativeOperationForJob(job),
          currentFile: job.relativePath,
          currentFolder: getSourceFolderPathFromRelativePath(job.relativePath)
        });

        if (job.kind === 'thumbnail') {
          const thumbnail = await generateThumbnailDerivative(job.absolutePath, job.relativePath, job.force, {
            thumbnailPath: job.thumbnailPath
          });

          if (thumbnail.generatedThumbnail) {
            generatedThumbnails += 1;
            this.setProgress({
              generatedThumbnails: this.progress.generatedThumbnails + 1
            });
          }
        } else {
          const derivatives = await generateDerivatives(job.absolutePath, job.relativePath, job.force, {
            thumbnailPath: job.thumbnailPath,
            previewPath: job.previewPath
          });

          if (derivatives.generatedThumbnail) {
            generatedThumbnails += 1;
            this.setProgress({
              generatedThumbnails: this.progress.generatedThumbnails + 1
            });
          }

          if (derivatives.generatedPreview) {
            generatedPreviews += 1;
            this.setProgress({
              generatedPreviews: this.progress.generatedPreviews + 1
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = formatScanError(job.relativePath, message, {
          sourcePath: job.absolutePath
        });
        await errors.add(detail);
        log.error(joinLogParts(['Derivative generation failed', formatStep('file', job.relativePath), message]));

        if (appConfig.scanMediaErrorMode === 'fail') {
          throw new Error(detail);
        }
      } finally {
        this.setProgress({
          processedDerivativeJobs: this.progress.processedDerivativeJobs + 1
        });
      }
    };

    if (appConfig.scanMediaErrorMode === 'fail') {
      for (const job of jobs) {
        await processJob(job);
      }
    } else {
      await Promise.all(jobs.map((job) => derivativeLimit(() => processJob(job))));
    }

    const summary = {
      durationMs: elapsedMilliseconds(startedAt),
      generatedPreviews,
      generatedThumbnails,
      queuedJobs: jobs.length
    };

    log.table('Finished derivative phase', [
      ['Jobs', summary.queuedJobs],
      ['Thumbnails', summary.generatedThumbnails],
      ['Previews', summary.generatedPreviews],
      ['Duration', formatDuration(summary.durationMs)]
    ]);

    return summary;
  }

  private async resolveFolder(
    existingFolders: FolderRecord[],
    usedSlugs: Set<string>,
    sourceFolderPath: string,
    options: ResolvedFolderOptions = {}
  ): Promise<ResolvedFolderResult> {
    const normalizedFolderPath = normalizePath(sourceFolderPath);
    const existingByFolder = existingFolders.find(
      (folder) => normalizePath(folder.folder_path) === normalizedFolderPath
    );
    const folderName = getFolderDisplayInfo(normalizedFolderPath).name;
    const role = options.role ?? 'normal';
    const storyOwnerFolderId = options.storyOwnerFolderId ?? null;

    if (existingByFolder) {
      usedSlugs.delete(existingByFolder.slug);
    }

    const slug = resolveUniqueSlug(normalizedFolderPath, usedSlugs, slugifyFolderPath);
    const saved = await folderRepository.save({
      slug,
      name: folderName,
      folderPath: normalizedFolderPath,
      role,
      storyOwnerFolderId
    });
    this.rememberFolder(existingFolders, saved.folder);
    return {
      folder: saved.folder,
      wroteFolder: saved.wrote
    };
  }

  private rememberFolder(existingFolders: FolderRecord[], folder: FolderRecord): void {
    const existingIndex = existingFolders.findIndex((entry) => entry.id === folder.id);

    if (existingIndex >= 0) {
      existingFolders[existingIndex] = folder;
      return;
    }

    existingFolders.push(folder);
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private createRebuildDerivativeReuseIndex(images: ImageRecord[]): RebuildDerivativeReuseIndex {
    const byRelativePath = new Map<string, ImageRecord>();
    const bySignature = new Map<string, ImageRecord[]>();

    for (const image of images) {
      byRelativePath.set(normalizePath(image.relative_path), image);

      const signature = createReusableDerivativeSignature(image.file_size, image.mtime_ms, image.extension);
      const signatureMatches = bySignature.get(signature) ?? [];
      signatureMatches.push(image);
      bySignature.set(signature, signatureMatches);
    }

    return {
      byRelativePath,
      bySignature,
      claimedImageIds: new Set<number>()
    };
  }

  private hasReusableDerivativeSignature(image: ImageRecord, file: IndexedFileCandidate, extension: string): boolean {
    return createReusableDerivativeSignature(image.file_size, image.mtime_ms, image.extension) ===
      createReusableDerivativeSignature(file.stats.size, file.stats.mtimeMs, extension);
  }

  private findRebuildDerivativeReuseCandidate(
    file: IndexedFileCandidate,
    extension: string,
    context: ImageProcessingContext
  ): ImageRecord | undefined {
    const index = context.rebuildDerivativeReuseIndex;
    if (!index) {
      return undefined;
    }

    const normalizedRelativePath = normalizePath(file.relativePath);
    const existingByRelativePath = index.byRelativePath.get(normalizedRelativePath);
    if (existingByRelativePath && !index.claimedImageIds.has(existingByRelativePath.id)) {
      index.claimedImageIds.add(existingByRelativePath.id);
      return existingByRelativePath;
    }

    const signature = createReusableDerivativeSignature(file.stats.size, file.stats.mtimeMs, extension);
    const candidates = (index.bySignature.get(signature) ?? [])
      .filter((candidate) => candidate.relative_path !== normalizedRelativePath && !index.claimedImageIds.has(candidate.id));

    if (candidates.length === 0) {
      return undefined;
    }

    const requestedBasename = path.basename(file.relativePath).toLowerCase();
    const basenameMatches = candidates.filter((candidate) => candidate.filename.toLowerCase() === requestedBasename);
    const selectedCandidate =
      candidates.length === 1
        ? candidates[0]
        : basenameMatches.length === 1
          ? basenameMatches[0]
          : undefined;

    if (selectedCandidate) {
      index.claimedImageIds.add(selectedCandidate.id);
    }

    return selectedCandidate;
  }

  private async findMoveCandidate(
    file: IndexedFileCandidate,
    extension: string,
    context: ImageProcessingContext
  ): Promise<ImageRecord | undefined> {
    if (!context.moveReconciliationEnabled) {
      return undefined;
    }

    const candidates = (await imageRepository
      .listMoveCandidates(file.stats.size, file.stats.mtimeMs, extension))
      .filter((candidate) => candidate.relative_path !== file.relativePath && !context.claimedMoveImageIds.has(candidate.id));

    if (candidates.length === 0) {
      return undefined;
    }

    const missingCandidates: ImageRecord[] = [];
    for (const candidate of candidates) {
      let candidatePath: string | null = null;
      try {
        candidatePath = resolveOriginalPath(candidate.relative_path);
      } catch {
        candidatePath = null;
      }

      if (!candidatePath || !(await this.pathExists(candidatePath))) {
        missingCandidates.push(candidate);
      }
    }

    if (missingCandidates.length === 0) {
      return undefined;
    }

    const requestedBasename = path.basename(file.relativePath).toLowerCase();
    const basenameMatches = missingCandidates.filter((candidate) => candidate.filename.toLowerCase() === requestedBasename);
    const selectedCandidate =
      missingCandidates.length === 1
        ? missingCandidates[0]
        : basenameMatches.length === 1
          ? basenameMatches[0]
          : undefined;

    if (selectedCandidate) {
      context.claimedMoveImageIds.add(selectedCandidate.id);
    }

    return selectedCandidate;
  }

  private async processImageFile(
    folder: FolderRecord,
    file: IndexedFileCandidate,
    options: FullScanOptions = resolveFullScanOptions(),
    context: ImageProcessingContext = {
      galleryRootChanged: false,
      hasStoredGalleryRoot: false,
      avifMetadataRepairPending: false,
      moveReconciliationEnabled: false,
      claimedMoveImageIds: new Set<number>()
    }
  ): Promise<ProcessedFileSummary> {
    const fingerprint = createFingerprint(file.relativePath, file.stats.size, file.stats.mtimeMs);
    const extension = path.extname(file.absolutePath).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const existingByPath = await imageRepository.getByRelativePath(file.relativePath);
    const moveCandidate = existingByPath ? undefined : await this.findMoveCandidate(file, extension, context);
    const rebuildDerivativeReuseCandidate = existingByPath || moveCandidate
      ? undefined
      : this.findRebuildDerivativeReuseCandidate(file, extension, context);
    const existing = existingByPath ?? moveCandidate ?? rebuildDerivativeReuseCandidate;
    const canReuseDerivativeFiles = Boolean(moveCandidate) ||
      (rebuildDerivativeReuseCandidate
        ? this.hasReusableDerivativeSignature(rebuildDerivativeReuseCandidate, file, extension)
        : false);
    const absolutePathChanged = existingByPath ? normalizePath(existingByPath.absolute_path) !== normalizePath(file.absolutePath) : false;
    const assetKey = existing?.asset_key ?? generateAssetKey();
    const thumbnailPath = existing?.thumbnail_path ?? getThumbnailPathForAssetKey(assetKey);
    const previewPath = existing?.preview_path ?? getPreviewPathForAssetKey(assetKey, mediaType);
    const needsTakenAtBackfill = existing?.taken_at === null || existing?.taken_at_source === null;
    const needsMediaBackfill = existing?.media_type !== mediaType || (mediaType === 'video' && existing?.duration_ms === null);
    const needsOrientationBackfill = mediaType === 'image' && existing?.display_orientation === null;
    const needsPlaybackStrategyBackfill = mediaType === 'video' && existing?.playback_strategy === null;
    const needsAnimatedBackfill = mediaType === 'image' && existing?.is_animated === null;
    const needsExifBackfill = mediaType === 'image' && existing?.exif_json === null;
    const needsAvifMetadataRepair = context.avifMetadataRepairPending
      && mediaType === 'image'
      && extension === '.avif'
      && existingByPath !== undefined;

    if (existingByPath && existingByPath.checksum_or_fingerprint === fingerprint) {
      const refreshedIndexedRow = shouldRefreshUnchangedImage({
        absolutePathChanged,
        galleryRootChanged: context.galleryRootChanged,
        hasStoredGalleryRoot: context.hasStoredGalleryRoot,
        isDeleted: existingByPath.is_deleted === 1
      });

      let metadataTakenAt = existingByPath.taken_at;
      let metadataDurationMs = existingByPath.duration_ms;
      let metadataWidth = existingByPath.width;
      let metadataHeight = existingByPath.height;
      let metadataDisplayOrientation = existingByPath.display_orientation;
      let metadataPlaybackStrategy = existingByPath.playback_strategy ?? 'preview';
      let metadataIsAnimated = existingByPath.is_animated === 1;
      let metadataExifJson = existingByPath.exif_json;

      if (
        needsTakenAtBackfill
        || needsMediaBackfill
        || needsOrientationBackfill
        || needsPlaybackStrategyBackfill
        || needsAnimatedBackfill
        || needsExifBackfill
        || needsAvifMetadataRepair
      ) {
        const metadata = await readMediaMetadata(file.absolutePath, mediaType, {
          fileSize: file.stats.size
        });
        metadataTakenAt = metadata.takenAt;
        metadataDurationMs = metadata.durationMs;
        metadataWidth = metadata.width;
        metadataHeight = metadata.height;
        metadataDisplayOrientation = mediaType === 'image' ? (metadata.displayOrientation ?? 1) : null;
        metadataPlaybackStrategy = metadata.playbackStrategy;
        metadataIsAnimated = metadata.isAnimated;
        metadataExifJson = mediaType === 'image'
          ? serializeImageExifData(metadata.exif ?? null, {
              storeEmptyObject: true
            })
          : null;
      }

      const shouldResetLegacyAnimatedAvifTakenAt = needsAvifMetadataRepair
        && existingByPath.taken_at_source === 'exif'
        && metadataIsAnimated
        && metadataTakenAt !== existingByPath.taken_at;

      if (
        refreshedIndexedRow
        || needsTakenAtBackfill
        || needsMediaBackfill
        || needsOrientationBackfill
        || needsPlaybackStrategyBackfill
        || needsAnimatedBackfill
        || needsExifBackfill
        || needsAvifMetadataRepair
      ) {
        const resolvedTakenAt = resolveTakenAt({
          exifTakenAt: metadataTakenAt,
          existingTakenAt: shouldResetLegacyAnimatedAvifTakenAt ? null : existingByPath.taken_at,
          existingTakenAtSource: shouldResetLegacyAnimatedAvifTakenAt ? null : existingByPath.taken_at_source,
          existingSortTimestamp: existingByPath.sort_timestamp,
          existingFirstSeenAt: existingByPath.first_seen_at,
          existingMtimeMs: existingByPath.mtime_ms,
          fileMtimeMs: file.stats.mtimeMs,
          firstSeenAt: existingByPath.first_seen_at,
          stableFallbackTimestamp: existingByPath.sort_timestamp
        });

        const image = await imageRepository.refreshIndexed({
          folderId: folder.id,
          assetKey,
          filename: path.basename(file.absolutePath),
          extension,
          relativePath: file.relativePath,
          absolutePath: file.absolutePath,
          fileSize: file.stats.size,
          width: metadataWidth,
          height: metadataHeight,
          displayOrientation: metadataDisplayOrientation,
          mediaType,
          mimeType: getMimeTypeFromExtension(extension),
          durationMs: metadataDurationMs,
          isAnimated: metadataIsAnimated,
          fingerprint,
          mtimeMs: file.stats.mtimeMs,
          takenAt: resolvedTakenAt.takenAt,
          takenAtSource: resolvedTakenAt.source,
          exifJson: mediaType === 'image' ? (metadataExifJson ?? '{}') : null,
          thumbnailPath,
          previewPath,
          playbackStrategy: metadataPlaybackStrategy
        });
        await placeResolutionService.resolveImage(image);
      } else if (existingByPath.place_id === null) {
        await placeResolutionService.resolveImage(existingByPath);
      }

      return {
        status: 'unchanged',
        derivativeJob: !appConfig.derivativeMode || appConfig.derivativeMode === 'eager'
          ? (shouldQueueDerivativeJobForStatus('unchanged', options) || needsPlaybackStrategyBackfill
            ? {
                absolutePath: file.absolutePath,
                relativePath: file.relativePath,
                thumbnailPath,
                previewPath,
                force: false,
                kind: 'all'
              }
            : null)
          : null,
        refreshedIndexedRow,
        relativePath: file.relativePath
      };
    }

    const metadata = await readMediaMetadata(file.absolutePath, mediaType, {
      fileSize: file.stats.size
    });
    const sortTimestamp = getStableSortTimestamp(
      existing
        ? {
            sortTimestamp: existing.sort_timestamp,
            firstSeenAt: existing.first_seen_at
          }
        : null,
      file.stats.mtimeMs
    );
    const firstSeenAt = existing?.first_seen_at ?? new Date().toISOString();
    const shouldResetLegacyAnimatedAvifTakenAt = context.avifMetadataRepairPending
      && mediaType === 'image'
      && extension === '.avif'
      && existing?.taken_at_source === 'exif'
      && metadata.isAnimated
      && metadata.takenAt !== existing.taken_at;
    const resolvedTakenAt = resolveTakenAt({
      exifTakenAt: metadata.takenAt,
      existingTakenAt: shouldResetLegacyAnimatedAvifTakenAt ? null : existing?.taken_at,
      existingTakenAtSource: shouldResetLegacyAnimatedAvifTakenAt ? null : existing?.taken_at_source,
      existingSortTimestamp: existing?.sort_timestamp,
      existingFirstSeenAt: existing?.first_seen_at,
      existingMtimeMs: existing?.mtime_ms,
      fileMtimeMs: file.stats.mtimeMs,
      firstSeenAt,
      stableFallbackTimestamp: sortTimestamp
    });

    const exifJson = mediaType === 'image'
      ? serializeImageExifData(metadata.exif ?? null, {
          storeEmptyObject: true
        })
      : null;

    if (moveCandidate) {
      const image = await imageRepository.reconcileMove({
        id: moveCandidate.id,
        folderId: folder.id,
        filename: path.basename(file.absolutePath),
        extension,
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        fileSize: file.stats.size,
        width: metadata.width,
        height: metadata.height,
        displayOrientation: mediaType === 'image' ? (metadata.displayOrientation ?? 1) : null,
        mediaType,
        mimeType: getMimeTypeFromExtension(extension),
        durationMs: metadata.durationMs,
        isAnimated: metadata.isAnimated,
        fingerprint,
        mtimeMs: file.stats.mtimeMs,
        takenAt: resolvedTakenAt.takenAt,
        takenAtSource: resolvedTakenAt.source,
        exifJson,
        playbackStrategy: metadata.playbackStrategy
      });
      await placeResolutionService.resolveImage(image);
    } else {
      const image = await imageRepository.upsert({
        folderId: folder.id,
        assetKey,
        filename: path.basename(file.absolutePath),
        extension,
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        fileSize: file.stats.size,
        width: metadata.width,
        height: metadata.height,
        displayOrientation: mediaType === 'image' ? (metadata.displayOrientation ?? 1) : null,
        mediaType,
        mimeType: getMimeTypeFromExtension(extension),
        durationMs: metadata.durationMs,
        isAnimated: metadata.isAnimated,
        fingerprint,
        mtimeMs: file.stats.mtimeMs,
        firstSeenAt,
        sortTimestamp,
        takenAt: resolvedTakenAt.takenAt,
        takenAtSource: resolvedTakenAt.source,
        exifJson,
        thumbnailPath,
        previewPath,
        playbackStrategy: metadata.playbackStrategy
      });
      await placeResolutionService.resolveImage(image);
    }

    return {
      status: existing ? 'updated' : 'new',
      derivativeJob: appConfig.derivativeMode === 'lazy'
        ? null
        : {
            absolutePath: file.absolutePath,
            relativePath: file.relativePath,
            thumbnailPath,
            previewPath,
            force: existing ? !canReuseDerivativeFiles : options.forceNewFileDerivatives,
            kind: 'all'
          },
      refreshedIndexedRow: false,
      relativePath: file.relativePath
    };
  }
}

export const scannerService = new ScannerService();
