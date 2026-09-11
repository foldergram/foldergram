# 当前部署入口与版本锁定

本文档是 foldergram 当前运行版本的入口记录。部署、排查或刷新网页时，必须以这里记录的入口和镜像为准，不要自行切换到 GitHub 的原始镜像或旧项目目录。

## 唯一用户入口

- 网页入口：`http://192.168.5.11:43921/`
- 健康检查：`http://192.168.5.11:43921/api/health`
- `4141` 是容器内部端口，不是用户访问入口。
- NAS 管理界面里的旧容器、旧端口或其他项目目录都不属于当前用户入口。

## 当前版本

- 对外容器名：`foldergram`（Nginx 网关）；应用容器为 `foldergram-web` 和 `foldergram-worker`。
- 当前性能部署 Compose：`docker-compose.nas-direct.yml`。
- 部署方式：NAS 上从当前源码目录本地构建 `foldergram:domain-split-20260911`，再启动网关、web 和 worker。
- 禁止使用：`ghcr.io/foldergram/foldergram:latest`。它可能把系统带回未包含本地优化的原始版本。
- NAS Docker：`27.2.0`
- NAS Compose：`v2.40.1`
- 最近一次部署：2026-08-31 22:17，运行镜像 ID `sha256:bff45474...`，回滚镜像 `foldergram:backup-20260831-221700-before-sw-v6`
- 2026-09-01 外网播放优化已部署，运行镜像 ID `sha256:108a7a71493d...`，回滚镜像 `foldergram:backup-20260901-before-wan-hls`
- 前一次回滚点：`foldergram:backup-20260831-092253-before-perf-audio-keepalive`
- 该次部署上线内容：修复共享播放器 Teleport 后误登记组件代理导致的沉浸式上下滑退出异常；保护 provider 切换期间的播放状态读取；Service Worker 升级为 `foldergram-v5`，确保手机不会继续执行旧播放器脚本。此前的响应压缩与静态资源缓存、全局静音裁决、视图缓存、沉浸式手势与起播优化仍保留。
- 本次部署上线内容：移除首页把播放器 Teleport 到沉浸层的旧链路，所有全屏入口统一由 `ImmersiveVideoLayer` 的单一 `VideoMediaPlayer` 承载；沉浸式画面横向拖动改为按手指绝对位置连续 seek，保留长按 2 倍速、双击暂停/继续、上下滑退出、双指缩放/平移与横屏坐标映射；首页交接继续携带播放进度，返回时恢复位置与播放状态。部署前已通过客户端核心回归测试、类型检查、生产构建，并在 390x844 移动端现场验证。
- 本次增量部署上线内容：沉浸式画面左右拖动改为以按下瞬间的播放点为基准、按手指位移连续 seek，避免手指滑到屏幕中间时播放点跳回中间；视频播放优先使用带 `+faststart` 的预览 MP4，降低首帧、图片后视频和长视频跳播的等待；首页激活视频可见阈值下调，避免混合图片/视频列表中视频失去播放拥有者。已通过 121 个客户端回归测试、类型检查和生产构建，并重新部署到 NAS。
- 本次增量部署上线内容：播放器在有声 autoplay 被浏览器拒绝后先静音启动，成功后立即恢复全局声音状态，并同步 Vidstack、light DOM 与 shadow DOM 的原生 `<video>.muted`；没有 faststart preview 的旧媒体保留 HLS 兼容路径；首页与纯刷切换、provider 重挂载或底层视频尚未拿到可渲染帧时保留真实缩略图，避免切回首页出现黑屏。已通过核心客户端回归测试、类型检查和生产构建，并部署到 NAS。
- 本次增量部署上线内容：修正 `media-provider` 与 `media-poster` 的播放器层叠布局，避免 provider 占据正常文档流后把缩略图推到视频卡片底部；首页与纯刷切换时封面会稳定留在同一舞台，直到原生视频真正解码出帧。已通过核心客户端回归测试、类型检查和生产构建，并部署到 NAS。
- 本次增量部署上线内容：Service Worker 升级到 `foldergram-v6`，主动淘汰旧的首页/CSS 缓存，确保 PWA 刷新后真正使用当前播放器构建。
- 2026-09-01 本次增量部署上线内容：扫描文件夹的勾选范围现在同时作为全局显示范围，应用的首页、纯刷、搜索、收藏、归档、文件夹、地点和统计只展示勾选目录及其子目录；取消勾选只隐藏，不删除数据库索引、缩略图或预览，重新勾选可复用已有索引。运行镜像为 `foldergram:scope-20260901`，回滚镜像为 `foldergram:backup-20260901-before-scope`。
- 2026-09-01 本次增量部署上线内容：首页小窗的播放权阈值与观察器对齐到 20%，修复视频已滑入画面却没有自动起播、点进沉浸式再返回才开始播放的问题。Service Worker `foldergram-v11`。运行镜像 `foldergram:home-autoplay-owner-20260901`，回滚 `foldergram:backup-20260901-before-home-autoplay-owner`。
- 2026-09-01 本次增量部署上线内容：dock 视图滚动位置按路由名稳定保存，并在 KeepAlive 激活后的布局阶段进行有限重试恢复；沉浸式播放器底部时间轴独占指针事件，底栏拖动不会再触发画面左右/上下手势。运行镜像 `foldergram:scroll-progress-20260901`，回滚 `foldergram:backup-20260901-before-scroll-progress`。
- 2026-09-01 本次增量部署上线内容：视频封面为空或封面请求失败时，使用原视频临时抓取第一帧作为视觉兜底；首页小窗自动播放必须检测到原生视频可绘制帧，不能只看播放时钟是否前进。保留共享播放器和既有手势契约，不需要重新扫描图库。运行镜像 `foldergram:direct-worker-20260901`，旧镜像标签保留用于回滚。
- 2026-09-01 本次增量部署上线内容：全屏画面单指左右拖动固定为相对当前进度；每次新手势从最近一次已提交/显示的位置继续，不读屏幕绝对坐标，也不受底层播放器 seek 回报滞后影响。横屏、竖屏和首页共享小窗一致。Service Worker `foldergram-v12`。运行镜像 `foldergram:relative-scrub-20260901`，回滚 `foldergram:backup-20260901-before-relative-scrub`。
- 2026-09-01 本次增量部署上线内容：修复点开黑屏不播。封面会留到真正出画；沉浸式/纯刷/首页共享播放器在 2 秒仍无画面时切 HLS 兜底。Service Worker `foldergram-v10`。运行镜像 `foldergram:black-screen-fallback-20260901`，回滚 `foldergram:backup-20260901-before-black-screen-fallback`。
- 2026-09-01 本次增量部署上线内容：默认直推原文件；预览策略的 MP4/MOV 在设备报告 HEVC 可硬解时也直推，避免现场 HLS 转码把首卡卡在 0:00。首页去掉 Google Fonts 外链，Service Worker 升到 `foldergram-v9`。沉浸式横屏单指左右拖动按旋转后的画面坐标绝对跟手。Feed/Reels 查询加了库签名缓存。运行镜像为 `foldergram:hevc-direct-20260901`，回滚镜像为 `foldergram:backup-20260901-before-hevc-direct`。
- 2026-09-01 本次增量部署上线内容：共享播放器进入沉浸式后使用 viewer 底栏布局，进度条位于暂停/时间行上方并避开底部遮挡；横屏受控时间轴按旋转后的视觉轴计算，且补齐共享播放器的 seek/seek-preview 接线，避免横屏进度条显示但无法拖动。运行镜像为 `foldergram:immersive-seek-20260901`，回滚镜像为 `foldergram:backup-20260901-before-immersive-seek-wiring`。
- 2026-09-01 本次增量部署上线内容：沉浸式底部时间轴的圆点与轨道居中对齐，竖屏按 X 轴、旋转横屏按视觉 Y 轴绝对 seek；纯刷短片详情在 PWA 中固定居中；底部 Dock 往返纯刷时按当前短片恢复；首页三点“删除帖子”直接移入回收站，永久删除只在回收站操作。Service Worker `foldergram-v13`，运行镜像 `foldergram:ui-polish-20260901`，回滚 `foldergram:backup-20260901-before-ui-polish`。
- 2026-09-04 本次增量部署上线内容：首页/瞬间卡片流改为窗口化渲染（`FeedList.vue` + `useFeedWindow.ts`），只挂视口附近的卡片，滑走的卡片卸载、空间由列容器 padding 顶住；UI、卡片结构与手势全部未改。沉浸式 claim 的卡片会被 pin 住并冻结窗口范围，共享 `<media-player>` 不会被回收。线上实测（滚 10 页）：卡片 342→7、`media-player` 318→8、`<video>` 332→8、DOM 节点 19150→815、`<img>` 1001→42、远离视口仍挂源的 `<video>` 47→0、主线程 148→217 ticks/s；滚动位置、上拉加载、dock 往返恢复均不变，高度估算误差 1.1%。运行镜像 `foldergram:feed-window-20260904`，Service Worker `foldergram-v14`。回滚镜像 `foldergram:direct-worker-20260901`。
- 2026-09-04 本次增量部署上线内容（窗口化后修复）：修复离开首页时窗口被重置的问题。KeepAlive 把首页摘下 DOM 的瞬间 ResizeObserver 会报一次 0x0，旧逻辑把它当成「没有布局」并回退到全量渲染，导致隐藏中的首页在后台把每张卡重新挂一遍（组件测试实测 40 张全部挂回），列容器高度同时塌掉，从纯刷切回首页滚动位置掉回顶部（线上实测 240686→0、342272→0）。现在只有「从未解析过窗口」才允许全量兜底；已解析过的窗口在容器量不到宽度时原样保留，激活时也不再用尚未恢复的滚动位置重算。同时补齐 `ReelsView` 的 ReelDeck stub（`getScrollElement`）与 `ReelPlayerCard` 假播放器的 `play`/`pause` 事件，客户端测试从 323 通过 / 8 失败变为 331 全绿。运行镜像 `foldergram:feed-window-20260904b`，Service Worker `foldergram-v15`。回滚镜像 `foldergram:feed-window-20260904`。
- 本次增量部署上线内容：视频自动播放统一改为 HLS；新增 480p 外网起播档（约 0.9 Mbps），720p/1080p 同步限制实际视频与音频码率；恢复播放片段预热，并停用历史预览 MP4 作为托管视频源，避免损坏预览文件导致 0 秒卡死和外网高码率起播缓慢。手机端仍使用浏览器/系统硬件解码 H.264/AAC，NAS 仅负责 CPU 解码后转码，避免 VAAPI 解码绿屏兼容问题。专项测试客户端 12/12、服务端 9/9、类型检查和生产构建均通过。

