# Token Work ROI Demo Flow

This flow is for public GitHub screenshots, blog posts, and resume walkthroughs.

## 1. Start Synthetic Demo

```bash
npm install
npm run demo
```

The demo command seeds `data/demo.sqlite` from `docs/demo-data/token-work-demo.json` and starts the local UI.

## 2. Show The Story

1. Open the dashboard and point out the `Demo Mode` badge.
2. Show source/model filtering and project/session attribution.
3. Open `/review`.
4. Show ROI Evidence Score before the detailed sections.
5. Show ROI Advisor and model strategy.
6. Export the Markdown review report.
7. Open `/api/model-policy.md` to show the generated model policy.

## 3. Privacy Script

Run:

```bash
npm run privacy:check
```

The public demo should not include real SQLite databases, local AI log directories, `.env` files, generated exports, personal paths, or raw conversation content.

## Demo Boundary

- Synthetic demo data is not real usage history.
- Real local mode requires explicit collection confirmation.
- Token Work ROI does not read conversation content.
- Official-price conversion is not a provider invoice.
