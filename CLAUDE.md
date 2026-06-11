# Jaga Padi — Project Instructions

Electron desktop app. Smart Rice Field Monitoring (GIS + AI). RIKUB Kemdintisaintek 2025.
Stack: Electron (main/preload/renderer), vanilla JS/HTML/CSS, Leaflet + GeoTIFF (georaster),
Python microservices backend (Flask, localhost:5000/5001) — backend not in this repo.

## Tooling (project-scoped)

### ECC rules
Engineering rules live in `.claude/rules/ecc/`. Consult before writing/reviewing code:
- `common/` — coding-style, security, testing, code-review, git-workflow, performance, patterns
- `typescript/` — JS/TS specifics (this app is vanilla JS)
- `web/` — `design-quality.md` (UI/UX), performance, patterns, security for the renderer

When implementing a feature: read the relevant `common/*` + `web/*` rule first, follow it.
For UI/UX work, `web/design-quality.md` is the primary reference.

### Graphify code graph
Knowledge graph of this codebase is in `graphify-out/`:
- `graph.html` — open in browser to explore the 388-node / 797-edge graph interactively
- `GRAPH_REPORT.md` — summary + suggested queries
- `graph.json` — queryable data

Rebuild after code changes (offline, no LLM):
```
graphify update .
```
Query the graph:
```
graphify query "how does maps load GeoTIFF layers"
graphify explain "loadGeoTIFF"
graphify path "menu.html" "detectDisease"
```

## Architecture

- Entry: `package.json` main = `src/main/index.js` (BrowserWindow 1280x720, contextIsolation on, preload).
  NOTE: root `main.js` + `index.html` are a stale duplicate entry — do not use.
- Flow: `splash.html` -> `menu.html` -> {`maps.html`, `chatbot.html`, `detection.html`}.
  Multi-page nav via `window.location.href` (not SPA).
- `maps.html` — Leaflet offline tiles (`data/MapsJemberNew2/`) + GeoTIFF overlays (`data/layer/*.tif`).
- `scripts/api-client.js` — fetch wrapper to Python services; `config/api-config.js` holds endpoints.
- Color tokens: `warna.md` (green palette, primary `#567666`).

## Known issues (fix before new features)

1. `package.json` dependencies list is wrong — full of transitive deps; only `electron` is real.
2. `src/renderer/scripts/detection.js` — `detectDisease()` calls itself (name shadows api-client's
   `detectDisease`); recursion bug, never hits the API.
3. Missing data dirs referenced by `maps.html`: `data/leaflet/`, `data/MapsJemberNew2/`, `data/layer/`,
   and `styles/common.css` — maps will not render without them.
4. `maps.html` CSS typo: `height: 50 px` (line ~144).

## Conventions

- Keep renderer secure: `nodeIntegration: false`, `contextIsolation: true`. Add IPC via preload, not node in renderer.
- Match existing vanilla-JS style; no framework introduced unless requested.
- Indonesian UI copy; keep it.
