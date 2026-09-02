# AI Context Map

本文件是给 AI 助手的低 token 索引页，是**唯一允许默认全读**的文件。
新增/移动文件后运行 `scripts/ai-map.sh` 刷新 `ai/AI_FILE_INDEX.md`。

## TL;DR

- 项目类型: `pnpm monorepo / local-first 照片视频画廊`（Instagram 风格 UI，扫描本地目录）
- 技术栈: 服务端 Express 5 + TypeScript ESM + SQLite(dbmate 迁移) + sharp + exifr + zod；客户端 Vue 3 + Pinia + vue-router + vue-i18n + UnoCSS + Vite；文档 VitePress
- 工作区: `server/`、`client/`、`docs/`（见 `pnpm-workspace.yaml`）
- 服务端入口: `server/src/index.ts` → `server/src/app.ts`（中间件挂载顺序在此）
- API 路由: `server/src/routes/api.ts`（单文件 1400+ 行，所有 `/api/*` 端点）
- 数据访问: `server/src/db/repositories.ts`（3800+ 行，所有 SQL）；schema 在 `server/src/db/schema.ts`
- 服务端模型: `server/src/types/models.ts`
- 环境配置: `server/src/config/env.ts`（zod 校验，所有 env 变量在此声明）
- 客户端入口: `client/src/main.ts`；路由 `client/src/router/index.ts`
- 客户端网络层: `client/src/api/http.ts`（fetch 封装 + CSRF header）、`client/src/api/gallery.ts`
- 客户端类型: `client/src/types/api.ts`（与服务端响应对齐）
- 自动文件索引: `ai/AI_FILE_INDEX.md`
- 本地符号索引: `.ai/tags`（用 `scripts/ai-symbol.sh` 查，**不要**整读 `.ai/SYMBOL_INDEX.md`）
- 低 token 工作流: `ai/TOKEN_EFFICIENT_WORKFLOW.md`

## Short Tags

用户可以直接说「改 `feedapi`」而不用打全路径。

| Tag | 含义 | 首查文件 |
|---|---|---|
| `entry` | 服务端启动 | `server/src/index.ts`, `server/src/app.ts` |
| `api` | 所有 HTTP 端点 | `server/src/routes/api.ts` |
| `repo` | SQL / 数据访问 | `server/src/db/repositories.ts` |
| `schema` | 表结构与迁移 | `server/src/db/schema.ts`, `server/db/migrations/` |
| `model` | 服务端类型 | `server/src/types/models.ts` |
| `env` | 环境变量与路径 | `server/src/config/env.ts` |
| `setting` | 运行时可变设置键 | `server/src/constants/app-setting-keys.ts` |
| `scan` | 扫描/监听库目录 | `server/src/services/scanner-service.ts`, `watcher-service.ts` |
| `deriv` | 缩略图/预览生成 | `server/src/services/derivative-service.ts`, `routes/lazy-derivatives.ts` |
| `gallery` | 聚合业务逻辑 | `server/src/services/gallery-service.ts` |
| `auth` | 登录/会话/权限 | `server/src/services/auth-service.ts`, `middleware/auth-protection.ts` |
| `share` | 文件夹分享 | `server/src/services/folder-share-service.ts` |
| `trash` | 回收站/永久删除 | `server/src/services/permanent-deletion-service.ts` |
| `route` | 前端路由 | `client/src/router/index.ts` |
| `store` | Pinia 全局状态 | `client/src/stores/` |
| `http` | 前端请求封装 | `client/src/api/http.ts` |
| `view` | 页面级组件 | `client/src/views/` |
| `comp` | 复用组件 | `client/src/components/` |
| `i18n` | 三语文案 | `client/src/locales/{en,zh,es}.json` |

## 架构速览

请求链路（`server/src/app.ts` 顺序，改中间件必须看这里）：

```
/api/*  → no-store headers → blockPublicDemoMutations → requireTrustedMutationRequest(CSRF)
        → requireApiAuthentication → apiRouter
/thumbnails, /previews → requireMediaAuthentication → (lazy router | express.static)
生产模式 → client/dist 静态资源 + SPA fallback
```

服务端分层：`routes/api.ts`（校验 + 编排）→ `services/*`（业务）→ `db/repositories.ts`（SQL）。
新增端点通常要动这三层，加字段还要加 `server/db/migrations/` 和 `client/src/types/api.ts`。

关键服务对象都是单例导出（`galleryService`、`scannerService`、`authService`、`storageService`、`permanentDeletionService` 等），直接 import 使用。

前端：`views/` 页面 → `stores/` 取数与缓存 → `api/gallery.ts` → `api/http.ts`。
14 个 store：`app`（全局设置/扫描进度）、`auth`、`feed`、`reels`、`explore`、`folders`、`folder-stories`、`collections`、`likes`、`moments`、`places`、`share`、`trash`、`viewer`。

## Search Dictionary

**这张表 ROI 最高**：左列是你可能说的原话，右列是真正该搜的符号。用它替代「换词搜三轮」。

