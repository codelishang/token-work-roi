# Competitive Notes

Token Work ROI is positioned as a local AI coding ROI review system, not only a token counter.

## Referenced Projects

| Project | Public focus | Coverage strength | Launch strength | Token Work ROI difference |
|---|---|---|---|---|
| [ccusage](https://ccusage.com/) | Local CLI usage and estimated cost across many coding agents | Broad collector coverage, offline pricing, cache token accounting | Strong CLI workflow | Token Work ROI adds work attribution, output links, ROI evidence score, and weekly review exports. |
| [CodeBurn](https://github.com/getagentseal/codeburn) | Interactive TUI for Claude Code, Codex, and Cursor cost observability | Claude, Codex, Cursor oriented | Fast `npx` terminal experience | Token Work ROI uses a browser review workspace with work items and advisor actions. |
| [token-dashboard](https://github.com/nateherkai/token-dashboard) | Local Claude Code JSONL dashboard with cost analytics, heatmaps, and tips | Deep Claude Code analytics | Clear dashboard story | Token Work ROI keeps transcript content out of the product and focuses on project/task/output ROI. |
| [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | Real-time terminal monitoring with burn rate and prediction | Claude Code focused | Strong live monitoring | Token Work ROI treats live monitoring as a lightweight guardrail and keeps weekly ROI review as the main surface. |
| [TokenTracker](https://github.com/mm7894215/TokenTracker) | Local-first dashboard, native tray/menu bar, widgets, many coding tools | Very broad tool coverage | Desktop packaging and zero-config story | Token Work ROI is lighter-weight today but has deeper work/output attribution and publishable review artifacts. |

## Differentiation

- Work attribution: project alias, task type, output status, work purpose, stage, value, and notes.
- Output evidence: PR, commit, article, deploy, document, screenshot, or other URL without fetching linked content.
- Work item layer: multiple sessions can roll up into one deliverable.
- ROI Evidence Score: separates manually confirmed work, auto/high-confidence work, missing fields, output links, and high-cost gaps.
- ROI Savings Simulator: compares model switching scenarios for exploration, testing, context prep, low-value, and abandoned work using official-price conversion, not invoice claims.
- ROI Advisor: local explainable rules that recommend annotation, model switching, context compression, stop-loss, output links, and policy changes.
- Advisor Action Loop: recommendations can become open/done/dismissed actions and appear in weekly reports.
- Model Policy export: produces a reusable Markdown strategy for when to use light, mid, or heavy models.
- ccusage JSON Import: uses ccusage documented output as an import bridge for broader structured coverage while recomputing official-price costs locally.
- Budget Guardrails: custom source-level token/cost windows, burn projection, and near/over/exceeded warnings without pretending to know provider subscription quotas.
- Collector Audit: safely checks experimental collector viability before upgrading support level, instead of inflating source count with unreliable estimates.
- Terminal ROI Report: quick CLI summary of total tokens, official-price cost, project/model ranking, budget risks, and Advisor Actions.
- Public safety: demo mode, privacy-check, `NOTICE.md`, no real SQLite in git, no prompt/response export.
- Launch path: `npx token-work` after npm publication for real local collection, with `npx token-work demo` kept as the synthetic walkthrough path.
- Experimental Cursor, Copilot CLI, Qwen Code, Kimi, and Goose collectors skip records without explicit token fields.

## Current Product Bet

The fastest way to improve Token Work ROI is to close visible coverage and workflow gaps without diluting the ROI product wedge. ccusage, tokscale, and TokenTracker still lead on breadth and quick-start monitoring. CodeBurn and Claude Code Usage Monitor remain stronger in terminal-first live burn-rate workflows. Token Work narrows those gaps while deepening the question those tools usually stop short of: **what should I change next week to spend fewer tokens on low-value work and preserve expensive models for high-value output?**

Token Work therefore prioritizes:

- ccusage import before reimplementing every collector.
- Custom budget guardrails before claiming exact subscription limits.
- Advisor Actions before generic tips.
- Terminal ROI report before a full TUI.
- Collector matrix breadth with detected-only/import-only honesty before fake stable support.
- ccusage CLI Bridge: run ccusage explicitly, request `--json --no-cost`, reject unsafe conversation-like fields, and recompute costs with Token Work official-price logic.
- Statusline Guardrails: a compact read-only summary for terminal prompt, tmux, or Claude Code statusline use.
- ccusage Bridge UX: the Dashboard generates copyable commands for saved JSON or CLI bridge workflows, but the browser never runs external scanners.
- Quota Profiles v2: custom guardrails now support rolling and fixed reset windows, reset countdowns, and editable warning thresholds.
- Statusline Integration Pack: documented snippets for Claude Code statusline, tmux, PowerShell prompts, and JSON scripts.
- ROI Playbook Export: `token-work policy --format=markdown|claude-md|agents-md` turns Model Policy into copyable operating rules without editing user files.
- npm one-command launch: `npx token-work` should run coverage, import trusted Claude/Codex event rows, and open the browser; `demo` remains a synthetic walkthrough.
- Source Health Center: show native stable, experimental, detected-only, and ccusage import-bridge support honestly, including detected status, recent rows, token-field trust, and privacy boundaries.
- ccusage bridge as coverage shortcut: use ccusage's broad ecosystem through explicit JSON/CLI import while still recomputing costs with Token Work official-price logic.
- README first screen: position Token Work ROI around Work Evidence, Savings Simulator, and Model Policy instead of competing only as a token meter.
- Desktop Pulse only reads the existing local API and SQLite-derived `/api/live` data.
- Desktop Pulse does not run `collect` automatically.
- Cyberpunk styling is limited to live surfaces: browser `/live` and Electron Desktop Pulse. Dashboard, Trust, and Review keep the Claude-like audit-oriented interface.
- Budgets remain custom guardrails, not provider subscription quotas.
- Detected-only and experimental sources still cannot write usage unless reliable token fields are proven.

## Remaining Gaps

- Collector depth is still behind the broadest multi-tool products. Source Health plus ccusage JSON/CLI bridge improve breadth, but Token Work's own stable collectors remain narrower than ccusage or TokenTracker.
- Live monitoring is intentionally lightweight; it is a guardrail for current burn rate, not an exact subscription predictor.
- Desktop packaging starts as an Electron companion and separate GitHub Release asset path. It is intentionally not part of the npm tarball.
- Automatic attribution is rule-based and should always display provenance and confidence.
- Savings simulation depends on official public token prices and structured metadata; it is useful for strategy, not proof of actual invoice savings.
