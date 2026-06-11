#!/usr/bin/env bash
# Download Leaflet + MarkerCluster into web/vendor/leaflet/ (offline assets).
# Run once with internet; afterwards the app runs fully offline.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$ROOT/web/vendor/leaflet"
mkdir -p "$V/images"

LEAFLET="1.9.4"
CLUSTER="1.5.3"
base_l="https://unpkg.com/leaflet@${LEAFLET}/dist"
base_c="https://unpkg.com/leaflet.markercluster@${CLUSTER}/dist"

dl() { echo "GET $1"; curl -fsSL "$1" -o "$2"; }

dl "$base_l/leaflet.js"  "$V/leaflet.js"
dl "$base_l/leaflet.css" "$V/leaflet.css"
for img in marker-icon.png marker-icon-2x.png marker-shadow.png layers.png layers-2x.png; do
  dl "$base_l/images/$img" "$V/images/$img"
done

dl "$base_c/leaflet.markercluster.js" "$V/leaflet.markercluster.js"
dl "$base_c/MarkerCluster.css"         "$V/MarkerCluster.css"
dl "$base_c/MarkerCluster.Default.css" "$V/MarkerCluster.Default.css"

echo "DONE  vendored Leaflet ${LEAFLET} + MarkerCluster ${CLUSTER}"
