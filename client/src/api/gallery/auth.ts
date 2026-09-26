import type { AuthMutationResult, AuthStatus, ViewerAccessMode } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchAuthStatus() {
  return requestJson<AuthStatus>('/api/auth/status');
}

export function loginWithPassword(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/login', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

export function unlockAdmin(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/unlock-admin', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

export function logout() {
  return requestJson<AuthMutationResult>('/api/auth/logout', {
    method: 'POST'
  });
}

export function enablePasswordProtection(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function changePasswordProtection(currentPassword: string, password: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ currentPassword, password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function disablePasswordProtection(currentPassword: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ currentPassword }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'DELETE'
  });
}

export function updateViewerAccess(mode: ViewerAccessMode, viewerPassword?: string) {
  return requestJson<AuthMutationResult>('/api/auth/viewer-access', {
    body: JSON.stringify({
      mode,
      viewerPassword
    }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function configurePatternUnlock(
  pattern: string | null,
  proof?: { currentPattern?: string; currentPassword?: string }
) {
  return requestJson<AuthMutationResult>('/api/auth/pattern', {
    body: JSON.stringify(pattern === null ? { ...proof } : { pattern, ...proof }),
    headers: {
      'content-type': 'application/json'
    },
    method: pattern === null ? 'DELETE' : 'PUT'
  });
}

export function unlockWithPattern(pattern: string) {
  return requestJson<AuthMutationResult>('/api/auth/pattern/unlock', {
    body: JSON.stringify({ pattern }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

export function resetPatternWithPassword(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/pattern/reset', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}
