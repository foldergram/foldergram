import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { appConfig } from '../config/env.js';
import { LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY } from '../constants/app-setting-keys.js';
import { databaseManager } from '../db/database.js';
import { isSupportedMediaFile } from '../utils/image-utils.js';
import { getHeicImportSetting } from '../services/heic/import-setting.js';
import { ensureWithinRoot, matchesRelativeRoot, safeJoin } from '../utils/path-utils.js';
import { PERMANENT_DELETION_QUARANTINE_DIRECTORY_NAME } from '../services/maintenance-operation-lock.js';

export const localSourceConfigSchema = z.object({
  rootPath: z.string().min(1),
  canonicalRootPath: z.string().nullable(),
  readOnlyOriginals: z.boolean()
});
export type LocalSourceConfig = z.infer<typeof localSourceConfigSchema>;
export interface LocalSource {
  id: number;
  kind: 'local';
  name: string;
  managed_by: 'environment' | 'settings';
  enabled: number;
  status: string;
  last_error: string | null;
  last_success: string | null;
  progress: number;
  asset_count: number;
  folder_count: number;
  generation: number;
  updated_at: string;
  config: LocalSourceConfig;
}
type LocalSourceRow = Omit<LocalSource, 'config'> & { config_json: string };
const localSourceColumns = 'id, kind, name, managed_by, enabled, status, last_error, last_success, progress, asset_count, folder_count, generation, updated_at, config_json';

function parseLocalSource({ config_json, ...row }: LocalSourceRow): LocalSource {
  return { ...row, config: localSourceConfigSchema.parse(JSON.parse(config_json)) };
}

function canonicalPath(root: string): string | null {
  try {
    return fs.realpathSync.native(root);
  } catch {
    return null;
  }
}

function primaryConfig(rootPath: string): LocalSourceConfig {
  return { rootPath, canonicalRootPath: canonicalPath(rootPath), readOnlyOriginals: false };
}

/** Bind the migration's unconfigured primary row before exposing the database. */
export function initializePrimaryLocalSource(db: DatabaseSync): void {
  const previous = db.prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY) as { value: string } | undefined;
  const lastRun = db.prepare("SELECT finished_at FROM scan_runs WHERE status IN ('completed', 'completed_with_errors') ORDER BY id DESC LIMIT 1")
    .get() as { finished_at: string | null } | undefined;
  const existing = db.prepare("SELECT id, config_json FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'")
    .get() as { id: number; config_json: string } | undefined;
  if (existing && existing.config_json !== '{}') {
    localSourceConfigSchema.parse(JSON.parse(existing.config_json));
    return;
  }
  // Releases without a stored root still recorded the absolute path of every local image.
  const sample = existing && !previous?.value
    ? db.prepare("SELECT relative_path, absolute_path FROM images WHERE source_id = ? AND absolute_path != '' ORDER BY id LIMIT 1")
      .get(existing.id) as { relative_path: string; absolute_path: string } | undefined
    : undefined;
  const inferredRoot = sample && path.isAbsolute(sample.absolute_path)
    ? sample.relative_path.split('/').reduce(root => path.dirname(root), sample.absolute_path)
    : null;
  const recordedRoot = previous?.value ?? (sample && inferredRoot && safeJoin(inferredRoot, sample.relative_path) === path.normalize(sample.absolute_path) ? inferredRoot : null);
  const rootPath = recordedRoot ? path.resolve(recordedRoot) : appConfig.galleryRoot;
  if (recordedRoot && !previous?.value) {
    db.prepare('INSERT INTO app_settings(key, value) VALUES (?, ?)').run(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, rootPath);
  }
  if (!recordedRoot && !lastRun && !db.prepare('SELECT 1 FROM folders WHERE source_id = ? LIMIT 1').get(existing?.id ?? -1)) {
    try {
      fs.mkdirSync(rootPath, { recursive: true });
    } catch {
      // An unavailable primary gallery does not prevent SQLite from opening.
    }
  }
  const config = JSON.stringify(primaryConfig(rootPath));
  if (!existing) {
    db.prepare("INSERT INTO media_sources (kind, managed_by, name, config_json) VALUES ('local', 'environment', 'Primary gallery', ?)").run(config);
    return;
  }
  db.prepare(`
    UPDATE media_sources SET config_json = ?, last_success = ?, status = ?,
      asset_count = (SELECT COUNT(*) FROM images WHERE source_id = ? AND is_deleted = 0),
      folder_count = (SELECT COUNT(*) FROM folders WHERE source_id = ? AND role = 'normal')
    WHERE id = ?
  `).run(config, lastRun?.finished_at ?? null, lastRun ? 'ready' : 'idle', existing.id, existing.id, existing.id);
}

const db = () => databaseManager.connection;
export function listLocalSources(): LocalSource[] {
  return (db().prepare(`SELECT ${localSourceColumns} FROM media_sources WHERE kind = 'local' ORDER BY managed_by, id`)
    .all() as unknown as LocalSourceRow[]).map(parseLocalSource);
}

export function primaryLocalSource(): LocalSource {
  const row = db().prepare(`SELECT ${localSourceColumns} FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'`)
    .get() as unknown as LocalSourceRow;
  return parseLocalSource(row);
}

export function getLocalSource(id: number): LocalSource | undefined {
  const row = db().prepare(`SELECT ${localSourceColumns} FROM media_sources WHERE id = ? AND kind = 'local'`)
    .get(id) as unknown as LocalSourceRow | undefined;
  return row ? parseLocalSource(row) : undefined;
}

export function isImmichSource(id?: number | null): boolean {
  return id != null && Boolean(db().prepare("SELECT 1 FROM media_sources WHERE id = ? AND kind = 'immich'").get(id));
}

