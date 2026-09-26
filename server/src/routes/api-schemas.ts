import { z } from 'zod';
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '../services/auth-service.js';
import { FOLDER_SHARE_PASSWORD_MAX_LENGTH, FOLDER_SHARE_PASSWORD_MIN_LENGTH } from '../services/folder-share-service.js';
import { normalizePublicBaseUrl } from '../utils/share-url.js';

export const paginationQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(60).default(24) });
export const mediaTypeQuerySchema = z.object({ mediaType: z.enum(['image', 'video']).optional() });
export const originalMediaQuerySchema = z.object({ download: z.preprocess((value) => {
  if (value === undefined) return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return value;
}, z.boolean()) });
export const deleteFolderQuerySchema = z.object({ deleteSourceFolder: z.preprocess((value) => {
  if (value === undefined) return false;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}, z.boolean()) });
const paginationFeedFields = { mode: z.enum(['recent', 'rediscover', 'random']).default('random'), seed: z.coerce.number().int().nonnegative().optional() };
export const feedQuerySchema = paginationQuerySchema.extend({ ...paginationFeedFields, exclude: z.string().trim().max(6000).optional().transform((value) => value ? value.split(',').map((entry) => Number.parseInt(entry.trim(), 10)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 500) : undefined) });
export const reelsQuerySchema = paginationQuerySchema.extend({ mode: z.enum(['recommended', 'recent', 'random']).default('recommended'), seed: z.coerce.number().int().nonnegative().optional(), lastFolder: z.string().trim().min(1).max(240).optional(), recentFolders: z.string().trim().max(2400).optional() });
export const mediaSearchQuerySchema = paginationQuerySchema.extend({ q: z.string().trim().min(1).max(160) });
export const homeFeedDefaultBodySchema = z.object({ defaultMode: z.enum(['recent', 'rediscover', 'random']) });
export const appLocaleBodySchema = z.object({ defaultLocale: z.enum(['en', 'es', 'zh']) });
export const reelsFeedDefaultBodySchema = z.object({ defaultMode: z.enum(['recommended', 'recent', 'random']) });
export const folderImageOrderDefaultBodySchema = z.object({ defaultOrder: z.enum(['newest', 'oldest']) });
export const nestedFolderTitleFormatBodySchema = z.object({ titleFormat: z.enum(['folder', 'parent-plus-folder']) });
export const videoPlaybackQualityBodySchema = z.object({ videoPlaybackQuality: z.enum(['auto', 'original', '1080p', '720p', '480p']) });
export const videoPlaybackModeBodySchema = z.object({ videoPlaybackMode: z.enum(['direct', 'transcode']) });
export const storiesModeBodySchema = z.object({ treatStoriesAsFolders: z.boolean() });
export const excludedFoldersBodySchema = z.object({ rules: z.array(z.string()).default([]) });
export const collectionBodySchema = z.object({ name: z.string().trim().min(1).max(80) });
export const slugSchema = z.object({ slug: z.string().min(1).max(240) });
export const momentIdSchema = z.object({ id: z.string().min(1).max(120) });
export const storyIdSchema = z.object({ id: z.string().min(1).max(240) });
export const imageIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const permanentDeletionBatchBodySchema = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(5000) });
export const shareLinkIdSchema = z.object({ linkId: z.coerce.number().int().positive() });
export const shareTokenParamSchema = z.object({ token: z.string().trim().min(1).max(512) });
export const publicBaseUrlBodySchema = z.object({ publicBaseUrl: z.string().trim().max(512).nullable().transform((value) => value === null || value.length === 0 ? null : value).refine((value) => value === null || normalizePublicBaseUrl(value) !== null, { message: 'Public base URL must be an absolute http(s) URL.' }) });
export const patchFolderBodySchema = z.object({ name: z.string().min(1).max(255), description: z.string().max(300).nullable().optional() });
export const patchImageCaptionBodySchema = z.object({ caption: z.preprocess((value) => typeof value === 'string' ? value.trim() : value, z.string().max(300).nullable().optional()) }).transform((body) => ({ caption: body.caption === '' ? null : body.caption ?? null }));
export const folderCoverBodySchema = z.object({ imageId: z.coerce.number().int().positive() });