| 需求/症状 | 推荐搜索词 / 首查位置 |
|---|---|
| 加端点、改接口返回 | `router.get(` / `router.post(` in `server/src/routes/api.ts` |
| 改数据库字段 | `server/db/migrations/` + `schema.ts` + `repositories.ts` |
| 首页 feed 排序/推荐 | `feed-utils.ts`, `feed-rail-utils.ts`, `home-recommendations.ts` |
| Reels 播放列表 | `server/src/utils/reels-utils.ts`, `client/src/utils/reels.ts`, `useReelsStore` |
| 轮播/多图帖 | `carousels-utils.ts`, `TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY`, `CarouselMediaStage.vue` |
| Stories | `stories-utils.ts`, `folder-stories.ts`, `StoriesModal.vue` |
| 缩略图/预览没生成 | `generateDerivatives`, `derivative-paths.ts`, `DERIVATIVE_MODE`, `lazy-derivatives.ts` |
| 视频不播 / 编码 | `writeVideoPreview`, `video-derivative-strategy`, `VideoMediaPlayer.vue` |
| 扫描慢/漏文件/报错 | `scannerService`, `SCAN_MEDIA_ERROR_MODE`, `scan-utils.ts`, `excluded-folder-rules.ts` |
| 库目录换位置 | `library-relocation-service.ts`, `LIBRARY_REBUILD_REQUIRED_MESSAGE`, `GALLERY_ROOT` |
| 登录失败/会话过期 | `authService`, `AUTH_SESSION_COOKIE_NAME`, `requireApiAuthentication` |
| 403 / CSRF 报错 | `requireTrustedMutationRequest`, `CSRF_INTENT_HEADER`, `CSRF_TRUSTED_ORIGINS` |
| 权限不够 | `requireCapability(`, `canManageLibrary`, `canDeleteMedia`, `canAccessSettings` |
| 分享链接/密码 | `folderShareService`, `FOLDER_SHARE_SESSION_COOKIE_NAME`, `/share/folders/:slug` |
| 删除/回收站 | `permanentDeletionService`, `/trash/images`, `useTrashStore` |
| EXIF / 拍摄地点 | `exif-utils.ts`, `placeResolutionService`, `geodataService` |
| 文件夹标题显示 | `folder-title-format.ts`, `NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY` |
| 图片瀑布流布局 | `client/src/utils/media-layout.ts`（`resolveFeedAspectRatio`），用在 `FeedCard.vue` |
| 文案/多语言 | `client/src/locales/`, `APP_DEFAULT_LOCALE_SETTING_KEY` |
| 限流 | `middleware/rate-limit.ts`, `authRateLimiter`, `adminMutationRateLimiter` |
| 环境变量不生效 | `server/src/config/env.ts`（zod schema 是唯一来源）+ `.env.example` |
| 演示模式屏蔽写操作 | `public-demo-mode.ts`, `PUBLIC_DEMO_MODE` |

## Ignore Rules

- 忽略 `data/`（真实媒体库、SQLite 数据库、生成的缩略图预览），除非任务就是排查数据文件本身
- 忽略构建产物：`**/dist/`、`node_modules/`、`coverage/`、`docs/.vitepress/{dist,cache}/`
- 忽略 `pnpm-lock.yaml`，除非任务是依赖版本问题
- 忽略所有 `._*` 文件（外接 exFAT 盘的 macOS 资源分叉噪音，本仓库大量存在）
- 忽略 `.env`（含密钥），只读 `.env.example`
- 忽略 `ai/AI_REPOMIX_CONTEXT.md` 和 `.tmp/`，除非用户明确要求全量交接
- 仓库已提供 `.codexignore` / `.cursorignore` / `.rgignore`，默认搜索不要关掉 ignore

## Low-Token Workflow

1. 先读本文件 `ai/AI_CONTEXT.md`。
2. 文件可能新增或移动时，运行 `scripts/ai-refresh.sh`（每任务一次）。
3. 用 `scripts/ai-symbol.sh "符号"` 或 `AI_SEARCH_LIMIT=40 scripts/ai-search.sh "关键词"` 定位。
4. 只打开命中的 1-3 个源文件。注意 `api.ts` / `repositories.ts` 都是数千行，**用行号区间读，不要整读**。
5. 改完按风险验证：
   - 服务端：`pnpm test:server`（Vitest，`server/test/`，约 70 个用例文件；部分用例跨测 `client/src/utils/`）
   - 客户端：`pnpm test:client`
   - 类型/构建：`pnpm build`（`vue-tsc` + `tsc`）
   - 迁移：`pnpm migrate`

## Prompt Pattern

```text
先读 ai/AI_CONTEXT.md。
任务聚焦: api + repo。
按需用 scripts/ai-symbol.sh / scripts/ai-search.sh，不要加载 Repomix dump。
api.ts 和 repositories.ts 只读相关行号区间，先定位再做最小改动。
改完跑 pnpm test:server。
```
