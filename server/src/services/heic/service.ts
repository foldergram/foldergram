import { randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import pLimit from 'p-limit';

import { appConfig } from '../../config/env.js';
import { HeicError, sameHeicRevision, type HeicMetadata, type HeicOutput, type HeicWorkerRequest, type HeicWorkerResult, type SourceRevision } from './protocol.js';

export { HeicError } from './protocol.js';
export const derivativeWorkLimit = pLimit(appConfig.scanDerivativeConcurrency);

export interface HeicSource {
  key: string;
  isCurrent: () => boolean;
}

type Output = { kind: HeicOutput['kind']; path: string };

interface Job {
  key: string;
  request: HeicWorkerRequest;
  foreground: boolean;
  deadline: number;
  resolve: (metadata: HeicMetadata) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending: Job[] = [];
const waitingForWorkSlot = new Set<Job>();
const workers = new Set<Worker>();
const inFlight = new Map<string, Promise<HeicMetadata>>();
const mediaFailures = new Map<string, string>();
const MAX_REMEMBERED_MEDIA_FAILURES = 128;
let admitted = 0;
let active = 0;
let foregroundStreak = 0;
let stopping = false;

const mark = '.foldergram-heic-';
const sourceWorker = import.meta.url.endsWith('.ts');
const workerUrl = new URL(sourceWorker ? './worker.ts' : './worker.js', import.meta.url);

function createWorker(request: HeicWorkerRequest): Worker {
  if (!sourceWorker) return new Worker(workerUrl, { workerData: request, execArgv: [] });

  // Vitest and tsx both execute the TypeScript service. Register tsx in
  // the new thread explicitly, since loader state is isolated per worker.
  const bootstrap = `const { workerData } = require('node:worker_threads');
    require('tsx/esm/api').tsImport(${JSON.stringify(workerUrl.href)}, workerData.sourcePathUrl)
      .catch(error => { throw error; });`;
  return new Worker(bootstrap, {
    eval: true,
    execArgv: [],
    workerData: { ...request, sourcePathUrl: import.meta.url }
  });
}

function runWorker(job: Job): Promise<HeicMetadata> {
  return new Promise((resolve, reject) => {
    const remaining = job.deadline - Date.now();
    if (stopping || remaining <= 0) {
      reject(new HeicError('busy', 'HEIC processing could not start before its deadline.'));
      return;
    }

    let worker: Worker;
    try {
      worker = createWorker(job.request);
    } catch (error) {
      reject(new HeicError('infrastructure', 'Could not start the HEIC worker.', { cause: error }));
      return;
    }
    workers.add(worker);
    let result: HeicWorkerResult | undefined;
    let failure: HeicError | undefined;
    const timeout = setTimeout(() => {
      failure = new HeicError('busy', 'HEIC processing timed out.');
      void worker.terminate();
    }, remaining);

    worker.once('message', (message: HeicWorkerResult) => { result = message; });
    worker.once('error', error => {
      failure = new HeicError('infrastructure', 'HEIC worker stopped unexpectedly.', { cause: error });
    });
    worker.once('exit', code => {
      clearTimeout(timeout);
      workers.delete(worker);
      if (failure) reject(failure);
      else if (stopping) reject(new HeicError('busy', 'HEIC processing is shutting down.'));
      else if (code !== 0 || !result) reject(new HeicError('infrastructure', 'HEIC worker exited without a result.'));
      else if ('kind' in result) reject(new HeicError(result.kind, result.message));
      else resolve(result.metadata);
    });
  });
}

function drain(): void {
  while (!stopping && active < appConfig.heicDecodeConcurrency && pending.length > 0) {
    const foreground = pending.findIndex(job => job.foreground);
    const background = pending.findIndex(job => !job.foreground);
    const index = foreground >= 0 && (background < 0 || foregroundStreak < 3) ? foreground : background;
    const [job] = pending.splice(index, 1);
    foregroundStreak = job.foreground ? foregroundStreak + 1 : 0;
    active += 1;
    waitingForWorkSlot.add(job);
    // Keep the admission deadline running while a job waits behind JPEG/video
    // work. The slot is retained until its canceled callback has drained.
    void derivativeWorkLimit(() => {
      waitingForWorkSlot.delete(job);
      clearTimeout(job.timer);
      return runWorker(job);
    }).then(job.resolve, job.reject).finally(() => {
      active -= 1;
      drain();
    });
  }
}

function submit(key: string, request: HeicWorkerRequest, foreground: boolean): Promise<HeicMetadata> {
  if (stopping || pending.length >= appConfig.heicDecodeQueueLimit) {
    throw new HeicError('busy', 'HEIC processing is busy. Try again shortly.');
  }
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + appConfig.heicJobTimeoutMs;
    const job: Job = {
      key, request, foreground, deadline, resolve, reject,
      timer: setTimeout(() => {
        const index = pending.indexOf(job);
        if (index >= 0) pending.splice(index, 1);
        reject(new HeicError('busy', 'HEIC processing waited too long for a worker.'));
      }, appConfig.heicJobTimeoutMs)
    };
    pending.push(job);
    drain();
  });
}

