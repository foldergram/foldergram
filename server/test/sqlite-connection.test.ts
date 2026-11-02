import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openSqliteDatabase,
  SQLITE_BUSY_TIMEOUT_MS,
  type SqliteConnectionPolicy
} from '../src/db/sqlite-connection.js';

const LOCK_WORKER_SOURCE = `
  const { parentPort, workerData } = require('node:worker_threads');
  const { DatabaseSync } = require('node:sqlite');

  const releasedAt = new BigInt64Array(workerData.releasedAt);
  const database = new DatabaseSync(workerData.databasePath);

  parentPort.once('message', () => {
    database.exec('BEGIN IMMEDIATE');
    parentPort.postMessage('locked');

    setTimeout(() => {
      database.exec('ROLLBACK');
      database.close();
      Atomics.store(releasedAt, 0, BigInt(Date.now()));
      parentPort.postMessage('released');
    }, workerData.holdMs);
  });
`;

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-sqlite-'));
  tempDirectories.push(directory);
  return directory;
}

function waitForWorkerMessage(worker: Worker, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    function cleanup(): void {
      worker.off('message', onMessage);
      worker.off('error', onError);
    }

    function onMessage(message: unknown): void {
      if (message === expected) {
        cleanup();
        resolve();
      }
    }

    function onError(error: Error): void {
      cleanup();
      reject(error);
    }

    worker.on('message', onMessage);
    worker.on('error', onError);
  });
}

function startLockWorker(databasePath: string, holdMs: number): {
  worker: Worker;
  releasedAt: BigInt64Array;
} {
  const releasedAt = new BigInt64Array(new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT));
  const worker = new Worker(LOCK_WORKER_SOURCE, {
    eval: true,
    workerData: {
      databasePath,
      holdMs,
      releasedAt: releasedAt.buffer
    }
  });

  return { worker, releasedAt };
}

async function acquireWorkerLock(worker: Worker): Promise<void> {
  const locked = waitForWorkerMessage(worker, 'locked');
  worker.postMessage('lock');
  await locked;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('sqlite connection policy', () => {
  it('configures file-backed databases with WAL, foreign keys, a busy timeout, and NORMAL synchronous mode', async () => {
    const tempRoot = await createTempDirectory();
    const databasePath = path.join(tempRoot, 'gallery.sqlite');
    let observedPolicy: SqliteConnectionPolicy | undefined;

    const database = openSqliteDatabase(databasePath, {
      onConfigured: (policy) => {
        observedPolicy = policy;
      }
    });

    try {
      expect(observedPolicy).toEqual({
        fileBacked: true,
        foreignKeys: true,
        busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
        journalMode: 'wal',
        synchronous: 1
      });
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(database.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: SQLITE_BUSY_TIMEOUT_MS });
      expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
      expect(database.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 });
    } finally {
      database.close();
    }
  });

  it('initializes in-memory databases without forcing WAL mode', () => {
    let observedPolicy: SqliteConnectionPolicy | undefined;
    const database = openSqliteDatabase(':memory:', {
      onConfigured: (policy) => {
        observedPolicy = policy;
      }
    });

    try {
      expect(observedPolicy).toMatchObject({
        fileBacked: false,
        foreignKeys: true,
        busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
        journalMode: 'memory'
      });
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'memory' });
    } finally {
      database.close();
    }
  });

  it('waits for a short write lock and then completes the write', async () => {
    const tempRoot = await createTempDirectory();
    const databasePath = path.join(tempRoot, 'gallery.sqlite');
    const database = openSqliteDatabase(databasePath);

    database.exec('CREATE TABLE lock_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)');

    const { worker, releasedAt } = startLockWorker(databasePath, 400);

    try {
      await acquireWorkerLock(worker);

      const released = waitForWorkerMessage(worker, 'released');
      database.prepare('INSERT INTO lock_probe(value) VALUES (?)').run('writer-completed');
      await released;

      const releasedTimestamp = Number(Atomics.load(releasedAt, 0));
      expect(releasedTimestamp).toBeGreaterThan(0);
      expect(Date.now()).toBeGreaterThanOrEqual(releasedTimestamp);
      expect(database.prepare('SELECT COUNT(*) AS count FROM lock_probe').get()).toEqual({ count: 1 });
    } finally {
      database.close();
      await worker.terminate();
    }
  });

  it('fails with a controlled lock error after the busy timeout and remains usable', async () => {
    const tempRoot = await createTempDirectory();
    const databasePath = path.join(tempRoot, 'gallery.sqlite');
    const database = openSqliteDatabase(databasePath, { busyTimeoutMs: 200 });

    database.exec('CREATE TABLE lock_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)');

    const { worker } = startLockWorker(databasePath, 900);

    try {
      await acquireWorkerLock(worker);

      const startedAt = Date.now();
      expect(() => {
        database.prepare('INSERT INTO lock_probe(value) VALUES (?)').run('blocked-writer');
      }).toThrow(/locked|busy/i);
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(100);
      expect(elapsedMs).toBeLessThan(2000);

      await waitForWorkerMessage(worker, 'released');
      database.prepare('INSERT INTO lock_probe(value) VALUES (?)').run('retry-completed');
      expect(database.prepare('SELECT COUNT(*) AS count FROM lock_probe').get()).toEqual({ count: 1 });
    } finally {
      database.close();
      await worker.terminate();
    }
  });
});
