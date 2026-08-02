# 本地采集说明 / Local Collectors

元衡的采集逻辑只提取结构化用量字段，不保存或输出对话正文，也不会从文本长度估算词元。

Yuanheng collectors extract structured usage metadata only. They do not store or output conversation text, and they do not estimate tokens from text length.

## 稳定采集器 / Stable Collectors

当前已实现稳定采集的来源：

- Claude Code
- Codex（CLI、Desktop 或未识别客户端）
- Gemini CLI
- OpenCode
- OpenClaw
- Hermes Agent

这些来源在本机存在可靠元数据时，可以生成 `daily_usage`、`session_usage` 和 `token_events`。稳定采集不等于快速启动时全部自动写入。

快速启动的定时采集只处理 Claude Code 和 Codex；Codex 记录会根据客户端元数据标为 Codex CLI、Codex Desktop 或 Codex。其他稳定采集器和实验来源需要通过 `coverage --sources` 或 `collect --sources` 明确选择。

These collectors can produce structured usage when reliable local metadata exists. Quick-start scheduled collection handles Claude Code and Codex only. Codex records are labeled as Codex CLI, Codex Desktop, or Codex according to available client metadata. Select other stable or experimental collectors explicitly with `coverage --sources` or `collect --sources`.

## 实验来源 / Experimental Sources

实验来源需要明确词元字段才会导入：

- Cursor
- GitHub Copilot CLI
- Qwen Code
- Kimi / Moonshot Coding CLI
- Goose

如果没有明确词元字段，元衡只报告检测状态，不写入用量。

If explicit token fields are missing, Yuanheng reports detection status only and writes no usage.

## 常用命令 / Commands

从源码运行时使用：

```bash
node src/cli.ts
node src/cli.ts --no-collect
node src/cli.ts --dry-run-only
node src/cli.ts coverage --sources=claude,codex,cursor --json
node src/cli.ts collect --dry-run --sources=claude,codex,cursor
node src/cli.ts collect --apply --yes --sources=claude,codex
node src/cli.ts compare-ccusage --report=session --json --yes
```

发布包用户可以把 `node src/cli.ts` 换成 `npx token-work`。在源码目录里不要用 `npx token-work` 作为本地入口；`npx` 会按 npm 包解析。

Use `npx token-work` instead of `node src/cli.ts` when using the published package.

v2 源码入口使用 TypeScript 文件。旧的 `.mjs` 源码直跑路径不再作为 v2 入口；npm 用户命令保持不变。

## 命令怎么选 / Which Command To Use

| 命令 | 作用 |
|---|---|
| `node src/cli.ts` | 默认入口，先打开浏览器，再在后台采集可信 Claude/Codex 事件级记录 |
| `--no-collect` | 不扫描本机日志，也不写入采集结果 |
| `--dry-run-only` | 禁用定时采集并打开界面，不写入采集结果 |
| `coverage` | 查看每个来源是否有可靠词元字段，以及 daily/session/event 是否能对上 |
| `collect --dry-run` | 输出将要读取和写入的摘要，不修改 SQLite |
| `collect --apply` | 明确确认后写入，写入前创建 SQLite 备份 |
| 定时采集 | 数据需要写入或修复时才创建完整备份；受管备份只保留最新一份 |
| `compare-ccusage` | 调用 ccusage JSON 模式进行对比，但不采用 ccusage 的成本字段 |

## 写入前的保护 / Write Safety

`collect` 必须显式选择 `--dry-run` 或 `--apply`。直接运行 `node src/collect.ts` 或 `npm run collect` 不会绕过确认流程。

`collect` requires either `--dry-run` or `--apply`. Running the lower-level script directly will not bypass the confirmation boundary.

写入会被阻止的情况：

- Claude/Codex 有候选记录，但最后会写入 0 条 `token_events`。
- daily、session、event 统计差异超过 1%。
- 记录里没有可靠词元字段。
- 记录看起来像 prompt、response 或完整对话。

## Cursor 说明 / Cursor Note

Cursor 只有在本机 `state.vscdb` 或结构化文件里存在明确词元字段时才会写入用量。否则只显示 `detected-no-token-fields`。

Cursor writes usage only when explicit token fields exist. Otherwise it remains `detected-no-token-fields`.

## 历史数据限制 / History Limits

元衡只能读取本机仍然存在、且含有可靠词元字段的历史记录。已经被上游工具删除、或者从未记录词元字段的数据，无法准确恢复。

Yuanheng can only read local history that still exists and contains reliable token fields. Deleted logs or logs without token fields cannot be reconstructed accurately.

## 环境变量 / Environment

- `TOKEN_WORK_COLLECTORS=claude,codex,gemini`
- `TOKEN_WORK_CONFIG=config/collectors.json`
- `TOKEN_WORK_HEADLESS_DIR=/path/to/headless/events`
- `TOKEN_WORK_COLLECT_CONFIRMED=1`：用于已经审计过来源的非交互式 `collect --apply`。

## 隐私 / Privacy

采集器只保存结构化词元元数据，不保存 prompt、response、完整 transcript、命令正文或 diff 内容。部分来源会把 workspace/project path 保存到本机 SQLite，用于项目归因；分享数据库、截图、导出文件或启用远程推送前应检查并脱敏。

Collectors may store structured token metadata only. They must not store prompts, responses, full transcripts, command bodies, or diff content. Some sources keep a workspace or project path in local SQLite for attribution; review and sanitize it before sharing a database, screenshot, or export.
