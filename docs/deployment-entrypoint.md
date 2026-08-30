# 当前部署入口与版本锁定

本文档是 foldergram 当前运行版本的入口记录。部署、排查或刷新网页时，必须以这里记录的入口和镜像为准，不要自行切换到 GitHub 的原始镜像或旧项目目录。

## 唯一用户入口

- 网页入口：`http://192.168.5.11:43921/`
- 健康检查：`http://192.168.5.11:43921/api/health`
- `4141` 是容器内部端口，不是用户访问入口。
- NAS 管理界面里的旧容器、旧端口或其他项目目录都不属于当前用户入口。

## 当前版本

- 服务名：`foldergram`
- 当前镜像标签：`foldergram:gpu-hls`
- 部署方式：NAS 上从当前源码目录本地构建 Docker 镜像，再启动容器。
- 禁止使用：`ghcr.io/foldergram/foldergram:latest`。它可能把系统带回未包含本地优化的原始版本。
- NAS Docker：`27.2.0`
- NAS Compose：`v2.40.1`

## 部署安全规则

1. 部署前先确认当前源码目录和 Git 提交，不使用远程 `latest` 覆盖本地版本。
2. 部署前备份当前运行容器的镜像标签和镜像 ID；新版本健康检查失败时，不删除旧容器和旧镜像。
3. 同步源码时排除 `data/`、`.env`、`node_modules/`、`dist/`、`.tmp/`、`ai/` 和 `._*` 文件，不能覆盖真实媒体库、SQLite 数据库或运行配置。
4. 部署完成后必须确认容器名仍为 `foldergram`、镜像仍来自本地构建，并访问上面的健康检查地址。
5. SSH 使用已配置的别名：`ssh foldergram-nas`。如需密码登录，只作为备用，不要把密码写入脚本或仓库。

## 当前功能基线

当前版本的功能基线包括：文件夹、搜索、收藏、归档等网格入口统一使用沉浸式媒体查看器；视频支持横竖方向切换、快进快退和长按倍速；首页分享按钮生成并复制单条内容链接；全局视频静音状态在各页面保持一致；首页小窗口切入沉浸式播放器时继承当前播放进度。

后续修改必须在本版本上增量完成。不要通过切换旧目录、拉取远程 `latest` 或重新初始化 compose 来“恢复版本”。

## 沉浸式播放器手势契约

沉浸式播放器（`client/src/components/ImmersiveVideoLayer.vue`）是首页、搜索、文件夹、收藏、归档共用的唯一全屏播放器，手势规则如下：

- 单指左右滑动：拖动进度，左退右进。
- 单指上下滑动：退出播放器。
- 双指捏合：放大缩小；放大后单指可在 X/Y 方向自由平移，松手回到一档归位。
- 长按屏幕：2 倍速播放。
- 横竖方向切换后，以上手势按视觉方向跟随；纯刷模式（`ReelPlayerCard.vue`）横屏同样跟随。
- 做过左右滑动或长按之后，上下滑退出与双指捏合必须继续生效，不允许失效。

实现约束：`useHoldToSpeed` 的 `lostpointercapture` 回退只在丢失目标等于自身捕获元素时才结束手势；`usePinchZoom` 用 `suspendSinglePointer()` 移交手指而不清空 pointer 记账，并在 primary `pointerdown` 时清理陈旧 pointer。改动这三个文件后必须跑 `client/src/composables/immersive-gesture-coordination.test.ts`。

## 小窗口切入沉浸式播放器的进度衔接

首页小窗口点开进入沉浸式播放器时，播放位置通过 `immersive-video` store 的 `startTime` 传递，实现上有三个必须同时成立的条件：

- `useBundledHlsLibrary` 接受 `getStartPosition`，把交接位置写进 hls.js 的 `startPosition`，让第一个分片请求直接落在观众正在看的那一段，而不是先缓冲片头再 seek。
- `VideoMediaPlayer` 的 `applyStartTime` 在时钟已经接近目标位置时不再重复 seek，避免把 hls.js 刚缓冲好的分片冲掉。
- 播放进度判定以 `playbackBaselineSec`（交接位置）为基准，而不是固定的 `currentTime > 0.05`；否则交接到非零位置时会被误判为"已在播放"，重试循环提前退出，画面卡住不动。

另外 `VideoMediaPlayer` 保留一张自绘的首帧缩略图（`.video-media-player__first-frame`），直到交接 seek 落位后才移除，避免 vidstack 拆掉 `<media-poster>` 后出现黑屏。
