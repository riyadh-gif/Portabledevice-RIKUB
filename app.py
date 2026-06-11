"""Jaga Padi - pywebview shell (Raspberry Pi 5 target).

Replaces the Electron shell. Serves the static frontend in web/ and the asset
tree in data/ through a tiny Flask app, then renders it in a system WebKitGTK
webview (EdgeChromium on Windows during dev). Far lighter than Electron:
no bundled Chromium, no Node runtime, one process shared with Python backend.

Run:
    py app.py                # windowed (dev)
    python3 app.py --fullscreen   # kiosk on Pi 5

The AI services (detection :5001, chatbot :5000) stay as separate Python
processes; the frontend talks to them over HTTP exactly as before.
"""
import argparse
import mimetypes
import os

from flask import Flask, abort, send_from_directory

# Ensure correct MIME for ES modules / wasm if added later
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("image/png", ".png")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DATA_DIR = os.path.join(BASE_DIR, "data")
TILES_DIR = os.path.join(DATA_DIR, "tiles")  # pre-baked overlay tiles (see tools/prebake_tiles.sh)

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/<path:filename>")
def web_files(filename):
    """Serve built SPA assets; fall back to index.html for client routes."""
    full = os.path.join(WEB_DIR, filename)
    if os.path.isfile(full):
        return send_from_directory(WEB_DIR, filename)
    # SPA history fallback: route-like paths (no file extension) -> index.html.
    if "." not in os.path.basename(filename):
        return send_from_directory(WEB_DIR, "index.html")
    abort(404)


@app.route("/data/<path:filename>")
def data_files(filename):
    """Serve the asset tree: icons, hama photos, base map tiles, photos.json."""
    return send_from_directory(DATA_DIR, filename)


@app.route("/tiles/<path:filename>")
def tile_files(filename):
    """Serve pre-baked GeoTIFF overlay tiles (XYZ scheme)."""
    return send_from_directory(TILES_DIR, filename)


@app.after_request
def cache_headers(resp):
    # Tiles are immutable once baked: cache hard so the webview doesn't re-decode.
    if "/tiles/" in (resp.headers.get("Content-Location") or "") or resp.mimetype == "image/png":
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


def main():
    parser = argparse.ArgumentParser(description="Jaga Padi pywebview shell")
    parser.add_argument("--fullscreen", action="store_true", help="kiosk fullscreen (Pi 5)")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    args = parser.parse_args()

    import webview  # imported here so Flask routes can be reused/tested without webview

    webview.create_window(
        "Jaga Padi",
        app,                       # pywebview runs the Flask WSGI app (server mode)
        width=args.width,
        height=args.height,
        fullscreen=args.fullscreen,
        text_select=False,
    )
    # GTK on Pi = WebKitGTK; Windows dev = EdgeChromium. private_mode off keeps tile cache.
    webview.start(private_mode=False)


if __name__ == "__main__":
    main()
