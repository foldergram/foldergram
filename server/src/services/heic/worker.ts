import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

import sharp from 'sharp';

import { extractImageExif } from '../../utils/exif-utils.js';
import { PREVIEW_MAX_WIDTH, THUMBNAIL_SIZE } from '../../utils/image-utils.js';
import { HeicError, sameHeicRevision, type HeicWorkerRequest, type HeicWorkerResult } from './protocol.js';

type Heif = Awaited<ReturnType<typeof import('libheif-js/libheif-wasm/libheif.js').default>>;

const require = createRequire(import.meta.url);
const EXPECTED_LIBHEIF_VERSION = 0x01170500;
const INTERLEAVED = 10;
const RGB_COLORSPACE = 1;
const HEADER_BYTES = 36;
const RESULT = 12; // follows heif_error in the pinned wasm32 C ABI
const REFERENCE_TYPE = 16;
const REFERENCES = 20;
const STRIDE = 24;

const fourcc = (value: string) => Buffer.from(value, 'ascii').readUInt32BE();

function mediaError(message: string): never {
  throw new HeicError('media', message);
}

async function readOriginal(job: HeicWorkerRequest): Promise<Buffer> {
  const file = await fs.open(job.sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stats = await file.stat();
    if (!stats.isFile() || !sameHeicRevision(stats, job.revision)) {
      throw new HeicError('stale', 'HEIC original changed before processing.');
    }
    if (stats.size <= 0 || stats.size > job.maxInputBytes) {
      mediaError('HEIC input exceeds the configured byte limit or is empty.');
    }
    const bytes = Buffer.allocUnsafe(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new HeicError('stale', 'HEIC original changed while reading.');
      offset += bytesRead;
    }
    if (!sameHeicRevision(await file.stat(), job.revision)) {
      throw new HeicError('stale', 'HEIC original changed while reading.');
    }
    return bytes;
  } finally {
    await file.close();
  }
}

function checkContainer(bytes: Buffer): void {
  if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp') {
    mediaError('Invalid HEIC/HEIF file header.');
  }
  const size = bytes.readUInt32BE();
  if (size < 16 || size > Math.min(4096, bytes.length) || size % 4 !== 0) {
    mediaError('Invalid HEIC/HEIF file type box.');
  }
  const brands = [bytes.toString('ascii', 8, 12)];
  for (let offset = 16; offset < size; offset += 4) {
    brands.push(bytes.toString('ascii', offset, offset + 4));
  }
  if (brands.some(brand => ['msf1', 'hevc', 'hevx', 'hevm', 'hevs'].includes(brand))) {
    mediaError('HEIC/HEIF image sequences are unsupported.');
  }
  if (!['mif1', 'heic', 'heix', 'heim', 'heis'].includes(brands[0])) {
    mediaError('Unsupported HEIC/HEIF container brand.');
  }
}

function validateSize(width: number, height: number, maxPixels: number): void {
  if (width <= 0 || height <= 0 || width > 32_768 || height > 32_768 || width * height > maxPixels) {
    mediaError('HEIC dimensions exceed the configured pixel limit or are invalid.');
  }
}

function checkHeif(wasm: Heif, scratch: number, action: string, allowMissingProfile = false): boolean {
  const code = wasm.HEAPU32[scratch / 4];
  const subcode = wasm.HEAPU32[scratch / 4 + 1];
  if (code === 0) return true;
  if (allowMissingProfile && code === 10) return false;
  if (subcode === 1000) mediaError(`HEIC ${action} exceeded a decoder resource limit.`);
  if (code === 6) throw new HeicError('infrastructure', 'HEIC decoder could not allocate memory.');
  mediaError(`HEIC ${action} failed (libheif code ${code}/${subcode}).`);
}

function validateGrid(wasm: Heif, context: number, imageId: number, scratch: number): void {
  for (let index = 0; index < 128; index += 1) {
    const count = wasm._heif_context_get_item_references(context, imageId, index, scratch + REFERENCE_TYPE, scratch + REFERENCES);
    if (count === 0) break;
    try {
      if (wasm.HEAPU32[(scratch + REFERENCE_TYPE) / 4] !== fourcc('dimg')) continue;
      if (count > 256) mediaError('HEIC tile count exceeds the supported limit.');
      const list = wasm.HEAPU32[(scratch + REFERENCES) / 4];
      for (let tile = 0; tile < count; tile += 1) {
        if (wasm._heif_item_get_item_type(context, wasm.HEAPU32[list / 4 + tile]) !== fourcc('hvc1')) {
          mediaError('HEIC grid contains an unsupported tile codec.');
        }
      }
      return;
    } finally {
      wasm._heif_release_item_references(context, scratch + REFERENCES);
    }
  }
  mediaError('HEIC grid has no HEVC tiles.');
}

