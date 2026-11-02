import http from 'node:http';

import type express from 'express';

export interface TestHttpResponse {
  status: number;
  headers: Headers;
  body: any;
  rawBody: Buffer;
}

export async function requestTestApp(
  app: express.Application,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<TestHttpResponse> {
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', handleError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string' || !address.port) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Failed to obtain a valid server port.');
  }

  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  try {
    return await new Promise<TestHttpResponse>((resolve, reject) => {
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: urlPath,
          method,
          headers: {
            ...(serializedBody === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers
          }
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            const responseHeaders = new Headers();
            for (let index = 0; index < response.rawHeaders.length; index += 2) {
              responseHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
            }

            const rawBodyBuffer = Buffer.concat(chunks);
            const rawBody = rawBodyBuffer.toString('utf8');
            const contentType = responseHeaders.get('content-type') ?? '';
            let responseBody: any = rawBody;

            if (contentType.includes('application/json')) {
              try {
                responseBody = JSON.parse(rawBody);
              } catch {
                responseBody = null;
              }
            }

            resolve({
              status: response.statusCode ?? 0,
              headers: responseHeaders,
              body: responseBody,
              rawBody: rawBodyBuffer
            });
          });
        }
      );

      request.on('error', reject);
      if (serializedBody !== undefined) {
        request.write(serializedBody);
      }
      request.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
