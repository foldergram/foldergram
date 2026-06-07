import { performance } from 'node:perf_hooks';

import pg from 'pg';

import { appConfig } from '../../config/env.js';
import { log } from '../../services/log-service.js';
import { metricsService } from '../../services/metrics-service.js';
import type { IDbDriver, QueryResult } from './types.js';

function extractCaller(): string {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n')) {
    if (line.includes('repositories.')) {
      const match = line.match(/at (?:async )?(?:Object\.)?(\w+)\s/);
      if (match?.[1]) return match[1];
    }
  }
  return 'unknown';
}

function recordQuery(sql: string, elapsedMs: number, getCaller?: () => string): void {
  metricsService.recordQuery(sql, elapsedMs, appConfig.logSlowQueryMs, getCaller);
  if (elapsedMs >= appConfig.logSlowQueryMs) {
    log.info('Slow query', { elapsed: `${elapsedMs}ms`, sql: sql.replace(/\s+/g, ' ').trim().slice(0, 200) });
  }
}

const BOOLEAN_COLUMNS = new Set([
  'is_deleted',
  'is_trashed',
  'is_animated',
  'is_approximate',
  'is_default'
]);

const BOOL_COLUMN_PATTERN = /(\b(?:is_deleted|is_trashed|is_animated|is_approximate|is_default)\b\s*=\s*)(0|1)(?!\d)/g;

function normalizeBooleanLiterals(sql: string): string {
  return sql.replace(BOOL_COLUMN_PATTERN, (_, prefix, val) => `${prefix}${val === '1' ? 'true' : 'false'}`);
}

function rewritePlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

const BOOL_COL_NAMES = 'is_deleted|is_trashed|is_animated|is_approximate|is_default';

// Finds zero-based parameter indices that correspond to boolean columns.
// Handles two patterns:
//   1. SET/WHERE:  `bool_col = ?`
//   2. INSERT:     `INSERT INTO t (col1, bool_col, ...) VALUES (?, ?, ...)`
function boolParamIndices(sql: string): Set<number> {
  const indices = new Set<number>();

  function qsBefore(pos: number): number {
    return (sql.slice(0, pos).match(/\?/g) ?? []).length;
  }

  // Pattern 1: col = ?
  const eqRe = new RegExp(`\\b(${BOOL_COL_NAMES})\\s*=\\s*\\?`, 'g');
  let m: RegExpExecArray | null;
  while ((m = eqRe.exec(sql)) !== null) {
    indices.add(qsBefore(m.index + m[0].length) - 1);
  }

  // Pattern 2: INSERT INTO t (..., bool_col, ...) VALUES (..., ?, ...)
  const insertRe = /INSERT\s+(?:\w+\s+)?INTO\s+\w+\s*\(([^)]+)\)\s*(?:OVERRIDING\s+\w+\s+VALUE\s+)?VALUES\s*\(([^)]+)\)/gi;
  while ((m = insertRe.exec(sql)) !== null) {
    const cols = m[1].split(',').map(s => s.trim());
    const valTokens = m[2].split(',').map(s => s.trim());
    const baseQ = qsBefore(sql.indexOf(m[2], m.index));
    let localQ = 0;
    for (let i = 0; i < valTokens.length && i < cols.length; i++) {
      if (valTokens[i] === '?') {
        if (BOOLEAN_COLUMNS.has(cols[i])) indices.add(baseQ + localQ);
        localQ++;
      }
    }
  }

  return indices;
}

function normalizeBooleanParams(sql: string, params: unknown[]): unknown[] {
  if (params.length === 0) return params;
  const indices = boolParamIndices(sql);
  if (indices.size === 0) return params;
  const result = [...params];
  for (const idx of indices) {
    if (idx >= 0 && idx < result.length && (result[idx] === 0 || result[idx] === 1)) {
      result[idx] = result[idx] === 1;
    }
  }
  return result;
}

function quoteAliases(sql: string): string {
  return sql.replace(/\bAS (?!")([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, alias) =>
    /[A-Z]/.test(alias) ? `AS "${alias}"` : match
  );
}

function prepSql(sql: string): string {
  return rewritePlaceholders(normalizeBooleanLiterals(quoteAliases(sql)));
}

function normalizeRow<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }
  return result as T;
}

export class PostgresDriver implements IDbDriver {
  readonly dialect = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const t = performance.now();
    const result = await this.pool.query(prepSql(sql), normalizeBooleanParams(sql, params));
    recordQuery(sql, Math.round(performance.now() - t), extractCaller);
    const rows = result.rows.map((row: Record<string, unknown>) => normalizeRow<T>(row));
    return { rows, rowCount: result.rowCount ?? rows.length };
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const t = performance.now();
    const result = await this.pool.query(prepSql(sql), normalizeBooleanParams(sql, params));
    recordQuery(sql, Math.round(performance.now() - t), extractCaller);
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeRow<T>(result.rows[0]);
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const t = performance.now();
    const result = await this.pool.query(prepSql(sql), normalizeBooleanParams(sql, params));
    recordQuery(sql, Math.round(performance.now() - t), extractCaller);
    const lastInsertId = result.rows.length > 0 && result.rows[0].id != null
      ? Number(result.rows[0].id)
      : undefined;
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
      lastInsertId
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (driver: IDbDriver) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const clientDriver = new PostgresClientDriver(client);
    try {
      await client.query('BEGIN');
      const result = await fn(clientDriver);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgresClientDriver implements IDbDriver {
  readonly dialect = 'postgres' as const;

  constructor(private readonly client: pg.PoolClient) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const t = performance.now();
    const result = await this.client.query(prepSql(sql), normalizeBooleanParams(sql, params));
    recordQuery(sql, Math.round(performance.now() - t), extractCaller);
    const rows = result.rows.map((row: Record<string, unknown>) => normalizeRow<T>(row));
    return { rows, rowCount: result.rowCount ?? rows.length };
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const t = performance.now();
    const result = await this.client.query(prepSql(sql), normalizeBooleanParams(sql, params));
    recordQuery(sql, Math.round(performance.now() - t), extractCaller);
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeRow<T>(result.rows[0]);
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const t = performance.now();
    const result = await this.client.query(prepSql(sql), normalizeBooleanParams(sql, params));
    recordQuery(sql, Math.round(performance.now() - t), extractCaller);
    const lastInsertId = result.rows.length > 0 && result.rows[0].id != null
      ? Number(result.rows[0].id)
      : undefined;
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
      lastInsertId
    };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<T>(fn: (driver: IDbDriver) => Promise<T>): Promise<T> {
    // Already inside a transaction — run directly
    return fn(this);
  }

  async close(): Promise<void> {
    // Client is managed by the pool — do not close here
  }
}
