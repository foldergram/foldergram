import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY,
  DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY,
  DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY,
  STALE_DERIVATIVE_GC_LAST_RUN_AT_SETTING_KEY
} from '../constants/app-setting-keys.js';
import { appConfig } from '../config/env.js';
import { appSettingsRepository, imageRepository } from '../db/repositories.js';
import type { ImageRecord } from '../types/models.js';
import { getMediaTypeFromExtension, getPreviewRelativePath, getThumbnailRelativePath } from '../utils/image-utils.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import {
  DERIVATIVE_STORAGE_LAYOUT_VERSION,
  LEGACY_DERIVATIVE_STORAGE_LAYOUT_VERSIONS,
  generateAssetKey,
  getPreviewPathForAssetKey,
  getThumbnailPathForAssetKey
} from '../utils/derivative-paths.js';
import { normalizePath, safeJoin } from '../utils/path-utils.js';
import { generateDerivatives } from './derivative-service.js';
import { log } from './log-service.js';

const MIGRATION_BATCH_SIZE = 200;
const STALE_DERIVATIVE_RETENTION_MS = 1000 * 60 * 60 * 24 * 30;
const DERIVATIVE_KEEP_FILE = '.gitkeep';
const MIGRATION_PHASE_MESSAGE = 'Upgrading legacy thumbnails and previews before indexing starts.';

export type DerivativeMigrationOperation =
  | 'checking_derivatives'
  | 'backfilling_asset_key'
  | 'moving_thumbnail'
  | 'moving_preview'
  | 'repairing_thumbnail'
  | 'repairing_preview'
  | 'regenerating_derivatives';

export interface DerivativeMigrationProgress {
  totalRows: number;
  processedRows: number;
  movedFiles: number;
  missingFiles: number;
  repairedFiles: number;
  backfilledAssetKeys: number;
  currentOperation: DerivativeMigrationOperation | null;
  currentFile: string | null;
  currentPhaseMessage: string | null;
}

interface EnsureMigratedOptions {
  onProgress?: (progress: DerivativeMigrationProgress) => void;
  onError?: (error: DerivativeMigrationRepairError) => void | Promise<void>;
}

export interface DerivativeMigrationSummary extends DerivativeMigrationProgress {
  migratedRows: number;
  repairedRows: number;
  repairErrors: number;
  complete: boolean;
}

interface DerivativeMigrationRepairError {
  currentFile: string;
  operation: DerivativeMigrationOperation;
  message: string;
  sourcePath: string | null;
}

interface DerivativeCleanupSummary {
  deletedFiles: number;
  deletedOrphans: number;
}

interface DerivativeReferenceState {
  hasLiveReference: boolean;
  hasRetainedDeletedReference: boolean;
}

interface MissingDerivativeRepairSummary {
  repairedFiles: number;
  repairedRows: number;
  missingFiles: number;
  repairErrors: number;
}

interface RepairRowError {
  message: string;
  sourcePath: string | null;
  error: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatStep(label: string, value: string | number): string {
  return `${label} ${value}`;
}

function joinLogParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' | ');
}

