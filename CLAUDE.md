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

ACTIVE shell = **pywebview** (Pi 5 target). Electron tree under `src/` + root
`main.js`/`index.html` is LEGACY — kept for reference, not the run path. See `README-pi.md`.

- Entry: `app.py` — pywebview window + Flask. Serves `web/` (frontend), `data/`, `tiles/`.
  Run: `py app.py` (dev) / `python3 app.py --fullscreen` (Pi kiosk).
- Frontend: `web/` — vanilla HTML/CSS/JS, root-absolute paths (`/styles`, `/scripts`, `/data`).
  Flow: `index.html` (splash) -> `menu.html` -> {`maps.html`, `chatbot.html`, `detection.html`}.
- `web/scripts/maps.js` — Leaflet + **pre-baked XYZ overlay tiles** (`/tiles/<id>/{z}/{x}/{y}.png`).
  GeoTIFF parsing removed (was the Jetson perf killer); bake via `tools/prebake_tiles.sh`.
- `web/scripts/api-client.js` — fetch wrapper to Python AI services (chatbot :5000, detection :5001).
- `web/styles/transitions.css` — compositor-friendly animations (interactivity layer).
- `web/vendor/leaflet/` — Leaflet + MarkerCluster, offline (refetch: `tools/fetch_vendor.sh`).
- Color tokens: `warna.md` (green palette, primary `#567666`).

## Fixed during pywebview migration

- detection recursion/shadowing bug → handlers renamed `runDetection()` / `runAnalyze()`,
  API fns `detectDiseaseApi()` / `analyzeParametersApi()`.
- dropped dead `styles/common.css` ref; fixed `height: 50 px` typo.

## Still open

1. `package.json` dependencies list is wrong (transitive deps); irrelevant to pywebview build but clean up.
2. Required assets NOT in repo (must copy from source): `data/MapsJemberNew2/` (base tiles),
   `data/layer/*.tif` (overlay source), `data/icon/*`. See README-pi.md asset table.

## Conventions

- Keep renderer secure: `nodeIntegration: false`, `contextIsolation: true`. Add IPC via preload, not node in renderer.
- Match existing vanilla-JS style; no framework introduced unless requested.
- Indonesian UI copy; keep it.
