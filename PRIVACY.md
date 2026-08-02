# Privacy

元衡（Token Work ROI）是本机运行的 AI 编程用量复盘工具。默认数据文件位于 `data/`，默认不会上传到第三方服务器。

## 启动与采集

- `token-work demo` 只使用合成演示数据。
- `token-work --no-collect` 不检查本机 AI 工具记录，也不写入采集结果。
- `token-work --dry-run-only` 禁用定时采集并打开本地界面，不写入采集结果。
- `token-work`、`token-work start` 和 `token-work live` 会启动定时采集；Claude Code 或 Codex 的事件级记录通过可信门槛后，才会备份并写入本地 SQLite。Codex 会根据客户端元数据标为 Codex CLI、Codex Desktop 或 Codex。
- `token-work collect --apply` 和结构化 JSON 导入需要用户明确确认。
- Electron 桌面入口会复用已有服务；没有可复用服务时，会启动本地服务并开启与默认入口相同的定时采集。

`--no-collect` 和 `--dry-run-only` 不会把 SQLite 变成只读文件；首次启动时仍可能初始化数据库结构，用户在界面中的主动操作也可以写入本地数据。

## 采集器不保存的内容

采集器不保存：

- prompt、response 或完整 transcript；
- diff、代码正文或命令正文；
- 外部链接指向的网页、提交、文章或部署内容；
- 账号密码、API key 或模型服务商凭据。

用户填写的产出链接只保存 URL、标签和类型，不会抓取链接内容。
备注由用户主动填写，内容由用户自行控制。

## 本地保存的内容

为了完成统计和复盘，SQLite 可以保存以下结构化字段：

- 时间、来源、模型和 token 数量；
- session 标识和来源设备；
- 采集器提供的 workspace/project path；
- 项目别名、任务类型、阶段、价值和产出状态；
- 用户填写的备注、产出链接和预算设置；
- 文件类型、工具分类和不可逆路径哈希等派生字段。

workspace/project path 用于本地项目归因，可能包含用户名或目录结构。界面、截图、SQLite、导出文件或问题日志在对外分享前都应人工检查。路径哈希用于区分来源，不等同于明文路径。

只有用户显式执行带 `--push` 的采集命令时，结构化采集结果才会发送到指定 ingest 地址；其中可能包含 workspace/project path。

## 本地接口

服务默认绑定 `127.0.0.1`。普通 `/api/*` 读写接口同时检查请求地址和 Origin，只接受本机页面访问。JSON 写接口还要求 `Content-Type: application/json`。

`/api/ingest` 默认关闭。只有设置 `INGEST_TOKEN` 后才会启用，并要求每个请求携带：

```text
Authorization: Bearer <token>
Content-Type: application/json
```

非本机绑定还必须同时设置 `TOKEN_WORK_ALLOW_REMOTE=1`。该模式仅用于受 token 保护的结构化数据写入，不会开放看板、可信度、复盘或实时接口供远程浏览。

## 费用边界

费用使用官方公开 token 单价和本地缓存汇率计算，适合趋势比较，不等同于服务商账单或财务对账结果。外部导入文件中的成本字段不会直接写入数据库。

## 分享前检查

公开仓库、截图或发布包前运行：

```bash
npm run privacy:check
```

检查会查找 SQLite、AI 日志目录、`.env`、私密导出、个人路径和疑似密钥。它不能代替人工检查截图和报告内容。
