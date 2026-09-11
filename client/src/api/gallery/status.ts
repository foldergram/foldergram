import type { AppStats, AppStatus, ScanFoldersPayload, ScanProgress } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchStats() {
  return requestJson<AppStatus>('/api/status');
}

export function fetchAdminStats() {
  return requestJson<AppStats>('/api/admin/stats');
}

export function fetchScanProgress() {
  return requestJson<ScanProgress>('/api/scan-progress');
}

export function fetchAdminScanProgress() {
  return requestJson<ScanProgress>('/api/admin/scan-progress');
}

export function fetchScanFolders() {
  return requestJson<ScanFoldersPayload>('/api/admin/scan-folders');
}

