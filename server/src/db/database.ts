import type { DatabaseSync } from 'node:sqlite';

import { runStartupMigrations } from './migration.js';
import { assertNoLegacySchema } from './schema-compat.js';
import { schemaSql } from './schema.js';
import {
  checkpointSqliteWal,
  openSqliteDatabase,
  type SqliteConnectionPolicy,
  type SqliteWalCheckpointResult
} from './sqlite-connection.js';
import { appConfig } from '../config/env.js';
import { log } from '../services/log-service.js';
import { storageService } from '../services/storage-service.js';
import { getReelRandomRank } from '../utils/reels-utils.js';

const GLOBAL_DB_KEY = Symbol.for('foldergram.database.connection');

function registerSqlFunctions(db: DatabaseSync): void {
  db.function('reel_random_rank', { deterministic: true }, (idValue, seedValue) => {
    const id = Number(idValue);
    const seed = Number(seedValue);

    if (!Number.isFinite(id) || !Number.isFinite(seed)) {
      return 0;
    }

    return getReelRandomRank(id, seed);
  });
}

function synchronousLabel(synchronous: number): string {
  if (synchronous === 0) {
    return 'OFF';
  }
  if (synchronous === 1) {
    return 'NORMAL';
  }
  if (synchronous === 2) {
    return 'FULL';
  }
  if (synchronous === 3) {
    return 'EXTRA';
  }
  return String(synchronous);
}

function logConnectionPolicy(policy: SqliteConnectionPolicy): void {
  const meta = {
    busyTimeoutMs: policy.busyTimeoutMs,
    foreignKeys: policy.foreignKeys ? 'ON' : 'OFF',
    synchronous: synchronousLabel(policy.synchronous)
  };

  if (policy.fileBacked && policy.journalMode !== 'wal') {
    log.info(
      `SQLite WAL mode is unavailable; continuing with ${policy.journalMode.toUpperCase()} journal mode`,
      meta
    );
    return;
  }

  log.info(`SQLite journal mode: ${policy.journalMode.toUpperCase()}`, meta);

  if (appConfig.logVerbose) {
    log.info('SQLite connection configured', {
      ...meta,
      fileBacked: policy.fileBacked
    });
  }
}

class DatabaseManager {
  get connection(): DatabaseSync {
    const globalObj = globalThis as unknown as Record<symbol, DatabaseSync | null>;
    if (globalObj[GLOBAL_DB_KEY]) {
      return globalObj[GLOBAL_DB_KEY]!;
    }

    const databasePath = storageService.getDatabasePath();

    if (databasePath !== ':memory:') {
      runStartupMigrations({ databasePath });
    }

    const db = openSqliteDatabase(databasePath, { onConfigured: logConnectionPolicy });
    try {
      registerSqlFunctions(db);

      if (databasePath === ':memory:') {
        db.exec(schemaSql);
      } else {
        assertNoLegacySchema(db);
      }
    } catch (error) {
      db.close();
      throw error;
    }

    globalObj[GLOBAL_DB_KEY] = db;
    return db;
  }

  close(): SqliteWalCheckpointResult | null {
    const globalObj = globalThis as unknown as Record<symbol, DatabaseSync | null>;
    const db = globalObj[GLOBAL_DB_KEY];
    if (!db) {
      return null;
    }

    let checkpoint: SqliteWalCheckpointResult | null = null;

    try {
      checkpoint = checkpointSqliteWal(db);
      if (checkpoint && !checkpoint.complete) {
        log.info('SQLite WAL checkpoint incomplete; preserve WAL sidecar files with database backups', {
          busy: checkpoint.busy,
          logFrames: checkpoint.logFrames,
          checkpointedFrames: checkpoint.checkpointedFrames
        });
      }
    } catch {
      // Checkpointing is best-effort; closing still releases the connection.
    }

    try {
      db.close();
    } catch {
      // Ignore errors if already closed
    } finally {
      globalObj[GLOBAL_DB_KEY] = null;
    }

    return checkpoint;
  }
}

export const databaseManager = new DatabaseManager();
