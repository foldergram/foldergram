import express from 'express';

import { registerAdminPreludeRoutes, registerAdminRoutes, registerAdminStatusRoutes } from '../modules/admin/index.js';
import { registerCollectionRoutes } from '../modules/collections/index.js';
import { registerDeletionRoutes } from '../modules/deletion/index.js';
import { registerFeedMomentRoutes, registerFeedRoutes } from '../modules/feed/index.js';
import { registerFolderContentRoutes, registerFolderRoutes, registerFolderStoryRoutes } from '../modules/folders/index.js';
import { registerLibraryRoutes } from '../modules/library/index.js';
import { registerPlaceRoutes } from '../modules/places/index.js';
import { registerFolderSharingAdminRoutes, registerFolderSharingPublicRoutes, registerPostSharingRoutes } from '../modules/sharing/index.js';
import { registerSettingsRoutes } from '../modules/settings/index.js';
import { installPublicMetadataRedaction } from './api-middleware.js';
import { videoStreamRouter } from './video-stream.js';

const router = express.Router();

// The direct video router intentionally precedes anonymous public metadata redaction.
router.use('/videos', videoStreamRouter);
installPublicMetadataRedaction(router);

// Registration order mirrors the former monolithic router. Several domains therefore
// expose phases instead of mounting child routers, preserving Express's match semantics.
registerAdminPreludeRoutes(router);
registerFeedRoutes(router);
registerAdminStatusRoutes(router);
registerSettingsRoutes(router);
registerFeedMomentRoutes(router);
registerFolderRoutes(router);
registerFolderSharingAdminRoutes(router);
registerFolderContentRoutes(router);
registerFolderSharingPublicRoutes(router);
registerPostSharingRoutes(router);
registerPlaceRoutes(router);
registerFolderStoryRoutes(router);
registerCollectionRoutes(router);
registerDeletionRoutes(router);
registerLibraryRoutes(router);
registerAdminRoutes(router);

export {
  authRequestBodySchemas,
  folderCoverBodySchema,
  patchFolderBodySchema,
  patchImageCaptionBodySchema,
  routeParamSchemas,
  settingsRequestBodySchemas
} from './api-schemas.js';
export { router as apiRouter };
