# Token Efficient Workflow

本文件定义 foldergram 的低 token 工作流：优先读小而准的索引，而不是反复全仓搜索。
本仓库 238 个 TS/Vue 源文件，`api.ts` 和 `repositories.ts` 单文件就有 1400 / 3800 行，整读代价极高。

## 默认流程

1. 运行 `scripts/ai-refresh.sh`
2. 阅读 `AGENTS.md`
3. 阅读 `ai/AI_CONTEXT.md`
4. 按需阅读 `ai/AI_FILE_INDEX.md`
5. 用 `scripts/ai-symbol.sh "符号"` 或 `AI_SEARCH_LIMIT=40 scripts/ai-search.sh "关键词"` 做窄查询
6. 只打开最相关的 1-3 个文件，大文件按行号区间读

## 命令示例

```bash
scripts/ai-refresh.sh                                  # 刷索引
scripts/ai-symbol.sh galleryService                    # 精确符号
scripts/ai-symbol.sh "use\w+Store"                     # 正则找所有 store
AI_SEARCH_LIMIT=40 scripts/ai-search.sh "requireCapability"
scripts/ai-search.sh "TREAT_CAROUSELS_AS_FOLDERS" server/src
scripts/ai-freeze-findings.sh                          # 开始绕圈时冻结结论
```

## 什么时候刷新索引

需要刷新：新增源码文件、移动或重命名文件、新增 store/view/service/迁移、更新 `AGENTS.md` 或 `ai/AI_CONTEXT.md`。

不必刷新：只改已有文件内容、只调样式文案注释。

## 三层刷新机制

| 方式 | 命令 | 场景 |
|---|---|---|
| 手动 | `scripts/ai-refresh.sh` | 每个任务开头一次 |
| 提交前自动 | `scripts/install-ai-hooks.sh` | 装一次，之后 commit 自动刷（需要 `.git`） |
| 持续监听 | `fswatch server/src client/src \| xargs -n1 -I{} scripts/ai-map.sh` | 重度开发期可选 |

## 索引范围

| 产物 | 覆盖 | 是否入库 |
|---|---|---|
| `ai/AI_FILE_INDEX.md` | `server/src`、`client/src`、`server/test`、`server/db/migrations`、`scripts` | 是 |
| `.ai/tags` + `.ai/SYMBOL_INDEX.md` | 仅 `server/src`、`client/src`（测试不进符号索引，避免大量重复 mock 类型污染） | 否 |

要连测试一起索引符号，改 `scripts/ai-map.sh` 顶部的 `SYMBOL_DIRS`。

## 维护约定

- `ai/AI_CONTEXT.md` 是低 token 总入口，保持短、准、稳定，手工维护。
- `ai/AI_FILE_INDEX.md` 自动生成，不手工改，随代码入库。
- `.ai/tags` 和 `.ai/SYMBOL_INDEX.md` 本地辅助索引，不入库。
- `ai/AI_REPOMIX_CONTEXT.md` 只保留 stub，全量 dump 写到 `.tmp/`。
- `.codexignore` / `.cursorignore` / `.rgignore` 三份内容必须一致，改一份要同步改三份。
- `ai/` 目录只放 AI 协作产物；用户文档在 `docs/`（VitePress 站点），两者不要混。

## 建议实践

- 每天第一次进入仓库执行一次 `scripts/ai-refresh.sh`
- 长期参与本项目的机器安装 `pre-commit` hook
- 不要为了「多看一点上下文」去读 dump 或整读符号索引
- 需要符号时用 `scripts/ai-symbol.sh`，需要文本时用 `scripts/ai-search.sh`
- 本仓库在外接 exFAT 盘上，大量 `._*` 噪音文件已在所有 ignore 和脚本 glob 中排除，不要绕开