## 视频盘 HLS 缓存

`docker-compose.nas-direct.yml` 将可再生的 HLS 视频分片写到图库源盘：

- `${GALLERY_ROOT_HOST_PATH}/.foldergram-cache/hls-cache`

图库源文件仍挂载为 `/app/data/gallery`；ConfigReviews 的 `FOLDERGRAM_DATA_HOST_PATH` 继续保存 SQLite 数据库、设置、缩略图、预览和扫描报告。`.foldergram-cache` 是隐藏目录，因此扫描器与图库监听器会忽略它。

首次切换前，先在 NAS 执行：

```bash
cd <当前源码目录>
docker compose -f docker-compose.nas-direct.yml stop foldergram-web foldergram-worker
mkdir -p "${GALLERY_ROOT_HOST_PATH}/.foldergram-cache/hls-cache"
rsync -a "${FOLDERGRAM_DATA_HOST_PATH}/hls-cache/" "${GALLERY_ROOT_HOST_PATH}/.foldergram-cache/hls-cache/"
```

保留 ConfigReviews 上的原 `hls-cache` 目录，直到新容器已验证视频播放正常。回滚时移除 HLS 独立挂载并重新启动应用容器即可。

HLS 缓存按 `hls-cache/<视频ID>/<清晰度>/` 分组。worker 在启动时及每 6 小时清理：先删除 7 天未访问的组；若仍超过 100 GiB，则按最久未使用顺序删除。正在转码或请求中的组不会被当前清理删除。可通过 `HLS_CACHE_DIR`、`HLS_CACHE_MAX_AGE_DAYS`、`HLS_CACHE_MAX_BYTES` 覆盖默认值。

