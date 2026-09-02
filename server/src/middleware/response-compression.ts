import zlib from 'node:zlib';

import type express from 'express';

/**
 * Responses below this size are left alone: the compression overhead (and the extra
 * CPU on the NAS) is not worth it for a few hundred bytes.
 */
const MINIMUM_COMPRESSED_BYTES = 1024;

/**
 * Only these media types are compressed. A whitelist is deliberate: the app streams
 * originals, HLS segments, thumbnails and previews through the same Express instance,
 * and those are already-compressed binaries that must never be re-encoded.
 */
const COMPRESSIBLE_TYPE_PATTERN =
  /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json|x-mpegurl|vnd\.apple\.mpegurl)|image\/svg\+xml)/i;

type Encoding = 'br' | 'gzip';

function pickEncoding(header: string | undefined): Encoding | null {
  if (!header) {
    return null;
  }

  const accepted = header.toLowerCase();
  // Brotli first: it is meaningfully smaller for the JS/CSS bundles that dominate
  // a cold load, and every browser that ships this PWA supports it.
  if (accepted.includes('br')) {
    return 'br';
  }

  if (accepted.includes('gzip')) {
    return 'gzip';
  }

  return null;
}

function createCompressor(encoding: Encoding): zlib.Gzip | zlib.BrotliCompress {
  if (encoding === 'br') {
    return zlib.createBrotliCompress({
      params: {
        // Level 5 is the usual sweet spot for on-the-fly encoding: close to max
        // ratio for text, but fast enough not to add latency on NAS-class CPUs.
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
      }
    });
  }

  return zlib.createGzip({ level: 6 });
}

function isCompressibleResponse(response: express.Response): boolean {
  if (response.getHeader('Content-Encoding')) {
    return false;
  }

  // 204/304 have no body, and 206 is a range slice that must stay byte-exact.
  if (response.statusCode === 204 || response.statusCode === 304 || response.statusCode === 206) {
    return false;
  }

  if (response.getHeader('Content-Range')) {
    return false;
  }

  const contentType = response.getHeader('Content-Type');
  if (typeof contentType !== 'string') {
    return false;
  }

  return COMPRESSIBLE_TYPE_PATTERN.test(contentType);
}

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer | null {
  if (chunk === undefined || chunk === null) {
    return null;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding ?? 'utf8');
  }

  return null;
}

/**
 * Compresses text responses on the fly.
 *
 * The app shell is a ~1 MB JS bundle plus a ~240 KB stylesheet, and Express ships
 * no compression by default, so every cold PWA start used to download the whole
 * thing uncompressed. Range requests, partial content and binary media are skipped
 * so video streaming and derivative delivery keep their current byte-exact
 * behaviour.
 */
export function compressTextResponses(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
): void {
  // A range request is being served byte-for-byte; compressing it would break the
  // offsets the client asked for.
  if (request.headers.range) {
    next();
    return;
  }

  const encoding = pickEncoding(request.headers['accept-encoding'] as string | undefined);
  if (!encoding) {
    next();
    return;
  }

  // Caches must not hand a compressed body to a client that cannot read it.
  response.vary('Accept-Encoding');

  const originalWrite = response.write.bind(response);
  const originalEnd = response.end.bind(response);
  const buffered: Buffer[] = [];
  let bufferedBytes = 0;
  let passthrough = false;
  let finished = false;

  function startPassthrough(): void {
    passthrough = true;
    response.write = originalWrite;
    response.end = originalEnd;

    for (const chunk of buffered) {
      originalWrite(chunk);
    }

    buffered.length = 0;
  }

  response.write = function patchedWrite(chunk: unknown, ...rest: unknown[]): boolean {
    if (passthrough || finished) {
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }

    const encodingArgument = typeof rest[0] === 'string' ? (rest[0] as BufferEncoding) : undefined;
    const buffer = toBuffer(chunk, encodingArgument);
    if (buffer === null) {
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }

    buffered.push(buffer);
    bufferedBytes += buffer.length;

    const callback = rest.find((argument) => typeof argument === 'function');
    if (typeof callback === 'function') {
      (callback as () => void)();
    }

    return true;
  } as typeof response.write;

  response.end = function patchedEnd(chunk?: unknown, ...rest: unknown[]): express.Response {
    if (passthrough || finished) {
      return (originalEnd as (...args: unknown[]) => express.Response)(chunk, ...rest);
    }

    const encodingArgument = typeof rest[0] === 'string' ? (rest[0] as BufferEncoding) : undefined;
    const tail = toBuffer(chunk, encodingArgument);
    if (tail !== null) {
      buffered.push(tail);
      bufferedBytes += tail.length;
    }

    finished = true;
    const body = buffered.length === 1 ? buffered[0] : Buffer.concat(buffered, bufferedBytes);
    const callback = rest.find((argument) => typeof argument === 'function') as (() => void) | undefined;

    if (bufferedBytes < MINIMUM_COMPRESSED_BYTES || !isCompressibleResponse(response)) {
      response.write = originalWrite;
      response.end = originalEnd;
      return (originalEnd as (...args: unknown[]) => express.Response)(body, callback);
    }

    const compressor = createCompressor(encoding);
    const compressedChunks: Buffer[] = [];

    compressor.on('data', (piece: Buffer) => {
      compressedChunks.push(piece);
    });

    compressor.on('error', () => {
      // Fall back to the untouched body rather than failing the request.
      response.write = originalWrite;
      response.end = originalEnd;
      (originalEnd as (...args: unknown[]) => express.Response)(body, callback);
    });

    compressor.on('end', () => {
      const compressed = Buffer.concat(compressedChunks);
      response.setHeader('Content-Encoding', encoding);
      response.setHeader('Content-Length', String(compressed.length));
      // ETags are computed from the identity body upstream; keeping a strong ETag
      // here would let a cache serve the compressed bytes as if they were identity.
      const etag = response.getHeader('ETag');
      if (typeof etag === 'string' && !etag.startsWith('W/')) {
        response.setHeader('ETag', `W/${etag}`);
      }

      response.write = originalWrite;
      response.end = originalEnd;
      (originalEnd as (...args: unknown[]) => express.Response)(compressed, callback);
    });

    compressor.end(body);
    return response;
  } as typeof response.end;

  // A body that never gets written (for example a 304) must still restore the
  // original methods so downstream listeners behave normally.
  response.on('close', () => {
    if (!finished && !passthrough) {
      startPassthrough();
    }
  });

  next();
}
