# 演示流程 / Demo Flow

这份文档用于准备 README 截图、博客截图或项目展示。演示数据是合成数据，不是真实本机用量。

This guide is for README screenshots, blog screenshots, and project walkthroughs. Demo data is synthetic, not real local usage.

## 1. 启动演示 / Start Demo

```bash
npm install
npm run demo
```

演示命令会使用 `docs/demo-data/token-work-demo.json` 生成 `data/demo.sqlite`，然后启动本地页面。

The demo command seeds `data/demo.sqlite` from `docs/demo-data/token-work-demo.json` and starts the local UI.

## 2. 展示顺序 / Walkthrough

建议按这个顺序展示：

1. 打开看板，先指出 `Demo Mode`，说明这不是本机真实数据。
2. 展示时间筛选、来源、模型和项目概览。
3. 打开可信度页面，说明哪些数据能支持复盘，哪些只是检测状态。
4. 打开复盘页面，展示证据评分、建议和模型策略。
5. 导出 Markdown 复盘报告。
6. 打开 `/api/model-policy.md`，展示可复制的模型使用策略。

Suggested order:

1. Open Dashboard and point out `Demo Mode`.
2. Show time range, source, model, and project overview.
3. Open Trust and explain reliable data versus detected-only data.
4. Open Review and show evidence score, suggestions, and model strategy.
5. Export the Markdown review report.
6. Open `/api/model-policy.md` for the generated model policy.

## 3. 发布前检查 / Privacy Check

```bash
npm run privacy:check
```

公开截图不应包含：

- 真实 SQLite 数据库。
- 本机 AI 日志目录。
- `.env` 文件。
- 私密导出报告。
- 个人路径或用户名。
- prompt、response、完整对话、diff 或命令正文。

Public screenshots should not contain real databases, local AI log paths, `.env`, private exports, personal paths, prompts, responses, full conversations, diffs, or command bodies.

## 4. 演示边界 / Demo Boundary

- 演示数据不代表真实采集成功。
- 真实模式需要用户明确确认采集或导入。
- 元衡不读取对话正文。
- 费用是官方公开单价换算，不是服务商账单。

- Demo data does not prove real collection works on a user's machine.
- Real mode requires explicit collection or import.
- Yuanheng does not read conversation content.
- Cost is official public price conversion, not a provider invoice.
