/**
 * Compatibility composition root for database repositories.
 *
 * Callers keep importing this module while implementations live in domain files.
 */
export {
  resolvePostIdByImageId,
  resolveImageId
} from './repositories/shared.js';
export type {
  UpsertFolderInput,
  SaveFolderResult,
  CreateFolderShareLinkInput,
  CreatePostShareLinkInput,
  UpsertFolderSharePasswordInput,
  UpsertPostInput,
  UpsertImageInput,
  RefreshIndexedImageInput,
  ReconcileImageMoveInput,
  UpsertFolderScanStateInput,
  UpsertCityPlaceInput
} from './repositories/shared.js';
export * from './repositories/media.js';
export * from './repositories/collections.js';
export * from './repositories/shares.js';
export * from './repositories/settings.js';
export * from './repositories/scans.js';
