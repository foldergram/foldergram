import { authService } from '../services/auth-service.js';

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

export function applyProtectedMediaHeaders(response: HeaderResponse): void {
  if (authService.isEnabled()) {
    response.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    response.setHeader('Vary', 'Cookie');
    return;
  }

  response.setHeader('Cache-Control', 'public, max-age=604800, immutable');
}

/** Originals keep Range cacheable without `immutable`, because `/api/originals/:id` can be replaced. */
export function applyOriginalMediaHeaders(response: HeaderResponse): void {
  if (authService.isEnabled()) {
    response.setHeader('Cache-Control', 'private, max-age=604800');
    response.setHeader('Vary', 'Cookie');
  } else {
    response.setHeader('Cache-Control', 'public, max-age=604800');
  }

  response.setHeader('Accept-Ranges', 'bytes');
}

export function applyDerivativeErrorHeaders(response: HeaderResponse): void {
  response.setHeader('Cache-Control', 'no-store');

  if (authService.isEnabled()) {
    response.setHeader('Vary', 'Cookie');
  }
}

export function applyNoStoreMediaHeaders(response: HeaderResponse & { vary?: (field: string) => void }): void {
  response.setHeader('Cache-Control', 'private, no-store');
  if (typeof response.vary === 'function') {
    response.vary('Cookie');
  } else {
    response.setHeader('Vary', 'Cookie');
  }
}

export function createProtectedStaticOptions() {
  return {
    fallthrough: false,
    setHeaders(response: HeaderResponse) {
      applyProtectedMediaHeaders(response);
    }
  };
}
