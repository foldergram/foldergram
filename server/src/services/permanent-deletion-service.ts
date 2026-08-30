import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { appConfig } from '../config/env.js';
import { folderRepository, postRepository } from '../db/repositories.js';
import type { ImageRecord } from '../types/models.js';
import { normalizePath } from '../utils/path-utils.js';
import { log } from './log-service.js';
import {
  maintenanceOperationLock,
  PERMANENT_DELETION_QUARANTINE_DIRECTORY_NAME
} from './maintenance-operation-lock.js';
import { storageService } from './storage-service.js';

const QUARANTINE_DIRECTORY_NAME = PERMANENT_DELETION_QUARANTINE_DIRECTORY_NAME;
const JOURNAL_VERSION = 1;

type DeletionRoot = 'gallery' | 'thumbnails' | 'previews';

interface FileIdentity {
  device: string;
  inode: string;
  size: string;
  modifiedNanoseconds: string;
}

interface DirectoryIdentity {
  device: string;
  inode: string;
}

interface DirectoryGuardEntry extends DirectoryIdentity {
  path: string;
  followConfiguredRoot: boolean;
}

interface DirectoryGuard {
  rootPath: string;
  rootRealPath: string;
  entries: DirectoryGuardEntry[];
}

interface DeletionJournalEntry {
  root: DeletionRoot;
  originalRelativePath: string;
  quarantineRelativePath: string;
  wasPresent: boolean;
  identity: FileIdentity | null;
}

interface DeletionJournal {
  version: typeof JOURNAL_VERSION;
  operationId: string;
  postId: number;
  folderSlug: string;
  createdAt: string;
  entries: DeletionJournalEntry[];
}

export class SimulatedDeletionInterruptionError extends Error {
  constructor(message = 'Simulated process termination during permanent deletion') {
    super(message);
    this.name = 'SimulatedDeletionInterruptionError';
  }
}

export interface PermanentDeletionServiceHooks {
  rename?: (sourcePath: string, destinationPath: string) => Promise<void>;
  afterQuarantine?: (journal: Readonly<DeletionJournal>) => Promise<void> | void;
  afterDatabaseCommit?: (journal: Readonly<DeletionJournal>) => Promise<void> | void;
}

interface ValidatedDeletionTarget {
  root: DeletionRoot;
  rootPath: string;
  originalPath: string;
  originalRelativePath: string;
  quarantinePath: string;
  quarantineRelativePath: string;
  wasPresent: boolean;
  identity: FileIdentity | null;
}

