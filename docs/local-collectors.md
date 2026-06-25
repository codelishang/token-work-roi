# 本地采集说明 / Local Collectors

元衡的采集逻辑只处理结构化用量数据。它不会读取对话正文，也不会从文本长度估算词元。

Yuanheng collectors handle structured usage metadata only. They do not read conversation text or estimate tokens from text length.

## 默认会读取哪些来源 / Default Sources

默认启用：

- Claude Code
- Codex CLI
- Gemini CLI
- OpenCode
- OpenClaw
- Hermes Agent

这些来源在本机存在可靠元数据时，可以生成 `daily_usage`、`session_usage` 和 `token_events`。

Enabled by default when reliable local metadata exists.

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
node src/cli.mjs
node src/cli.mjs --no-collect
node src/cli.mjs --dry-run-only
node src/cli.mjs coverage --sources=claude,codex,cursor --json
node src/cli.mjs collect --dry-run --sources=claude,codex,cursor
node src/cli.mjs collect --apply --yes --sources=claude,codex
node src/cli.mjs compare-ccusage --report=session --json --yes
```

发布包用户可以把 `node src/cli.mjs` 换成 `npx token-work`。

Use `npx token-work` instead of `node src/cli.mjs` when using the published package.

## 命令怎么选 / Which Command To Use

| 命令 | 作用 |
|---|---|
| `node src/cli.mjs` | 默认入口，先检查来源，再写入可信 Claude/Codex 事件级记录，最后打开浏览器 |
| `--no-collect` | 只打开当前 SQLite，不扫描本机日志 |
| `--dry-run-only` | 只预检，不写入数据库 |
| `coverage` | 查看每个来源是否有可靠词元字段，以及 daily/session/event 是否能对上 |
| `collect --dry-run` | 输出将要读取和写入的摘要，不修改 SQLite |
| `collect --apply` | 明确确认后写入，写入前创建 SQLite 备份 |
| `compare-ccusage` | 调用 ccusage JSON 模式进行对比，但不采用 ccusage 的成本字段 |

## 写入前的保护 / Write Safety

`collect` 必须显式选择 `--dry-run` 或 `--apply`。直接运行 `node src/collect.mjs` 或 `npm run collect` 不会绕过确认流程。

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

采集器只能保存结构化词元元数据。不能保存 prompt、response、完整 transcript、完整本机路径、命令正文或 diff 内容。

Collectors may store structured token metadata only. They must not store prompts, responses, full transcripts, full local paths, command bodies, or diff content.
