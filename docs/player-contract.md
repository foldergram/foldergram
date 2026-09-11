# 播放器契约（锁定）

> 用户锁定。改播放器、手势、直推或小窗/沉浸式衔接前，必须先读本文。
> 没有用户明确要求，禁止改这些规则，也禁止用“优化手感 / 绝对跟手 / 两套播放器更简单”把它们改回去。

## 唯一入口

- 用户只走 `http://192.168.5.11:43921/`
- 容器 `foldergram`，compose：`/zspace/applications/services/zdocker/config/compose_config/foldergram.yaml`
- 禁止切到 `ghcr.io/foldergram/foldergram:latest` 或任何 GitHub 原始镜像

## 一套播放器，一个解码实例

首页小窗和沉浸式全屏是**同一个** `<media-player>` DOM，通过 `shared-video-surface` claim + Teleport 搬进 `ImmersiveVideoLayer` 的 `#immersive-video-slot`。

禁止：

- 小窗还在播时，沉浸式再挂一套 `VideoMediaPlayer`（`hasSharedPlayer` 为 true 时，`v-if="!hasSharedPlayer"` 必须挡住第二套）
- `hasSharedPlayer` 再加 `isAttached` 才为 true（claim 成功就要挡住 fallback，否则 Teleport 完成前会双解码）
- 打开沉浸式时 `syncHomeVideoPlayback()` 把这张共享卡 pause 掉
- 为“架构更干净”拆掉 Teleport，改成两个 player 靠 `startTime` 交接

`hasSharedPlayer` 的判定只看：

```ts
sharedVideoSurfaceStore.ownerId === `feed:${target.id}`
```

搜索 / 文件夹 / 收藏 / 归档没有这张共享卡时，才允许 `ImmersiveVideoLayer` 自己挂 `VideoMediaPlayer`，仍然走直推，仍然遵守下面的手势。

## 直推流

`client/src/utils/video-playback.ts` 的 `resolveVideoSource(media, 'auto')`：

- 扫描标记 `original`：播 `/api/originals/:id`（Range 206），手机解码
- 扫描标记 `preview` 但文件是 mp4/m4v/mov，且 `canDirectPlayHevc()`：同样直推原文件
- 直推失败才回 HLS；用户手选 480p/720p 才走固定 HLS

小窗和沉浸式都必须走这条源，不要给小窗单独塞 preview MP4 / 现场转码。

## 手势（写死）

小窗和沉浸式同一套语义：

| 手势 | 行为 |
|---|---|
| 单击画面 | 小窗：打开沉浸式，**不暂停**。沉浸式：单击不暂停。 |
| 双击画面 | 暂停 / 继续。不要做成单击暂停。 |
| 底部播放键 | 暂停 / 继续。这是唯一的单击暂停入口。 |
| 单指左右滑 | **相对当前进度** seek。按下时记下时间，位移 × 秒/像素。禁止把手指 X 映射成时间轴绝对位置。 |
| 单指上下滑 | 退出沉浸式。 |
| 长按 | 2 倍速，松手回 1x。 |
| 双指捏合 | 缩放；放大后可平移。 |

横竖屏：

- PWA 保持竖屏。横屏视频在竖屏里 `object-fit: contain` 居中信箱，禁止 `cover` 放大裁切。
- 旋转按钮用 CSS `rotate(90deg)` 转整个 rotator，不依赖 iOS orientation lock。
- 旋转后，左右滑/上下滑按**画面坐标**（`resolveGesturePoint(..., 'rotated')`），不要改回屏幕绝对 X。
- 底栏进度条可以按条的几何位置 seek（那是滑块，不是全屏手势）。全屏表面拖动必须相对。

相关实现：

- `client/src/composables/useHoldToSpeed.ts`：相对 scrub 的唯一实现。不要再加 `scrubPositionFromEvent` 绝对映射。
- `client/src/components/FeedCard.vue`：共享卡、直推源、单击打开、双击暂停。
- `client/src/components/ImmersiveVideoLayer.vue`：Teleport 槽、旋转、上下滑退出。
- `client/src/components/VideoMediaPlayer.vue`：无共享卡时的直推播放器；`surfaceMode=immersive` 时单击不暂停。
- `client/src/stores/shared-video-surface.ts`：claim / attach / release。
- `client/src/styles/base.css`：`#immersive-video-slot` 必须 `object-fit: contain`。

改这些文件后至少跑：

- `client/src/composables/useHoldToSpeed.test.ts`
- `client/src/composables/immersive-gesture-coordination.test.ts`
- `client/src/components/FeedCard.test.ts`
- `client/src/components/VideoMediaPlayer.test.ts`
- `client/src/utils/video-playback.test.ts`

## 明确禁止的回归

历史上反复出现、禁止再做：

1. 绝对跟手 seek：手指在屏幕中间，进度跳到视频一半。
2. 单击进沉浸式就暂停。
3. 打开沉浸式时 pause 共享卡，造成双解码或冻帧。
4. 横屏视频在竖屏沉浸式里 `object-fit: cover`。
5. 把 Teleport 共享实例拆回两套 player。

## 首页卡片流窗口化（锁定）

`client/src/components/FeedList.vue` 只渲染视口附近的卡片，滑走的卡片会被卸载，空出来的高度由列容器的
`padding-top` / `padding-bottom` 顶住（`client/src/composables/useFeedWindow.ts`）。UI、卡片结构、样式、间距
都没有改，改的只是「同时挂多少张卡」。

不这样做的后果（2026-09-04 线上实测，滚 10 页）：342 张卡、318 个 `media-player`、332 个 `<video>`、19150 个
DOM 节点，其中 47 个已经远离视口的 `<video>` 还挂着源、缓冲已被系统清空 —— 这就是「刷久了越来越卡」和
「滑回去卡在 0:00」。窗口化后同样操作是 7 张卡、8 个 player、815 个节点、0 个滑走仍挂源的 video。

禁止：

- 把 `FeedList.vue` 改回 `v-for="item in items"` 全量渲染。
- 给 `.feed-list` 绑 `:style`，或改掉 `overflow-anchor: none`。窗口用 `el.style.padding*` 直接写，绑 style 会被
  Vue 覆盖，浏览器的 scroll anchoring 也会和 padding 数学打架。
- 去掉 `pinnedIndex`。沉浸式 claim 的那张卡必须留在 DOM 里，否则共享 `<media-player>` 被销毁，全屏直接黑屏。
- 用「离屏隐藏容器」来实现 pin。换父节点会让 Vue 重建 `<media-player>`，等于毁掉共享解码器。
- 让 `activeVideoId` 回到遍历全量 `items`。只有窗口内的卡片能拿播放权，否则播放权会落到已卸载的卡上。
- 让「容器量不到宽度」时重置成全量渲染。KeepAlive 把首页从 DOM 上摘下来的瞬间，ResizeObserver 会报一次
  0x0；如果那时把 `endIndex` 归零，隐藏着的首页会在后台把每张卡重新挂一遍（实测 40 张全挂回来），列容器高度
  也会塌掉，从纯刷切回首页的滚动位置就会掉回顶部。只有「从来没解析过窗口」（jsdom、首帧）才允许全量兜底。