## 部署安全规则

- `compose up -d` 只重建 `foldergram-web` / `foldergram-worker` 时，网关容器 `foldergram`（nginx）不会重建，会继续
  指向旧容器 IP，`http://192.168.5.11:43921/` 直接 502。每次重建应用容器后必须 `docker restart foldergram`，
  再用 `/api/health` 确认。


1. 部署前先确认当前源码目录和 Git 提交，不使用远程 `latest` 覆盖本地版本。
2. 部署前备份当前运行容器的镜像标签和镜像 ID；新版本健康检查失败时，不删除旧容器和旧镜像。
3. 同步源码时排除 `data/`、`.env`、`node_modules/`、`dist/`、`.tmp/`、`ai/` 和 `._*` 文件，不能覆盖真实媒体库、SQLite 数据库或运行配置。
4. 部署完成后必须确认容器名仍为 `foldergram`、镜像仍来自本地构建，并访问上面的健康检查地址。
5. SSH 使用已配置的别名：`ssh foldergram-nas`。如需密码登录，只作为备用，不要把密码写入脚本或仓库。

## 直推与扫描隔离

- 原文件播放不经过 FFmpeg：web 只校验 `/api/originals/:id`，随后用 `X-Accel-Redirect` 交给网关的内部路径发 Range 字节流。
- `foldergram-worker` 独占扫描、`ffprobe` 和缩略图/预览生成；其 Docker CPU 配额是 `0.75`，默认扫描并发固定为 `1`。
- web 和 worker 共用 SQLite 时启用 WAL 与 5 秒 busy timeout，读请求不再被扫描写事务长期卡住。
- worker 的 `4142` 端口没有发布到 NAS；只有 web 能通过 Docker 内网提交扫描或读取扫描进度。

