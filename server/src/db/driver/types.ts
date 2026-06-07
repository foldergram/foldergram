export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  lastInsertId?: number | bigint;
}

export interface IDbDriver {
  readonly dialect: 'sqlite' | 'postgres';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (driver: IDbDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