const submittedPasswordSchema = z.string().min(1, 'Password is required.').max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
const submittedCurrentPasswordSchema = z.string().min(1, 'Current password is required.').max(AUTH_PASSWORD_MAX_LENGTH, `Current password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
const passwordFieldSchema = z.string().min(AUTH_PASSWORD_MIN_LENGTH, `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`).max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`).refine((value) => value.trim().length > 0, 'Password cannot be empty.');
export const loginBodySchema = z.object({ password: submittedPasswordSchema });
export const patternUnlockBodySchema = z.object({ pattern: z.string().regex(/^\d{1,8}(-\d{1,8}){2,}$/, 'Pattern must be a dash-separated dot sequence with at least 3 dots.').max(64) });
export const patternResetBodySchema = loginBodySchema;
const patternSequenceSchema = patternUnlockBodySchema.shape.pattern;
export const patternConfigureBodySchema = z.object({ pattern: patternSequenceSchema, currentPattern: patternSequenceSchema.optional(), currentPassword: submittedPasswordSchema.optional() });
export const patternDisableBodySchema = z.object({ currentPattern: patternSequenceSchema.optional(), currentPassword: submittedPasswordSchema.optional() });
export const configurePasswordBodySchema = z.object({ password: passwordFieldSchema });
export const changePasswordBodySchema = z.object({ currentPassword: submittedCurrentPasswordSchema, password: passwordFieldSchema });
export const disablePasswordBodySchema = z.object({ currentPassword: submittedCurrentPasswordSchema });
export const viewerAccessBodySchema = z.object({ mode: z.enum(['off', 'password', 'public']), viewerPassword: passwordFieldSchema.optional() }).superRefine((body, context) => {
  if (body.mode === 'password' && !body.viewerPassword) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Viewer password is required when viewer access mode is password.', path: ['viewerPassword'] });
});
export const createShareLinkBodySchema = z.object({ expiresIn: z.enum(['1h', '24h', '7d', 'custom', 'unlimited']).default('24h'), customExpiresAt: z.string().datetime().nullable().optional(), unlimited: z.boolean().default(false) }).superRefine((body, context) => {
  if (body.unlimited || body.expiresIn === 'unlimited') return;
  if (body.expiresIn === 'custom' && !body.customExpiresAt) { context.addIssue({ code: z.ZodIssueCode.custom, message: 'Custom expiration date is required.', path: ['customExpiresAt'] }); return; }
  if (body.customExpiresAt && Date.parse(body.customExpiresAt) <= Date.now()) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Share links must expire in the future.', path: ['customExpiresAt'] });
});
export const shareTokenBodySchema = z.object({ token: z.string().trim().min(1).max(512) });
export const sharePasswordBodySchema = z.object({ password: z.string().min(FOLDER_SHARE_PASSWORD_MIN_LENGTH, `Password must be at least ${FOLDER_SHARE_PASSWORD_MIN_LENGTH} characters.`).max(FOLDER_SHARE_PASSWORD_MAX_LENGTH, `Password must be at most ${FOLDER_SHARE_PASSWORD_MAX_LENGTH} characters.`).refine((value) => value.trim().length > 0, 'Password cannot be empty.') });
export const submittedSharePasswordBodySchema = z.object({ password: z.string().min(1, 'Password is required.').max(FOLDER_SHARE_PASSWORD_MAX_LENGTH, `Password must be at most ${FOLDER_SHARE_PASSWORD_MAX_LENGTH} characters.`) });
export const scanFoldersBodySchema = z.object({ folders: z.array(z.string().trim().min(1).max(2048)).max(5000) });

export const authRequestBodySchemas = { login: loginBodySchema, configurePassword: configurePasswordBodySchema, changePassword: changePasswordBodySchema, disablePassword: disablePasswordBodySchema, viewerAccess: viewerAccessBodySchema, patternUnlock: patternUnlockBodySchema, patternReset: patternResetBodySchema };
export const settingsRequestBodySchemas = { sharePublicBaseUrl: publicBaseUrlBodySchema, homeFeedDefault: homeFeedDefaultBodySchema, appLocale: appLocaleBodySchema, reelsFeedDefault: reelsFeedDefaultBodySchema, folderImageOrderDefault: folderImageOrderDefaultBodySchema, nestedFolderTitleFormat: nestedFolderTitleFormatBodySchema, storiesMode: storiesModeBodySchema, videoPlaybackQuality: videoPlaybackQualityBodySchema, videoPlaybackMode: videoPlaybackModeBodySchema, excludedFolders: excludedFoldersBodySchema, scanFolders: scanFoldersBodySchema };
export const routeParamSchemas = { slug: slugSchema, momentId: momentIdSchema, storyId: storyIdSchema, imageId: imageIdSchema };
