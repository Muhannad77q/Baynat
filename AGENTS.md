# AGENTS.md

## Cursor Cloud specific instructions

Baynat is a single vanilla-JS product (no framework, no build step for runtime) served by one raw Node.js HTTP server (`server.js`). Two frontends share it: `/` (supervisor dashboard: `index.html`, `app.js`) and `/student.html` (student view: `student.js`). See `README.md` (Arabic) for product details.

Standard commands live in `package.json` scripts; don't duplicate them here. Key ones: `npm run dev` (dev server with `--watch`, serves on port `5173`), `npm test` (Node built-in test runner), `npm run build` (copies static assets into `dist/` for Netlify). There is no lint tooling configured.

Non-obvious caveats:
- Requires Node `>=22` (already provisioned).
- Local dev runs in "Node mode" and needs **no database** — state persists to `.data/baynat.json` (gitignored). The Netlify Postgres path (`@netlify/database`, `netlify/functions/api.mjs`) is a separate deploy target and is not needed to run or test locally.
- To bootstrap the first supervisor you need the **setup key**, which is auto-generated and printed to the dev server log on startup (line `Baynat supervisor setup key: ...`). Grab it from the running process's stdout. You can also pin it via the `BAYNAT_SETUP_KEY` env var. It is erased from state after the first supervisor is created.
- Both supervisor login and student access require a browser-side proof-of-work challenge, so end-to-end flows are easiest to exercise through the browser UI (not raw curl). Difficulty defaults are low in dev (`BAYNAT_SUPERVISOR_DIFFICULTY=16`, `BAYNAT_ACCESS_DIFFICULTY=20`).
- Run only one Node process per data file; a `.lock` file next to the data file prevents a second process from starting. After an unclean shutdown only, ensure no process is running before deleting a stale `.lock`.
