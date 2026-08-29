import { describe, expect, it } from 'vitest';

import { isPrivateHostname, normalizePublicBaseUrl, resolveShareBaseUrl } from '../src/utils/share-url.js';

describe('share url resolution', () => {
  it('recognises LAN and loopback hosts', () => {
    expect(isPrivateHostname('192.168.5.11')).toBe(true);
    expect(isPrivateHostname('10.0.0.4')).toBe(true);
    expect(isPrivateHostname('172.20.1.9')).toBe(true);
    expect(isPrivateHostname('nas.local')).toBe(true);
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('gallery.example.com')).toBe(false);
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
  });

  it('normalizes a configured base url and rejects nonsense', () => {
    expect(normalizePublicBaseUrl('https://gallery.example.com/')).toBe('https://gallery.example.com');
    expect(normalizePublicBaseUrl('  http://1.2.3.4:8443/prefix/  ')).toBe('http://1.2.3.4:8443/prefix');
    expect(normalizePublicBaseUrl('')).toBeNull();
    expect(normalizePublicBaseUrl(null)).toBeNull();
    expect(normalizePublicBaseUrl('ftp://example.com')).toBeNull();
    expect(normalizePublicBaseUrl('not a url')).toBeNull();
  });

  it('keeps LAN requests on the LAN address', () => {
    expect(
      resolveShareBaseUrl({ host: '192.168.5.11:43921' }, 'https://gallery.example.com')
    ).toBe('http://192.168.5.11:43921');
  });

  it('uses the configured public base url for outside requests', () => {
    expect(
      resolveShareBaseUrl({ host: 'gallery.example.com', forwardedProto: 'https' }, 'https://share.example.com')
    ).toBe('https://share.example.com');
  });

  it('falls back to the request origin when nothing is configured', () => {
    expect(resolveShareBaseUrl({ host: 'gallery.example.com', forwardedProto: 'https' }, null)).toBe(
      'https://gallery.example.com'
    );
    expect(resolveShareBaseUrl({ host: null }, null)).toBeNull();
  });
});