## 当前功能基线

当前版本的功能基线包括：文件夹、搜索、收藏、归档等网格入口统一使用沉浸式媒体查看器；视频支持横竖方向切换、快进快退和长按倍速；首页分享按钮生成并复制单条内容链接；全局视频静音状态在各页面保持一致；首页小窗口切入沉浸式播放器时继承当前播放进度；纯刷模式支持双指缩放与放大后自由平移，右下角不提供专用播放暂停按钮；沉浸式播放器详情面板在手机上全屏居中，横屏时间轴按视觉坐标精确 seek，横竖切换按钮固定在右下角时间轴上方；方向切换控件使用横竖双矩形标准符号。

后续修改必须在本版本上增量完成。不要通过切换旧目录、拉取远程 `latest` 或重新初始化 compose 来“恢复版本”。

## 永久删除与扫描的并发契约

回收站的永久删除必须在服务端后台执行，用户关掉网页或 PWA 之后仍然继续，服务重启后自动续跑。相关约束：

- 任务实现在 `server/src/services/deletion-job-service.ts`，进度写入 `app_settings` 的 `deletion.permanent_batch_job`（键定义在 `server/src/constants/app-setting-keys.ts`）。
- 路由 `POST/GET/DELETE /api/posts/deletions/batch` 必须注册在 `router.get(['/posts/:id', ...])` 之前，否则 `deletions` 会被当成数字 id 解析并返回 400。
- 每删完一项就持久化一次；队列头部的 id 在删除成功后才出队，中途崩溃时会重试同一项而不是跳过。
- 图库存储不可用时任务标记为 stalled 而不是 finished，剩余 id 保留在队列里，下次启动或下次入队时继续。
- 前端 `client/src/stores/trash.ts` 只做轮询（1.5 秒一次），不再在浏览器里并发调用删除接口；`TrashView.vue` 挂载时调用 `syncDeletionJob()` 接回仍在跑的任务。
- 删除走 `maintenanceOperationLock` 的 `interactive` 优先级，扫描走 `background` 并在批次之间让出锁；两者不得再互相阻塞。
- 永久删除同时清理原文件、缩略图、预览图和该视频的 `hls-cache/<imageId>` 段缓存。删除服务会把内部 `unlink` 短时登记给 watcher，避免误触发增量扫描；批量任务每个 post 后让出一次事件循环，播放、搜索和首页请求可以继续响应。
- 删除接口要求 `canDeleteMedia`，匿名会话没有该能力。容器重建后旧会话失效，需要重新登录管理员才能删除。
- 挂载点不能是只读：compose 里 `/app/data/gallery` 必须是读写挂载，否则 quarantine rename 第一步就会失败。

## 播放器锁定

完整契约见 `docs/player-contract.md`。没有用户明确要求，禁止改小窗/沉浸式实例模型、直推源选择和手势。

- 小窗和沉浸式共用**一个** `<media-player>`（claim + Teleport），禁止第二套解码。
- `auto` 质量走直推原文件；HEVC 可硬解的 preview MP4/MOV 同样直推；失败才 HLS。
- 单击小窗进入沉浸式且不暂停；双击才暂停；左右拖是相对当前进度，不是手指绝对位置。
- 竖屏里横屏视频 `object-fit: contain` 居中；旋转用 CSS `rotate(90deg)`，手势跟画面坐标。

## 小窗口切入沉浸式播放器的进度衔接


首页小窗口点开进入沉浸式播放器时，播放位置通过 `immersive-video` store 的 `startTime` 传递，实现上有三个必须同时成立的条件：

- `useBundledHlsLibrary` 接受 `getStartPosition`，把交接位置写进 hls.js 的 `startPosition`，让第一个分片请求直接落在观众正在看的那一段，而不是先缓冲片头再 seek。
- `VideoMediaPlayer` 的 `applyStartTime` 在时钟已经接近目标位置时不再重复 seek，避免把 hls.js 刚缓冲好的分片冲掉。
- 播放进度判定以 `playbackBaselineSec`（交接位置）为基准，而不是固定的 `currentTime > 0.05`；否则交接到非零位置时会被误判为"已在播放"，重试循环提前退出，画面卡住不动。

