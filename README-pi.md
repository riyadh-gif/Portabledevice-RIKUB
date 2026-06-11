# Jaga Padi — pywebview build (Raspberry Pi 5)

Lightweight replacement for the Electron shell. Same UI, far lower RAM/CPU:
system WebKitGTK webview + a tiny Flask server, one process, no bundled Chromium,
no Node. Built for a 2GB Pi 5 running the Python AI services alongside it.

## Architecture

```
app.py            pywebview window + Flask (serves web/, data/, tiles/)
web/              frontend (vanilla HTML/CSS/JS — reused from the Electron UI)
  index.html      splash -> menu
  menu.html maps.html detection.html chatbot.html
  styles/         page CSS + transitions.css (animations)
  scripts/        api-client, maps, detection, chatbot
  vendor/leaflet/ Leaflet + MarkerCluster (offline)
data/             icons, hama photos, base map tiles, baked overlay tiles
tools/            prebake_tiles.sh, fetch_vendor.sh
```

The detection (`:5001`) and chatbot (`:5000`) AI services stay as **separate
Python processes**. The frontend calls them over HTTP — see `web/scripts/api-client.js`.

## Why not Electron / Tauri / Next.js

- **Electron** — bundles Chromium + Node per app; too heavy for a 2GB Pi.
- **Tauri / PyTauri** — same WebKitGTK render as pywebview (no lighter at runtime),
  but add a Rust build on arm64 and keep Python as a separate process. No payoff here.
- **Next.js** — adds a React runtime + (SSR) Node process. Heavier, not lighter.
- **pywebview** — same language as the backend, `pip` install, no compile. Chosen.

UI interactivity (animations, richer maps) is **frontend** work and is identical
across all shells — it does not depend on the wrapper.

## First-time setup (Raspberry Pi OS / Debian)

```bash
sudo apt update
sudo apt install -y python3-gi python3-gi-cairo gir1.2-gtk-3.0 \
                    gir1.2-webkit2-4.1 libcairo2-dev gdal-bin jq curl
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Required assets (NOT in the repo)

These are large/binary and must be copied from the original data source:

| Path | What |
|------|------|
| `data/MapsJemberNew2/{z}/{x}/{y}.png` | offline base map tiles |
| `data/layer/*.tif` | source GeoTIFF overlays (input to prebake) |
| `data/icon/*` | menu/layer icons (maps.png, deteksi.jpeg, ruteits.png) |

`web/vendor/leaflet/` is already vendored. To refetch: `bash tools/fetch_vendor.sh`.

## Pre-bake the overlays (do this once)

The old build parsed GeoTIFF in the browser (`georaster.js`) every time a layer
loaded — the main reason it was heavy on Jetson. Now we bake tiles ahead of time:

```bash
bash tools/prebake_tiles.sh
# -> data/tiles/<layer>/{z}/{x}/{y}.png  +  data/tiles/index.json
```

At runtime the webview just loads static PNGs (near-zero CPU). If `data/tiles/`
is absent the map still runs; overlays simply won't show until baked.

## Run

```bash
python3 app.py                 # windowed (dev)
python3 app.py --fullscreen    # kiosk (Pi 5)
```

### Autostart kiosk on boot (systemd user service)

```ini
# ~/.config/systemd/user/jagapadi.service
[Unit]
Description=Jaga Padi kiosk
After=graphical-session.target

[Service]
WorkingDirectory=%h/jaga-padi
ExecStart=%h/jaga-padi/.venv/bin/python app.py --fullscreen
Restart=on-failure

[Install]
WantedBy=default.target
```
```bash
systemctl --user enable --now jagapadi.service
```

## Windows dev

`py app.py` works using EdgeChromium WebView2 instead of WebKitGTK — handy for
UI iteration. Map base tiles / overlays still need the asset dirs above.
