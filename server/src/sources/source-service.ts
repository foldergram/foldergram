import fs from 'node:fs/promises';
import { z } from 'zod';
import { appConfig } from '../config/env.js';
import { databaseManager } from '../db/database.js';
import { listSources as listImmichSources, sourceStatuses as immichStatuses } from '../immich/source-service.js';
import { maintenanceRepository } from '../db/repositories.js';
import { maintenanceOperationLock } from '../services/maintenance-operation-lock.js';
import { permanentDeletionService } from '../services/permanent-deletion-service.js';
import { scannerService } from '../services/scanner-service.js';
import { watcherService } from '../services/watcher-service.js';
import { log } from '../services/log-service.js';
import { safeJoin } from '../utils/path-utils.js';
import { checkLocalSourceDirectory, getLocalSource, listLocalSources, validateLocalPath, type LocalSource } from './local-source.js';

const sourceName = z.string().trim().min(1).max(100);
const rootPath = z.string().trim().min(1).max(4096);

export const localSourceInput = z.object({
  kind: z.literal('local'),
  name: sourceName,
  rootPath,
  readOnlyOriginals: z.boolean().default(true),
  enabled: z.boolean().default(true)
}).strict();

export const localSourcePatch = z.object({
  kind: z.literal('local'),
  name: sourceName.optional(),
  rootPath: rootPath.optional(),
  readOnlyOriginals: z.boolean().optional(),
  enabled: z.boolean().optional()
}).strict();

const db = () => databaseManager.connection;
const availability = new Map<number, { root: string; available: boolean; checkedAt: number }>();

function localAvailable(source: LocalSource, retry = false): boolean {
  if (!source.enabled || source.status === 'relocation_required' || source.status === 'empty_review') return false;
  const previous = availability.get(source.id);
  if (!retry && previous?.root === source.config.rootPath && Date.now() - previous.checkedAt < 5000) return previous.available;
  let available = false;
  try {
    checkLocalSourceDirectory(source);
    available = true;
  } catch {
    // The client gets the availability flag without the underlying OS error.
  }
  availability.set(source.id, { root: source.config.rootPath, available, checkedAt: Date.now() });
  return available;
}

function sourceCapabilities(source: LocalSource) {
  const managed = source.managed_by === 'settings';
  return { canEdit: managed, canRemove: managed, canSync: Boolean(source.enabled), canWriteOriginals: !source.config.readOnlyOriginals };
}

export function listManagedSources() {
  return [
    ...listLocalSources().map(({ config, ...source }) => {
      const scan = scannerService.getSourceProgress(source.id);
      return {
        ...source, ...config, ...sourceCapabilities({ ...source, config }),
        available: localAvailable({ ...source, config }),
        syncing: scan.syncing, progress: scan.syncing ? scan.progress : source.progress
      };
    }),
    ...listImmichSources().map(source => ({
      ...source,
      canSync: Boolean(source.enabled),
      canEdit: source.managed_by === 'settings',
      canRemove: source.managed_by === 'settings',
      canWriteOriginals: false
    }))
  ];
}

export async function listPublicSourceStatuses(retry = false) {
  const immich = await immichStatuses(retry);
  const local = listLocalSources().map(source => ({
    id: source.id,
    kind: source.kind,
    name: source.name,
    enabled: source.enabled,
    status: source.status,
    generation: source.generation,
    updated_at: source.updated_at,
    available: localAvailable(source, retry),
    syncing: scannerService.getSourceProgress(source.id).syncing
  }));
  return [...local, ...immich];
}

export async function createLocalSource(input: z.infer<typeof localSourceInput>): Promise<number> {
  return maintenanceOperationLock.runExclusive(async () => {
    const paths = validateLocalPath(input.rootPath);
    const config = JSON.stringify({ ...paths, readOnlyOriginals: input.readOnlyOriginals });
    return Number(db().prepare("INSERT INTO media_sources(kind,name,enabled,config_json) VALUES('local',?,?,?)")
      .run(input.name, Number(input.enabled), config).lastInsertRowid);
  });
}

export async function patchLocalSource(id: number, input: z.infer<typeof localSourcePatch>): Promise<void> {
  if (scannerService.getSourceProgress(id).syncing) throw new Error('Wait for this source to finish syncing.');
  await maintenanceOperationLock.runExclusive(async () => {
    const source = getLocalSource(id);
    if (!source) throw new Error('Source not found.');
    if (source.managed_by === 'environment') throw new Error('The primary gallery is managed by environment configuration.');
    if (input.rootPath !== undefined && input.rootPath !== source.config.rootPath) {
      throw new Error('Add a new source to change the gallery path.');
    }
    const editWrites = input.readOnlyOriginals !== undefined && input.readOnlyOriginals !== source.config.readOnlyOriginals;
    if (editWrites) {
      await permanentDeletionService.recoverPendingDeletionsWhileLocked();
      if (permanentDeletionService.hasPendingSourceRecovery(id)) throw new Error('Resolve pending deletion recovery for this source first.');
    }
    const enabled = input.enabled ?? Boolean(source.enabled);
    const config = { ...source.config, readOnlyOriginals: input.readOnlyOriginals ?? source.config.readOnlyOriginals };
    const name = input.name ?? source.name;
    db().prepare('UPDATE media_sources SET name=?, enabled=?, config_json=?, generation=generation+?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name, Number(enabled), JSON.stringify(config), Number(enabled !== Boolean(source.enabled) || name !== source.name || editWrites), id);
    availability.delete(id);
  });
  await watcherService.refresh();
}

export async function removeLocalSource(id: number): Promise<void> {
  if (scannerService.getSourceProgress(id).syncing) throw new Error('Wait for this source to finish syncing.');
  await maintenanceOperationLock.runExclusive(async () => {
    const source = getLocalSource(id);
    if (!source) throw new Error('Source not found.');
    if (source.managed_by === 'environment') throw new Error('The primary gallery cannot be removed.');
    await permanentDeletionService.recoverPendingDeletionsWhileLocked();
    if (permanentDeletionService.hasPendingSourceRecovery(id)) throw new Error('Resolve pending deletion recovery for this source first.');
    const derivatives = db().prepare('SELECT thumbnail_path, preview_path FROM images WHERE source_id=?').all(id) as Array<{ thumbnail_path: string; preview_path: string }>;
    maintenanceRepository.resetLibraryIndex(id, true);
    availability.delete(id);

    for (const row of derivatives) {
      for (const [directory, column] of [[appConfig.thumbnailsDir, 'thumbnail_path'], [appConfig.previewsDir, 'preview_path']] as const) {
        const relativePath = row[column];
        if (!relativePath || db().prepare(`SELECT 1 FROM images WHERE ${column} = ? LIMIT 1`).get(relativePath)) continue;
        try {
          await fs.rm(safeJoin(directory, relativePath), { force: true });
        } catch (error) {
          log.error('Could not remove a derivative from a removed source', error);
        }
      }
    }
  });
  await watcherService.refresh();
}