function getRootPath(root: DeletionRoot): string {
  if (root === 'gallery') return appConfig.galleryRoot;
  if (root === 'thumbnails') return appConfig.thumbnailsDir;
  return appConfig.previewsDir;
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function toIdentity(stats: Awaited<ReturnType<typeof fs.lstat>>): FileIdentity {
  const bigintStats = stats as unknown as {
    dev: bigint | number;
    ino: bigint | number;
    size: bigint | number;
    mtimeNs?: bigint;
    mtimeMs: number;
  };

  return {
    device: String(bigintStats.dev),
    inode: String(bigintStats.ino),
    size: String(bigintStats.size),
    modifiedNanoseconds: bigintStats.mtimeNs !== undefined
      ? String(bigintStats.mtimeNs)
      : String(Math.round(bigintStats.mtimeMs * 1_000_000))
  };
}

function identitiesMatch(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedNanoseconds === right.modifiedNanoseconds;
}

function toDirectoryIdentity(stats: { dev: bigint | number; ino: bigint | number }): DirectoryIdentity {
  return {
    device: String(stats.dev),
    inode: String(stats.ino)
  };
}

function directoryIdentitiesMatch(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function captureDirectoryGuard(rootPath: string, directoryPath: string, label: string): DirectoryGuard {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedDirectory = path.resolve(directoryPath);
  if (!isPathWithin(resolvedRoot, resolvedDirectory)) {
    throw new Error(`${label} is outside its configured root`);
  }

  const rootRealPath = fsSync.realpathSync.native(resolvedRoot);
  const rootStats = fsSync.statSync(resolvedRoot, { bigint: true });
  if (!rootStats.isDirectory()) throw new Error(`Configured root is not a directory: ${resolvedRoot}`);

  const entries: DirectoryGuardEntry[] = [{
    path: resolvedRoot,
    followConfiguredRoot: true,
    ...toDirectoryIdentity(rootStats)
  }];
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  let currentPath = resolvedRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    currentPath = path.join(currentPath, segment);
    const stats = fsSync.lstatSync(currentPath, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${label} traverses a non-directory or symbolic link`);
    }
    const realPath = fsSync.realpathSync.native(currentPath);
    if (!isPathWithin(rootRealPath, realPath)) {
      throw new Error(`${label} resolves outside its configured root`);
    }
    entries.push({
      path: currentPath,
      followConfiguredRoot: false,
      ...toDirectoryIdentity(stats)
    });
  }

  return { rootPath: resolvedRoot, rootRealPath, entries };
}

function assertDirectoryGuardStable(guard: DirectoryGuard, label: string): void {
  if (fsSync.realpathSync.native(guard.rootPath) !== guard.rootRealPath) {
    throw new Error(`${label} configured root changed during the filesystem operation`);
  }

  for (const entry of guard.entries) {
    const stats = entry.followConfiguredRoot
      ? fsSync.statSync(entry.path, { bigint: true })
      : fsSync.lstatSync(entry.path, { bigint: true });
    if (!stats.isDirectory() || (!entry.followConfiguredRoot && stats.isSymbolicLink()) ||
        !directoryIdentitiesMatch(toDirectoryIdentity(stats), entry)) {
      throw new Error(`${label} parent directory changed during the filesystem operation`);
    }
  }
}

function assertMatchingFileSync(targetPath: string, identity: FileIdentity, label: string): void {
  const stats = fsSync.lstatSync(targetPath, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || !identitiesMatch(toIdentity(stats as unknown as Awaited<ReturnType<typeof fs.lstat>>), identity)) {
    throw new Error(`${label} no longer matches the file recorded in the deletion journal`);
  }
}

function lstatSyncIfPresent(targetPath: string): fsSync.Stats | fsSync.BigIntStats | null {
  try {
    return fsSync.lstatSync(targetPath, { bigint: true });
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function resolveRelativePathWithinRoot(rootPath: string, relativePath: string, label: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its configured root`);
  }

  return resolvedPath;
}

async function lstatIfPresent(targetPath: string, useBigInt = false): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return useBigInt
      ? await fs.lstat(targetPath, { bigint: true }) as unknown as Awaited<ReturnType<typeof fs.lstat>>
      : await fs.lstat(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function assertNoSymlinkTraversal(rootPath: string, targetPath: string, label: string): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, targetPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its configured root`);
  }

  const rootStats = await fs.stat(resolvedRoot);
  if (!rootStats.isDirectory()) {
    throw new Error(`Configured root is not a directory: ${resolvedRoot}`);
  }

  let currentPath = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    const stats = await lstatIfPresent(currentPath);
    if (!stats) return;
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} traverses a symbolic link`);
    }
  }
}

async function validateExistingFile(rootPath: string, targetPath: string, label: string): Promise<{
  wasPresent: boolean;
  identity: FileIdentity | null;
}> {
  await assertNoSymlinkTraversal(rootPath, targetPath, label);
  const stats = await lstatIfPresent(targetPath, true);
  if (!stats) {
    return { wasPresent: false, identity: null };
  }
  if (!stats.isFile()) {
    throw new Error(`${label} is not a regular file`);
  }
  return { wasPresent: true, identity: toIdentity(stats) };
}

