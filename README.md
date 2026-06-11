# Jaga Padi — Portable Device (RIKUB)

Smart Rice Field Monitoring System. Aplikasi monitoring sawah: **SmartGIS** (peta/GIS),
**Chatbot AI** (asisten pertanian), dan **Deteksi Penyakit** (citra daun + sensor tanah).
Target perangkat: **Raspberry Pi 5** (kiosk).

> **Shell = pywebview (Python + WebKitGTK). BUKAN Electron.**
> Folder Electron lama (`main.js`, `index.html`, `src/`, dep `electron` di `package.json`)
> adalah **legacy/arsip** — tidak dipakai pada run path saat ini.

## Tech Stack

| Lapisan | Teknologi |
|---|---|
| Shell desktop | **pywebview** (WebKitGTK di Pi, EdgeChromium di Windows dev) |
| Web server lokal | **Flask** (`app.py`) — serve `web/`, `data/`, `tiles/` |
| Frontend | **React + Vite + Tailwind CSS + shadcn/ui** (`frontend/`) |
| Font | Inter (di-bundle offline) |
| Peta | Leaflet + MarkerCluster (tile PNG pre-baked) |
| Backend AI | Python microservices terpisah — chatbot `:5000`, detection `:5001` |

Run path: `app.py` (pywebview + Flask) → serve `web/` (hasil build React).

## Struktur

```
app.py                # pywebview + Flask (entry)
requirements.txt
web/                  # hasil build frontend (di-serve Flask) — commit, siap pakai
frontend/             # sumber React/Vite (edit di sini, lalu build ke ../web)
  src/pages/          # Splash, Menu, Maps, Detection, Chatbot
  src/components/ui/  # shadcn (button, card, badge)
data/                 # icon, cover, hama, photos.json, (tiles & base map = lihat catatan)
tools/                # prebake_tiles.sh, fetch_vendor.sh
README-pi.md          # setup & autostart kiosk Raspberry Pi 5
```

## Menjalankan (Windows / dev)

```bash
# 1. Build frontend
cd frontend
npm install            # jika kena corporate cert: set NODE_OPTIONS=--use-system-ca dulu
npm run build          # output ke ../web

# 2. Jalankan shell pywebview (dari root project)
cd ..
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
python app.py                   # jendela app
```

Iterasi cepat UI: `cd frontend && npm run dev` (hot reload, buka di browser).

## Menjalankan (Raspberry Pi 5 / kiosk)

Lihat **`README-pi.md`** — termasuk apt deps WebKitGTK, prebake tiles (gdal), dan
autostart systemd. Ringkas:

```bash
sudo apt install -y python3-gi gir1.2-webkit2-4.1 gdal-bin jq
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 app.py --fullscreen
```

## Catatan aset (tidak ada di repo)

Besar/binari, salin manual dari sumber data asli:

| Path | Isi |
|---|---|
| `data/MapsJemberNew2/{z}/{x}/{y}.png` | tile peta dasar offline |
| `data/layer/*.tif` | GeoTIFF overlay (input prebake → `tools/prebake_tiles.sh`) |

Tanpa ini, halaman Maps tetap jalan tetapi area peta kosong.

## Inferensi AI di Pi 5 (ringkas)

- **UI**: ringan (SPA statik + pywebview).
- **Deteksi penyakit**: ringan jika model lightweight + quantized (TFLite/ONNX INT8),
  on-demand. Ideal 4/8GB atau pakai AI Kit (Hailo).
- **Chatbot LLM**: **jangan lokal di Pi 2GB** — offload ke server/cloud lewat service `:5000`.
- **Fusi sensor tanah** (N/P/K/Na/pH/kelembapan/suhu): ringan.

## Author

RIKUB Kemdintisaintek 2025
