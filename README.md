# 元衡

[English](README.en.md) | **中文**

元衡是一个在本机运行的 AI 编程用量复盘工具。它帮你看清楚三件事：

1. 最近用了多少词元（token），大概花了多少钱。
2. 这些用量来自哪些工具、模型和项目。
3. 这些消耗有没有对应到任务、产出和下一步改进。

英文标识为 **Token Work ROI**，npm 命令名为 `token-work`。它不是聊天工具，也不是服务商账单系统。元衡只读取结构化用量记录，不保存 prompt、response、完整对话、diff、命令正文或完整本机路径。

## 适合谁

适合：

- 经常用 Claude Code、Codex CLI、Cursor、Gemini CLI 等工具写代码的人。
- 想知道 AI 编程成本主要花在哪些项目和模型上。
- 想把一周的 AI 使用情况整理成复盘报告。
- 想给自己设置预算提醒，而不是等到账单出来才发现用量过高。

不适合：

- 想查看完整聊天内容。
- 想做团队账号、云同步或多人权限管理。
- 想用它替代模型服务商的正式账单。

## 快速开始

需要 Node.js 24 或更高版本。

```bash
npx token-work
```

命令执行后会做三件事：

1. 只读检查本机默认来源是否有结构化用量记录。
2. 仅在通过可信门槛时，把 Claude/Codex 事件级用量写入本地 SQLite 数据库。
3. 打开浏览器页面。

如果你只想看演示，不想扫描本机日志：

```bash
npx token-work demo
```

如果你已经克隆源码：

```bash
git clone https://github.com/codelishang/token-work-roi.git
cd token-work-roi
npm install
node src/cli.mjs
```

## 第一次打开看哪里

| 页面 | 用途 |
|---|---|
| 看板 | 看总用量、费用、来源、模型、项目和明细 |
| 可信度 | 判断当前数据是否可靠，哪些来源只是检测到、哪些真的有词元记录 |
| 复盘 | 给 session 补项目、任务、阶段、产出，并导出 Markdown 复盘报告 |
| 实时 | 看近 24 小时词元压力、burn rate、预算状态和当前建议 |
| 导入/预算弹窗 | 从看板顶部打开，用于导入结构化 JSON 和创建预算窗口 |

最简单的使用顺序：

1. 先看“可信度”，确认数据是不是可信事件级记录。
2. 再看“看板”，了解今天或本周主要用量。
3. 最后到“复盘”，把高消耗 session 关联到项目和产出。

## 常用命令

```bash
npx token-work
npx token-work demo
npx token-work --no-collect
npx token-work --dry-run-only
npx token-work coverage --sources=claude,codex,cursor --json
npx token-work collect --dry-run --sources=claude,codex,cursor --json
npx token-work collect --apply --yes --sources=claude,codex
npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes
npx token-work statusline --format=text
npx token-work privacy-check
```

命令说明：

- `demo`：只看演示数据，不代表真实采集成功。
- `--no-collect`：只打开已有数据库，不扫描本机日志。
- `--dry-run-only`：只预检，不写入用量。
- `coverage`：查看哪些来源有可靠词元字段。
- `collect --apply`：确认后写入可信来源数据，写入前会备份数据库。
- `privacy-check`：发布前检查是否误带本机数据库、日志路径、环境变量或私密导出文件。

## 支持的数据来源

| 来源 | 状态 | 可检测 | 可采集 | 默认检查 | 默认写入 |
|---|---|---:|---:|---:|---:|
| Claude Code | stable | 是 | 是 | 是 | 是 |
| Codex CLI | stable | 是 | 是 | 是 | 是 |
| Cursor | experimental | 是 | 仅明确词元字段 | 是 | 否 |
| Gemini CLI | stable | 是 | 是 | 否 | 否 |
| OpenCode | stable | 是 | 是 | 否 | 否 |
| OpenClaw | stable | 是 | 是 | 否 | 否 |
| Hermes Agent | stable | 是 | 是 | 否 | 否 |
| GitHub Copilot CLI | experimental | 是 | 仅明确词元字段 | 否 | 否 |
| Qwen Code | experimental | 是 | 仅明确词元字段 | 否 | 否 |
| Kimi | experimental | 是 | 仅明确词元字段 | 否 | 否 |
| Goose | experimental | 是 | 仅明确词元字段 | 否 | 否 |