async function ensurePrivateDirectory(rootPath: string, directoryPath: string): Promise<void> {
  await assertNoSymlinkTraversal(rootPath, directoryPath, 'Quarantine directory');
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  await assertNoSymlinkTraversal(rootPath, directoryPath, 'Quarantine directory');
  const stats = await fs.lstat(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Quarantine path is not a private directory');
  }
}

async function assertMatchingFile(targetPath: string, identity: FileIdentity, label: string): Promise<boolean> {
  const stats = await lstatIfPresent(targetPath, true);
  if (!stats) return false;
  if (!stats.isFile() || stats.isSymbolicLink() || !identitiesMatch(toIdentity(stats), identity)) {
    throw new Error(`${label} no longer matches the quarantined file recorded in the deletion journal`);
  }
  return true;
}

async function pruneEmptyAncestors(rootPath: string, startDirectory: string, stopDirectory = path.resolve(rootPath)): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedStop = path.resolve(stopDirectory);
  let currentDirectory = path.resolve(startDirectory);

  while (currentDirectory !== resolvedStop && currentDirectory !== resolvedRoot) {
    const relative = path.relative(resolvedRoot, currentDirectory);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Directory pruning target is outside its configured root');
    }

    await assertNoSymlinkTraversal(resolvedRoot, currentDirectory, 'Directory pruning target');
    try {
      const directoryStats = fsSync.lstatSync(currentDirectory, { bigint: true });
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        throw new Error('Directory pruning target is not a real directory');
      }
      const parentGuard = captureDirectoryGuard(resolvedRoot, path.dirname(currentDirectory), 'Directory pruning target');
      assertDirectoryGuardStable(parentGuard, 'Directory pruning target');
      const currentStats = fsSync.lstatSync(currentDirectory, { bigint: true });
      if (!directoryIdentitiesMatch(toDirectoryIdentity(currentStats), toDirectoryIdentity(directoryStats))) {
        throw new Error('Directory pruning target changed during the filesystem operation');
      }
      fsSync.rmdirSync(currentDirectory);
      assertDirectoryGuardStable(parentGuard, 'Directory pruning target');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        currentDirectory = path.dirname(currentDirectory);
        continue;
      }
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return;
      throw error;
    }

    currentDirectory = path.dirname(currentDirectory);
  }
}

function parseJournal(value: unknown): DeletionJournal {
  if (!value || typeof value !== 'object') throw new Error('Deletion journal is not an object');
  const candidate = value as Partial<DeletionJournal>;
  if (candidate.version !== JOURNAL_VERSION ||
      typeof candidate.operationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.operationId) ||
      !Number.isSafeInteger(candidate.postId) || Number(candidate.postId) <= 0 ||
      typeof candidate.folderSlug !== 'string' ||
      typeof candidate.createdAt !== 'string' ||
      !Array.isArray(candidate.entries)) {
    throw new Error('Deletion journal metadata is invalid');
  }

  for (const entry of candidate.entries) {
    if (!entry || typeof entry !== 'object' ||
        !['gallery', 'thumbnails', 'previews'].includes(entry.root) ||
        typeof entry.originalRelativePath !== 'string' ||
        typeof entry.quarantineRelativePath !== 'string' ||
        typeof entry.wasPresent !== 'boolean' ||
        (entry.wasPresent && (!entry.identity || typeof entry.identity !== 'object')) ||
        (!entry.wasPresent && entry.identity !== null)) {
      throw new Error('Deletion journal entry is invalid');
    }

    if (entry.identity && (
      typeof entry.identity.device !== 'string' ||
      typeof entry.identity.inode !== 'string' ||
      typeof entry.identity.size !== 'string' ||
      typeof entry.identity.modifiedNanoseconds !== 'string'
    )) {
      throw new Error('Deletion journal file identity is invalid');
    }

    const normalizedOriginalPath = normalizePath(entry.originalRelativePath);
    if (normalizedOriginalPath === QUARANTINE_DIRECTORY_NAME || normalizedOriginalPath.startsWith(`${QUARANTINE_DIRECTORY_NAME}/`)) {
      throw new Error('Deletion journal original path overlaps private quarantine storage');
    }

    const expectedPrefix = `${normalizePath(path.join(QUARANTINE_DIRECTORY_NAME, 'files', candidate.operationId))}/`;
    const normalizedQuarantinePath = normalizePath(entry.quarantineRelativePath);
    if (!normalizedQuarantinePath.startsWith(expectedPrefix) || normalizedQuarantinePath === expectedPrefix) {
      throw new Error('Deletion journal quarantine path is invalid');
    }
  }

  return candidate as DeletionJournal;
}

