# 首次使用

本页只讲第一次运行需要完成的步骤。

## 1. 启动

需要 Node.js 24.0.0 或更高版本。

```bash
npx token-work
```

默认入口先打开浏览器，再在后台采集 Claude Code 和 Codex CLI 的可信事件级记录。采集通过可信门槛后，元衡会备份并更新本地 SQLite。
持续运行时，定时采集只在用量发生变化时备份，最多每小时一个，并保留最近 24 个定时备份；人工采集、导入和手工备份不受此限制。

只想熟悉界面：

```bash
npx token-work demo
```

只检查、不写入：

```bash
npx token-work --dry-run-only
```

只打开已有数据库：

```bash
npx token-work --no-collect
```

源码目录使用 `node src/cli.ts`，不要用 `npx token-work` 代替当前源码。

## 2. 先看可信度

进入“可信度”页面，先确认当前数据属于哪种状态：

- **事件级数据已验证**：可以用于实时监控和复盘。
- **有事件记录，待检查**：已有 token event，但可信检查尚未通过。
- **只有聚合数据**：可以看趋势，不能证明完整事件历史。
- **空数据库**：需要采集、导入或使用演示模式。
- **演示数据**：仅用于了解界面，不代表本机采集成功。

来源显示为“仅检测到”或“无 token 字段”时，元衡不会把它计入用量。

## 3. 再看看板

看板用于确认：

- 当天或所选时间段的 token 总量；
- 官方价成本和人民币参考值；
- 主要来源、模型和项目；
- 高消耗 session 与明细记录。

如果模型显示“未定价”，表示没有确认到官方公开价格，不代表免费。

## 4. 导入外部数据

另一台电脑或外部工具已经导出 ccusage JSON 时，先预检：

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --device other-computer --dry-run
```

确认日期、来源和 token 数量后写入：

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --device other-computer --apply --yes
```

`--device` 用于区分来源电脑，同一台电脑重复导入时应使用相同名称。导入使用 `device + source + session_id` 去重。外部成本字段会被忽略，费用由元衡重新计算。

## 5. 设置预算

从看板顶部打开“导入/预算”，可以设置：

- 最近若干分钟的 token 或成本上限；
- 每天固定时间开始的预算窗口；
- 指定来源或模型组；
- 提醒比例和硬阈值。

预算是本地提醒，不是服务商套餐额度。

## 6. 完成第一次复盘

打开“复盘”，优先处理高消耗且信息不完整的 session。补充项目、任务类型、工作阶段、价值、产出状态和产出链接后，再导出 Markdown 复盘报告。

建议只填写能确认的事实。没有产出证据时保持未标注，不要为了提高评分补造内容。

## 7. 可选入口

终端状态栏：

```bash
npx token-work statusline --format=text --window-minutes=15
```

源码桌面小窗：

```bash
npm install
npm run desktop:install
npm run desktop
```

状态栏只读 SQLite；桌面小窗启动后会在后台采集可信事件级记录。桌面说明见 [desktop/README.md](../desktop/README.md)。

## 8. 遇到问题

```bash
npx token-work doctor
```

仍无法启动时，依次检查 Node.js 版本、本地端口、SQLite 文件权限和终端中的错误信息。提交问题前请先移除用户名、完整路径、数据库和真实导出内容。