这些来源只有在本地记录里存在明确词元字段时才会写入用量。元衡不会按消息长度估算词元，也不会把“检测到目录”当成“已经采集成功”。

## 结构化 JSON 导入

元衡可以导入外部工具生成的结构化 JSON。例如，如果你已经在用 ccusage，可以把它生成的 JSON 导入元衡。

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --dry-run
```

确认预检结果后再写入：

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --apply --yes
```

也可以让元衡显式调用 ccusage CLI：

```bash
npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes
```

导入时会忽略 ccusage 自带的成本字段，费用统一由元衡按官方公开价格重新计算。包含对话正文、prompt、response 等字段的数据会被拒绝。

## 预算提醒

元衡支持自定义预算窗口，例如：

- 最近 60 分钟最多使用多少词元。
- 每天从固定时间开始计算预算。
- 只统计某个来源或某类模型。
- 达到 75% 时提醒，超过硬阈值时标红。

这些预算只是你自己的提醒规则，不是服务商套餐额度，也不代表模型厂商账单。

## 桌面小窗（源码入口）

桌面小窗目前是源码仓库里的开发入口，不是签名安装包，也不是 npm 包的一键桌面能力。需要先克隆仓库并安装开发依赖：

```bash
npm install
npm run desktop:install
npm run desktop
```

桌面小窗适合放在旁边看实时用量。它打开的仍然是本机元衡服务，不会在桌面壳里实现另一套采集器。默认启动桌面小窗不会自动执行定时采集；如需要实时刷新，可在确认采集边界后显式配置本地服务。

桌面版适合：

- 常驻一个小窗看今天用量。
- 从托盘快速打开实时、看板、复盘和可信度。
- 工作时看 burn rate、预算和当前建议。

完整复盘、导入和报告导出仍建议在浏览器里完成。更多说明见 [desktop/README.md](https://github.com/codelishang/token-work-roi/blob/main/desktop/README.md) 和 [docs/desktop-pulse.md](https://github.com/codelishang/token-work-roi/blob/main/docs/desktop-pulse.md)。

## 截图

以下截图来自演示数据或脱敏合成数据，不包含真实本机日志。

![Token Work ROI dashboard](https://raw.githubusercontent.com/codelishang/token-work-roi/main/docs/assets/token-work-dashboard.png)

![Token Work ROI local trust](https://raw.githubusercontent.com/codelishang/token-work-roi/main/docs/assets/token-work-trust.png)

![Token Work ROI review](https://raw.githubusercontent.com/codelishang/token-work-roi/main/docs/assets/token-work-review.png)

![Token Work ROI live pulse](https://raw.githubusercontent.com/codelishang/token-work-roi/main/docs/assets/token-work-live-pulse.png)

## 价格和汇率

元衡显示的费用是“官方公开单价换算”，不是服务商账单。

- 美元价格按 USD / 1M tokens 计算。
- 软件会保留官方价格的来源币种，并按刷新时的 USD/CNY 汇率展示人民币参考值。
- 没有确认官方价格的模型显示为未定价，不按 0 元计算。

模型价格可手动刷新：

```bash
npm run pricing:update
```

仓库维护流程会在每周一 00:01（Asia/Shanghai）尝试更新内置价格表；本地用户也可手动刷新价格缓存。刷新失败时保留旧缓存和内置表。

## 隐私边界

元衡默认不保存：

- prompt
- response
- 完整 transcript
- 完整本机路径
- 命令正文
- diff 内容

允许保存的是复盘所需的结构化字段，例如时间、来源、模型、词元数量、session、来源设备、项目别名、任务类型、阶段、产出状态、预算配置、用户手动填写的产出链接和链接说明。文件类型或路径哈希等结构化派生字段也可能保存在本地数据库中；路径哈希用于区分来源，不直接保存完整路径文本。

## 开发

```bash
npm install
npm test
npm run build
npm run privacy:check
```

## 名称和 Logo

项目中文名是“元衡”，英文名是“Token Work ROI”。“元”表示词元、成本和原始记录，“衡”表示衡量、校准和取舍。

Logo 和品牌使用说明见 [docs/brand.md](https://github.com/codelishang/token-work-roi/blob/main/docs/brand.md)。

## 开源协议

本项目采用 AGPL-3.0-only，并提供商业双授权说明。商业使用前请阅读 [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)。
