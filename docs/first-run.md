# First Run Guide

This guide gets a new user from an empty checkout to a useful ROI review in about five minutes.

## 1. Start With Real Local Coverage

```bash
npx token-work
```

The default command runs read-only coverage over local Claude/Codex/Cursor metadata, writes trusted Claude/Codex event-level token rows, and opens the browser. It does not store prompts, responses, transcripts, diffs, command bodies, or full file paths. Cursor stays detected-only unless explicit token fields exist.

From a cloned repository, use:

```bash
npm install
node src/cli.mjs
```

To inspect the product without scanning local AI logs, use synthetic demo mode:

```bash
npx token-work demo
```

To only inspect current SQLite without scanning, use:

```bash
npx token-work --no-collect
```

## 2. Try The Import Flow Without Writing

Open the Dashboard and choose **导入/预算**.

Paste ccusage JSON or choose a local JSON file, then click **Dry-run 预检**. Token Work reports the detected shape, daily rows, sessions, token events, ignored third-party cost fields, and unsafe conversation-like fields.

Only click **Apply 写入 SQLite** after the dry-run looks correct. Apply creates a SQLite backup before writing.

CLI equivalent:

```bash
npx token-work import-usage --format=ccusage-json --file ccusage.json --dry-run
```

If you already use ccusage and want Token Work to invoke it for you, use the explicit bridge:

```bash
npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes
```

This runs `ccusage session --json --no-cost` through the configured bridge. Token Work rejects conversation-like fields, ignores ccusage cost fields, and only writes SQLite when you switch from `--dry-run` to `--apply`.

The Dashboard also has a **ccusage CLI Bridge** command builder. It only generates a copyable terminal command; the browser does not run ccusage or any external scanner.

## 3. Create A Custom Budget Window

In **导入/预算**, create a source-level budget such as:

- source: `Codex CLI`
- window type: `rolling` or `fixed`
- window: `60` minutes, `300` minutes, or your own target
- reset anchor: fixed windows only
- warning threshold: for example `0.75`
- token budget: your own target
- USD budget: optional official-price conversion target

Token Work does not ship provider subscription quota presets. Budgets are your own guardrails, not vendor plan limits.

## 4. Review ROI

Open `/review` and check:

- ROI Evidence Score
- Savings Simulator
- ROI Advisor
- Advisor Actions
- Markdown report export

The first useful action is usually to add one or two recommendations to the action list, then review whether similar work uses fewer tokens next week.

## 5. Optional Terminal Statusline

For a compact live guardrail in a terminal prompt, tmux bar, or Claude Code statusline:

```bash
npx token-work statusline --format=text --window-minutes=15
npx token-work statusline --format=json --window-minutes=15
```

The statusline command only reads SQLite. It does not scan logs or start a background process. Copyable Claude Code, tmux, and PowerShell snippets are in [statusline.md](statusline.md).

## 6. Optional ROI Playbook Export

Export a model-use playbook without editing `CLAUDE.md`, `AGENTS.md`, or project files:

```bash
npx token-work policy --format=markdown
npx token-work policy --format=claude-md
npx token-work policy --format=agents-md
```

Use the output as a review artifact or copy the relevant section manually into your local project rules.

## Privacy Boundary

Token Work does not store prompts, responses, transcripts, command bodies, diffs, or full file paths. Costs are official public token-price conversions and simulations, not provider invoices.
