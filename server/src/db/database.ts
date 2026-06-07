import { DatabaseSync } from 'node:sqlite';

import { appConfig } from '../config/env.js';
import { SqliteDriver } from './driver/sqlite-driver.js';
import { PostgresDriver } from './driver/postgres-driver.js';
import type { IDbDriver } from './driver/types.js';
import { runStartupMigrations } from './migration.js';
import { assertNoLegacySchema } from './schema-compat.js';
import { schemaSql } from './schema.js';
import { storageService } from '../services/storage-service.js';

class DatabaseManager {
  private driverPromise: Promise<IDbDriver> | null = null;

  getConnection(): Promise<IDbDriver> {
    if (!this.driverPromise) {
      this.driverPromise = this.initialize();
    }
    return this.driverPromise;
  }

  private async initialize(): Promise<IDbDriver> {
    if (appConfig.dbDriver === 'postgres') {
      runStartupMigrations({ dialect: 'postgres' });
      return new PostgresDriver(appConfig.databaseUrl!);
    }

    const databasePath = storageService.getDatabasePath();

    if (databasePath === ':memory:') {
      const db = new DatabaseSync(':memory:');
      db.exec(schemaSql);
      return new SqliteDriver(db);
    }

    runStartupMigrations({ databasePath, dialect: 'sqlite' });
    const db = new DatabaseSync(databasePath);
    assertNoLegacySchema(db);
    return new SqliteDriver(db);
  }
}

export const databaseManager = new DatabaseManager();
