import { DatabaseSync } from 'node:sqlite';

import { runStartupMigrations } from './migration.js';
import { assertNoLegacySchema } from './schema-compat.js';
import { schemaSql } from './schema.js';
import { storageService } from '../services/storage-service.js';

function initializeTransientDatabase(database: DatabaseSync): DatabaseSync {
  database.exec(schemaSql);
  return database;
}

// Without sqlite_stat1 the planner guesses index selectivity and can pick a
// disastrous join order (folder summaries measured 15s instead of 10ms).
// PRAGMA optimize only re-analyses tables whose stats are missing or stale.
function refreshQueryPlannerStatistics(database: DatabaseSync): void {
  try {
    const statsTable = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1' LIMIT 1")
      .get() as { present: number } | undefined;
    if (statsTable) {
      database.exec('PRAGMA optimize');
      return;
    }
    database.exec('ANALYZE');
  } catch {
    // Statistics are an optimisation only; never block startup on them.
  }
}

const GLOBAL_DB_KEY = Symbol.for('foldergram.database.connection');

class DatabaseManager {
  get connection(): DatabaseSync {
    const globalObj = globalThis as unknown as Record<symbol, DatabaseSync | null>;
    if (globalObj[GLOBAL_DB_KEY]) {
      return globalObj[GLOBAL_DB_KEY]!;
    }

    const databasePath = storageService.getDatabasePath();

    let db: DatabaseSync;
    if (databasePath === ':memory:') {
      db = initializeTransientDatabase(new DatabaseSync(databasePath));
    } else {
      runStartupMigrations({ databasePath });
      db = new DatabaseSync(databasePath);
      assertNoLegacySchema(db);
      refreshQueryPlannerStatistics(db);
    }

    globalObj[GLOBAL_DB_KEY] = db;
    return db;
  }

  close(): void {
    const globalObj = globalThis as unknown as Record<symbol, DatabaseSync | null>;
    const db = globalObj[GLOBAL_DB_KEY];
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore errors if already closed
      } finally {
        globalObj[GLOBAL_DB_KEY] = null;
      }
    }
  }
}

export const databaseManager = new DatabaseManager();
