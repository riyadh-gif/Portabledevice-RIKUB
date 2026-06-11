// SmartGIS map logic. Pre-baked XYZ overlay tiles (no client-side GeoTIFF parse).
// Richer interaction: animated flyTo, marker clustering (optional plugin),
// animated popups. All compositor-friendly — light on the Pi 5 GPU.

const BASE_BOUNDS = [
  [-8.23324, 113.68652], // SW
  [-8.05923, 113.90625], // NE
];

// Overlay layers. Tile dirs are baked by tools/prebake_tiles.sh into data/tiles/<id>/.
const LAYERS = [
  { id: 'rute-its', label: 'Rute ITS', default: true },
  { id: 'sawah4-5', label: 'Sawah 4&5' },
  { id: 'sawah6', label: 'Sawah 6' },
  { id: 'sawah7', label: 'Sawah 7' },
  { id: 'sawah8', label: 'Sawah 8' },
];

const overlays = {}; // id -> { tile: L.TileLayer|null, meta: {...} }
let tileIndex = {}; // id -> { bounds, minzoom, maxzoom } from /tiles/index.json
let currentMarker = null;

const map = L.map('map', {
  maxBounds: BASE_BOUNDS,
  maxBoundsViscosity: 1.0,
  zoomControl: true,
  fadeAnimation: true,
  markerZoomAnimation: true,
}).setView([-8.14623, 113.79639], 13);

L.tileLayer('/data/MapsJemberNew2/{z}/{x}/{y}.png', {
  maxZoom: 19,
  minZoom: 14,
  attribution: 'Offline Map - Jember',
  bounds: BASE_BOUNDS,
  updateWhenIdle: true, // fewer requests while panning = lighter on Pi
  keepBuffer: 1,
}).addTo(map);

L.control.scale({ imperial: false }).addTo(map);

// ---- Overlay tiles ------------------------------------------------------

function ensureLayer(id) {
  const entry = overlays[id];
  if (entry.tile) return entry.tile;
  const meta = tileIndex[id] || {};
  entry.tile = L.tileLayer(`/tiles/${id}/{z}/{x}/{y}.png`, {
    opacity: 0.7,
    maxNativeZoom: meta.maxzoom || 19,
    minNativeZoom: meta.minzoom || 14,
    maxZoom: 19,
    bounds: meta.bounds || BASE_BOUNDS,
    updateWhenIdle: true,
    className: 'overlay-fade',
  });
  return entry.tile;
}

function toggleLayer(id) {
  const card = document.getElementById(`card-${id}`);
  const tile = ensureLayer(id);
  if (map.hasLayer(tile)) {
    map.removeLayer(tile);
    card.classList.remove('active');
  } else {
    tile.addTo(map);
    card.classList.add('active');
  }
}

function zoomToLayer(id) {
  const tile = ensureLayer(id);
  if (!map.hasLayer(tile)) {
    tile.addTo(map);
    document.getElementById(`card-${id}`).classList.add('active');
  }
  const meta = tileIndex[id];
  map.flyToBounds(meta && meta.bounds ? meta.bounds : BASE_BOUNDS, {
    duration: 0.8,
    padding: [20, 20],
  });
}

// ---- Layer panel UI -----------------------------------------------------

function buildLayerCards() {
  const container = document.getElementById('layer-cards');
  container.innerHTML = LAYERS.map((l) => `
    <div class="layer-card${l.default ? ' active' : ''}" id="card-${l.id}" onclick="toggleLayer('${l.id}')">
      <img class="layer-card-image" src="/data/icon/ruteits.png" alt="${l.label}" />
      <div class="layer-card-label">${l.label}</div>
      <button class="zoom-icon-btn" onclick="event.stopPropagation(); zoomToLayer('${l.id}');">🔍</button>
    </div>
  `).join('');
}

function toggleLayerPanel() {
  document.getElementById('layer-panel').classList.toggle('active');
}

document.addEventListener('click', (e) => {
  const container = document.querySelector('.layer-control-container');
  const panel = document.getElementById('layer-panel');
  if (panel.classList.contains('active') && !container.contains(e.target)) {
    panel.classList.remove('active');
  }
});

// ---- Photo markers ------------------------------------------------------

function loadPhotos() {
  fetch('/data/photos.json')
    .then((r) => r.json())
    .then((photos) => {
      const useCluster = typeof L.markerClusterGroup === 'function';
      const group = useCluster ? L.markerClusterGroup({ showCoverageOnHover: false }) : L.layerGroup();
      photos.forEach((photo) => {
        const photoPath = '/' + photo.file.replace(/^\/?/, ''); // data/... -> /data/...
        const popup = `
          <div style="text-align:center">
            <h4 style="margin:0 0 6px 0;font-size:13px">${photo.title}</h4>
            <img src="${photoPath}" style="width:150px;height:auto;border-radius:4px;margin-bottom:6px" loading="lazy" />
            <p style="margin:3px 0;font-size:11px;color:#666">${photo.description}</p>
            <p style="margin:3px 0;font-size:10px;color:#999">${photo.lat.toFixed(6)}, ${photo.lng.toFixed(6)}</p>
          </div>`;
        L.marker([photo.lat, photo.lng]).bindPopup(popup, { maxWidth: 180 }).addTo(group);
      });
      group.addTo(map);
    })
    .catch((err) => console.error('Error loading photos:', err));
}

// ---- Coordinate tools ---------------------------------------------------

function dropMarker(lat, lng) {
  if (currentMarker) map.removeLayer(currentMarker);
  currentMarker = L.marker([lat, lng]).addTo(map);
  currentMarker
    .bindPopup(`Latitude: ${lat.toFixed(6)}<br>Longitude: ${lng.toFixed(6)}`)
    .openPopup();
  currentMarker.on('popupclose', () => {
    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = null;
  });
}

map.on('click', (e) => dropMarker(e.latlng.lat, e.latlng.lng));

function searchCoordinate() {
  const lat = parseFloat(document.getElementById('lat-input').value);
  const lng = parseFloat(document.getElementById('lng-input').value);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    alert('Masukkan koordinat yang valid!');
    return;
  }
  dropMarker(lat, lng);
  map.flyTo([lat, lng], 18, { duration: 0.8 });
}

// Expose handlers used by inline onclick attributes.
window.toggleLayer = toggleLayer;
window.zoomToLayer = zoomToLayer;
window.toggleLayerPanel = toggleLayerPanel;
window.searchCoordinate = searchCoordinate;

// ---- Boot ---------------------------------------------------------------

buildLayerCards();

fetch('/tiles/index.json')
  .then((r) => (r.ok ? r.json() : {}))
  .then((idx) => { tileIndex = idx || {}; })
  .catch(() => { tileIndex = {}; })
  .finally(() => {
    LAYERS.filter((l) => l.default).forEach((l) => {
      overlays[l.id] = overlays[l.id] || { tile: null, meta: {} };
      ensureLayer(l.id).addTo(map);
    });
    loadPhotos();
  });

// Initialise registry entries up front so toggle works before index loads.
LAYERS.forEach((l) => { overlays[l.id] = overlays[l.id] || { tile: null, meta: {} }; });
