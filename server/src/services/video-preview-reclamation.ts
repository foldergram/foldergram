import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { appConfig } from '../config/env.js';
import { databaseManager } from '../db/database.js';
import { listFolderIdsRequiringSharedPreviews } from '../db/repositories.js';
import { getLocalSource, listLocalSources } from '../sources/local-source.js';
import type { ImageRecord } from '../types/models.js';
import { getPreviewRelativePath } from '../utils/image-utils.js';
import { isSameOrWithinPath, safeJoin } from '../utils/path-utils.js';
import { isDirectPlayableVideoEligible } from '../utils/video-playback-policy.js';
import { writeVideoPreview } from './derivative-service.js';
import { derivativeWorkLimit } from './heic/service.js';
import { hlsCache } from './hls-cache.js';
import { hlsWindowReservation, supportsHlsEncoding, validateHlsInput } from './hls-encoder.js';
import { ensureVideoMetadata, getIndexedLocalVideo, resolveCurrentVideoOriginal } from './local-video-source.js';
import { MaintenancePausedError, maintenanceOperationLock } from './maintenance-operation-lock.js';
import { beginPreviewRemoval } from './video-preview-access.js';

const db = () => databaseManager.connection;
const batchSize = 32;
const statuses = ['failed', 'deferred'] as const;
type Outcome = 'removed' | 'generated' | 'switched' | 'skipped' | typeof statuses[number];
type TargetMode = typeof appConfig.videoDeliveryMode;
type State = 'assessing' | 'ready' | 'running' | 'complete' | 'cancelled' | 'interrupted';

interface JobData {
  id: string;
  targetMode?: TargetMode;
  state: State;
  sources: Array<{ id: number; name: string }>;
  assessment: { checked: number; videos: number; files: number; bytes: number; skipped: number; reasons: Record<string, number> };
  result: { processed: number; switched: number; files: number; bytes: number; skipped: number; deferred: number; failed: number; reasons: Record<string, number> };
  maxImageId: number;
  assessmentCursor: number;
  confirmed: boolean;
  cancelRequested: boolean;
}
interface Candidate {
  image_id: number;
  revision: string;
  preview_path: string;
  state: 'queued' | 'pending' | Outcome;
  pending_bytes: number;
  reason: string | null;
}

class SkipReclamation extends Error {}
class DeferReclamation extends Error {}

// Jobs persisted before preview generation was added are cleanup jobs.
const modeOf = (job: JobData): TargetMode => job.targetMode ?? 'streaming';
const jobModeSql = "COALESCE(json_extract(data, '$.targetMode'), 'streaming')";

function transaction(work: () => void) {
  db().exec('BEGIN IMMEDIATE');
  try {
    work();
    db().exec('COMMIT');
  } catch (error) {
    db().exec('ROLLBACK');
    throw error;
  }
}

function save(job: JobData) {
  db().prepare('UPDATE video_preview_reclamation SET state = ?, data = ? WHERE id = ?')
    .run(job.state, JSON.stringify(job), job.id);
}

let activeJob: JobData | undefined;