export class PermanentDeletionService {
  private readonly renameFile: (sourcePath: string, destinationPath: string) => Promise<void>;

  constructor(private readonly hooks: PermanentDeletionServiceHooks = {}) {
    this.renameFile = hooks.rename ?? ((sourcePath, destinationPath) => fs.rename(sourcePath, destinationPath));
  }

  deletePost(postId: number): Promise<{ id: number; folderSlug: string } | null> {
    // Deletion is user-initiated, so it jumps ahead of any long-running scan
    // that is currently holding the maintenance lock.
    return maintenanceOperationLock.runExclusive(async () => {
      await this.recoverPendingDeletionsInternal();
      return this.deletePostInternal(postId);
    });
  }

  recoverPendingDeletions(): Promise<void> {
    return maintenanceOperationLock.runExclusive(() => this.recoverPendingDeletionsInternal());
  }

  recoverPendingDeletionsWhileLocked(): Promise<void> {
    return this.recoverPendingDeletionsInternal();
  }

  private async renameValidatedFile(
    sourceRootPath: string,
    sourcePath: string,
    destinationRootPath: string,
    destinationPath: string,
    identity: FileIdentity,
    label: string
  ): Promise<void> {
    const sourceGuard = captureDirectoryGuard(sourceRootPath, path.dirname(sourcePath), `${label} source`);
    const destinationGuard = captureDirectoryGuard(destinationRootPath, path.dirname(destinationPath), `${label} destination`);
    assertDirectoryGuardStable(sourceGuard, `${label} source`);
    assertDirectoryGuardStable(destinationGuard, `${label} destination`);
    assertMatchingFileSync(sourcePath, identity, `${label} source`);
    if (lstatSyncIfPresent(destinationPath)) throw new Error(`${label} destination is already occupied`);

    if (this.hooks.rename) {
      await this.renameFile(sourcePath, destinationPath);
    } else {
      // Keep the final identity checks, rename, and post-checks in one event-loop turn.
      // This closes in-process races. Pre-existing symlinks are rejected above; an
      // external writer with access to these roots is outside the documented threat model.
      fsSync.renameSync(sourcePath, destinationPath);
    }

    assertDirectoryGuardStable(sourceGuard, `${label} source`);
    assertDirectoryGuardStable(destinationGuard, `${label} destination`);
    assertMatchingFileSync(destinationPath, identity, `${label} destination`);
  }

  private unlinkValidatedFile(rootPath: string, targetPath: string, identity: FileIdentity, label: string): void {
    const parentGuard = captureDirectoryGuard(rootPath, path.dirname(targetPath), label);
    assertDirectoryGuardStable(parentGuard, label);
    assertMatchingFileSync(targetPath, identity, label);
    fsSync.unlinkSync(targetPath);
    assertDirectoryGuardStable(parentGuard, label);
  }

  private unlinkInternalFileIfPresent(rootPath: string, targetPath: string, label: string): void {
    const stats = lstatSyncIfPresent(targetPath);
    if (!stats) return;
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
    this.unlinkValidatedFile(
      rootPath,
      targetPath,
      toIdentity(stats as unknown as Awaited<ReturnType<typeof fs.lstat>>),
      label
    );
  }

