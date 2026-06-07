interface EndpointStat {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
}

interface SlowSample {
  elapsed_ms: number;
  sql: string;
  timestamp: string;
}

interface QueryStat {
  count: number;
  totalMs: number;
  maxMs: number;
  slowSamples: SlowSample[];
  caller: string;
}

export interface QueryTimeStat {
  fn: string;
  sql: string;
  count: number;
  avg_ms: number;
  max_ms: number;
}

export interface MetricsSummary {
  uptime_seconds: number;
  endpoints: Array<{
    key: string;
    count: number;
    avg_ms: number;
    max_ms: number;
    errors: number;
  }>;
  slow_queries: Array<{
    key: string;
    count: number;
    avg_ms: number;
    max_ms: number;
    samples: SlowSample[];
  }>;
}

const SLOW_SAMPLE_LIMIT = 10;
const QUERY_KEY_LENGTH = 120;

function sqlKey(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, QUERY_KEY_LENGTH);
}

class MetricsService {
  private readonly endpoints = new Map<string, EndpointStat>();
  private readonly queries = new Map<string, QueryStat>();
  private readonly startedAt = Date.now();

  recordRequest(method: string, path: string, statusCode: number, elapsedMs: number): void {
    const key = `${method} ${path}`;
    const existing = this.endpoints.get(key);
    if (existing) {
      existing.count++;
      existing.totalMs += elapsedMs;
      if (elapsedMs > existing.maxMs) existing.maxMs = elapsedMs;
      if (statusCode >= 500) existing.errors++;
    } else {
      this.endpoints.set(key, {
        count: 1,
        totalMs: elapsedMs,
        maxMs: elapsedMs,
        errors: statusCode >= 500 ? 1 : 0
      });
    }
  }

  recordQuery(sql: string, elapsedMs: number, slowThresholdMs: number, getCaller?: () => string): void {
    const key = sqlKey(sql);
    const existing = this.queries.get(key);
    if (existing) {
      existing.count++;
      existing.totalMs += elapsedMs;
      if (elapsedMs > existing.maxMs) existing.maxMs = elapsedMs;
      if (elapsedMs >= slowThresholdMs) {
        if (existing.slowSamples.length >= SLOW_SAMPLE_LIMIT) {
          existing.slowSamples.shift();
        }
        existing.slowSamples.push({ elapsed_ms: elapsedMs, sql: key, timestamp: new Date().toISOString() });
      }
    } else {
      this.queries.set(key, {
        count: 1,
        totalMs: elapsedMs,
        maxMs: elapsedMs,
        caller: getCaller?.() ?? 'unknown',
        slowSamples: elapsedMs >= slowThresholdMs
          ? [{ elapsed_ms: elapsedMs, sql: key, timestamp: new Date().toISOString() }]
          : []
      });
    }
  }

  getAllQueryStats(): QueryTimeStat[] {
    return [...this.queries.entries()]
      .map(([key, s]) => ({
        fn: s.caller,
        sql: key,
        count: s.count,
        avg_ms: Math.round(s.totalMs / s.count),
        max_ms: s.maxMs
      }))
      .sort((a, b) => b.avg_ms - a.avg_ms);
  }

  getSummary(): MetricsSummary {
    const uptime_seconds = Math.round((Date.now() - this.startedAt) / 1000);

    const endpoints = [...this.endpoints.entries()]
      .map(([key, s]) => ({
        key,
        count: s.count,
        avg_ms: Math.round(s.totalMs / s.count),
        max_ms: s.maxMs,
        errors: s.errors
      }))
      .sort((a, b) => b.avg_ms - a.avg_ms);

    const slow_queries = [...this.queries.entries()]
      .filter(([, s]) => s.slowSamples.length > 0)
      .map(([key, s]) => ({
        key,
        count: s.count,
        avg_ms: Math.round(s.totalMs / s.count),
        max_ms: s.maxMs,
        samples: s.slowSamples
      }))
      .sort((a, b) => b.max_ms - a.max_ms);

    return { uptime_seconds, endpoints, slow_queries };
  }

  reset(): void {
    this.endpoints.clear();
    this.queries.clear();
  }
}

export const metricsService = new MetricsService();