// Matrix entries describe how each EXIF orientation maps the original axes.
const orientations = [
  [1, 0, 0, 1], [-1, 0, 0, 1], [-1, 0, 0, -1], [1, 0, 0, -1],
  [0, 1, 1, 0], [0, -1, 1, 0], [0, -1, -1, 0], [0, 1, -1, 0]
];

function containerOrientation(wasm: Heif, context: number, imageId: number): number | null {
  const count = wasm._heif_item_get_transformation_properties(context, imageId, 0, 0);
  if (count <= 0) return null;
  if (count > 32) mediaError('HEIC has too many geometric transformations.');
  const properties = wasm._malloc(count * 4);
  if (!properties) throw new HeicError('infrastructure', 'HEIC decoder could not allocate memory.');
  try {
    wasm._heif_item_get_transformation_properties(context, imageId, properties, count);
    let current = orientations[0];
    let hasOrientation = false;
    for (let i = 0; i < count; i += 1) {
      const id = wasm.HEAPU32[properties / 4 + i];
      const type = wasm._heif_item_get_property_type(context, imageId, id);
      let next: number[];
      if (type === fourcc('irot')) {
        const angle = wasm._heif_item_get_property_transform_rotation_ccw(context, imageId, id);
        const rotation = [1, 8, 3, 6][angle / 90];
        if (!rotation) mediaError('Invalid HEIC rotation.');
        next = orientations[rotation - 1];
      } else if (type === fourcc('imir')) {
        const direction = wasm._heif_item_get_property_transform_mirror(context, imageId, id);
        if (direction !== 0 && direction !== 1) mediaError('Invalid HEIC mirror direction.');
        next = orientations[direction === 0 ? 3 : 1];
      } else {
        continue;
      }
      hasOrientation = true;
      const [a, b, c, d] = next;
      const [e, f, g, h] = current;
      current = [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];
    }
    return hasOrientation ? orientations.findIndex(matrix => matrix.every((value, i) => value === current[i])) + 1 : null;
  } finally {
    wasm._free(properties);
  }
}

function inspectColor(wasm: Heif, handle: number, scratch: number): 'srgb' | 'display-p3' {
  if (wasm._heif_image_handle_get_luma_bits_per_pixel(handle) !== 8 ||
      wasm._heif_image_handle_get_chroma_bits_per_pixel(handle) !== 8) {
    mediaError('This HEIC prototype supports 8-bit SDR images.');
  }

  const profileSize = wasm._heif_image_handle_get_raw_color_profile_size(handle);
  if (profileSize && profileSize !== 548) mediaError('Unrecognized HEIC ICC color profile.');
  let isKnownAppleP3 = false;
  if (profileSize) {
    const pointer = wasm._malloc(profileSize);
    if (!pointer) throw new HeicError('infrastructure', 'HEIC decoder could not allocate memory.');
    try {
      wasm._heif_image_handle_get_raw_color_profile(scratch, handle, pointer);
      checkHeif(wasm, scratch, 'ICC color profile');
      const digest = createHash('sha256').update(wasm.HEAPU8.subarray(pointer, pointer + profileSize)).digest('hex');
      // The Apple Display P3 profile on the iPhone 11 and 13 validation fixtures.
      isKnownAppleP3 = digest === 'e468e89239fc0493d5e8fb9b014e91b210c6caa73c81edf04c3d21a734f377cc';
      if (!isKnownAppleP3) mediaError('Unrecognized HEIC ICC color profile.');
    } finally {
      wasm._free(pointer);
    }
  }

  wasm._heif_image_handle_get_nclx_color_profile(scratch, handle, scratch + RESULT);
  if (!checkHeif(wasm, scratch, 'color metadata', true)) return isKnownAppleP3 ? 'display-p3' : 'srgb';
  const profile = wasm.HEAPU32[(scratch + RESULT) / 4];
  try {
    const primaries = wasm.HEAPU32[profile / 4 + 1];
    const transfer = wasm.HEAPU32[profile / 4 + 2];
    if (![1, 2, 13].includes(transfer)) mediaError('HDR or unsupported HEIC transfer characteristics.');
    if (isKnownAppleP3 || (primaries === 12 && transfer === 13)) return 'display-p3';
    if (![1, 2].includes(primaries)) mediaError('Unsupported HEIC color primaries.');
    return 'srgb';
  } finally {
    wasm._heif_nclx_color_profile_free(profile);
  }
}

