import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom');
const { execFileMock, execFileAsyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileAsyncMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execFile: Object.assign(execFileMock, {
    [PROMISIFY_CUSTOM]: execFileAsyncMock
  })
}));

type AppConfigModule = typeof import('../src/config/env.js');
type DerivativeServiceModule = typeof import('../src/services/derivative-service.js');

describe.sequential('video derivative strategy', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let writeVideoPreview: DerivativeServiceModule['writeVideoPreview'];
  let generatePreviewDerivative: DerivativeServiceModule['generatePreviewDerivative'];
  let generateDerivatives: DerivativeServiceModule['generateDerivatives'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-video-derivatives-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ generateDerivatives, writeVideoPreview, generatePreviewDerivative } = await import('../src/services/derivative-service.js'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    execFileMock.mockReset();
    execFileAsyncMock.mockReset();
    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  it('keeps preview transcoding for large high-resolution browser-safe MP4 originals while preserving original playback eligibility', async () => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({
      format: {
        duration: '4.0',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2'
      },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 2160, height: 3840, pix_fmt: 'yuv420p' },
        { index: 1, codec_type: 'audio', codec_name: 'aac' }
      ]
    }));

    const sourcePath = path.join(appConfig.galleryRoot, 'clips', 'reel-1.mp4');
    const stalePreviewPath = path.join(appConfig.previewsDir, 'clips', 'reel-1.mp4');

    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.mkdir(path.dirname(stalePreviewPath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.alloc(32 * 1024 * 1024));

    const result = await generateDerivatives(sourcePath, 'clips/reel-1.mp4');

    expect(result.playbackStrategy).toBe('original');
    expect(result.generatedPreview).toBe(true);

    const ffmpegCalls = execFileAsyncMock.mock.calls.filter(([command, args]) => command === 'ffmpeg' && args.includes('-i'));
    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls[0]?.[1]).toContain('libwebp');
    expect(ffmpegCalls[1]?.[1]).toContain('libx264');
    expect(ffmpegCalls[1]?.[1]).toContain(expectedVideoScaleFilter());
  });

  it('keeps preview transcoding for incompatible MP4 files', async () => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({
      format: {
        duration: '4.0',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2'
      },
      streams: [
        { codec_type: 'video', codec_name: 'hevc', width: 1080, height: 1920, pix_fmt: 'yuv420p' },
        { index: 1, codec_type: 'audio', codec_name: 'aac' }
      ]
    }));

    const sourcePath = path.join(appConfig.galleryRoot, 'clips', 'reel-2.mp4');

    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.alloc(1024 * 1024));

    const result = await generateDerivatives(sourcePath, 'clips/reel-2.mp4', true);

    expect(result.playbackStrategy).toBe('preview');
    expect(result.generatedPreview).toBe(true);

    const ffmpegCalls = execFileAsyncMock.mock.calls.filter(([command, args]) => command === 'ffmpeg' && args.includes('-i'));
    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls[0]?.[1]).toContain('libwebp');
    expect(ffmpegCalls[1]?.[1]).toContain('libx264');
    expect(ffmpegCalls[1]?.[1]).toContain(expectedVideoScaleFilter());
  });

  it('normalizes rotated source dimensions to display dimensions before returning metadata', async () => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({
      format: {
        duration: '4.0',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2'
      },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          pix_fmt: 'yuv420p',
          side_data_list: [
            {
              rotation: -90
            }
          ]
        },
        { index: 1, codec_type: 'audio', codec_name: 'aac' }
      ]
    }));

    const sourcePath = path.join(appConfig.galleryRoot, 'clips', 'reel-rotated.mp4');

    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.alloc(1024 * 1024));

    const result = await generateDerivatives(sourcePath, 'clips/reel-rotated.mp4', true);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
  });
  it.each(['aac', 'pcm_s16le', 'mp3'])('selects supported %s audio after an unsupported track by absolute index', async (codec) => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({ streams: [
      { index: 0, codec_type: 'video', codec_name: 'hevc' },
      { index: 1, codec_type: 'audio' },
      { index: 7, codec_type: 'audio', codec_name: codec }
    ] }));
    const output = path.join(tempRoot, `supported-${codec}.mp4`);
    await writeVideoPreview('source.mov', output);
    const conversion = execFileAsyncMock.mock.calls.find(([command, args]) => command === 'ffmpeg' && args.includes('-i'));
    expect(conversion?.[1]).toContain('0:7');
    expect(conversion?.[1]).not.toContain('0:a?');
    expect(conversion?.[1].at(-1)).not.toBe(output);
    expect(await fs.readFile(output, 'utf8')).toBe('valid-preview');
  });

  it('preserves silent videos without requiring an audio decoder', async () => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({ streams: [
      { index: 0, codec_type: 'video', codec_name: 'hevc' }
    ] }));
    await writeVideoPreview('silent.mov', path.join(tempRoot, 'silent.mp4'));
    const conversion = execFileAsyncMock.mock.calls.find(([command, args]) => command === 'ffmpeg' && args.includes('-i'));
    expect(conversion?.[1]).toContain('-an');
    expect(execFileAsyncMock.mock.calls.some(([, args]) => args.includes('-decoders'))).toBe(false);
  });

  it('fails explicitly for recognized audio without an installed decoder', async () => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({ streams: [
      { index: 1, codec_type: 'audio', codec_name: 'unavailable' }
    ] }));
    const output = path.join(tempRoot, 'unsupported.mp4');
    await expect(writeVideoPreview('unsupported.mov', output)).rejects.toThrow('No audio track');
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['ffmpeg', 'empty', 'probe', 'invalid'])('preserves an old preview and cleans temporary files after %s failure', async (failure) => {
    const output = path.join(appConfig.previewsDir, `failure-${failure}.mp4`);
    await fs.writeFile(output, 'old-valid-preview');
    const baseMock = createExecFileAsyncMock({ streams: [{ index: 1, codec_type: 'audio', codec_name: 'aac' }] });
    execFileAsyncMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === 'ffmpeg' && args.includes('-i')) {
        await fs.writeFile(args.at(-1)!, failure === 'empty' ? '' : 'partial');
        if (failure === 'ffmpeg') throw new Error('conversion failed');
        return { stdout: '', stderr: '' };
      }
      if (command === 'ffprobe' && path.basename(args.at(-1)!).startsWith('.preview-')) {
        if (failure === 'probe') throw new Error('invalid container');
        if (failure === 'invalid') return { stdout: '{"streams":[]}', stderr: '' };
      }
      return baseMock(command, args);
    });
    await expect(generatePreviewDerivative('source.mov', 'source.mov', true, {
      previewPath: path.basename(output)
    })).rejects.toThrow();
    expect(await fs.readFile(output, 'utf8')).toBe('old-valid-preview');
    expect((await fs.readdir(appConfig.previewsDir)).filter((name) => name.startsWith('.preview-'))).toEqual([]);
  });

  it('retries an empty cached preview and reuses the repaired preview', async () => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({ streams: [{ index: 1, codec_type: 'audio', codec_name: 'aac' }] }));
    const previewPath = 'empty-cache.mp4';
    await fs.writeFile(path.join(appConfig.previewsDir, previewPath), '');
    const first = await generatePreviewDerivative('source.mov', 'source.mov', false, { previewPath });
    expect(first.generatedPreview).toBe(true);
    execFileAsyncMock.mockClear();
    const second = await generatePreviewDerivative('source.mov', 'source.mov', false, { previewPath });
    expect(second.generatedPreview).toBe(false);
    expect(execFileAsyncMock).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent writes and leaves only a published preview', async () => {
    execFileAsyncMock.mockImplementation(createExecFileAsyncMock({ streams: [] }));
    const output = path.join(appConfig.previewsDir, 'concurrent.mp4');
    await Promise.all([writeVideoPreview('source.mov', output), writeVideoPreview('source.mov', output)]);
    expect(execFileAsyncMock.mock.calls.filter(([command, args]) => command === 'ffmpeg' && args.includes('-i'))).toHaveLength(1);
    expect(await fs.readFile(output, 'utf8')).toBe('valid-preview');
    expect((await fs.readdir(appConfig.previewsDir)).filter((name) => name.startsWith('.preview-'))).toEqual([]);
  });

});