  private async deletePostInternal(postId: number): Promise<{ id: number; folderSlug: string } | null> {
    if (storageService.getState().usingInMemoryDatabase) {
      throw new Error('Permanent deletion is unavailable while the configured database is offline');
    }

    const post = postRepository.findById(postId);
    if (!post) return null;
    const folderSlug = folderRepository.getById(post.folder_id)?.slug ?? '';
    const operationId = randomUUID();
    const targets = await this.buildValidatedTargets(operationId, postRepository.listImageRecords(post.id));
    const journal: DeletionJournal = {
      version: JOURNAL_VERSION,
      operationId,
      postId: post.id,
      folderSlug,
      createdAt: new Date().toISOString(),
      entries: targets.map((target) => ({
        root: target.root,
        originalRelativePath: target.originalRelativePath,
        quarantineRelativePath: target.quarantineRelativePath,
        wasPresent: target.wasPresent,
        identity: target.identity
      }))
    };

    const journalPath = await this.writeJournal(journal);
    const completedMoves = new Set<number>();

    try {
      for (const [targetIndex, target] of targets.entries()) {
        if (!target.wasPresent) continue;
        if (!target.identity) throw new Error('Validated deletion target is missing its file identity');
        await ensurePrivateDirectory(target.rootPath, path.dirname(target.quarantinePath));
        await this.renameValidatedFile(
          target.rootPath,
          target.originalPath,
          target.rootPath,
          target.quarantinePath,
          target.identity,
          'Quarantine move'
        );
        completedMoves.add(targetIndex);
        await this.writeMoveMarker(journal, targetIndex);
      }

      await this.hooks.afterQuarantine?.(journal);
    } catch (error) {
      if (error instanceof SimulatedDeletionInterruptionError) throw error;
      await this.restoreJournal(journal, journalPath, completedMoves);
      throw error;
    }

    let deleted: { id: number; folderSlug: string } | undefined;
    try {
      deleted = postRepository.deletePostAndImages(post.id);
    } catch (error) {
      if (!postRepository.findById(post.id)) {
        log.error('Permanent deletion transaction outcome was committed despite an error; cleanup will be retried', {
          operationId,
          postId: post.id,
          error
        });
        await this.tryCleanupCommittedJournal(journal, journalPath);
        return { id: post.id, folderSlug };
      }

      await this.restoreJournal(journal, journalPath, completedMoves);
      throw error;
    }

    if (!deleted) {
      await this.restoreJournal(journal, journalPath, completedMoves);
      return null;
    }

    try {
      await this.hooks.afterDatabaseCommit?.(journal);
    } catch (error) {
      if (error instanceof SimulatedDeletionInterruptionError) throw error;
      log.error('Permanent deletion committed; quarantined file cleanup will be retried', {
        operationId,
        postId: post.id,
        error
      });
      return deleted;
    }

    await this.tryCleanupCommittedJournal(journal, journalPath);
    return deleted;
  }

  private async buildValidatedTargets(operationId: string, images: ImageRecord[]): Promise<ValidatedDeletionTarget[]> {
    const candidates: Array<{ root: DeletionRoot; relativePath: string; label: string }> = [];
    for (const image of images) {
      candidates.push(
        { root: 'gallery', relativePath: image.relative_path, label: 'Stored original path' },
        { root: 'thumbnails', relativePath: image.thumbnail_path, label: 'Stored thumbnail path' },
        { root: 'previews', relativePath: image.preview_path, label: 'Stored preview path' }
      );
    }

    const targets: ValidatedDeletionTarget[] = [];
    const seenAbsolutePaths = new Set<string>();
    for (const [index, candidate] of candidates.entries()) {
      const rootPath = getRootPath(candidate.root);
      const normalizedCandidatePath = normalizePath(candidate.relativePath).replace(/^\/+/, '');
      if (normalizedCandidatePath === QUARANTINE_DIRECTORY_NAME || normalizedCandidatePath.startsWith(`${QUARANTINE_DIRECTORY_NAME}/`)) {
        throw new Error(`${candidate.label} overlaps private quarantine storage`);
      }
      const originalPath = resolveRelativePathWithinRoot(rootPath, candidate.relativePath, candidate.label);
      const pathKey = process.platform === 'win32' ? originalPath.toLocaleLowerCase() : originalPath;
      if (seenAbsolutePaths.has(pathKey)) continue;
      seenAbsolutePaths.add(pathKey);

      const originalRelativePath = normalizePath(path.relative(rootPath, originalPath));
      const quarantineRelativePath = normalizePath(path.join(
        QUARANTINE_DIRECTORY_NAME,
        'files',
        operationId,
        `${String(index).padStart(4, '0')}-${candidate.root}`
      ));
      const quarantinePath = resolveRelativePathWithinRoot(rootPath, quarantineRelativePath, 'Quarantine path');
      const fileState = await validateExistingFile(rootPath, originalPath, candidate.label);
      await assertNoSymlinkTraversal(rootPath, quarantinePath, 'Quarantine path');
      if (await lstatIfPresent(quarantinePath)) {
        throw new Error('Quarantine destination is already occupied');
      }

      targets.push({
        root: candidate.root,
        rootPath,
        originalPath,
        originalRelativePath,
        quarantinePath,
        quarantineRelativePath,
        ...fileState
      });
    }

    return targets;
  }

