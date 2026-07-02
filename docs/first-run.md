# 首次使用指南

第一次启动后，按这里的顺序看就够了。

## 快速开始

需要 Node.js 24.0.0 或更高版本。

发布包用户：

```bash
npx token-work
```

只看演示数据：

```bash
npx token-work demo
```

源码目录用户：

```bash
npm install
node src/cli.ts
```

启动后先看：可信度、看板、复盘。

## 启动后会发生什么

直接运行 `npx token-work` 时，软件会检查本机默认来源里的结构化用量记录。只有通过可信门槛的 Claude/Codex 事件级数据才会写入本地 SQLite，然后打开浏览器。

不保存这些内容：

- prompt
- response
- 完整对话
- diff
- 命令正文
- 完整本机路径

在源码目录里不要把 `npx token-work` 当作本地入口。`npx` 会解析 npm 包，源码目录请使用 `node src/cli.ts`。

只想打开已有数据库、不扫描日志：

```bash
npx token-work --no-collect
```

只想预检、不写入数据库：

```bash
npx token-work --dry-run-only
```

## 先看可信度

第一次打开先看“可信度”：

- 当前是不是演示数据。
- 是否有事件级词元记录。
- 哪些来源只是检测到目录，但没有可靠词元字段。

如果页面显示 aggregate-only 或 detected-only，只适合粗略观察，不适合直接写成复盘结论。

## 再看看板

看板主要看：

- 今天或本周用了多少词元。
- 哪些来源和模型占比最高。
- 哪些项目或 session 消耗最多。
- 哪些模型还没有官方价格。

如果数据库为空，可以先用 `npx token-work demo` 熟悉界面，或者在“导入/预算”里导入结构化 JSON。

## 导入前先预检

导入外部 JSON 时，先 dry-run，再写入。

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --dry-run
npx token-work import-usage --format=ccusage-json --file ccusage.json --apply --yes
```

也可以让软件调用 ccusage CLI：

```bash
npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes
```

浏览器里的辅助命令只负责生成可复制命令，不会自动运行外部扫描器。

## 设置预算

预算是本地提醒规则，不是服务商套餐。常见用法：

- 最近 60 分钟词元上限。
- 每日固定时间重置。
- 只统计某个来源。
- 只统计重模型。
- 达到指定比例后提醒。

## 做复盘

打开“复盘”页面，优先处理高消耗 session。建议补齐：

- 项目
- 任务类型
- 工作阶段
- 产出状态
- 产出链接
- 下次是否还适合用同一类模型

复盘报告导出为 Markdown，适合再手工整理。

## 实时和桌面版

实时页面适合看最近 24 小时压力；复盘仍在浏览器里做。

桌面版目前是源码仓库里的本地小窗：

```bash
npm install
npm run desktop:install
npm run desktop
```

桌面版复用同一套本地服务。默认不会启动即采集，也不会开启定时采集。导入、复盘和报告导出仍建议用浏览器完成。

## 终端状态栏

只想在终端看一行状态：

```bash
npx token-work statusline --format=text --window-minutes=15
```

这个命令只读 SQLite，不扫描日志，也不启动后台进程。

## 发布前检查

```bash
npm run privacy:check
```

用于检查是否误带真实数据库、AI 日志目录、`.env`、私密导出文件或个人路径。
