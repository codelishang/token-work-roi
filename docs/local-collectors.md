# Local Collectors

Token Work ROI uses a collector registry instead of ad-hoc collector labels.

## Stable Sources

- Claude Code
- Codex CLI
- Gemini CLI
- OpenCode
- OpenClaw
- Hermes Agent

These sources can produce normalized `daily_usage` and `session_usage` rows when their local metadata stores exist.

## Experimental Sources

- Cursor
- GitHub Copilot CLI
- Qwen Code
- Kimi / Moonshot Coding CLI
- Goose

Experimental sources are opt-in. They import only explicit structured token fields from JSON/JSONL metadata and skip records without reliable token fields.

See [collector-support-matrix.md](collector-support-matrix.md) for status, privacy, and token reliability.

## Commands

```bash
node src/cli.mjs
node src/cli.mjs --no-collect
node src/cli.mjs --dry-run-only
node src/cli.mjs doctor
node src/cli.mjs collectors
node src/cli.mjs coverage --sources=claude,codex,cursor --json
node src/cli.mjs collect --dry-run --sources=claude,codex,cursor
node src/cli.mjs collect --apply --yes --sources=claude,codex
node src/cli.mjs compare-ccusage --report=session --json --yes
```

The bare `node src/cli.mjs` command runs coverage, applies trusted Claude/Codex event-level rows, and starts the browser UI. Use `--no-collect` to only open the current SQLite and `--dry-run-only` to run coverage without writing.

`coverage` is the publish/readiness gate. It runs the same local collector dry-run but adds historical range, source-level coverage risk, and `candidateRecords -> tokenEvents -> sessions -> daily` reconciliation. It does not write SQLite.

`collect` requires an explicit mode. `--dry-run` scans local metadata and prints candidate file counts, parseable token records, skip reasons, expected row counts, historical range, and token totals without writing SQLite. `--apply` writes only after confirmation or `--yes`, creates a SQLite backup first, and prints before/after row counts. If Claude/Codex have parseable token records but would write zero `token_events`, or if daily/session/event totals differ by more than 1%, apply is blocked.

Running `node src/collect.mjs` or `npm run collect` without `--dry-run` or `--apply` refuses to scan and refuses to modify SQLite. This prevents bypassing the CLI confirmation boundary.

Cursor is conservative: Token Work reads only explicit token fields from local `state.vscdb`. If Cursor does not expose token fields on a machine, Token Work reports `detected-no-token-fields` and does not estimate from text length.

`compare-ccusage` explicitly runs ccusage JSON mode and compares token structure with Token Work's dry-run output. It does not adopt ccusage cost fields; Token Work still recomputes official-price cost itself.

Historical coverage is bounded by what the local upstream tools kept on disk. Deleted logs, logs without token fields, and UI-only conversation text cannot be reconstructed accurately.

## Environment

- `TOKEN_WORK_COLLECTORS=claude,codex,gemini`
- `TOKEN_WORK_CONFIG=config/collectors.json`
- `TOKEN_WORK_HEADLESS_DIR=/path/to/headless/events`
- `TOKEN_WORK_COLLECT_CONFIRMED=1` allows non-interactive `collect --apply` when you have already audited the sources.

## Privacy

Collectors should normalize token metadata only. They must not store prompt text, response text, full transcripts, full file paths, command bodies, or diff content.
