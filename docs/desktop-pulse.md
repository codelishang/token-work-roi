# Desktop Pulse Companion

Desktop Pulse is the optional local companion for people who want a tray/menu-bar style entry in addition to the Web app and CLI.

## Positioning

Pulse is not a replacement for Dashboard, Trust, or Review.

- Dashboard remains the main token and project workspace.
- `/trust` remains the coverage and local trust workbench.
- `/review` remains the ROI evidence and model strategy workspace.
- Desktop Pulse is for quick live guardrails: burn rate, custom budget windows, reset countdowns, unpriced models, and open actions.

If you mainly do weekly review, use the browser app. If you want a small local window/tray entry that stays close while you work, use Desktop Pulse.

## Start

```bash
npm run desktop
```

Pulse checks whether the local Token Work Web/API service is already running on `127.0.0.1`. If it is not running, Pulse starts the existing local service with safe live refresh enabled and opens `/live?surface=desktop`.

Live refresh means the local service periodically applies trusted Claude/Codex event-level metadata into SQLite and then `/live` reads the latest 15-minute window. Pulse does not read process memory or intercept prompts. If an upstream tool has not flushed logs yet, a 5-60 second delay is normal.

## Download And Use Paths

Current state:

- Web/CLI users run `npx token-work` or `node src/cli.mjs`; this is the primary public path.
- Source users can run `npm run desktop`; this launches Electron locally during development.
- The npm package does not include a packaged desktop installer.

Future desktop distribution should be separate from npm:

- Windows: portable `.exe` or installer from GitHub Releases.
- macOS/Linux: optional release assets after signing/package decisions.
- Desktop packages must pass desktop smoke and privacy checks before release.

The desktop app is useful only if it gives a lower-friction pulse than a browser tab: tray/menu access, compact live window, budget warnings, reset countdowns, and one-click links to Review/Trust. It should not become a second full dashboard.

## What It Shows

- Today / recent-window token pressure through `/api/live`.
- Burn rate, cache reuse, official-price conversion, and custom budget status.
- Reset countdown for rolling or fixed user-defined windows.
- Heavy-model and unpriced-model warnings.
- Shortcuts to Dashboard, Trust, and Review.

## What It Does Not Do

- It does not implement its own collector or run `collect` directly from Electron.
- When Pulse starts a fresh local service, that service runs the same safe scheduled Claude/Codex refresh used by the default `npx token-work` path.
- It does not implement separate collectors.
- It does not upload data.
- It does not read prompt, response, transcript, diff, command body, or full local paths.
- It does not claim provider subscription quotas; all budgets are user-defined guardrails.

## Security Boundary

Desktop Pulse is a local companion only. The Electron window loads the local Token Work service on `127.0.0.1`, denies renderer-created windows, blocks navigation away from the local service, denies renderer permission requests, keeps `contextIsolation` enabled, disables `nodeIntegration`, enables sandboxing, and keeps web security enabled. If the local service is unavailable, Pulse shows a local error page instead of falling back to a remote URL.

## Visual Boundary

The cyberpunk style is intentionally limited to live surfaces: browser `/live` and Electron Desktop Pulse. Dashboard, Trust, and Review keep the calmer Claude-like audit visual system because ROI evidence needs to feel inspectable and credible. Desktop Pulse loads `/live?surface=desktop`; browser `/live` loads the same Pulse data and visual language without the tray shell.

## Release Boundary

The npm package remains the CLI/Web distribution path. Desktop release artifacts should be produced as separate GitHub Release assets after desktop smoke and privacy checks pass.
