import { appConfig } from '../config/env.js';
import type { ScanRunRecord } from '../types/models.js';
import type { ScanProgressSnapshot } from './scanner-service.js';

export type RemoteScanOperation = 'manual' | 'rebuild' | 'rebuild-thumbnails';

interface WorkerRequestResult {
  ok: boolean;
  accepted: boolean;
  lastScan: ScanRunRecord | null;
}

function workerUrl(pathname: string): string {
  if (!appConfig.workerBaseUrl) {
    throw new Error('The scan worker is not configured.');
  }

  return `${appConfig.workerBaseUrl}${pathname}`;
}

async function readWorkerJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload ? payload.message : null;
    throw new Error(message || `Scan worker request failed (${response.status}).`);
  }

  return payload as T;
}

export function isRemoteScanWorkerEnabled(): boolean {
  return appConfig.runtime === 'web' && appConfig.workerBaseUrl !== null;
}

export async function requestRemoteScan(operation: RemoteScanOperation): Promise<WorkerRequestResult> {
  const response = await fetch(workerUrl(`/internal/scans/${operation}`), {
    method: 'POST',
    signal: AbortSignal.timeout(10_000)
  });
  return readWorkerJson<WorkerRequestResult>(response);
}

export async function fetchRemoteScanProgress(): Promise<ScanProgressSnapshot> {
  const response = await fetch(workerUrl('/internal/scan-progress'), {
    signal: AbortSignal.timeout(3_000)
  });
  return readWorkerJson<ScanProgressSnapshot>(response);
}
