import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { appConfig } from '../config/env.js';
import { databaseManager } from '../db/database.js';
import { getLocalSource, listLocalSources } from '../sources/local-source.js';
import type { ImageRecord } from '../types/models.js';
import { getPreviewRelativePath } from '../utils/image-utils.js';
import { isSameOrWithinPath, safeJoin } from '../utils/path-utils.js';
import { hlsCache } from './hls-cache.js';
import { hlsWindowReservation, supportsHlsEncoding, validateHlsInput } from './hls-encoder.js';
import { ensureVideoMetadata, getIndexedLocalVideo, resolveCurrentVideoOriginal } from './local-video-source.js';
import { MaintenancePausedError, maintenanceOperationLock } from './maintenance-operation-lock.js';
import { beginPreviewRemoval } from './video-preview-access.js';

const db = () => databaseManager.connection;
const batchSize = 32;
const statuses = ['failed', 'deferred'] as const;
type Outcome = 'removed' | 'switched' | 'skipped' | typeof statuses[number];
type State = 'assessing' | 'ready' | 'running' | 'complete' | 'cancelled' | 'interrupted';

interface JobData {
  id: string;
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

async function assess(job: JobData) {
  const sourceIds = job.sources.map(source => source.id);
  const select = db().prepare(
    'SELECT * FROM images WHERE id > ? AND id <= ? AND is_deleted = 0 AND is_trashed = 0 AND media_type = ' +
    "'video' AND source_id IN (" + sourceIds.map(() => '?').join(',') + ') ORDER BY id LIMIT ?'
  );
  const insert = db().prepare('INSERT OR IGNORE INTO video_preview_reclamation_items (job_id, image_id, revision, preview_path) VALUES (?, ?, ?, ?)');
  while (!job.cancelRequested) {
    const rows = select.all(job.assessmentCursor, job.maxImageId, ...sourceIds, batchSize) as unknown as ImageRecord[];
    if (!rows.length) break;
    for (const image of rows) {
      if (job.cancelRequested) return;
      let preview: Awaited<ReturnType<typeof inspectPreview>> = undefined;
      let reason: string | undefined;
      try {
        if (!getLocalSource(image.source_id)?.enabled) throw new SkipReclamation('originalUnavailable');
        preview = await inspectPreview(image);
        if (image.video_delivery_policy !== 'streaming' || preview) await checkOriginal(image);
      } catch (error) {
        reason = error instanceof SkipReclamation || error instanceof DeferReclamation ? error.message : 'unreadablePreview';
      }
      transaction(() => {
        if (reason) {
          job.assessment.skipped++;
          addReason(job.assessment.reasons, reason);
        } else {
          const switchPolicy = image.video_delivery_policy !== 'streaming';
          if (switchPolicy || preview) insert.run(job.id, image.id, image.checksum_or_fingerprint, image.preview_path);
          if (switchPolicy) job.assessment.videos++;
          if (preview) {
            job.assessment.files++;
            job.assessment.bytes += preview.size;
          }
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

function finish(job: JobData, item: Candidate, outcome: Outcome, bytes = 0, reason?: string) {
  transaction(() => {
    reverseOutcome(job, item);
    if (outcome === 'skipped' || outcome === 'failed' || outcome === 'deferred') job.result[outcome]++;
    if (outcome === 'removed') {
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

async function processCandidate(job: JobData, item: Candidate) {
  const image = getIndexedLocalVideo(item.image_id);
  if (!image || image.checksum_or_fingerprint !== item.revision || image.preview_path !== item.preview_path ||
      !job.sources.some(source => source.id === image.source_id)) throw new SkipReclamation('changed');
  const { source, snapshot } = await checkOriginal(image);
  const preview = await inspectPreview(image);
  const end = preview && beginPreviewRemoval(preview.file);
  if (preview && !end) throw new DeferReclamation('inUse');

  try {
    const current = await resolveCurrentVideoOriginal(image);
    const latest = await fs.stat(current);
    if (current !== source || latest.dev !== snapshot.dev || latest.ino !== snapshot.ino ||
        latest.ctimeMs !== snapshot.ctimeMs || latest.mtimeMs !== snapshot.mtimeMs || latest.size !== snapshot.size) {
      throw new SkipReclamation('changed');
    }
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
  const select = db().prepare(
    "SELECT * FROM video_preview_reclamation_items WHERE job_id = ? AND image_id > ? AND state IN ('queued','pending','deferred','failed') ORDER BY image_id LIMIT ?"
  );
  while (!job.cancelRequested) {
    const items = select.all(job.id, cursor, batchSize) as unknown as Candidate[];
    if (!items.length) break;
    for (const item of items) {
      if (job.cancelRequested) return;
      cursor = item.image_id;
      try {
        await maintenanceOperationLock.runExclusive(() => processCandidate(job, item));
      } catch (error) {
        if (error instanceof SkipReclamation) finish(job, item, 'skipped', 0, error.message);
        else if (error instanceof DeferReclamation || error instanceof MaintenancePausedError) {
          finish(job, item, 'deferred', 0, error instanceof DeferReclamation ? error.message : 'busy');
        } else finish(job, item, 'failed', 0, 'removalFailed');
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
  void hlsCache.recover().then(() => job.confirmed ? execute(job) : assess(job)).then(() => {
    job.state = job.cancelRequested ? 'cancelled' : job.confirmed ? 'complete' : 'ready';
  }, () => { job.state = 'interrupted'; }).finally(() => {
    activeJob = undefined;
    try { save(job); } catch { /* The durable previous state can be resumed. */ }
  });
}

export const videoPreviewReclamation = {
  list() {
    const latest = db().prepare('SELECT id FROM video_preview_reclamation ORDER BY created_at DESC LIMIT 1').get() as { id: string } | undefined;
    return {
      sources: listLocalSources().map(({ id, name }) => ({ id, name })),
      job: latest ? getJob(latest.id) : null
    };
  },
  get: getJob,
  assess(sourceId?: number): JobData | null {
    if (activeJob) return null;
    const sources = listLocalSources().filter(source => sourceId === undefined || source.id === sourceId)
      .map(({ id, name }) => ({ id, name }));
    if (!sources.length) return null;
    const { max } = db().prepare('SELECT COALESCE(MAX(id), 0) AS max FROM images').get() as { max: number };
    const job: JobData = {
      id: randomUUID(), state: 'assessing', sources, maxImageId: max, assessmentCursor: 0, confirmed: false, cancelRequested: false,
      assessment: { checked: 0, videos: 0, files: 0, bytes: 0, skipped: 0, reasons: {} },
      result: { processed: 0, switched: 0, files: 0, bytes: 0, skipped: 0, deferred: 0, failed: 0, reasons: {} }
    };
    db().prepare('INSERT INTO video_preview_reclamation VALUES (?, ?, ?, ?)').run(job.id, job.state, JSON.stringify(job), Date.now());
    launch(job);
    return job;
  },
  confirm(id: string): JobData | null {
    const job = getJob(id);
    if (activeJob || !job || job.state !== 'ready' || job.confirmed) return null;
    job.confirmed = true;
    launch(job);
    return job;
  },
  cancel(id: string): JobData | null {
    if (!activeJob || activeJob.id !== id) return null;
    activeJob.cancelRequested = true;
    save(activeJob);
    return activeJob;
  },
  retry(id: string): JobData | null {
    const job = getJob(id);
    if (activeJob || !job || !(job.state === 'interrupted' || job.state === 'cancelled' ||
        (job.state === 'complete' && (job.result.deferred || job.result.failed)))) return null;
    launch(job);
    return job;
  }
};