function getJob(id: string): JobData | null {
  if (activeJob?.id === id) return activeJob;
  const row = db().prepare('SELECT data FROM video_preview_reclamation WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  const job = JSON.parse(row.data) as JobData;
  if (job.state === 'running' || job.state === 'assessing') {
    job.state = 'interrupted';
    save(job);
  }
  return job;
}

function addReason(reasons: Record<string, number>, reason: string, by = 1) {
  const count = (reasons[reason] ?? 0) + by;
  if (count > 0) reasons[reason] = count;
  else delete reasons[reason];
}

async function checkOriginal(image: ImageRecord) {
  try {
    const source = await resolveCurrentVideoOriginal(image);
    const snapshot = await fs.stat(source);
    const metadata = await ensureVideoMetadata(image, source);
    const supported = metadata.video?.codec &&
      metadata.video.index != null && (metadata.durationMs ?? 0) > 0 &&
      await supportsHlsEncoding(metadata, metadata.video.codec) &&
      appConfig.hlsCacheMaxBytes >= hlsWindowReservation.low;
    if (!supported) throw new SkipReclamation('unsupported');
    await validateHlsInput(source, metadata);
    return { source, snapshot };
  } catch (error) {
    if (error instanceof SkipReclamation) throw error;
    const status = (error as { status?: number }).status;
    if (status === 503) throw new DeferReclamation('busy');
    throw new SkipReclamation(status === 409 ? 'originalUnavailable' : 'unsupported');
  }
}

async function inspectPreview(image: ImageRecord): Promise<{ file: string; size: number } | undefined> {
  if (!image.preview_path) return;
  if (!/\.mp4$/i.test(image.preview_path) || image.preview_path.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
    throw new SkipReclamation('unsafePreview');
  }
  const file = safeJoin(appConfig.previewsDir, image.preview_path);
  const mirrored = getPreviewRelativePath(image.relative_path, 'video');
  if (image.preview_path !== mirrored && (!image.asset_key || path.basename(file) !== image.asset_key + '.mp4')) {
    throw new SkipReclamation('unsafePreview');
  }
  try {
    const stats = await fs.lstat(file);
    const reference = db().prepare('SELECT 1 FROM images WHERE preview_path = ? AND id <> ? LIMIT 1').get(image.preview_path, image.id);
    if (reference) throw new SkipReclamation('sharedPreview');
    const root = await fs.realpath(appConfig.previewsDir);
    if (listLocalSources().some(source => {
      const gallery = source.config.canonicalRootPath ?? source.config.rootPath;
      return isSameOrWithinPath(root, gallery) || isSameOrWithinPath(gallery, root);
    })) throw new SkipReclamation('unsafePreview');
    const expected = path.join(root, path.relative(appConfig.previewsDir, file));
    if (!stats.isFile() || stats.nlink !== 1 || await fs.realpath(file) !== expected) {
      throw new SkipReclamation('unsafePreview');
    }
    return { file, size: stats.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

function requiresPreview(image: ImageRecord, sharedFolders: Set<number>) {
  return sharedFolders.has(image.folder_id) || !isDirectPlayableVideoEligible({
    mediaType: image.media_type, extension: image.extension, fileSize: image.file_size,
    width: image.width, playbackStrategy: image.playback_strategy
  });
}

async function resolvePreviewDestination(image: ImageRecord): Promise<string> {
  // Validate every existing directory before the writer creates missing parents.
  const file = safeJoin(appConfig.previewsDir, image.preview_path);
  const relative = path.relative(appConfig.previewsDir, file);
  const mirrored = getPreviewRelativePath(image.relative_path, 'video');
  if (!/\.mp4$/i.test(relative) || relative.split(path.sep).some(segment => segment.startsWith('.')) ||
      (image.preview_path !== mirrored && (!image.asset_key || path.basename(file) !== image.asset_key + '.mp4'))) {
    throw new SkipReclamation('unsafePreview');
  }
  if (db().prepare('SELECT 1 FROM images WHERE preview_path = ? AND id <> ? LIMIT 1').get(image.preview_path, image.id)) {
    throw new SkipReclamation('sharedPreview');
  }
  const root = await fs.realpath(appConfig.previewsDir);
  const galleryRoots = listLocalSources().flatMap(({ config }) => [config.rootPath, config.canonicalRootPath]);
  if (galleryRoots.some(gallery => gallery && (isSameOrWithinPath(root, gallery) || isSameOrWithinPath(gallery, root)))) {
    throw new SkipReclamation('unsafePreview');
  }

  let current = root;
  const segments = relative.split(path.sep);
  const filename = segments.pop()!;
  for (const directory of segments) {
    current = path.join(current, directory);
    const stats = await lstatIfPresent(current);
    if (stats && !stats.isDirectory()) throw new SkipReclamation('unsafePreview');
  }
  const destination = path.join(current, filename);
  const stats = await lstatIfPresent(destination);
  if (stats && (!stats.isFile() || stats.nlink !== 1)) throw new SkipReclamation('unsafePreview');
  return destination;
}

async function lstatIfPresent(file: string) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function assess(job: JobData) {
  const sourceIds = job.sources.map(source => source.id);
  const restoring = modeOf(job) === 'previews';
  const sharedFolders = restoring ? listFolderIdsRequiringSharedPreviews() : new Set<number>();
  const select = db().prepare(
    'SELECT * FROM images WHERE id > ? AND id <= ? AND is_deleted = 0 AND is_trashed = 0 AND media_type = ' +
    "'video' AND source_id IN (" + sourceIds.map(() => '?').join(',') + ')' +
    (restoring ? " AND video_delivery_policy = 'streaming'" : '') + ' ORDER BY id LIMIT ?'
  );
  const insert = db().prepare('INSERT OR IGNORE INTO video_preview_reclamation_items (job_id, image_id, revision, preview_path) VALUES (?, ?, ?, ?)');
  while (!job.cancelRequested) {
    const rows = select.all(job.assessmentCursor, job.maxImageId, ...sourceIds, batchSize) as unknown as ImageRecord[];
    if (!rows.length) break;
    for (const image of rows) {
      if (job.cancelRequested) return;
      let preview: Awaited<ReturnType<typeof inspectPreview>> = undefined;
      let needsPreview = false;
      let reason: string | undefined;
      try {
        if (!getLocalSource(image.source_id)?.enabled) throw new SkipReclamation('originalUnavailable');
        if (restoring) {
          await resolveCurrentVideoOriginal(image);
          needsPreview = requiresPreview(image, sharedFolders);
          if (needsPreview) await resolvePreviewDestination(image);
        } else {
          preview = await inspectPreview(image);
          if (image.video_delivery_policy !== 'streaming' || preview) await checkOriginal(image);
        }
      } catch (error) {
        reason = error instanceof SkipReclamation || error instanceof DeferReclamation ? error.message
          : (error as { status?: number }).status === 409 ? 'originalUnavailable' : 'unreadablePreview';
      }
      transaction(() => {
        if (reason) {
          job.assessment.skipped++;
          addReason(job.assessment.reasons, reason);
        } else {
          const switchPolicy = image.video_delivery_policy !== modeOf(job);
          if (switchPolicy || preview) insert.run(job.id, image.id, image.checksum_or_fingerprint, image.preview_path);
          if (switchPolicy) job.assessment.videos++;
          if (needsPreview || preview) job.assessment.files++;
          if (preview) job.assessment.bytes += preview.size;
        }
        job.assessment.checked++;
        job.assessmentCursor = image.id;
        save(job);
      });
    }
    await setImmediate();
  }
}

function reverseOutcome(job: JobData, item: Candidate) {
  if (item.state !== 'failed' && item.state !== 'deferred') return;
  job.result[item.state]--;
  job.result.processed--;
  if (item.reason) addReason(job.result.reasons, item.reason, -1);
}

function finish(job: JobData, item: Candidate, outcome: Outcome, bytes = 0, reason?: string, commitSwitch?: () => void) {
  transaction(() => {
    reverseOutcome(job, item);
    commitSwitch?.();
    if (outcome === 'skipped' || outcome === 'failed' || outcome === 'deferred') job.result[outcome]++;
    if (outcome === 'removed' || outcome === 'generated') {
      job.result.files++;
      job.result.bytes += bytes;
    }
    if (reason) addReason(job.result.reasons, reason);
    job.result.processed++;
    db().prepare('UPDATE video_preview_reclamation_items SET state = ?, reason = ?, pending_bytes = ? WHERE job_id = ? AND image_id = ?')
      .run(outcome, reason ?? null, item.pending_bytes, job.id, item.image_id);
    save(job);
  });
}

// An older retry must not undo a successful switch made by a newer job.
function wasSuperseded(job: JobData, item: Candidate): boolean {
  return Boolean(db().prepare(`
    SELECT 1 FROM video_preview_reclamation
    WHERE rowid > (SELECT rowid FROM video_preview_reclamation WHERE id = ?) AND ${jobModeSql} <> ?
      AND EXISTS (SELECT 1 FROM video_preview_reclamation_items AS item
        WHERE item.job_id = video_preview_reclamation.id AND item.image_id = ? AND item.revision = ?
          AND item.state IN ('removed', 'generated', 'switched')) LIMIT 1
  `).get(job.id, modeOf(job), item.image_id, item.revision));
}

async function restorePreview(job: JobData, item: Candidate, image: ImageRecord, sharedFolders: Set<number>) {
  if (image.video_delivery_policy !== 'streaming') throw new SkipReclamation('changed');
  const source = await resolveCurrentVideoOriginal(image);
  const snapshot = await fs.stat(source);
  const needsPreview = requiresPreview(image, sharedFolders);
  const destination = needsPreview ? await resolvePreviewDestination(image) : undefined;
  if (destination) {
    await derivativeWorkLimit(() => writeVideoPreview(source, destination, async () => {
      await verifyOriginalSnapshot(image, source, snapshot);
      if (await resolvePreviewDestination(image) !== destination) throw new SkipReclamation('unsafePreview');
    }));
  } else {
    await validateHlsInput(source, await ensureVideoMetadata(image, source));
    await verifyOriginalSnapshot(image, source, snapshot);
  }

  finish(job, item, destination ? 'generated' : 'switched', 0, undefined, () => {
    db().prepare("UPDATE images SET video_delivery_policy = 'previews' WHERE id = ?").run(image.id);
    job.result.switched++;
  });
}

async function verifyOriginalSnapshot(image: ImageRecord, source: string, snapshot: Awaited<ReturnType<typeof fs.stat>>) {
  const current = await resolveCurrentVideoOriginal(image);
  const latest = await fs.stat(current);
  if (current !== source || latest.dev !== snapshot.dev || latest.ino !== snapshot.ino ||
      latest.ctimeMs !== snapshot.ctimeMs || latest.mtimeMs !== snapshot.mtimeMs || latest.size !== snapshot.size) {
    throw new SkipReclamation('changed');
  }
}

async function processCandidate(job: JobData, item: Candidate, sharedFolders: Set<number>) {
  const image = getIndexedLocalVideo(item.image_id);
  if (!image || image.checksum_or_fingerprint !== item.revision || image.preview_path !== item.preview_path ||
      !job.sources.some(source => source.id === image.source_id) || wasSuperseded(job, item)) throw new SkipReclamation('changed');
  if (modeOf(job) === 'previews') return restorePreview(job, item, image, sharedFolders);
  const { source, snapshot } = await checkOriginal(image);
  const preview = await inspectPreview(image);
  const end = preview && beginPreviewRemoval(preview.file);
  if (preview && !end) throw new DeferReclamation('inUse');

  try {
    await verifyOriginalSnapshot(image, source, snapshot);
    transaction(() => {
      reverseOutcome(job, item);
      if (image.video_delivery_policy !== 'streaming') {
        db().prepare("UPDATE images SET video_delivery_policy = 'streaming' WHERE id = ? AND checksum_or_fingerprint = ?")
          .run(image.id, item.revision);
        job.result.switched++;
      }
      item.pending_bytes = preview?.size ?? item.pending_bytes;
      db().prepare("UPDATE video_preview_reclamation_items SET state = 'pending', reason = NULL, pending_bytes = ? WHERE job_id = ? AND image_id = ?")
        .run(item.pending_bytes, job.id, item.image_id);
      save(job);
    });
    item.state = 'pending';
    if (preview) await fs.unlink(preview.file);
    finish(job, item, preview || item.pending_bytes > 0 ? 'removed' : 'switched', item.pending_bytes);
  } finally {
    end?.();
  }
}

async function execute(job: JobData) {
  let cursor = 0;
  const restoring = modeOf(job) === 'previews';
  const select = db().prepare(
    "SELECT * FROM video_preview_reclamation_items WHERE job_id = ? AND image_id > ? AND state IN ('queued','pending','deferred','failed') ORDER BY image_id LIMIT ?"
  );
  while (!job.cancelRequested) {
    const items = select.all(job.id, cursor, batchSize) as unknown as Candidate[];
    if (!items.length) break;
    const sharedFolders = restoring ? listFolderIdsRequiringSharedPreviews() : new Set<number>();
    for (const item of items) {
      if (job.cancelRequested) return;
      cursor = item.image_id;
      try {
        await maintenanceOperationLock.runExclusive(() => processCandidate(job, item, sharedFolders));
      } catch (error) {
        if (error instanceof SkipReclamation) finish(job, item, 'skipped', 0, error.message);
        else if (error instanceof DeferReclamation || error instanceof MaintenancePausedError || (error as { status?: number }).status === 503) {
          finish(job, item, 'deferred', 0, error instanceof DeferReclamation ? error.message : 'busy');
        } else if ((error as { status?: number }).status === 409) finish(job, item, 'skipped', 0, 'originalUnavailable');
        else finish(job, item, 'failed', 0, restoring ? 'generationFailed' : 'removalFailed');
      }
    }
    await setImmediate();
  }
}

function launch(job: JobData) {
  job.cancelRequested = false;
  job.state = job.confirmed ? 'running' : 'assessing';
  save(job);
  activeJob = job;
  const prepare = modeOf(job) === 'streaming' ? hlsCache.recover() : Promise.resolve();
  void prepare.then(() => job.confirmed ? execute(job) : assess(job)).then(() => {
    job.state = job.cancelRequested ? 'cancelled' : job.confirmed ? 'complete' : 'ready';
  }, () => { job.state = 'interrupted'; }).finally(() => {
    activeJob = undefined;
    try { save(job); } catch { /* The durable previous state can be resumed. */ }
  });
}

const localVideos = `
  FROM images JOIN media_sources ON media_sources.id = images.source_id
  WHERE media_sources.kind = 'local' AND media_sources.enabled = 1
    AND images.media_type = 'video' AND images.is_deleted = 0 AND images.is_trashed = 0
`;

function hasIndexedCleanupWork() {
  // Overview requests must stay database-only. preview_path is a destination
  // even when no file exists, so actual leftover files are found by assessment.
  return Boolean(db().prepare(`
    SELECT 1 ${localVideos} AND images.video_delivery_policy IS NOT 'streaming' LIMIT 1
  `).get());
}

export const videoPreviewReclamation = {
  async list(targetMode: TargetMode) {
    const cleanupPending = targetMode === 'streaming' && appConfig.videoDeliveryMode === 'streaming'
      ? hasIndexedCleanupWork() : false;
    const latest = db().prepare(`SELECT id FROM video_preview_reclamation WHERE ${jobModeSql} = ? ORDER BY rowid DESC LIMIT 1`)
      .get(targetMode) as { id: string } | undefined;
    const sources = listLocalSources().filter(source => targetMode === 'streaming' || source.enabled)
      .map(({ id, name }) => ({ id, name }));
    const streamingCount = targetMode === 'previews' && appConfig.videoDeliveryMode === 'previews'
      ? (db().prepare(`
        SELECT COUNT(*) AS count ${localVideos} AND images.video_delivery_policy = 'streaming'
      `).get() as { count: number }).count : 0;
    return { sources, job: this.summarize(latest ? getJob(latest.id) : null), streamingCount, cleanupPending };
  },
  get(id: string, targetMode: TargetMode): JobData | null {
    const job = getJob(id);
    return job && modeOf(job) === targetMode ? job : null;
  },
  summarize(job: JobData | null) {
    if (!job || modeOf(job) !== 'previews' || !job.result.failed) return job;
    const failedVideos = db().prepare(`
      SELECT images.filename FROM video_preview_reclamation_items AS item
      JOIN images ON images.id = item.image_id AND images.checksum_or_fingerprint = item.revision
      WHERE item.job_id = ? AND item.state = 'failed' ORDER BY item.image_id LIMIT 10
    `).all(job.id) as Array<{ filename: string }>;
    return { ...job, failedVideos: failedVideos.map(video => video.filename) };
  },
  assess(sourceId: number | undefined, targetMode: TargetMode): JobData | null {
    if (activeJob || appConfig.videoDeliveryMode !== targetMode) return null;
    const sources = listLocalSources().filter(source =>
      (targetMode === 'streaming' || source.enabled) && (sourceId === undefined || source.id === sourceId))
      .map(({ id, name }) => ({ id, name }));
    if (!sources.length) return null;
    const { max } = db().prepare('SELECT COALESCE(MAX(id), 0) AS max FROM images').get() as { max: number };
    const job: JobData = {
      id: randomUUID(), targetMode, state: 'assessing', sources, maxImageId: max, assessmentCursor: 0, confirmed: false, cancelRequested: false,
      assessment: { checked: 0, videos: 0, files: 0, bytes: 0, skipped: 0, reasons: {} },
      result: { processed: 0, switched: 0, files: 0, bytes: 0, skipped: 0, deferred: 0, failed: 0, reasons: {} }
    };
    db().prepare('INSERT INTO video_preview_reclamation VALUES (?, ?, ?, ?)').run(job.id, job.state, JSON.stringify(job), Date.now());
    launch(job);
    return job;
  },
  confirm(id: string, targetMode: TargetMode): JobData | null {
    const job = this.get(id, targetMode);
    if (activeJob || appConfig.videoDeliveryMode !== targetMode || !job || job.state !== 'ready' || job.confirmed ||
        (!job.assessment.videos && !job.assessment.files)) return null;
    job.confirmed = true;
    launch(job);
    return job;
  },
  cancel(id: string, targetMode: TargetMode): JobData | null {
    if (!activeJob || activeJob.id !== id || modeOf(activeJob) !== targetMode) return null;
    activeJob.cancelRequested = true;
    save(activeJob);
    return activeJob;
  },
  retry(id: string, targetMode: TargetMode): JobData | null {
    const job = this.get(id, targetMode);
    if (activeJob || !job || !(job.state === 'interrupted' || job.state === 'cancelled' ||
        (job.state === 'complete' && (job.result.deferred || job.result.failed)))) return null;
    launch(job);
    return job;
  }
};