  private async writeJournal(journal: DeletionJournal): Promise<string> {
    const journalDirectory = path.join(appConfig.galleryRoot, QUARANTINE_DIRECTORY_NAME, 'journals');
    await ensurePrivateDirectory(appConfig.galleryRoot, journalDirectory);
    const finalPath = resolveRelativePathWithinRoot(
      appConfig.galleryRoot,
      path.join(QUARANTINE_DIRECTORY_NAME, 'journals', `${journal.operationId}.json`),
      'Deletion journal path'
    );
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    const directoryGuard = captureDirectoryGuard(appConfig.galleryRoot, journalDirectory, 'Deletion journal directory');
    assertDirectoryGuardStable(directoryGuard, 'Deletion journal directory');
    if (lstatSyncIfPresent(finalPath) || lstatSyncIfPresent(temporaryPath)) {
      throw new Error('Deletion journal destination is already occupied');
    }
    const fileDescriptor = fsSync.openSync(temporaryPath, 'wx', 0o600);
    try {
      fsSync.writeFileSync(fileDescriptor, `${JSON.stringify(journal)}\n`, 'utf8');
      fsSync.fsyncSync(fileDescriptor);
    } finally {
      fsSync.closeSync(fileDescriptor);
    }
    assertDirectoryGuardStable(directoryGuard, 'Deletion journal directory');
    fsSync.renameSync(temporaryPath, finalPath);
    assertDirectoryGuardStable(directoryGuard, 'Deletion journal directory');
    await this.syncDirectoryIfSupported(journalDirectory);
    return finalPath;
  }

  private getMoveMarkerPath(journal: DeletionJournal, entryIndex: number): string {
    return resolveRelativePathWithinRoot(
      appConfig.galleryRoot,
      path.join(QUARANTINE_DIRECTORY_NAME, 'journals', `${journal.operationId}.${entryIndex}.moved`),
      'Deletion move marker path'
    );
  }

  private async writeMoveMarker(journal: DeletionJournal, entryIndex: number): Promise<void> {
    const markerPath = this.getMoveMarkerPath(journal, entryIndex);
    const markerDirectory = path.dirname(markerPath);
    const directoryGuard = captureDirectoryGuard(appConfig.galleryRoot, markerDirectory, 'Deletion move marker directory');
    assertDirectoryGuardStable(directoryGuard, 'Deletion move marker directory');
    const fileDescriptor = fsSync.openSync(markerPath, 'wx', 0o600);
    try {
      fsSync.writeFileSync(fileDescriptor, 'moved\n', 'utf8');
      fsSync.fsyncSync(fileDescriptor);
    } finally {
      fsSync.closeSync(fileDescriptor);
    }
    assertDirectoryGuardStable(directoryGuard, 'Deletion move marker directory');
    await this.syncDirectoryIfSupported(markerDirectory);
  }

