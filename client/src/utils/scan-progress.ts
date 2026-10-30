import { i18n } from '../locales';
import type { ScanOperation, ScanProgress } from '../types/api';

export interface ScanBarState {
  indeterminate: boolean;
  percent: number;
}

export interface ScanStatCard {
  label: string;
  value: string;
}

const SCAN_OPERATIONS = new Set<ScanOperation>([
  'checking_derivatives',
  'backfilling_asset_key',
  'moving_thumbnail',
  'moving_preview',
  'repairing_thumbnail',
  'repairing_preview',
  'regenerating_derivatives',
  'discovering_media',
  'generating_thumbnail',
  'generating_preview',
  'generating_thumbnail_and_preview'
]);

function t(key: string, params?: Record<string, unknown>): string {
  return params ? i18n.global.t(key, params) : i18n.global.t(key);
}

function formatRatio(current: number, total: number, fallback = '?'): string {
  return `${current}/${total > 0 ? total : fallback}`;
}

function calculateDeterminatePercent(current: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

export function getScanPhaseLabel(scan: ScanProgress | null): string {
  if (!scan?.isScanning) {
    return t('scanProgress.phases.idle');
  }

  if (scan.phase === 'migration') {
    return t('scanProgress.phases.migration');
  }

  if (scan.phase === 'derivatives') {
    return t('scanProgress.phases.derivatives');
  }

  return t('scanProgress.phases.discovery');
}

export function getScanSummary(scan: ScanProgress | null): string {
  if (!scan) {
    return '';
  }

  // Built from phase and reason instead of the server's English currentPhaseMessage so it can be localized.
  if (scan.phase === 'migration') {
    return t('scanProgress.summary.migration');
  }

  if (scan.phase === 'derivatives') {
    if (scan.scanReason === 'rebuild-thumbnails') {
      return t('scanProgress.summary.derivativesThumbnails');
    }

    return scan.scanReason === 'rebuild'
      ? t('scanProgress.summary.derivativesRebuild')
      : t('scanProgress.summary.derivatives');
  }

  if (scan.scanReason === 'rebuild-thumbnails') {
    return t('scanProgress.summary.discoveryThumbnails');
  }

  return scan.scanReason === 'rebuild'
    ? t('scanProgress.summary.discoveryRebuild')
    : t('scanProgress.summary.discovery');
}

export function getScanOperationLabel(scan: ScanProgress | null): string | null {
  if (!scan?.currentOperation) {
    return null;
  }

  return SCAN_OPERATIONS.has(scan.currentOperation) ? t(`scanProgress.operations.${scan.currentOperation}`) : null;
}

export function getScanLocation(scan: ScanProgress | null): string | null {
  if (!scan) {
    return null;
  }

  return scan.currentFile ?? scan.currentFolder ?? null;
}

export function getScanActionLine(scan: ScanProgress | null): string | null {
  const operationLabel = getScanOperationLabel(scan);
  const location = getScanLocation(scan);

  if (!operationLabel) {
    return location;
  }

  if (!location) {
    return operationLabel;
  }

  return `${operationLabel}: ${location}`;
}

export function getScanMetricLine(scan: ScanProgress | null): string {
  if (!scan) {
    return '';
  }

  if (scan.phase === 'migration') {
    return [
      t('scanProgress.metrics.assetsChecked', { value: formatRatio(scan.processedMigrationRows, scan.migrationTotalRows) }),
      t('scanProgress.metrics.moved', { count: scan.migratedDerivativeFiles }),
      t('scanProgress.metrics.repaired', { count: scan.repairedDerivativeFiles }),
      t('scanProgress.metrics.missing', { count: scan.missingDerivativeFiles })
    ].join(' | ');
  }

  if (scan.phase === 'derivatives') {
    return [
      t('scanProgress.metrics.jobsComplete', { value: formatRatio(scan.processedDerivativeJobs, scan.queuedDerivativeJobs, '0') }),
      t('scanProgress.metrics.thumbnails', { count: scan.generatedThumbnails }),
      t('scanProgress.metrics.previews', { count: scan.generatedPreviews })
    ].join(' | ');
  }

  return [
    t('scanProgress.metrics.foldersProcessed', { value: formatRatio(scan.processedFolders, scan.discoveredFolders, '0') }),
    t('scanProgress.metrics.postsIndexed', { value: formatRatio(scan.processedImages, scan.discoveredImages, '0') })
  ].join(' | ');
}

export function getScanBarState(scan: ScanProgress | null): ScanBarState {
  if (!scan?.isScanning) {
    return {
      indeterminate: false,
      percent: 0
    };
  }

  if (scan.phase === 'discovery') {
    return {
      indeterminate: true,
      percent: 0
    };
  }

  if (scan.phase === 'migration') {
    return {
      indeterminate: false,
      percent: calculateDeterminatePercent(scan.processedMigrationRows, scan.migrationTotalRows)
    };
  }

  return {
    indeterminate: false,
    percent: calculateDeterminatePercent(scan.processedDerivativeJobs, scan.queuedDerivativeJobs)
  };
}

export function getInitialScanStats(scan: ScanProgress | null): ScanStatCard[] {
  if (!scan) {
    return [
      { label: t('scanProgress.stats.folders'), value: '0' },
      { label: t('scanProgress.stats.posts'), value: '0' },
      { label: t('scanProgress.stats.thumbnails'), value: '0' },
      { label: t('scanProgress.stats.previews'), value: '0' }
    ];
  }

  if (scan.phase === 'migration') {
    return [
      {
        label: t('scanProgress.stats.assetsChecked'),
        value: formatRatio(scan.processedMigrationRows, scan.migrationTotalRows, '0')
      },
      {
        label: t('scanProgress.stats.filesMoved'),
        value: String(scan.migratedDerivativeFiles)
      },
      {
        label: t('scanProgress.stats.filesRepaired'),
        value: String(scan.repairedDerivativeFiles)
      },
      {
        label: t('scanProgress.stats.missingFiles'),
        value: String(scan.missingDerivativeFiles)
      }
    ];
  }

  if (scan.phase === 'derivatives') {
    return [
      {
        label: t('scanProgress.stats.jobsComplete'),
        value: formatRatio(scan.processedDerivativeJobs, scan.queuedDerivativeJobs, '0')
      },
      {
        label: t('scanProgress.stats.queuedJobs'),
        value: String(scan.queuedDerivativeJobs)
      },
      {
        label: t('scanProgress.stats.thumbnails'),
        value: String(scan.generatedThumbnails)
      },
      {
        label: t('scanProgress.stats.previews'),
        value: String(scan.generatedPreviews)
      }
    ];
  }

  return [
    {
      label: t('scanProgress.stats.foldersFound'),
      value: String(scan.discoveredFolders)
    },
    {
      label: t('scanProgress.stats.foldersProcessed'),
      value: String(scan.processedFolders)
    },
    {
      label: t('scanProgress.stats.postsFound'),
      value: String(scan.discoveredImages)
    },
    {
      label: t('scanProgress.stats.postsIndexed'),
      value: String(scan.processedImages)
    }
  ];
}
