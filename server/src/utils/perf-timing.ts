import { performance } from 'node:perf_hooks';

import { appConfig } from '../config/env.js';
import { log } from '../services/log-service.js';

const VERBOSE_SLOW_OPERATION_THRESHOLD_MS = 250;
const SLOW_OPERATION_THRESHOLD_MS = 1000;

export function getSlowOperationThresholdMs(): number {
  return appConfig.logVerbose ? VERBOSE_SLOW_OPERATION_THRESHOLD_MS : SLOW_OPERATION_THRESHOLD_MS;
}

export function isSlowOperationDuration(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs >= getSlowOperationThresholdMs();
}

export function recordOperationDuration(name: string, durationMs: number): void {
  if (!isSlowOperationDuration(durationMs)) {
    return;
  }

  log.info(`Slow request work: ${name}`, { durationMs: Math.round(durationMs) });
}

export function measureOperation<T>(name: string, operation: () => T): T {
  const startedAtMs = performance.now();

  try {
    return operation();
  } finally {
    recordOperationDuration(name, performance.now() - startedAtMs);
  }
}