  private async hasMoveMarker(journal: DeletionJournal, entryIndex: number): Promise<boolean> {
    const markerPath = this.getMoveMarkerPath(journal, entryIndex);
    await assertNoSymlinkTraversal(appConfig.galleryRoot, markerPath, 'Deletion move marker path');
    const stats = await lstatIfPresent(markerPath);
    if (!stats) return false;
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Deletion move marker is not a regular file');
    }
    return true;
  }

  private async removeMoveMarkers(journal: DeletionJournal): Promise<void> {
    for (const entryIndex of journal.entries.keys()) {
      this.unlinkInternalFileIfPresent(
        appConfig.galleryRoot,
        this.getMoveMarkerPath(journal, entryIndex),
        'Deletion move marker'
      );
    }
  }

  private async restoreJournal(
    journal: DeletionJournal,
    journalPath: string,
    completedMoves: ReadonlySet<number> = new Set()
  ): Promise<void> {
    const restoreErrors: unknown[] = [];
    for (let entryIndex = journal.entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      try {
        const moveCompleted = completedMoves.has(entryIndex) || await this.hasMoveMarker(journal, entryIndex);
        await this.restoreEntry(journal.entries[entryIndex], moveCompleted);
      } catch (error) {
        restoreErrors.push(error);
      }
    }

    if (restoreErrors.length > 0) {
      const restoreError = new AggregateError(restoreErrors, `Unable to restore ${restoreErrors.length} quarantined deletion target(s)`);
      log.error('Permanent deletion rollback requires recovery', {
        operationId: journal.operationId,
        postId: journal.postId,
        error: restoreError
      });
      throw restoreError;
    }

    await this.removeMoveMarkers(journal);
    this.unlinkInternalFileIfPresent(appConfig.galleryRoot, journalPath, 'Deletion journal');
  }

  private async restoreEntry(entry: DeletionJournalEntry, moveCompleted: boolean): Promise<void> {
    if (!entry.wasPresent || !entry.identity) return;
    const rootPath = getRootPath(entry.root);
    const originalPath = resolveRelativePathWithinRoot(rootPath, entry.originalRelativePath, 'Journal original path');
    const quarantinePath = resolveRelativePathWithinRoot(rootPath, entry.quarantineRelativePath, 'Journal quarantine path');
    await assertNoSymlinkTraversal(rootPath, originalPath, 'Journal original path');
    await assertNoSymlinkTraversal(rootPath, quarantinePath, 'Journal quarantine path');

    const quarantineExists = await assertMatchingFile(quarantinePath, entry.identity, 'Quarantined file');
    const originalStats = await lstatIfPresent(originalPath, true);
    if (!quarantineExists) {
      if (originalStats?.isFile() && identitiesMatch(toIdentity(originalStats), entry.identity)) {
        return;
      }
      if (!moveCompleted) {
        return;
      }
      if (!originalStats || !originalStats.isFile() || !identitiesMatch(toIdentity(originalStats), entry.identity)) {
        throw new Error(`Cannot restore missing quarantined file: ${entry.originalRelativePath}`);
      }
    }
    if (originalStats) {
      throw new Error(`Cannot restore quarantined file because its original path is occupied: ${entry.originalRelativePath}`);
    }

    await this.renameValidatedFile(
      rootPath,
      quarantinePath,
      rootPath,
      originalPath,
      entry.identity,
      'Quarantine restore'
    );
  }

  private async recoverPendingDeletionsInternal(): Promise<void> {
    const journalDirectory = path.join(appConfig.galleryRoot, QUARANTINE_DIRECTORY_NAME, 'journals');
    const directoryStats = await lstatIfPresent(journalDirectory);
    if (!directoryStats) return;
    await assertNoSymlinkTraversal(appConfig.galleryRoot, journalDirectory, 'Deletion journal directory');
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error('Deletion journal path is not a directory');
    }

    const journalNames = (await fs.readdir(journalDirectory))
      .filter((name) => name.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right));
    if (journalNames.length > 0 && storageService.getState().usingInMemoryDatabase) {
      throw new Error('Cannot recover permanent deletions while the configured database is offline');
    }
    for (const journalName of journalNames) {
      const journalPath = resolveRelativePathWithinRoot(
        appConfig.galleryRoot,
        path.join(QUARANTINE_DIRECTORY_NAME, 'journals', journalName),
        'Deletion journal path'
      );
      await assertNoSymlinkTraversal(appConfig.galleryRoot, journalPath, 'Deletion journal path');
      const stats = await fs.lstat(journalPath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Deletion journal is not a regular file: ${journalName}`);
      }
      const journal = parseJournal(JSON.parse(await fs.readFile(journalPath, 'utf8')));

      if (postRepository.findById(journal.postId)) {
        await this.restoreJournal(journal, journalPath);
        log.info('Recovered interrupted permanent deletion by restoring quarantined files', {
          operationId: journal.operationId,
          postId: journal.postId
        });
      } else {
        await this.tryCleanupCommittedJournal(journal, journalPath);
      }
    }
  }

  private async tryCleanupCommittedJournal(journal: DeletionJournal, journalPath: string): Promise<void> {
    try {
      await this.cleanupCommittedJournal(journal, journalPath);
    } catch (error) {
      log.error('Permanent deletion cleanup is pending and will be retried', {
        operationId: journal.operationId,
        postId: journal.postId,
        journalPath,
        error
      });
    }
  }

  private async cleanupCommittedJournal(journal: DeletionJournal, journalPath: string): Promise<void> {
    const sourceDirectories = new Map<string, { rootPath: string; directoryPath: string }>();
    const quarantineOperationDirectories = new Map<string, { rootPath: string; directoryPath: string; stopPath: string }>();

    for (const entry of journal.entries) {
      const rootPath = getRootPath(entry.root);
      const originalPath = resolveRelativePathWithinRoot(rootPath, entry.originalRelativePath, 'Journal original path');
      const quarantinePath = resolveRelativePathWithinRoot(rootPath, entry.quarantineRelativePath, 'Journal quarantine path');
      await assertNoSymlinkTraversal(rootPath, originalPath, 'Journal original path');
      await assertNoSymlinkTraversal(rootPath, quarantinePath, 'Journal quarantine path');

      if (entry.wasPresent && entry.identity) {
        const quarantineExists = await assertMatchingFile(quarantinePath, entry.identity, 'Quarantined file');
        if (quarantineExists) this.unlinkValidatedFile(rootPath, quarantinePath, entry.identity, 'Quarantine cleanup');
      }

      sourceDirectories.set(`${entry.root}:${path.dirname(originalPath)}`, {
        rootPath,
        directoryPath: path.dirname(originalPath)
      });
      const quarantineBase = path.join(rootPath, QUARANTINE_DIRECTORY_NAME);
      quarantineOperationDirectories.set(entry.root, {
        rootPath,
        directoryPath: path.join(quarantineBase, 'files', journal.operationId),
        stopPath: quarantineBase
      });
    }

    for (const directory of sourceDirectories.values()) {
      await pruneEmptyAncestors(directory.rootPath, directory.directoryPath);
    }
    for (const directory of quarantineOperationDirectories.values()) {
      await pruneEmptyAncestors(directory.rootPath, directory.directoryPath, directory.stopPath);
    }

    await this.removeMoveMarkers(journal);
    this.unlinkInternalFileIfPresent(appConfig.galleryRoot, journalPath, 'Deletion journal');
    await this.syncDirectoryIfSupported(path.dirname(journalPath));
  }

  private async syncDirectoryIfSupported(directoryPath: string): Promise<void> {
    try {
      const handle = await fs.open(directoryPath, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    }
  }
}

export const permanentDeletionService = new PermanentDeletionService();
