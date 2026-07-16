<p align="center">
  <img src="public/yuanheng-logo.svg" alt="Yuanheng Token Work ROI" width="420" />
</p>

<h1 align="center">Token Work ROI</h1>

<p align="center">
  <strong>Put AI coding usage, cost, and output on the same scale</strong><br>
  A local token usage and ROI review tool
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/token-work"><img src="https://img.shields.io/npm/v/token-work?label=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24-339933" alt="Node.js 24 or newer" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-1f6feb" alt="AGPL-3.0-only" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong> ·
  <a href="docs/first-run.md">First Run</a>
</p>

---

## What It Does

Yuanheng is the Chinese name of Token Work ROI. It reviews structured usage records produced by local AI coding tools and answers three practical questions:

1. How many tokens did I use, and what is the estimated cost at official public rates?
2. Which tools, models, and projects account for that usage?
3. What work did the usage produce, and should I change model choices next time?

Data stays in a local SQLite database. Token Work ROI does not store prompts, responses, full conversations, diffs, or command bodies. Some collectors keep a workspace or project path locally for attribution; paths are not uploaded and should be reviewed before sharing screenshots or exports. The software is not a replacement for provider billing.

## Features

| Feature | Description |
|---|---|
| Dashboard | Review tokens and official-price cost by time, source, model, and project |
| Trust | Separate event-level records, aggregates, detected-only sources, and sources without token fields |
| Review | Add project, task, stage, value, and output labels to sessions; export Markdown reports |
| Live | Track 24-hour burn rate, active sessions, source distribution, and budget warnings |
| Import | Dry-run and import ccusage JSON or other compatible structured JSON |
| Budgets | Create local warnings by source, model group, or fixed time window |
| Statusline | Print a compact usage summary for shells, tmux, or Claude Code |

## Quick Start

Requires Node.js 24.0.0 or newer.

```bash
npx token-work
```

The default entrypoint first checks local structured sources in read-only mode. When Claude Code or Codex CLI event records pass the trust gate, Token Work ROI backs up and updates the local SQLite database, then opens the browser UI.

For a first look without writing real usage:

```bash
npx token-work demo           # Synthetic demo data
npx token-work --dry-run-only # Check sources without writing SQLite
npx token-work --no-collect   # Open the existing database only
```

From a source checkout, run the local entrypoint instead of resolving the npm package with `npx`:

```bash
git clone https://github.com/coderlishang/token-work-roi.git
cd token-work-roi
npm install
node src/cli.ts
```

For a first review, open **Trust -> Dashboard -> Review**.

## Screenshots

Screenshots use synthetic or sanitized data and contain no real local logs.

![Token Work ROI dashboard](docs/assets/token-work-dashboard.png)

![Token Work ROI trust page](docs/assets/token-work-trust.png)

![Token Work ROI review page](docs/assets/token-work-review.png)

![Token Work ROI live page](docs/assets/token-work-live-pulse.png)

## Data Sources

| Type | Sources |
|---|---|
| Stable collectors | Claude Code, Codex CLI, Gemini CLI, OpenCode, OpenClaw, Hermes Agent |
| Experimental collectors | Cursor, GitHub Copilot CLI, Qwen Code, Kimi, Goose |
| External import | ccusage JSON, ccusage CLI, and compatible structured JSON |

Records are written only when explicit token fields exist. Token Work ROI does not guess usage from text length and does not treat a detected directory as successful collection. See the [collector support matrix](docs/collector-support-matrix.md) for exact status.

## Import From Another Computer

Dry-run the file first:

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --dry-run
```

After checking the source, date, and token totals, apply it:

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --apply --yes
```

Imported cost fields are ignored. Token Work ROI recalculates cost from its official pricing table. Data containing conversation text, prompts, or responses is rejected.

## Desktop Window

The desktop window is an optional source-checkout entrypoint, not a signed installer:

```bash
npm install
npm run desktop:install
npm run desktop
```

It reuses the same local service and is intended for keeping the Live page open. Use the browser for imports, labels, and report export. See [Desktop](desktop/README.md).

## Pricing And Exchange Rates

- Model cost uses official public token rates and is not a provider invoice.
- CNY values use the USD/CNY rate stored in the pricing cache and are for reference only.
- A failed pricing or exchange-rate refresh keeps the last successful cache.
- Models without a verified official rate remain unpriced instead of being shown as free.

Maintainers can refresh the cache manually:

```bash
npm run pricing:update
```

The repository workflow attempts a pricing and exchange-rate refresh every Monday at 00:01 Asia/Shanghai.

## Privacy

Token Work ROI has no cloud sync or telemetry and does not upload usage by default. Stored data is limited to structured fields needed for review, including time, source, model, token counts, session, device, workspace or project path, project alias, task labels, budgets, and user-entered output links.

Before publishing or sharing a checkout, run:

```bash
npm run privacy:check
```

See [PRIVACY.md](PRIVACY.md) for the local API and remote ingest boundaries.

## Tech Stack

Node.js 24 · TypeScript · React 18 · Vite · ECharts · SQLite · Electron

## Development

```bash
npm install
npm test
npm run typecheck:tools
npm run build
npm run privacy:check
```

Before release, also run `npm run smoke:npx`, `npm run smoke:browser`, and `npm run desktop:smoke`. The complete process is in the [release checklist](docs/public-launch-checklist.md).

## Documentation

| Document | Contents |
|---|---|
| [First Run](docs/first-run.md) | From startup to the first review |
| [Collector Support Matrix](docs/collector-support-matrix.md) | Detection, collection, and default-write status |
| [Local Collectors](docs/local-collectors.md) | Collection commands, trust gates, and environment variables |
| [Statusline](docs/statusline.md) | Shell, tmux, and Claude Code setup |
| [Brand](docs/brand.md) | Name, logo meaning, and usage rules |
| [Privacy](PRIVACY.md) | Local data, API, and remote ingest boundaries |

## Name And License

The Chinese name is Yuanheng: `元` refers to tokens, cost, and original records; `衡` means measurement, calibration, and tradeoffs. The logo was drawn for this project. See [Brand](docs/brand.md) for the design notes.

AGPL-3.0-only license. Copyright © 2026 coderlishang. All rights reserved. See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for commercial dual licensing.
