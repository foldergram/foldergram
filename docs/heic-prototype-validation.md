# Local HEIC and HEIF prototype validation

## Backend decision

Keep automatic discovery disabled by default. The opt-in implementation uses
`libheif-js@1.23.5` (libheif 1.23.5) and Sharp 0.34.5. The examined
`heic-decode@2.1.0` package loads the same WASM distribution, picks the first
exposed image and allocates RGBA before returning. The implementation uses the
pinned WASM distribution's low-level primary-image handle, container dimensions,
and decode limits. The worker checks the libheif version and limits ABI at
runtime. There is one decoder backend.

The main thread supplies a local source identity and file revision. The worker
checks byte size, validates the primary still and encoded dimensions, and
decodes once for the requested WebP sizes. Input goes from the original read
buffer to WASM. Rows are copied from WASM into one job-local RGB or RGBA buffer
and passed to Sharp sequentially. The worker exits after each job, releasing
its WASM heap. There is no intermediate PNG or JPEG.

## Fixture evidence

Public phone samples were downloaded into temporary storage from the
[Exif Samples HEIC collection](https://github.com/ianare/exif-samples/tree/master/heic)
for validation. Its contribution notice specifies CC BY-SA 4.0. CI uses a small
Foldergram-generated HEVC fixture and requires no fixture download or native
HEIC encoder.

- `IMG_5195.HEIC`, iPhone 11 Pro Max, produced a 2566 × 3313 portrait. The
  worker returned the Apple camera model, capture date, and GPS.
- `mobile/iphone_13_pro_max.HEIC`, iPhone 13 Pro Max, produced a 3024 × 4032
  portrait with orientation 6 and the original camera model and capture date.
  The prototype recognizes the Apple Display P3 ICC profile shared by both
  iPhone samples and converts its decoded RGB samples to sRGB.
- `mobile/HMD_Nokia_8.3_5G.heif` produced a 3456 × 4608 portrait with
  orientation 6 and original GPS. The HDR companion raised an unsupported
  color error.
- Synthetic 24 MP and 48 MP 8-bit gradient stills exercised pixel allocation at
  larger sizes. They are less complex than real high-resolution phone photos.

## Comparison on amd64

One worker on an Intel Core i7-13700H development machine, Node 24.15, with
both 640-pixel and 1500-pixel WebPs requested. The native CLI comparison was
ImageMagick 7.1.1-43 using its installed libheif 1.19.8 delegate with sRGB
profile conversion and a 1500-pixel WebP. The native path would require a
libheif-enabled executable and its decoder libraries on each deployment
architecture. It is a validation reference.

| Fixture | WASM and Sharp time | Node peak RSS | Main-thread event-loop delay p95 | Native preview time / peak RSS | Reference RGB mean absolute difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| iPhone 13 Pro Max, 12.2 MP | 2.17 s | 255 MiB | 10.58 ms | 2.09 s / 139 MiB | 0.63 / 255 |
| Nokia, 15.9 MP | 2.56 s | 356 MiB | 10.65 ms | 1.16 s / 199 MiB | 0.49 / 255 |
| Synthetic 24 MP | 0.88 s | 401 MiB | 10.96 ms | 0.88 s / 253 MiB | 0.22 / 255 |
| Synthetic 48 MP | 1.51 s | 636 MiB | 10.31 ms | 1.27 s / 425 MiB | 0.22 / 255 |

RSS was sampled every 10 ms during each run. The event-loop monitor also used
10 ms resolution. The Node numbers include the main process and worker. Node
RSS after the four jobs was 113, 157, 171 and 187 MiB from an initial 74 MiB.
This short run does not establish steady-state RSS. Pixel comparisons use both
previews resampled to 160 × 160 RGB. Timing varies with workload and the native
comparison generated one derivative. These observations support a single
worker for opt-in testing only.

## Deployment and release gates

Verified the TypeScript worker under Vitest, the emitted production worker in
a running server, a Chromium post page, byte-identical original download, and
offline amd64 Docker decoding with Node 22.23.4. The local Docker builder could
not execute its arm64 base image. Before enabling discovery by default, repeat
on native arm64, compare recent iPhone HDR and gain-map stills and mirrored
fixtures, measure a real 48 MP phone export, exercise more worker-failure paths,
and define and verify sustained memory and API latency budgets during repeated
scans.

A separate production-code HTTP smoke seeded 50,000 synthetic HEIC records
with no original files. An app boot and listener setup took 1.92 s. A run of
25 sequential requests per endpoint measured feed p50/p95 at 187/230 ms
and detail p50/p95 at 5.1/7.3 ms. Both returned HTTP 200 without creating
derivatives. This check used a 24-item feed, one test folder and no competing
scan. In a separate small-library check, the feed and folder endpoints served
45 request pairs during an eager scan of three copies of the iPhone 13 Pro Max
sample. Feed p50/p95 was 12.6/53.5 ms and folder p50/p95 was 12.4/53.7 ms.
These measurements cover the beginning of one import. A sustained mixed-load
benchmark is still required for release.