function expectedVideoScaleFilter(): string {
  return "scale='trunc(if(gt(iw,ih),min(1280,iw),min(720,iw))/2)*2':'trunc(if(gt(iw,ih),min(1280,iw)*ih/iw,min(720,iw)*ih/iw)/2)*2':flags=lanczos";
}

function createExecFileAsyncMock(payload: { streams?: Array<Record<string, unknown>> }) {
  return async (command: string, args: string[]) => {
    if (command === 'ffprobe') {
      const isOutput = path.basename(args.at(-1)!).startsWith('.preview-');
      return {
        stdout: JSON.stringify(isOutput ? {
          format: { duration: '4.0', format_name: 'mov,mp4' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, pix_fmt: 'yuv420p' },
            ...(payload.streams?.some((stream) => stream.codec_type === 'audio')
              ? [{ codec_type: 'audio', codec_name: 'aac' }] : [])
          ]
        } : payload),
        stderr: ''
      };
    }
    if (args.includes('-decoders')) {
      return { stdout: ' A....D aac AAC\n A....D pcm_s16le PCM\n A....D mp3float MP3 (codec mp3)\n', stderr: '' };
    }
    await fs.writeFile(args.at(-1)!, 'valid-preview');
    return { stdout: '', stderr: '' };
  };
}
