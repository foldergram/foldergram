# AGENTS.md — foldergram

## 项目速览

pnpm monorepo：`server/`（Express 5 + TypeScript ESM + SQLite）、`client/`（Vue 3 + Pinia + Vite）、`docs/`（VitePress 用户文档）。
本地照片视频画廊，扫描 `GALLERY_ROOT` 目录生成 Instagram 风格 feed。

**详细索引在 `ai/AI_CONTEXT.md`，开工前必读，不要跳过。**

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | server + client + docs 一起起 |
| `pnpm build` | server + client 构建（含 `tsc` / `vue-tsc` 类型检查） |
| `pnpm test:server` | 服务端 Vitest |
| `pnpm test:client` | 客户端 Vitest |
| `pnpm migrate` | 执行待跑数据库迁移 |
| `scripts/ai-refresh.sh` | 刷新 AI 索引（每任务一次） |

## 先定位再改代码原则

不得听到指令后凭感觉直接改代码。修改前必须完成「事实核对 → 问题定位 → 方案确定 → 最小必要实现」闭环。

- 先查真实代码、日志、构建错误、运行现象；不要靠记忆或泛泛经验判断
- 必须指出问题点在哪：具体文件、函数、状态流、调用链、失败条件
- 必须先形成方案：改哪些文件、为什么这样改、影响哪些链路、如何验证
- 方案要有系统视角：本项目是三层结构（`routes/api.ts` → `services/*` → `db/repositories.ts`），加字段还要同步 `server/db/migrations/`、`server/src/types/models.ts`、`client/src/types/api.ts`
- 没找到根因就继续定位，或明确说还缺什么证据；不要为了「快点有变化」做低水平补丁
- 每次修改后必须用可执行验证或明确证据证明改对了，不能只说「看起来应该可以」

## 防搜索循环原则

查资料的目的是收敛到问题点和方案，不是无限搜索。

- 每个问题最多两轮宽泛搜索；若两轮反复命中同一批文件/符号，立即停止搜索并冻结结论
- `scripts/ai-refresh.sh` 每个任务开头运行一次即可；只有新增/移动/生成文件后才再运行
- 不要用同义词反复搜同一问题；优先打开已定位文件细读
- `server/src/routes/api.ts`（1400 行）和 `server/src/db/repositories.ts`（3800 行）**禁止整读**，用 `scripts/ai-symbol.sh` 拿到行号后读区间
- 输出被截断时优先收窄查询或打开具体文件，不要默认扩大 token 预算
- 正常排查不要跑 Repomix。仅在用户明确要求全量交接时运行 `AI_REFRESH_REPOMIX=1 scripts/ai-refresh.sh`，生成物在 `.tmp/`，且只允许抽样
- 不要读 `ai/AI_REPOMIX_CONTEXT.md`；它是 stub
- 如果开始循环，运行 `scripts/ai-freeze-findings.sh`，按模板列出 Frozen Facts，再选下一步

## 开始新任务前

1. 运行 `scripts/ai-refresh.sh`（用户不需要主动提醒）
2. 阅读本文件 `AGENTS.md`
3. 阅读 `ai/AI_CONTEXT.md`，用短标签、搜索词字典、忽略规则缩小范围
4. 按需查文件/符号：`ai/AI_FILE_INDEX.md`、`scripts/ai-symbol.sh`、`scripts/ai-search.sh`
5. 阅读目标文件，理解现有结构和风格
6. 向用户说明计划：改什么 → 为什么 → 影响哪些文件

## 完成后

- 简要说明：改了哪些文件、改了什么
- 说明如何验证：`pnpm test:server` / `pnpm test:client` / `pnpm build`
- 不要复述整个执行过程

## 本项目特有约定

- 服务端是 ESM，import 本地模块必须带 `.js` 后缀（源码写 `.ts` 但 import 写 `.js`）
- 所有环境变量必须先在 `server/src/config/env.ts` 的 zod schema 里声明，并同步 `.env.example`
- 数据库结构改动走 `server/db/migrations/` 新建迁移文件，不要改已有迁移
- 运行时可变设置统一用 `server/src/constants/app-setting-keys.ts` 里的键，不要硬编码字符串
- 前端文案改动必须同步 `client/src/locales/` 下 `en.json`、`zh.json`、`es.json` 三份
- 不要碰 `data/`（真实媒体库和 SQLite 数据库）和 `.env`
- 本仓库在外接 exFAT 盘上，大量 `._*` 资源分叉文件是噪音，不是源码
