#!/usr/bin/env bash
# Pre-bake GeoTIFF overlays into XYZ PNG tile pyramids.
#
# This moves the heavy raster work OFF the device: instead of parsing GeoTIFF in
# the browser at runtime (old georaster.js path), the webview just loads static
# PNG tiles. Run once on any machine with GDAL (or on the Pi itself).
#
#   sudo apt install -y gdal-bin jq        # Raspberry Pi OS / Debian
#   ./tools/prebake_tiles.sh
#
# Output: data/tiles/<layer>/{z}/{x}/{y}.png  +  data/tiles/index.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/data/layer"
OUT="$ROOT/data/tiles"
ZOOM="14-19"

# source GeoTIFF  ->  web layer id (must match LAYERS in web/scripts/maps.js)
declare -A LAYERS=(
  ["rute_its_clipped_custom.tif"]="rute-its"
  ["sawah4&5_clipped_noutm.tif"]="sawah4-5"
  ["sawah6_clipped_noutm.tif"]="sawah6"
  ["sawah7_clipped_noutm.tif"]="sawah7"
  ["sawah8_clipped_noutm.tif"]="sawah8"
)

command -v gdal2tiles.py >/dev/null 2>&1 || { echo "ERROR: gdal2tiles.py not found. Install gdal-bin."; exit 1; }
mkdir -p "$OUT"

INDEX="{"
first=1
for tif in "${!LAYERS[@]}"; do
  id="${LAYERS[$tif]}"
  path="$SRC/$tif"
  if [[ ! -f "$path" ]]; then
    echo "SKIP  $tif (not found in data/layer/)"
    continue
  fi
  echo "BAKE  $tif -> data/tiles/$id/ (z $ZOOM)"
  # --xyz => Leaflet-native scheme (no tms:true needed). -w none => no leaflet/ol viewer.
  gdal2tiles.py --xyz -z "$ZOOM" -w none -r bilinear "$path" "$OUT/$id" >/dev/null

  # WGS84 extent for fitBounds: [[south,west],[north,east]]
  if command -v jq >/dev/null 2>&1; then
    ext="$(gdalinfo -json "$path" | jq -c '.wgs84Extent.coordinates[0]')"
    west=$(echo "$ext"  | jq 'map(.[0]) | min')
    east=$(echo "$ext"  | jq 'map(.[0]) | max')
    south=$(echo "$ext" | jq 'map(.[1]) | min')
    north=$(echo "$ext" | jq 'map(.[1]) | max')
    bounds="[[${south},${west}],[${north},${east}]]"
  else
    bounds="null"
  fi

  [[ $first -eq 0 ]] && INDEX="$INDEX,"
  first=0
  INDEX="$INDEX\"$id\":{\"bounds\":$bounds,\"minzoom\":14,\"maxzoom\":19}"
done
INDEX="$INDEX}"

echo "$INDEX" > "$OUT/index.json"
echo "DONE  wrote data/tiles/index.json"
