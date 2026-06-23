# Public Launch Checklist

Use this checklist before pushing a public GitHub release or publishing an npm package.

## Required Commands

```bash
npm test
npm run build
npm run privacy:check
npm run pricing:update
node src/cli.mjs privacy-check --include-untracked
node src/cli.mjs coverage --sources=claude,codex,cursor --json
npm view token-work version
npm audit --audit-level=low
npm run smoke:npx
npm run smoke:browser
npm run desktop:smoke
npm pack --dry-run
git diff --check
```

## Screenshots

Public README screenshots:

- Use `npx token-work demo` after npm publication, or `npm run demo` from a cloned repository.
- Confirm the UI shows Demo Mode.
- Do not use real `data/usage.sqlite`.
- Do not include real project paths, local usernames, exported reports, or private output URLs.
- Current public screenshot assets:
  - `docs/assets/token-work-dashboard.png`
  - `docs/assets/token-work-trust.png`
  - `docs/assets/token-work-review.png`
  - `docs/assets/token-work-live-pulse.png`

Real local validation screenshots:

- May contain model names, project aliases, and aggregate token counts from a real local SQLite.
- Must not contain prompt, response, transcript, diff, full local path, local username, private output URL, or exported report content.
- Assets to inspect before sharing:
  - `docs/assets/token-work-real-dashboard.png`
  - `docs/assets/token-work-real-trust.png`
  - `docs/assets/token-work-real-review.png`
  - `docs/assets/token-work-real-live.png`

## GitHub Release

- Repository name: `token-work-roi`.
- Current local version: `v1.0.0`.
- Suggested topics: `ai-coding`, `token-usage`, `cost-tracking`, `local-first`, `privacy-first`, `roi`, `codex-cli`, `claude-code`.
- Release notes should say cost is official public token-price conversion, not a provider invoice.
- Release notes must not claim complete historical coverage. Say Token Work covers local history that still exists and contains reliable token fields, with `coverage` reporting gaps and reasons.
- Keep `NOTICE.md` in the repository.

## npm

- Primary package name: `token-work`.
- Fallback package name if unavailable: `tokenroi`.
- Primary one-command real-data path: `npx token-work`.
- Demo-only path: `npx token-work demo`.
- Troubleshooting path: `npx token-work --dry-run-only`, then `npx token-work --no-collect` if you only want to inspect the current SQLite.
- Do not publish until `npm pack --dry-run` shows no SQLite databases, logs, `.env`, `.claude`, `.codex`, `dist`, or `node_modules`.
- Do not publish until the tarball includes `data/official-pricing.json`, `LICENSE`, `COMMERCIAL-LICENSE.md`, `NOTICE.md`, `PRIVACY.md`, and no deprecated pricing cache files.
- Do not publish until `npm run smoke:npx` passes. This command installs the packed tarball in a fresh temp directory, runs the installed CLI, verifies event-level fixture collection, verifies UI/API readiness, and checks the auto-attribution proxy path.
- Do not publish until `npm run smoke:browser` passes on at least one Chromium-capable runner. This catches Dashboard `ReferenceError`, React duplicate-key warnings, and UI-port `/api` proxy connection failures.
- Do not publish until `token-work coverage` shows Claude/Codex event-level rows or explains why they are unavailable. Cursor detected-only must not be marketed as successful native usage collection.
- If the package name is unavailable, publish the fallback only after updating README, package metadata, and release notes consistently.
- `npm whoami` must succeed before running `npm publish --access public`.
- After publish, run `npm run smoke:published -- --version 1.0.0` and verify npm latest resolves to `1.0.0`.
- If using GitHub Trusted Publishing, trigger `.github/workflows/publish-npm.yml` manually only after `release-gate` is green.

## Pricing Refresh

- `.github/workflows/update-pricing.yml` must run weekly at Monday 00:01 Asia/Shanghai (`1 16 * * 0` in UTC).
- `npm run pricing:update` must fetch provider-owned pricing pages, write `data/official-pricing.json`, and update `src/pricing.mjs` only after at least one official source succeeds.
- If all official sources fail, the workflow should fail and leave the existing cache and built-in table unchanged.
- RMB prices may be converted to internal USD cost math using the captured USD/CNY refresh rate, but README/release notes must keep the “not a provider invoice” boundary.

## Licensing

- `package.json` must use `AGPL-3.0-only`.
- `LICENSE` must contain GNU Affero General Public License v3.0.
- `COMMERCIAL-LICENSE.md` must explain the commercial dual-license path for closed-source distribution, proprietary hosted services, and private modifications outside AGPL obligations.
- `NOTICE.md` must not contain obsolete attribution wording.
