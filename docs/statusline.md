# Statusline Guardrails

`token-work statusline` is a read-only SQLite summary for terminal prompts, tmux, scripts, and Claude Code statusline integrations. It does not scan local AI logs, run ccusage, start a daemon, or read conversation content.

## Basic Command

```bash
npx token-work statusline --format=text --window-minutes=15 --max-width=100
```

For script usage:

```bash
npx token-work statusline --format=json --window-minutes=15
```

## Claude Code Statusline

Use the same text command as your statusline command:

```bash
npx token-work statusline --format=text --window-minutes=15 --max-width=100
```

## tmux

```tmux
set -g status-right "#(npx token-work statusline --format=text --window-minutes=15 --max-width=80)"
```

## PowerShell Prompt

```powershell
function prompt {
  $ts = npx token-work statusline --format=text --window-minutes=15 --max-width=80
  "$ts PS $($PWD)> "
}
```

From a cloned repository, replace `npx token-work` with `node src/cli.mjs`.

## Output Meaning

- `tok`: tokens in the recent local window.
- `burn`: tokens per hour if the recent pace continues.
- `cache`: cache hit percentage from structured token events.
- `actions`: open Advisor Actions.
- `budget`: custom token/cost guardrail status and usage share.
- `reset`: next fixed-window reset countdown, or rolling-window duration.
- `warn`: highest current guardrail warning.

Budget profiles are custom guardrails. They are not provider subscription quota claims.
