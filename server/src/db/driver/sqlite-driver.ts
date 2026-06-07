import { performance } from 'node:perf_hooks';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { appConfig } from '../../config/env.js';
import { log } from '../../services/log-service.js';
import { metricsService } from '../../services/metrics-service.js';
import type { IDbDriver, QueryResult } from './types.js';

function recordQuery(sql: string, elapsedMs: number): void {
  metricsService.recordQuery(sql, elapsedMs, appConfig.logSlowQueryMs);
  if (elapsedMs >= appConfig.logSlowQueryMs) {
    log.info('Slow query', { elapsed: `${elapsedMs}ms`, sql: sql.replace(/\s+/g, ' ').trim().slice(0, 200) });
  }
}

export class SqliteDriver implements IDbDriver {
  readonly dialect = 'sqlite' as const;

  constructor(private readonly db: DatabaseSync) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const t = performance.now();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...(params as SQLInputValue[])) as T[];
    recordQuery(sql, Math.round(performance.now() - t));
    return { rows, rowCount: rows.length };
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const t = performance.now();
    const stmt = this.db.prepare(sql);
    const result = stmt.get(...(params as SQLInputValue[])) as T | undefined;
    recordQuery(sql, Math.round(performance.now() - t));
    return result;
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const t = performance.now();
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...(params as SQLInputValue[]));
    recordQuery(sql, Math.round(performance.now() - t));
    return {
      rows: [],
      rowCount: Number(result.changes ?? 0),
      lastInsertId: result.lastInsertRowid
    };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: (driver: IDbDriver) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
