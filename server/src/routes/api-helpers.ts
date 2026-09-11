import type express from 'express';
import { fetchRemoteScanProgress, isRemoteScanWorkerEnabled } from '../services/scan-worker-client.js';
import { scannerService, type ScanProgressSnapshot } from '../services/scanner-service.js';

export async function resolveScanProgress(): Promise<ScanProgressSnapshot> {
  if (!isRemoteScanWorkerEnabled()) return scannerService.getProgress();
  return fetchRemoteScanProgress();
}

export const requireNoScanInProgress = async (_request: express.Request, response: express.Response, next: express.NextFunction) => {
  try {
    if (!(await resolveScanProgress()).isScanning) { next(); return; }
    response.status(429).json({ message: 'A scan or rebuild is already in progress.' });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'The scan worker is unavailable.' });
  }
};