function convertDisplayP3ToSrgb(pixels: Buffer, channels: number): void {
  const linearize = Float64Array.from({ length: 256 }, (_, value) => {
    const signal = value / 255;
    return signal <= 0.04045 ? signal / 12.92 : ((signal + 0.055) / 1.055) ** 2.4;
  });
  const encode = Uint8Array.from({ length: 4097 }, (_, value) => {
    const light = value / 4096;
    return Math.round(255 * (light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055));
  });
  const quantize = (light: number) => encode[Math.max(0, Math.min(4096, Math.round(light * 4096)))];
  // Display P3 and sRGB both use D65. Apply the linear RGB conversion
  // before clipping out-of-gamut samples and restoring the sRGB transfer.
  for (let i = 0; i < pixels.length; i += channels) {
    const r = linearize[pixels[i]];
    const g = linearize[pixels[i + 1]];
    const b = linearize[pixels[i + 2]];
    pixels[i] = quantize(1.22494 * r - 0.22494 * g);
    pixels[i + 1] = quantize(-0.042057 * r + 1.042057 * g);
    pixels[i + 2] = quantize(-0.019638 * r - 0.078636 * g + 1.098274 * b);
  }
}

async function writeWebp(
  pixels: Buffer,
  raw: { width: number; height: number; channels: 3 | 4 },
  orientation: number,
  outputs: HeicWorkerRequest['outputs']
): Promise<void> {
  for (const output of outputs) {
    const maxWidth = output.kind === 'thumbnail' ? THUMBNAIL_SIZE : PREVIEW_MAX_WIDTH;
    const pipeline = sharp(pixels, { raw });
    if (orientation === 2 || orientation === 5 || orientation === 7) pipeline.flop();
    if (orientation === 4) pipeline.flip();
    const rotation = { 3: 180, 5: 270, 6: 90, 7: 90, 8: 270 }[orientation];
    if (rotation) pipeline.rotate(rotation);
    await pipeline.resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: output.kind === 'thumbnail' ? 82 : 86, effort: 4 })
      .toFile(output.temporaryPath);

    // Decode the actual encoded file before it can replace a cached derivative.
    const { data, info } = await sharp(output.temporaryPath, { failOn: 'warning' })
      .raw().toBuffer({ resolveWithObject: true });
    const { format } = await sharp(output.temporaryPath).metadata();
    const displayWidth = orientation >= 5 ? raw.height : raw.width;
    const displayHeight = orientation >= 5 ? raw.width : raw.height;
    const expectedWidth = Math.min(maxWidth, displayWidth);
    const expectedHeight = Math.max(1, Math.round(displayHeight * expectedWidth / displayWidth));
    if (format !== 'webp' || info.width !== expectedWidth || info.height !== expectedHeight ||
        data.length !== info.width * info.height * info.channels) {
      throw new HeicError('infrastructure', 'HEIC worker produced an invalid WebP derivative.');
    }
  }
}