export async function stopHeicProcessing(): Promise<void> {
  stopping = true;
  for (const job of [...pending.splice(0), ...waitingForWorkSlot]) {
    clearTimeout(job.timer);
    job.reject(new HeicError('busy', 'HEIC processing is shutting down.'));
  }
  waitingForWorkSlot.clear();
  await Promise.allSettled([...workers].map(worker => worker.terminate()));
  await Promise.allSettled(inFlight.values());
}

async function statOriginal(sourcePath: string): Promise<SourceRevision> {
  const stats = await fs.lstat(sourcePath);
  if (!stats.isFile()) throw new HeicError('stale', 'HEIC original is unavailable.');
  return stats;
}

// Recovery is scoped to the output's managed directory and to names used
// by this worker. A previous process may have stopped between encode and rename.
async function recoverTemporaryOutputs(outputPath: string): Promise<void> {
  const directory = await fs.opendir(path.dirname(outputPath));
  const prefix = `.${path.basename(outputPath)}${mark}`;
  let inspected = 0;
  for await (const entry of directory) {
    if (++inspected > 512) break;
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const candidate = path.join(path.dirname(outputPath), entry.name);
    const stats = await fs.stat(candidate).catch(() => null);
    if (stats && Date.now() - stats.mtimeMs > 2 * appConfig.heicJobTimeoutMs) {
      await fs.rm(candidate, { force: true }).catch(() => undefined);
    }
  }
}

export async function processHeicSource(
  sourcePath: string,
  outputs: Output[] = [],
  source?: HeicSource,
  foreground = false
): Promise<HeicMetadata> {
  if (stopping) throw new HeicError('busy', 'HEIC processing is shutting down.');
  if (source && !source.isCurrent()) throw new HeicError('stale', 'The indexed HEIC source changed.');
  let revision: SourceRevision;
  try {
    revision = await statOriginal(sourcePath);
  } catch (error) {
    throw new HeicError('stale', 'The HEIC original is unavailable.', { cause: error });
  }
  if (revision.size <= 0 || revision.size > appConfig.heicMaxInputBytes) {
    throw new HeicError('media', 'HEIC input exceeds the configured byte limit or is empty.');
  }
  const { dev, ino, size, mtimeMs, ctimeMs } = revision;
  const revisionKey = JSON.stringify([source?.key, sourcePath, dev, ino, size, mtimeMs, ctimeMs, appConfig.heicMaxPixels]);
  const knownFailure = mediaFailures.get(revisionKey);
  if (foreground && knownFailure) throw new HeicError('media', knownFailure);
  const key = JSON.stringify([revisionKey, outputs]);
  const existing = inFlight.get(key);
  if (existing) {
    if (foreground) {
      const queued = pending.find(job => job.key === key);
      if (queued) queued.foreground = true;
    }
    return existing;
  }

  if (admitted >= appConfig.heicDecodeConcurrency + appConfig.heicDecodeQueueLimit) {
    throw new HeicError('busy', 'HEIC processing is busy. Try again shortly.');
  }
  admitted += 1;
  const work = (async () => {
    const temporaryOutputs = outputs.map(output => ({
      kind: output.kind,
      temporaryPath: path.join(path.dirname(output.path), `.${path.basename(output.path)}${mark}${randomUUID()}.webp`)
    }));
    try {
      for (const output of outputs) {
        await fs.mkdir(path.dirname(output.path), { recursive: true });
        await recoverTemporaryOutputs(output.path);
      }
      const metadata = await submit(key, {
        sourcePath,
        revision: { dev, ino, size, mtimeMs, ctimeMs },
        maxInputBytes: appConfig.heicMaxInputBytes,
        maxPixels: appConfig.heicMaxPixels,
        outputs: temporaryOutputs
      }, foreground);

      for (const [index, output] of outputs.entries()) {
        if (stopping || !sameHeicRevision(await statOriginal(sourcePath), revision) || (source && !source.isCurrent())) {
          throw new HeicError('stale', 'The HEIC source changed before its derivatives could be published.');
        }
        // Do not yield between the live SQLite/source check and publication.
        renameSync(temporaryOutputs[index].temporaryPath, output.path);
      }
      if (!outputs.length && (!sameHeicRevision(await statOriginal(sourcePath), revision) || (source && !source.isCurrent()))) {
        throw new HeicError('stale', 'The HEIC source changed before its metadata could be read.');
      }
      return metadata;
    } catch (error) {
      if (error instanceof HeicError && error.kind === 'media') {
        if (mediaFailures.size >= MAX_REMEMBERED_MEDIA_FAILURES) {
          const oldest = mediaFailures.keys().next();
          if (!oldest.done) mediaFailures.delete(oldest.value);
        }
        mediaFailures.set(revisionKey, error.message);
      }
      throw error;
    } finally {
      await Promise.allSettled(temporaryOutputs.map(output => fs.rm(output.temporaryPath, { force: true })));
    }
  })().finally(() => {
    admitted -= 1;
    inFlight.delete(key);
  });

  inFlight.set(key, work);
  return work;
}
