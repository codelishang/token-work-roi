# 首次使用指南 / First Run Guide

这份文档只解决一个问题：第一次运行元衡后，应该先看哪里、点什么、哪些地方不要误解。

This guide is for the first run: what to open first, what to click, and what not to misunderstand.

## 1. 启动 / Start

```bash
npx token-work
```

它会先只读检查本机 Claude、Codex、Cursor 等工具的结构化用量记录，然后把可信的 Claude/Codex 事件级记录写入本地 SQLite，最后打开浏览器。

It checks local structured usage metadata in read-only mode, writes trusted Claude/Codex event-level rows into local SQLite, then opens the browser.

不会保存：

- prompt
- response
- 完整对话
- diff
- 命令正文
- 完整本机路径

It does not store prompts, responses, full conversations, diffs, command bodies, or full local paths.

从源码运行：

```bash
npm install
node src/cli.mjs
```

只看演示数据：

```bash
npx token-work demo
```

只打开已有数据库、不扫描日志：

```bash
npx token-work --no-collect
```

## 2. 先看可信度 / Check Trust First

第一次打开后，建议先看“可信度”页面。

Look at the Trust page first.

你要确认的是：

- 当前是不是演示数据。
- 是否有事件级词元记录。
- 哪些来源只是“检测到目录”，但没有可靠词元字段。
- daily、session、event 三类统计是否能对上。

Check whether:

- the data is demo data,
- event-level token rows exist,
- some sources are detected-only,
- daily/session/event totals reconcile.

如果可信度页面显示“aggregate only”或“detected only”，说明它只能支持粗略观察，不适合直接写强复盘结论。

If it says aggregate-only or detected-only, use it for rough observation only. Do not treat it as strong ROI evidence.

## 3. 再看看板 / Open Dashboard Next

看板适合回答：

- 今天或本周用了多少词元。
- 哪些来源和模型占比最高。
- 哪些项目或 session 消耗最多。
- 哪些模型没有官方价格。

Dashboard answers:

- token usage today or this week,
- top sources and models,
- high-cost projects or sessions,
- unpriced models.

如果数据为空，可以先用 `demo` 看界面，或者到“导入/预算”导入 ccusage JSON。

If the database is empty, use `demo` to inspect the UI or import ccusage JSON from Import / Budget.

## 4. 导入前先预检 / Dry-run Before Import

打开“导入/预算”，粘贴 ccusage JSON 或选择本地 JSON 文件，然后先点 dry-run。

Open Import / Budget, paste ccusage JSON or choose a local JSON file, then run dry-run first.

dry-run 会告诉你：

- JSON 是哪种结构。
- 有多少 daily、session 和 event 记录。
- 是否含有不安全字段。
- 哪些模型没有官方价格。
- 写入后大概会新增多少数据。

Only apply after the dry-run looks right.

命令行方式：

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --dry-run
npx token-work import-usage --format=ccusage-json --file ccusage.json --apply --yes
```

如果要让元衡调用 ccusage CLI：

```bash
npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes
```

浏览器页面只生成可复制命令，不会偷偷运行外部扫描器。

The browser only generates copyable commands. It does not secretly run external scanners.

## 5. 设置预算 / Add A Budget

预算是你自己的提醒规则，不是服务商套餐。

Budgets are your own guardrails, not provider subscription quotas.

常见设置：

- 最近 60 分钟最多使用多少词元。
- 每天固定时间重置预算。
- 只统计 Codex CLI 或 Claude Code。
- 只统计重模型。
- 达到 75% 时提醒。

Common settings:

- token budget for the last 60 minutes,
- fixed daily reset time,
- source-specific budget,
- heavy-model-only budget,
- warning at 75%.

## 6. 做复盘 / Review Work

打开“复盘”页面，先处理高消耗 session。

Open Review and start from high-cost sessions.

建议补充：

- 项目。
- 任务类型。
- 工作阶段。
- 产出状态。
- 产出链接。
- 是否值得继续用同样模型。

Add project, task type, stage, output state, output link, and model-choice notes.

复盘报告是 Markdown，可以直接导出后再人工整理。

The review report is Markdown and can be edited manually after export.

## 7. 可选：实时和桌面版 / Optional Live And Desktop

实时页面适合看最近 24 小时压力，不适合做完整复盘。

Live is for recent 24-hour pressure, not full review.

桌面版启动：

```bash
npm install
npm run desktop:install
npm run desktop
```

桌面版目前是源码仓库里的本地小窗，复用同一套本地服务。默认不会启动即采集或开启定时采集。完整导入、复盘和报告导出仍建议用浏览器。

The desktop app is currently a source-checkout local window using the same service. It does not collect on startup or enable scheduled collection by default. Use the browser for import, review, and export.

## 8. 终端状态栏 / Terminal Statusline

如果只想在终端看一个简短状态：

```bash
npx token-work statusline --format=text --window-minutes=15
```

它只读 SQLite，不扫描日志，也不启动后台进程。

It reads SQLite only. It does not scan logs or start a background process.

## 9. 发布前检查 / Before Publishing

```bash
npm run privacy:check
```

这个命令用于检查是否误带真实数据库、AI 日志目录、`.env`、私密导出文件或个人路径。

This checks for real databases, AI log directories, `.env`, private exports, and personal paths.
