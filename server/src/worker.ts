import { createServer } from 'node:http';

import { appConfig } from './config/env.js';
import { log } from './services/log-service.js';
import { LIBRARY_REBUILD_REQUIRED_MESSAGE, scannerService } from './services/scanner-service.js';
import { watcherService } from './services/watcher-service.js';

type ScanOperation = 'manual' | 'rebuild' | 'rebuild-thumbnails';

function startScan(operation: ScanOperation): void {
  if (scannerService.getProgress().isScanning) {
    return;
  }

  const work = operation === 'manual'
    ? scannerService.scanAll('manual')
    : operation === 'rebuild'
      ? scannerService.rebuildLibraryIndex('rebuild')
      : scannerService.rebuildThumbnails('rebuild-thumbnails');

  void work
    .then(async () => {
      if (operation === 'manual') {
        await watcherService.start();
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Worker ${operation} scan failed`, message);
    });
}

function json(response: import('node:http').ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function bootstrap(): Promise<void> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://worker').pathname;

    if (request.method === 'GET' && pathname === '/health') {
      json(response, 200, { ok: true, runtime: 'worker' });
      return;
    }

    if (request.method === 'GET' && pathname === '/internal/scan-progress') {
      json(response, 200, scannerService.getProgress());
      return;
    }

    const operation = /^\/internal\/scans\/(manual|rebuild|rebuild-thumbnails)$/.exec(pathname)?.[1] as ScanOperation | undefined;
    if (request.method === 'POST' && operation) {
      if (operation !== 'rebuild' && scannerService.isLibraryRebuildRequired()) {
        json(response, 409, { message: LIBRARY_REBUILD_REQUIRED_MESSAGE });
        return;
      }

      if (scannerService.getProgress().isScanning) {
        json(response, 429, { message: 'A scan or rebuild is already in progress.' });
        return;
      }

      startScan(operation);
      json(response, 202, { ok: true, accepted: true, lastScan: scannerService.getProgress().lastCompletedScan });
      return;
    }

    json(response, 404, { message: 'Not found.' });
  });

  server.listen(appConfig.workerControlPort, () => {
    log.info(`Scan worker listening on http://localhost:${appConfig.workerControlPort}`);
    if (!appConfig.libraryAutoScanEnabled) {
      log.info('Automatic library scanning disabled; waiting for an internal manual scan request');
      return;
    }

    const startupAction = scannerService.handleStartup('startup');
    if (startupAction !== 'blocked') {
      void watcherService.start().catch((error: unknown) => {
        log.error('Gallery watcher failed to start', error instanceof Error ? error.message : String(error));
      });
    }
  });

  const shutdown = async (signal: string) => {
    log.info(`Worker received ${signal}, shutting down`);
    await watcherService.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap().catch((error: unknown) => {
  log.error('Scan worker startup failed', error);
  process.exitCode = 1;
});
