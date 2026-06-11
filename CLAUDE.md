# Jaga Padi — Project Instructions

Smart Rice Field Monitoring (GIS + AI), target **Raspberry Pi 5** kiosk. RIKUB 2025.

**Shell = pywebview (Python + WebKitGTK). NOT Electron.** (Electron legacy removed.)

Stack: pywebview + Flask (`app.py`) serving a **React + Vite + Tailwind + shadcn/ui**
SPA (`frontend/` → built into `web/`). Inter font bundled offline. Leaflet + pre-baked
XYZ tiles for maps. AI backends are separate Python services (chatbot `:5000`,
detection `:5001`) — not in this repo; frontend calls them over HTTP.

## Architecture

- Entry: `app.py` — pywebview window + Flask. Serves `web/` (built SPA), `data/`, `tiles/`.
  Run: `python app.py` (dev) / `python3 app.py --fullscreen` (Pi kiosk).
- Frontend source: `frontend/` (Vite). **Edit here, then `npm run build` → outputs to `../web/`.**
  - `src/pages/` — Splash, Menu, Maps, Detection, Chatbot (react-router SPA).
  - `src/components/ui/` — shadcn primitives (button, card, badge); `src/lib/utils.js` (`cn`).
  - `src/api.js` — fetch wrapper to AI services.
  - `src/index.css` + `tailwind.config.js` — theme tokens.
- `web/` — committed build output (so the app runs without rebuilding). Do NOT hand-edit; rebuild.
- Maps: Leaflet + MarkerCluster (npm) + pre-baked XYZ overlay tiles (`/tiles/<id>/{z}/{x}/{y}.png`),
  baked via `tools/prebake_tiles.sh`. No client-side GeoTIFF parsing.
- Build needs `NODE_OPTIONS=--use-system-ca` if behind a corporate cert.

## Design system

Starbucks-inspired (see `../DESIGN-starbucks.md` if present): warm cream canvas, four-tier
green (`#006241` heading / `#00754A` CTA / `#1E3932` band), gold `#cba258` reserved accent,
full-pill buttons + `scale(0.95)` active, whisper shadows, Inter font (tight `-0.01em`).
Tokens in `src/index.css` (HSL CSS vars) + `tailwind.config.js` brand colors.

## Pages

- **Menu** — bento cards (featured SmartGIS + Chatbot + Detection) with cover images
  (`data/cover/*.jpg`), lucide icons, per-feature accent.
- **Chatbot** — open-webui style: multi-session sidebar (localStorage `jp-chat-sessions`),
  suggestion landing, avatar rows, auto-grow composer. Parameter analysis is an in-chat tool
  (⚙ button → form → result as assistant message). Calls `/api/chat` + `/api/analyze`.
- **Detection** — decision-support workspace: leaf image (upload/camera) + soil sensors
  (N/P/K/Na/pH/humidity/temp, simulated) → combined diagnosis. Calls `/api/detect`.
- **Splash** — snail progress loader.

## Tooling (project-scoped)

- **ECC rules** in `.claude/rules/ecc/` — consult `common/*` + `web/*` (esp `design-quality.md`)
  before UI work. (`typescript/` applies — frontend is JSX.)
- **ui-ux-pro-max** skill in `.claude/skills/` — design intelligence:
  `py .claude/skills/ui-ux-pro-max/scripts/search.py "<q>" --domain product|style|color|ux`
- **Graphify** graph in `graphify-out/` (gitignored). Rebuild: `graphify update .`

## Conventions

- Edit `frontend/` source, never `web/` directly. Rebuild to update `web/`.
- Keep React + Tailwind + shadcn idioms; semantic theme tokens (bg-background, text-forest, etc.).
- Indonesian UI copy; keep it.
- Compositor-friendly animations only (transform/opacity) — Pi GPU is weak.

## Assets NOT in repo (copy from source)

- `data/MapsJemberNew2/{z}/{x}/{y}.png` — base map tiles
- `data/layer/*.tif` — GeoTIFF overlay source (input to prebake)

## Pi 5 inference notes

UI light. Detection: lightweight quantized model (TFLite/ONNX INT8), on-demand. LLM chatbot:
offload to server/cloud (don't run locally on 2GB). Sensor fusion: trivial.
