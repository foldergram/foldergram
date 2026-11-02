import { performance } from 'node:perf_hooks';

import type express from 'express';

import { appConfig } from '../config/env.js';
import { log } from '../services/log-service.js';
import { isSlowOperationDuration } from '../utils/perf-timing.js';

const UNMATCHED_ROUTE_LABEL = 'unmatched';

function describeRoute(request: express.Request): string {
  const routePath = request.route?.path;

  if (typeof routePath === 'string' && routePath.length > 0) {
    return routePath;
  }

  if (Array.isArray(routePath)) {
    const routeTemplate = routePath.find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
    );

    if (routeTemplate) {
      return routeTemplate;
    }
  }

  return UNMATCHED_ROUTE_LABEL;
}

export function routeTimingMiddleware(request: express.Request, response: express.Response, next: express.NextFunction): void {
  const startedAtMs = performance.now();

  response.once('finish', () => {
    const durationMs = performance.now() - startedAtMs;

    if (isSlowOperationDuration(durationMs)) {
      log.info(`Slow API request: ${request.method.toUpperCase()} ${describeRoute(request)}`, {
        durationMs: Math.round(durationMs)
      });
    }
  });

  if (appConfig.isDevelopment) {
    const originalEnd = response.end.bind(response) as (...endArgs: unknown[]) => express.Response;
    response.end = ((...endArgs: unknown[]) => {
      // Streamed responses (sendFile, pipe) commit headers before end() runs, so
      // setting the header here would throw ERR_HTTP_HEADERS_SENT. Skip it instead.
      if (!response.headersSent) {
        response.setHeader('Server-Timing', `app;dur=${(performance.now() - startedAtMs).toFixed(1)}`);
      }

      return originalEnd(...endArgs);
    }) as typeof response.end;
  }

  next();
}