async function processHeic(job: HeicWorkerRequest): Promise<HeicWorkerResult> {
  const bytes = await readOriginal(job);
  checkContainer(bytes);
  const module = require('libheif-js/wasm-bundle') as Heif & { ready?: Promise<Heif> };
  const wasm = await (module.ready ?? module);
  if (wasm._heif_get_version_number() !== EXPECTED_LIBHEIF_VERSION) {
    throw new HeicError('infrastructure', 'Unexpected libheif WASM version.');
  }

  let context = 0;
  let input = 0;
  let scratch = 0;
  let handle = 0;
  let decoded = 0;
  try {
    context = wasm._heif_context_alloc();
    input = wasm._malloc(bytes.length);
    scratch = wasm._malloc(HEADER_BYTES);
    if (!context || !input || !scratch) throw new HeicError('infrastructure', 'HEIC decoder could not allocate memory.');

    // max_image_size_pixels is the first uint64_t at byte 8 in this wasm32 ABI.
    // Apply the limit inside libheif as well, including to grid tiles and alpha.
    const limits = wasm._heif_context_get_security_limits(context);
    if (!limits || wasm.HEAPU8[limits] !== 4) throw new HeicError('infrastructure', 'Unexpected libheif security limits ABI.');
    wasm.HEAPU32[limits / 4 + 2] = job.maxPixels;
    wasm.HEAPU32[limits / 4 + 3] = 0;
    wasm.HEAPU8.set(bytes, input);
    wasm._heif_context_read_from_memory_without_copy(scratch, context, input, bytes.length, 0);
    checkHeif(wasm, scratch, 'header inspection');
    if (wasm._heif_context_has_sequence(context) || wasm._heif_context_get_number_of_top_level_images(context) !== 1) {
      mediaError('HEIC sequences or multiple independent still images are unsupported.');
    }

    wasm._heif_context_get_primary_image_handle(scratch, context, scratch + RESULT);
    checkHeif(wasm, scratch, 'primary image selection');
    handle = wasm.HEAPU32[(scratch + RESULT) / 4];
    const id = wasm._heif_image_handle_get_item_id(handle);
    const type = wasm._heif_item_get_item_type(context, id);
    if (type === fourcc('grid')) validateGrid(wasm, context, id, scratch);
    else if (type !== fourcc('hvc1')) mediaError('The HEIC primary image does not use a supported HEVC codec.');

    const width = wasm._heif_image_handle_get_width(handle);
    const height = wasm._heif_image_handle_get_height(handle);
    validateSize(width, height, job.maxPixels);
    validateSize(wasm._heif_image_handle_get_ispe_width(handle), wasm._heif_image_handle_get_ispe_height(handle), job.maxPixels);
    const color = inspectColor(wasm, handle, scratch);
    const container = containerOrientation(wasm, context, id);
    const exif = await extractImageExif(bytes);
    const orientation = container ?? exif.orientation ?? 1;
    const pixelOrientation = container === null ? orientation : 1;
    const metadata = {
      ...exif,
      displayOrientation: orientation,
      width: pixelOrientation >= 5 ? height : width,
      height: pixelOrientation >= 5 ? width : height
    };
    if (job.outputs.length === 0) return { metadata };

    const channels = wasm._heif_image_handle_has_alpha_channel(handle) ? 4 : 3;
    wasm._heif_decode_image(scratch, handle, scratch + RESULT, RGB_COLORSPACE, channels === 4 ? 11 : 10, 0);
    checkHeif(wasm, scratch, 'pixel decode');
    decoded = wasm.HEAPU32[(scratch + RESULT) / 4];
    if (wasm._heif_image_get_decoding_warnings(decoded, 0, 0, 0) !== 0) {
      mediaError('HEIC pixel decode reported damaged or unsupported data.');
    }
    if (wasm._heif_image_get_width(decoded, INTERLEAVED) !== width ||
        wasm._heif_image_get_height(decoded, INTERLEAVED) !== height) {
      mediaError('Decoded HEIC dimensions differ from the primary image header.');
    }
    const pointer = wasm._heif_image_get_plane_readonly2(decoded, INTERLEAVED, scratch + STRIDE);
    const stride = wasm.HEAPU32[(scratch + STRIDE) / 4];
    const rowBytes = width * channels;
    if (!pointer || stride < rowBytes || pointer + stride * (height - 1) + rowBytes > wasm.HEAPU8.byteLength) {
      mediaError('Invalid HEIC decoded pixel buffer.');
    }
    const pixels = Buffer.allocUnsafe(rowBytes * height);
    for (let row = 0; row < height; row += 1) {
      const start = pointer + stride * row;
      pixels.set(wasm.HEAPU8.subarray(start, start + rowBytes), row * rowBytes);
    }
    const premultiplied = channels === 4 && Boolean(wasm._heif_image_is_premultiplied_alpha(decoded));
    wasm._heif_image_release(decoded);
    decoded = 0;

    // Sharp's raw constructor expects straight RGB(A) samples.
    if (premultiplied) {
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3];
        if (alpha === 0 || alpha === 255) continue;
        for (let channel = offset; channel < offset + 3; channel += 1) {
          pixels[channel] = Math.min(255, Math.round(pixels[channel] * 255 / alpha));
        }
      }
    }
    if (color === 'display-p3') convertDisplayP3ToSrgb(pixels, channels);
    await writeWebp(pixels, { width, height, channels }, pixelOrientation, job.outputs);
    return { metadata };
  } finally {
    if (decoded) wasm._heif_image_release(decoded);
    if (handle) wasm._heif_image_handle_release(handle);
    if (context) wasm._heif_context_free(context);
    if (scratch) wasm._free(scratch);
    if (input) wasm._free(input);
  }
}

if (!parentPort) throw new Error('The HEIC decoder must run inside a worker thread.');

void processHeic(workerData as HeicWorkerRequest).then(
  result => parentPort!.postMessage(result),
  (error: unknown) => parentPort!.postMessage({
    kind: error instanceof HeicError ? error.kind : 'infrastructure',
    message: error instanceof Error ? error.message : 'HEIC worker failed.'
  } satisfies HeicWorkerResult)
);
