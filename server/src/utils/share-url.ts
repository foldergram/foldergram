/**
 * Resolves the absolute origin a share link should carry.
 *
 * A link generated while browsing over the LAN has to stay on the LAN address, because
 * that is the only thing that resolves there. A link generated from outside cannot be
 * guessed from the request alone once a reverse proxy is involved, so the operator
 * configures it once and every outside-facing link uses it.
 */

const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./
];

const LOCAL_HOSTNAMES = new Set(['localhost', '::1', '0.0.0.0']);

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (LOCAL_HOSTNAMES.has(normalized) || normalized.endsWith('.local')) {
    return true;
  }

  if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // fc00::/7 unique-local and fe80::/10 link-local.
  return /^f[cd]/.test(normalized) || normalized.startsWith('fe80:');
}

export function normalizePublicBaseUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export interface ShareOriginRequestInfo {
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
  secure?: boolean;
}

function firstHeaderValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const first = value
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return first ?? null;
}

export function resolveRequestOrigin(request: ShareOriginRequestInfo): string | null {
  const host = firstHeaderValue(request.forwardedHost) ?? firstHeaderValue(request.host);
  if (!host) {
    return null;
  }

  const forwardedProto = firstHeaderValue(request.forwardedProto)?.toLowerCase().replace(/:$/, '');
  const protocol = forwardedProto === 'https' || (forwardedProto !== 'http' && request.secure) ? 'https' : 'http';

  return `${protocol}://${host}`;
}

export function resolveShareBaseUrl(
  request: ShareOriginRequestInfo,
  configuredPublicBaseUrl: string | null | undefined
): string | null {
  const requestOrigin = resolveRequestOrigin(request);
  if (!requestOrigin) {
    return normalizePublicBaseUrl(configuredPublicBaseUrl);
  }

  let hostname: string;
  try {
    hostname = new URL(requestOrigin).hostname;
  } catch {
    return normalizePublicBaseUrl(configuredPublicBaseUrl) ?? requestOrigin;
  }

  if (isPrivateHostname(hostname)) {
    return requestOrigin;
  }

  return normalizePublicBaseUrl(configuredPublicBaseUrl) ?? requestOrigin;
}