另外 `VideoMediaPlayer` 保留一张自绘的首帧缩略图（`.video-media-player__first-frame`），直到交接 seek 落位后才移除，避免 vidstack 拆掉 `<media-poster>` 后出现黑屏。

## 首屏与资源传输契约

服务端自己做文本压缩，不依赖反向代理，也没有引入 npm 压缩包：

- `server/src/middleware/response-compression.ts` 里的 `compressTextResponses` 必须是 `app.use` 的第一个中间件，brotli（quality 5）优先、gzip 兜底。
- 只压白名单类型（`text/*`、JSON、JavaScript、XML、manifest、m3u8、SVG）。原图、视频、HLS 分片、缩略图、预览图属于已压缩二进制，永远不能再编码。
- 1024 字节以下不压；`206`、带 `Content-Range`、已带 `Content-Encoding` 的响应直接放过，range 请求必须保持字节精确。
- 压缩后会 `Vary: Accept-Encoding`，强 ETag 降级为 weak ETag。
- `express.static(clientDist)` 用 `index: false` 加 `setHeaders`：`/assets/` 下带 hash 的产物是 `public, max-age=31536000, immutable`，`index.html`、`sw.js` 和 SPA fallback 是 `no-cache`。

线上实测基线（2026-08-31）：`/assets/index-*.js` 原始 897566 字节，brotli 后 241872 字节；`index.html` 与 `/assets/` 的 `Cache-Control` 符合上面规则；对同一资源发 `Range: bytes=0-1023` 仍返回 `206` 且无 `Content-Encoding`。

## 视图缓存与静音裁决契约

- `client/src/router/index.ts`：底部 dock 的目的地（HomeView、ReelsView、ExploreView、LibraryView、LikesView、CollectionsView、PostView、FolderView）保持静态 import，保证切换零网络等待；其余 9 个视图（CollectionView、MomentView、PlaceView、PlacesView、SettingsView、SharedFolderView、SharedPostView、SharedTokenPostView、TrashView）走 `() => import(...)` 懒加载，构建产物里应能看到独立 chunk。
- `KEPT_ALIVE_VIEW_NAMES` 是 `App.vue` 里 `<KeepAlive :include>` 的唯一来源。被缓存的视图必须写 `defineOptions({ name: 'XxxView' })`，否则 minify 后名字匹配不上，缓存静默失效。
- 缓存视图不会卸载，因此后台可能继续解码播放。`client/src/composables/useViewActivation.ts` 用 `onActivated/onDeactivated` 加 provide/inject 下发激活标志：`HomeView`/`ReelsView` 调 `provideViewActivation()`，`FeedCard`/`ReelPlayerCard` 用 `useViewActive()` 参与暂停判定。新增会自动播放的卡片组件时必须接这个标志。
- 同理，全局监听要跟着激活状态绑定解绑：`ReelsView` 的 wheel/resize 与 `ExploreView` 的 Escape keydown 都在 `onActivated/onDeactivated` 里处理，否则缓存后的视图会在别的页面隐形响应手势。
- 静音只有一个裁决来源：`stores/app.ts` 的 `videoMuted`（用户意图）加 `audibleAutoplayBlocked`（浏览器拒绝有声自动播放），对外只暴露 getter `videoEffectivelyMuted`。组件不得再自己维护 `audioBlocked` 本地状态。浏览器的自动播放裁决是文档级而非元素级，所以 `FeedCard`、`ReelPlayerCard`、`PostViewer`、`VideoMediaPlayer`、`StoriesModal` 必须共用同一个标志。
- `reportAudibleAutoplayBlocked()` 里不要加"已静音就提前返回"的短路，否则用户点开声音那一下会被自动播放失败回调吃掉（`VideoMediaPlayer.test.ts` 有回归用例守着）。

## Service Worker 契约

- `client/public/sw.js` 当前版本 `foldergram-v14`。改缓存策略必须同步升 `CACHE_VERSION`，否则老客户端拿不到新逻辑。
- 安装时从 `index.html` 正则提取 `/assets/` 路径逐个 `cache.add` 预缓存 app shell，让二次打开不再等 JS/CSS 下载。
- 导航请求走 stale-while-revalidate，cacheKey 固定为 `'/'`；`/assets/` 走 cache-first（内容带 hash，安全）。媒体与 API 请求策略不变。