function logDerivativeRepairFailure(
  currentFile: string,
  sourcePath: string | null,
  message: string,
  error: unknown
): void {
  log.error(
    joinLogParts([
      'Derivative repair skipped',
      formatStep('file', currentFile),
      sourcePath ? formatStep('source', normalizePath(sourcePath)) : null,
      message
    ]),
    appConfig.logVerbose ? error : undefined
  );
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removeFileIfPresent(targetPath: string): Promise<boolean> {
  try {
    await fs.unlink(targetPath);
    return true;
  } catch (error) {
    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function pruneEmptyDirectories(rootDir: string, filePath: string): Promise<void> {
  let currentDir = path.dirname(filePath);
  const normalizedRoot = path.resolve(rootDir);

  while (currentDir.startsWith(normalizedRoot) && currentDir !== normalizedRoot) {
    try {
      await fs.rmdir(currentDir);
    } catch (error) {
      const filesystemError = error as NodeJS.ErrnoException;
      if (
        filesystemError.code === 'ENOENT' ||
        filesystemError.code === 'ENOTEMPTY' ||
        filesystemError.code === 'EEXIST'
      ) {
        return;
      }

      throw error;
    }

    currentDir = path.dirname(currentDir);
  }
}

async function listDerivativeFiles(rootDir: string, currentRelativePath = ''): Promise<Array<{ absolutePath: string; relativePath: string; mtimeMs: number }>> {
  const currentAbsolutePath = currentRelativePath ? safeJoin(rootDir, currentRelativePath) : rootDir;
  const entries = await fs.readdir(currentAbsolutePath, { withFileTypes: true }).catch((error: unknown) => {
    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError.code === 'ENOENT') {
      return [];
    }

    throw error;
  });
  const files: Array<{ absolutePath: string; relativePath: string; mtimeMs: number }> = [];

  for (const entry of entries) {
    const relativePath = normalizePath(currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name);
    const absolutePath = safeJoin(rootDir, relativePath);

    if (entry.isDirectory()) {
      files.push(...await listDerivativeFiles(rootDir, relativePath));
      continue;
    }

    if (!entry.isFile() || entry.name === DERIVATIVE_KEEP_FILE) {
      continue;
    }

    const stats = await fs.stat(absolutePath);
    files.push({
      absolutePath,
      relativePath,
      mtimeMs: stats.mtimeMs
    });
  }

  return files;
}

class DerivativeMigrationService {
  isMigrationComplete(): boolean {
    if (
      appSettingsRepository.get(DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY) !== DERIVATIVE_STORAGE_LAYOUT_VERSION
      || appSettingsRepository.get(DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY) === null
    ) {
      return false;
    }

    return imageRepository.countPendingDerivativeMigrationRows() === 0;
  }

  async ensureMigrated(options: EnsureMigratedOptions = {}): Promise<DerivativeMigrationSummary> {
    if (this.isMigrationComplete()) {
      return {
        totalRows: 0,
        processedRows: 0,
        movedFiles: 0,
        missingFiles: 0,
        repairedFiles: 0,
        backfilledAssetKeys: 0,
        currentOperation: null,
        currentFile: null,
        currentPhaseMessage: MIGRATION_PHASE_MESSAGE,
        migratedRows: 0,
        repairedRows: 0,
        repairErrors: 0,
        complete: true
      };
    }

    let cursor = Number.parseInt(appSettingsRepository.get(DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY) ?? '0', 10);
    if (!Number.isFinite(cursor) || cursor < 0) {
      cursor = 0;
    }

    const totalRows = imageRepository.countAll();
    let repairedRows = 0;
    let repairErrors = 0;
    let migratedRows = 0;
    const progress: DerivativeMigrationProgress = {
      totalRows,
      processedRows: cursor > 0 ? imageRepository.countUpToId(cursor) : 0,
      movedFiles: 0,
      missingFiles: 0,
      repairedFiles: 0,
      backfilledAssetKeys: 0,
      currentOperation: totalRows > 0 ? 'checking_derivatives' : null,
      currentFile: null,
      currentPhaseMessage: MIGRATION_PHASE_MESSAGE
    };
    const emitProgress = (patch: Partial<DerivativeMigrationProgress> = {}) => {
      Object.assign(progress, patch);
      options.onProgress?.({ ...progress });
    };

    emitProgress();

    for (;;) {
      const rows = imageRepository.listByIdRange(cursor, MIGRATION_BATCH_SIZE);
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const currentFile = normalizePath(row.relative_path);
        emitProgress({
          currentOperation: 'checking_derivatives',
          currentFile
        });

        const rowSummary = await this.migrateRow(row, {
          onBackfilledAssetKey: () => {
            emitProgress({
              backfilledAssetKeys: progress.backfilledAssetKeys + 1,
              currentOperation: 'backfilling_asset_key',
              currentFile
            });
          },
          onThumbnailMoved: () => {
            emitProgress({
              movedFiles: progress.movedFiles + 1,
              currentOperation: 'moving_thumbnail',
              currentFile
            });
          },
          onPreviewMoved: () => {
            emitProgress({
              movedFiles: progress.movedFiles + 1,
              currentOperation: 'moving_preview',
              currentFile
            });
          }
        });

        migratedRows += 1;
        cursor = row.id;
        appSettingsRepository.set(DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY, String(cursor));
        emitProgress({
          processedRows: progress.processedRows + 1,
          missingFiles: progress.missingFiles + rowSummary.missingFiles
        });
      }
    }

    if (progress.processedRows > 0) {
      emitProgress({
        currentOperation: 'checking_derivatives',
        currentFile: null,
        missingFiles: 0
      });

      const repairSummary = await this.repairMissingDerivatives({
        onRepairingThumbnail: (currentFile) => {
          emitProgress({
            repairedFiles: progress.repairedFiles + 1,
            currentOperation: 'repairing_thumbnail',
            currentFile
          });
        },
        onRepairingPreview: (currentFile) => {
          emitProgress({
            repairedFiles: progress.repairedFiles + 1,
            currentOperation: 'repairing_preview',
            currentFile
          });
        },
        onRegeneratingDerivatives: (currentFile, repairedFiles) => {
          if (repairedFiles === 0) {
            return;
          }

          emitProgress({
            repairedFiles: progress.repairedFiles + repairedFiles,
            currentOperation: 'regenerating_derivatives',
            currentFile
          });
        },
        onMissingFilesCounted: (missingFiles) => {
          emitProgress({
            missingFiles: progress.missingFiles + missingFiles
          });
        },
        onRepairError: async (currentFile, message, sourcePath) => {
          await options.onError?.({
            currentFile,
            operation: 'regenerating_derivatives',
            message,
            sourcePath
          });
        }
      });
      repairedRows = repairSummary.repairedRows;
      repairErrors = repairSummary.repairErrors;
    }

    appSettingsRepository.set(DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY, DERIVATIVE_STORAGE_LAYOUT_VERSION);
    appSettingsRepository.set(DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY, nowIso());
    appSettingsRepository.remove(DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY);

    if (
      migratedRows > 0 ||
      progress.backfilledAssetKeys > 0 ||
      progress.movedFiles > 0 ||
      progress.repairedFiles > 0 ||
      progress.missingFiles > 0 ||
      repairErrors > 0
    ) {
      const rows: Array<[label: string, value: unknown]> = [
        ['Rows', migratedRows],
        ['Asset keys backfilled', progress.backfilledAssetKeys],
        ['Derivative files moved', progress.movedFiles],
        ['Derivative files repaired', progress.repairedFiles],
        ['Rows repaired', repairedRows],
        ['Missing derivative files', progress.missingFiles]
      ];

      if (repairErrors > 0) {
        rows.push(['Derivative repair errors', repairErrors]);
      }

      log.table('Derivative storage migration complete', rows, repairErrors > 0 ? 'warning' : 'success');
    }

    const complete = repairErrors === 0 && this.isMigrationComplete();

    return {
      ...progress,
      migratedRows,
      repairedRows,
      repairErrors,
      complete
    };
  }

  async cleanupStaleDerivatives(): Promise<DerivativeCleanupSummary> {
    const cutoffIso = new Date(Date.now() - STALE_DERIVATIVE_RETENTION_MS).toISOString();
    const references = imageRepository.listDerivativeReferences();
    const pathState = new Map<string, DerivativeReferenceState>();

    for (const reference of references) {
      this.rememberReference(pathState, reference.thumbnail_path, reference.is_deleted, reference.deleted_at, cutoffIso);
      this.rememberReference(pathState, reference.preview_path, reference.is_deleted, reference.deleted_at, cutoffIso);
    }

    let deletedFiles = 0;
    for (const candidate of imageRepository.listSoftDeletedDerivativeCandidates(cutoffIso)) {
      deletedFiles += await this.deleteIfCollectable(appConfig.thumbnailsDir, candidate.thumbnail_path, pathState);
      deletedFiles += await this.deleteIfCollectable(appConfig.previewsDir, candidate.preview_path, pathState);
    }

    let deletedOrphans = 0;
    for (const { absolutePath, relativePath, mtimeMs } of await listDerivativeFiles(appConfig.thumbnailsDir)) {
      if (pathState.has(relativePath) || mtimeMs > Date.now() - STALE_DERIVATIVE_RETENTION_MS) {
        continue;
      }

      deletedOrphans += await this.deleteAbsolutePath(appConfig.thumbnailsDir, absolutePath);
    }

    for (const { absolutePath, relativePath, mtimeMs } of await listDerivativeFiles(appConfig.previewsDir)) {
      if (pathState.has(relativePath) || mtimeMs > Date.now() - STALE_DERIVATIVE_RETENTION_MS) {
        continue;
      }

      deletedOrphans += await this.deleteAbsolutePath(appConfig.previewsDir, absolutePath);
    }

    appSettingsRepository.set(STALE_DERIVATIVE_GC_LAST_RUN_AT_SETTING_KEY, nowIso());
    if (deletedFiles > 0 || deletedOrphans > 0) {
      log.table('Stale derivative cleanup complete', [
        ['Deleted referenced files', deletedFiles],
        ['Deleted orphan files', deletedOrphans]
      ], 'success');
    }

    return {
      deletedFiles,
      deletedOrphans
    };
  }

  /**
   * Videos are played from the original file or from on-demand HLS segments, so
   * no preview file is expected for them. Counting one as missing would keep the
   * migration reporting thousands of gaps it can never fill.
   */
  private expectsPreviewFile(mediaType: string): boolean {
    return mediaType !== 'video';
  }

  private async migrateRow(
    row: ImageRecord,
    callbacks: {
      onBackfilledAssetKey?: () => void;
      onThumbnailMoved?: () => void;
      onPreviewMoved?: () => void;
    } = {}
  ): Promise<{ missingFiles: number }> {
    let assetKey = row.asset_key;

    if (!assetKey) {
      assetKey = generateAssetKey();
      imageRepository.updateAssetKey(row.id, assetKey);
      callbacks.onBackfilledAssetKey?.();
    }

    const mediaType = row.media_type ?? getMediaTypeFromExtension(row.extension || path.extname(row.relative_path));
    const nextThumbnailPath = getThumbnailPathForAssetKey(assetKey);
    const nextPreviewPath = getPreviewPathForAssetKey(assetKey, mediaType);

    let missingFiles = 0;

    const thumbnailMoved = await this.migrateDerivativeFile(appConfig.thumbnailsDir, row.thumbnail_path, nextThumbnailPath);
    if (thumbnailMoved > 0) {
      callbacks.onThumbnailMoved?.();
    }

    const previewMoved = await this.migrateDerivativeFile(appConfig.previewsDir, row.preview_path, nextPreviewPath);
    if (previewMoved > 0) {
      callbacks.onPreviewMoved?.();
    }

    const nextThumbnailExists = await fileExists(safeJoin(appConfig.thumbnailsDir, nextThumbnailPath));
    const nextPreviewExists = await fileExists(safeJoin(appConfig.previewsDir, nextPreviewPath));
    const resolvedThumbnailPath = nextThumbnailExists ? nextThumbnailPath : row.thumbnail_path;
    const resolvedPreviewPath = nextPreviewExists ? nextPreviewPath : row.preview_path;

    if (!nextThumbnailExists) {
      missingFiles += 1;
    }

    if (!nextPreviewExists && this.expectsPreviewFile(mediaType)) {
      missingFiles += 1;
    }

    if (row.thumbnail_path !== resolvedThumbnailPath || row.preview_path !== resolvedPreviewPath) {
      imageRepository.updateDerivativePaths(row.id, resolvedThumbnailPath, resolvedPreviewPath);
    }

    return {
      missingFiles
    };
  }

  private async repairMissingDerivatives(
    callbacks: {
      onRepairingThumbnail?: (currentFile: string) => void;
      onRepairingPreview?: (currentFile: string) => void;
      onRegeneratingDerivatives?: (currentFile: string, repairedFiles: number) => void;
      onMissingFilesCounted?: (missingFiles: number) => void;
      onRepairError?: (currentFile: string, message: string, sourcePath: string | null) => void | Promise<void>;
    } = {}
  ): Promise<MissingDerivativeRepairSummary> {
    let repairedFiles = 0;
    let repairedRows = 0;
    let missingFiles = 0;
    let repairErrors = 0;

    for (const row of imageRepository.listActive()) {
      const currentFile = normalizePath(row.relative_path);
      let fatalRepairError: string | null = null;

      try {
        const repairSummary = await this.repairRow(row, {
          onRepairingThumbnail: () => {
            callbacks.onRepairingThumbnail?.(currentFile);
          },
          onRepairingPreview: () => {
            callbacks.onRepairingPreview?.(currentFile);
          },
          onRegeneratingDerivatives: (repairedFiles) => {
            callbacks.onRegeneratingDerivatives?.(currentFile, repairedFiles);
          }
        });

        if (repairSummary.regenerationError) {
          repairErrors += 1;
          await callbacks.onRepairError?.(
            currentFile,
            repairSummary.regenerationError.message,
            repairSummary.regenerationError.sourcePath
          );
          logDerivativeRepairFailure(
            currentFile,
            repairSummary.regenerationError.sourcePath,
            repairSummary.regenerationError.message,
            repairSummary.regenerationError.error
          );

          if (appConfig.scanMediaErrorMode === 'fail') {
            fatalRepairError = `${currentFile}: ${repairSummary.regenerationError.message}`;
          }
        }

        repairedFiles += repairSummary.repairedFiles;
        repairedRows += repairSummary.repaired ? 1 : 0;
        missingFiles += repairSummary.missingFiles;
        callbacks.onMissingFilesCounted?.(repairSummary.missingFiles);
      } catch (error) {
        const message = getErrorMessage(error);

        repairErrors += 1;
        await callbacks.onRepairError?.(currentFile, message, null);
        logDerivativeRepairFailure(currentFile, null, message, error);

        if (appConfig.scanMediaErrorMode === 'fail') {
          throw new Error(`${currentFile}: ${message}`);
        }
      }

      if (fatalRepairError) {
        throw new Error(fatalRepairError);
      }
    }

    return {
      repairedFiles,
      repairedRows,
      missingFiles,
      repairErrors
    };
  }

  private async repairRow(
    row: ImageRecord,
    callbacks: {
      onRepairingThumbnail?: () => void;
      onRepairingPreview?: () => void;
      onRegeneratingDerivatives?: (repairedFiles: number) => void;
    } = {}
  ): Promise<{ repairedFiles: number; missingFiles: number; repaired: boolean; regenerationError: RepairRowError | null }> {
    let assetKey = row.asset_key;
    let repairedFiles = 0;
    let regenerationError: RepairRowError | null = null;

    if (!assetKey) {
      assetKey = generateAssetKey();
      imageRepository.updateAssetKey(row.id, assetKey);
    }

    const mediaType = row.media_type ?? getMediaTypeFromExtension(row.extension || path.extname(row.relative_path));
    const targetThumbnailPath = getThumbnailPathForAssetKey(assetKey);
    const targetPreviewPath = getPreviewPathForAssetKey(assetKey, mediaType);

    const repairedThumbnail = await this.promoteDerivativeCandidate(
      appConfig.thumbnailsDir,
      targetThumbnailPath,
      this.uniqueDerivativePaths([
        row.thumbnail_path,
        ...LEGACY_DERIVATIVE_STORAGE_LAYOUT_VERSIONS.map((layoutVersion) => getThumbnailPathForAssetKey(assetKey, layoutVersion)),
        getThumbnailRelativePath(row.relative_path)
      ])
    );
    if (repairedThumbnail > 0) {
      repairedFiles += repairedThumbnail;
      callbacks.onRepairingThumbnail?.();
    }

    const repairedPreview = await this.promoteDerivativeCandidate(
      appConfig.previewsDir,
      targetPreviewPath,
      this.uniqueDerivativePaths([
        row.preview_path,
        ...LEGACY_DERIVATIVE_STORAGE_LAYOUT_VERSIONS.map((layoutVersion) => getPreviewPathForAssetKey(assetKey, mediaType, layoutVersion)),
        getPreviewRelativePath(row.relative_path, mediaType)
      ])
    );
    if (repairedPreview > 0) {
      repairedFiles += repairedPreview;
      callbacks.onRepairingPreview?.();
    }

    const thumbnailAbsolutePath = safeJoin(appConfig.thumbnailsDir, targetThumbnailPath);
    const previewAbsolutePath = safeJoin(appConfig.previewsDir, targetPreviewPath);
    let sourcePath: string | null = null;
    try {
      sourcePath = resolveOriginalPath(row.relative_path);
    } catch {
      sourcePath = null;
    }

    const sourceExists = sourcePath ? await fileExists(sourcePath) : false;
    const thumbnailExistsBeforeGenerate = await fileExists(thumbnailAbsolutePath);
    const previewExistsBeforeGenerate = await fileExists(previewAbsolutePath);

    const previewRequired = this.expectsPreviewFile(mediaType);
    const needsGeneration = !thumbnailExistsBeforeGenerate || (previewRequired && !previewExistsBeforeGenerate);

    if (needsGeneration && sourcePath && sourceExists) {
      try {
        const derivatives = await generateDerivatives(sourcePath, row.relative_path, false, {
          thumbnailPath: targetThumbnailPath,
          previewPath: targetPreviewPath
        });
        const regeneratedFiles = Number(derivatives.generatedThumbnail) + Number(derivatives.generatedPreview);
        if (regeneratedFiles > 0) {
          repairedFiles += regeneratedFiles;
          callbacks.onRegeneratingDerivatives?.(regeneratedFiles);
        }
      } catch (error) {
        regenerationError = {
          message: getErrorMessage(error),
          sourcePath,
          error
        };
      }
    }

    const thumbnailExists = await fileExists(thumbnailAbsolutePath);
    const previewExists = await fileExists(previewAbsolutePath);
    const resolvedThumbnailPath = thumbnailExists ? targetThumbnailPath : row.thumbnail_path;
    const resolvedPreviewPath = previewExists ? targetPreviewPath : row.preview_path;

    if (row.thumbnail_path !== resolvedThumbnailPath || row.preview_path !== resolvedPreviewPath) {
      imageRepository.updateDerivativePaths(row.id, resolvedThumbnailPath, resolvedPreviewPath);
    }

    let missingFiles = 0;
    if (!(await fileExists(safeJoin(appConfig.thumbnailsDir, resolvedThumbnailPath)))) {
      missingFiles += 1;
    }

    if (previewRequired && !(await fileExists(safeJoin(appConfig.previewsDir, resolvedPreviewPath)))) {
      missingFiles += 1;
    }

    return {
      repairedFiles,
      missingFiles,
      regenerationError,
      repaired:
        repairedFiles > 0 ||
        row.thumbnail_path !== resolvedThumbnailPath ||
        row.preview_path !== resolvedPreviewPath
    };
  }

  private async migrateDerivativeFile(rootDir: string, currentPath: string, nextPath: string): Promise<number> {
    if (currentPath === nextPath) {
      return 0;
    }

    const currentAbsolutePath = safeJoin(rootDir, currentPath);
    const nextAbsolutePath = safeJoin(rootDir, nextPath);

    if (await fileExists(nextAbsolutePath)) {
      if (await removeFileIfPresent(currentAbsolutePath)) {
        await pruneEmptyDirectories(rootDir, currentAbsolutePath);
      }

      return 0;
    }

    if (!(await fileExists(currentAbsolutePath))) {
      return 0;
    }

    await fs.mkdir(path.dirname(nextAbsolutePath), { recursive: true });
    await fs.rename(currentAbsolutePath, nextAbsolutePath);
    await pruneEmptyDirectories(rootDir, currentAbsolutePath);
    return 1;
  }

  private async promoteDerivativeCandidate(rootDir: string, targetPath: string, candidates: string[]): Promise<number> {
    if (await fileExists(safeJoin(rootDir, targetPath))) {
      return 0;
    }

    for (const candidatePath of candidates) {
      if (!candidatePath || candidatePath === targetPath) {
        continue;
      }

      const movedFiles = await this.migrateDerivativeFile(rootDir, candidatePath, targetPath);
      if (movedFiles > 0 || await fileExists(safeJoin(rootDir, targetPath))) {
        return movedFiles;
      }
    }

    return 0;
  }

  private uniqueDerivativePaths(paths: string[]): string[] {
    return [...new Set(paths.filter(Boolean).map((value) => normalizePath(value)))];
  }

  private rememberReference(
    pathState: Map<string, DerivativeReferenceState>,
    derivativePath: string,
    isDeleted: number,
    deletedAt: string | null,
    cutoffIso: string
  ): void {
    const existing = pathState.get(derivativePath) ?? {
      hasLiveReference: false,
      hasRetainedDeletedReference: false
    };

    if (isDeleted === 0) {
      existing.hasLiveReference = true;
    } else if (!deletedAt || deletedAt > cutoffIso) {
      existing.hasRetainedDeletedReference = true;
    }

    pathState.set(derivativePath, existing);
  }

  private async deleteIfCollectable(rootDir: string, relativePath: string, pathState: Map<string, DerivativeReferenceState>): Promise<number> {
    const state = pathState.get(relativePath);
    if (state?.hasLiveReference || state?.hasRetainedDeletedReference) {
      return 0;
    }

    return this.deleteAbsolutePath(rootDir, safeJoin(rootDir, relativePath));
  }

  private async deleteAbsolutePath(rootDir: string, absolutePath: string): Promise<number> {
    const deleted = await removeFileIfPresent(absolutePath);
    if (!deleted) {
      return 0;
    }

    await pruneEmptyDirectories(rootDir, absolutePath);
    return 1;
  }
}

export const derivativeMigrationService = new DerivativeMigrationService();