export function isSourceVisible(id?: number | null): boolean {
  return id == null || Boolean(db().prepare("SELECT 1 FROM media_sources WHERE id = ? AND enabled = 1 AND (kind = 'local' OR status <> 'revoked')").get(id));
}

export function bindPrimaryRoot(rootPath: string): void {
  db().prepare("UPDATE media_sources SET config_json = ? WHERE kind = 'local' AND managed_by = 'environment'")
    .run(JSON.stringify(primaryConfig(rootPath)));
}

export class LocalPathError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
  }
}

function checkDirectory(rootPath: string): string {
  try {
    const canonical = fs.realpathSync.native(rootPath);
    const directory = fs.opendirSync(canonical);
    directory.closeSync();
    return canonical;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new LocalPathError('Foldergram cannot read this folder. Check its permissions.', 'permission_denied');
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new LocalPathError('This folder does not exist on the Foldergram server.', 'missing');
    throw new LocalPathError('Foldergram cannot open this folder.', 'unavailable');
  }
}

const privateDirectories = () => [appConfig.dbDir, appConfig.thumbnailsDir, appConfig.previewsDir, appConfig.scanErrorReportDir, appConfig.geodataDir];
const overlaps = (left: string, right: string) => ensureWithinRoot(left, right) || ensureWithinRoot(right, left);
const aliases = (root: string, saved?: string | null) => [...new Set([path.resolve(root), canonicalPath(root), saved].filter((item): item is string => Boolean(item)))];

export function validateLocalPath(input: string, excludeId?: number, primary = false): { rootPath: string; canonicalRootPath: string } {
  if (!path.isAbsolute(input) || input.includes('\0')) throw new LocalPathError('Enter an absolute folder path on the server.', 'invalid_path');
  const rootPath = path.resolve(input);
  const canonicalRootPath = checkDirectory(rootPath);
  if (!primary && (rootPath === path.parse(rootPath).root || canonicalRootPath === path.parse(canonicalRootPath).root)) {
    throw new LocalPathError('Choose a folder below the filesystem root.', 'filesystem_root');
  }
  const paths = [rootPath, canonicalRootPath];
  if (!primary && privateDirectories().some(directory => aliases(directory).some(privatePath => paths.some(root => overlaps(root, privatePath))))) {
    throw new LocalPathError('This folder overlaps Foldergram application storage.', 'private_storage');
  }
  for (const source of listLocalSources()) {
    if (source.id === excludeId) continue;
    const candidates = aliases(source.config.rootPath, source.config.canonicalRootPath);
    if (source.managed_by === 'environment') candidates.push(...aliases(appConfig.galleryRoot));
    if (paths.some(root => candidates.some(candidate => overlaps(root, candidate)))) {
      throw new LocalPathError(`This folder overlaps the registered source “${source.name}”.`, 'overlap');
    }
  }
  return { rootPath, canonicalRootPath };
}

export function inspectLocalPath(input: string, excludeId?: number) {
  const result = validateLocalPath(input, excludeId);
  const { enabled: heicImportEnabled } = getHeicImportSetting();
  let ignoredRootMediaCount = 0;
  let entriesChecked = 0;
  const directory = fs.opendirSync(result.canonicalRootPath);
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (entry.isFile() && isSupportedMediaFile(entry.name, heicImportEnabled)) ignoredRootMediaCount++;
      if (++entriesChecked === 1000) break;
    }
  } finally {
    directory.closeSync();
  }
  return { ...result, ignoredRootMediaCount, partial: entriesChecked === 1000 };
}

export function checkLocalSourceDirectory(source: LocalSource): string {
  const canonical = checkDirectory(source.config.rootPath);
  if (source.config.canonicalRootPath && canonical !== source.config.canonicalRootPath) {
    throw new LocalPathError('The folder now points to a different location. Reconnect the original drive.', 'root_changed');
  }
  return canonical;
}

export function resolveLocalPath(
  source: LocalSource,
  relativePath: string,
  options: { allowMissing?: boolean; rootPath?: string; scanRoot?: string } = {}
): string {
  if ((!source.enabled && !options.scanRoot) || (!options.scanRoot && !options.rootPath && ['empty_review', 'relocation_required'].includes(source.status)) || !relativePath || path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new LocalPathError('The requested file is unavailable.', 'unavailable');
  }
  if (source.managed_by === 'environment' && matchesRelativeRoot(relativePath, [
    ...appConfig.managedGalleryRelativeIgnores,
    PERMANENT_DELETION_QUARANTINE_DIRECTORY_NAME
  ])) {
    throw new LocalPathError('The requested file is unavailable.', 'private_storage');
  }
  const root = options.scanRoot ?? (options.rootPath ? checkDirectory(options.rootPath) : checkLocalSourceDirectory(source));
  const target = safeJoin(root, relativePath);
  if (target === root || privateDirectories().some(directory => aliases(directory).some(candidate => ensureWithinRoot(candidate, target)))) {
    throw new LocalPathError('The requested file is unavailable.', 'private_storage');
  }
  const parts = path.relative(root, target).split(path.sep);
  let current = root;
  for (const segment of parts) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new LocalPathError('The requested path contains a symbolic link.', 'symlink');
    } catch (error) {
      if (options.allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}

export function isLocalOriginalUnavailable(id: number): boolean {
  const source = getLocalSource(id);
  if (!source?.enabled) return false;
  if (source.status === 'empty_review' || source.status === 'relocation_required') return true;
  try {
    checkLocalSourceDirectory(source);
    return false;
  } catch {
    return true;
  }
}
