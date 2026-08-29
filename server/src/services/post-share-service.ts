import { randomBytes } from 'node:crypto';

import { postRepository, postShareLinkRepository } from '../db/repositories.js';
import type { PostRecord, PostShareLinkRecord } from '../types/models.js';
import { hashShareToken } from './folder-share-service.js';

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PREFIX_LENGTH = 8;

export interface PublicPostShareLink {
  id: number;
  postId: number;
  tokenPrefix: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}

export interface PostShareGrant {
  linkId: number;
  postId: number;
}

function isLinkExpired(link: Pick<PostShareLinkRecord, 'expires_at'>, now = Date.now()): boolean {
  if (!link.expires_at) {
    return false;
  }

  const expiresAt = Date.parse(link.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function isLinkUsable(link: PostShareLinkRecord, now = Date.now()): boolean {
  return link.revoked_at === null && !isLinkExpired(link, now);
}

function mapShareLink(link: PostShareLinkRecord, now = new Date()): PublicPostShareLink {
  return {
    id: link.id,
    postId: link.post_id,
    tokenPrefix: link.token_prefix,
    expiresAt: link.expires_at,
    revokedAt: link.revoked_at,
    createdAt: link.created_at,
    lastUsedAt: link.last_used_at,
    status: link.revoked_at ? 'revoked' : isLinkExpired(link, now.getTime()) ? 'expired' : 'active'
  };
}

function getVisiblePost(postId: number): PostRecord | null {
  const post = postRepository.findById(postId);
  if (!post || post.is_deleted || post.is_trashed) {
    return null;
  }

  return post;
}

/**
 * Single-post share links.
 *
 * Unlike folder shares there is no unlock step and no session cookie: the token stays
 * in every URL the shared page uses, so a link is self-contained and can be opened by
 * someone with no account and no prior request. That also means one token can never
 * widen into "everything in that folder" the way a folder token does.
 */
export const postShareService = {
  listLinks(postId: number): { links: PublicPostShareLink[]; post: PostRecord } | null {
    const post = getVisiblePost(postId);
    if (!post) {
      return null;
    }

    return {
      links: postShareLinkRepository.listByPost(post.id).map((link) => mapShareLink(link)),
      post
    };
  },

  createLink(postId: number, options: { expiresAt: Date | null }): {
    link: PublicPostShareLink;
    post: PostRecord;
    rawToken: string;
  } | null {
    const post = getVisiblePost(postId);
    if (!post) {
      return null;
    }

    const rawToken = randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
    const link = postShareLinkRepository.create({
      postId: post.id,
      tokenHash: hashShareToken(rawToken),
      tokenPrefix: rawToken.slice(0, TOKEN_PREFIX_LENGTH),
      expiresAt: options.expiresAt ? options.expiresAt.toISOString() : null
    });

    return {
      link: mapShareLink(link),
      post,
      rawToken
    };
  },

  revokeLink(postId: number, linkId: number): PublicPostShareLink | null {
    const post = getVisiblePost(postId);
    if (!post) {
      return null;
    }

    const link = postShareLinkRepository.revoke(linkId, post.id);
    return link && link.post_id === post.id ? mapShareLink(link) : null;
  },

  verifyToken(token: string, options: { touch?: boolean } = {}): PostShareGrant | null {
    const normalizedToken = token.trim();
    if (normalizedToken.length === 0 || normalizedToken.length > 512) {
      return null;
    }

    const link = postShareLinkRepository.getByTokenHash(hashShareToken(normalizedToken));
    if (!link || !isLinkUsable(link) || !getVisiblePost(link.post_id)) {
      return null;
    }

    if (options.touch) {
      postShareLinkRepository.touchLastUsed(link.id);
    }

    return {
      linkId: link.id,
      postId: link.post_id
    };
  },

  /**
   * Derivative and HLS routes are addressed by image id, so an id has to resolve back
   * to the very post the token was minted for before anything is served.
   */
  grantCoversImage(grant: PostShareGrant, imageId: number): boolean {
    const post = postRepository.findByImageId(imageId);
    return post?.id === grant.postId;
  }
};
