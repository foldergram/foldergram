# 当前部署入口与版本锁定

本文档是 foldergram 当前运行版本的入口记录。部署、排查或刷新网页时，必须以这里记录的入口和镜像为准，不要自行切换到 GitHub 的原始镜像或旧项目目录。

## 唯一用户入口

- 网页入口：`http://192.168.5.11:43921/`
- 健康检查：`http://192.168.5.11:43921/api/health`
- `4141` 是容器内部端口，不是用户访问入口。
- NAS 管理界面里的旧容器、旧端口或其他项目目录都不属于当前用户入口。

## 当前版本

- 服务名：`foldergram`
- 当前镜像标签：`foldergram:immersive-seek-20260901`
- 部署方式：NAS 上从当前源码目录本地构建 Docker 镜像，再启动容器。
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
- 2026-09-01 本次增量部署上线内容：共享播放器进入沉浸式后使用 viewer 底栏布局，进度条位于暂停/时间行上方并避开底部遮挡；横屏受控时间轴按旋转后的视觉轴计算，且补齐共享播放器的 seek/seek-preview 接线，避免横屏进度条显示但无法拖动。运行镜像为 `foldergram:immersive-seek-20260901`，回滚镜像为 `foldergram:backup-20260901-before-immersive-seek-wiring`。
- 本次增量部署上线内容：视频自动播放统一改为 HLS；新增 480p 外网起播档（约 0.9 Mbps），720p/1080p 同步限制实际视频与音频码率；恢复播放片段预热，并停用历史预览 MP4 作为托管视频源，避免损坏预览文件导致 0 秒卡死和外网高码率起播缓慢。手机端仍使用浏览器/系统硬件解码 H.264/AAC，NAS 仅负责 CPU 解码后转码，避免 VAAPI 解码绿屏兼容问题。专项测试客户端 12/12、服务端 9/9、类型检查和生产构建均通过。

## 部署安全规则

1. 部署前先确认当前源码目录和 Git 提交，不使用远程 `latest` 覆盖本地版本。
2. 部署前备份当前运行容器的镜像标签和镜像 ID；新版本健康检查失败时，不删除旧容器和旧镜像。
3. 同步源码时排除 `data/`、`.env`、`node_modules/`、`dist/`、`.tmp/`、`ai/` 和 `._*` 文件，不能覆盖真实媒体库、SQLite 数据库或运行配置。
4. 部署完成后必须确认容器名仍为 `foldergram`、镜像仍来自本地构建，并访问上面的健康检查地址。
5. SSH 使用已配置的别名：`ssh foldergram-nas`。如需密码登录，只作为备用，不要把密码写入脚本或仓库。

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

## 沉浸式播放器手势契约

沉浸式播放器（`client/src/components/ImmersiveVideoLayer.vue`）是首页、搜索、文件夹、收藏、归档共用的唯一全屏播放器，手势规则如下：

- 单指左右滑动：拖动进度，左退右进。
- 单指上下滑动：退出播放器。
- 双指捏合：放大缩小；放大后单指可在 X/Y 方向自由平移，松手回到一档归位。
- 长按屏幕：2 倍速播放。
- 横竖方向切换后，以上手势按视觉方向跟随；纯刷模式（`ReelPlayerCard.vue`）横屏同样跟随。
- 做过左右滑动或长按之后，上下滑退出与双指捏合必须继续生效，不允许失效。
- 纯刷模式（`ReelPlayerCard.vue`）使用同一个 `usePinchZoom` 控制器：静止时单指归滑动/快进快退，双指提升为缩放；放大后单指在 X/Y 自由平移，低于归位阈值时松手自动回到 1 倍。
- 沉浸式播放器的 viewer 进度条在视觉上位于暂停/时间行上方，避免手机底部安全区遮挡操作；实现上保留 `VideoProgressFooter` 的 DOM 顺序，只用 viewer variant 做 `column-reverse`。
- viewer 底栏必须带 `safe-area-inset-bottom` 的底部 padding；暂停/时间和静音按钮不能贴到手机手势条。
- `VideoProgressFooter` 在沉浸式播放器里使用受控时间轴：竖屏按 `clientX`，CSS 旋转横屏按 `clientY` 和旋转后的元素边界换算，不能继续把未旋转的 X 坐标交给 Vidstack。

实现约束：`useHoldToSpeed` 的 `lostpointercapture` 回退只在丢失目标等于自身捕获元素时才结束手势；`usePinchZoom` 用 `suspendSinglePointer()` 移交手指而不清空 pointer 记账，并在 primary `pointerdown` 时清理陈旧 pointer。改动这三个文件后必须跑 `client/src/composables/immersive-gesture-coordination.test.ts`。

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

- `client/public/sw.js` 当前版本 `foldergram-v4`。改缓存策略必须同步升 `CACHE_VERSION`，否则老客户端拿不到新逻辑。
- 安装时从 `index.html` 正则提取 `/assets/` 路径逐个 `cache.add` 预缓存 app shell，让二次打开不再等 JS/CSS 下载。
- 导航请求走 stale-while-revalidate，cacheKey 固定为 `'/'`；`/assets/` 走 cache-first（内容带 hash，安全）。媒体与 API 请求策略不变。
