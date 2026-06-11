import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { ArrowLeft, MapPinned, Search, Layers, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const BASE_BOUNDS = [[-8.23324, 113.68652], [-8.05923, 113.90625]];
const LAYERS = [
  { id: 'rute-its', label: 'Rute ITS', default: true },
  { id: 'sawah4-5', label: 'Sawah 4&5' },
  { id: 'sawah6', label: 'Sawah 6' },
  { id: 'sawah7', label: 'Sawah 7' },
  { id: 'sawah8', label: 'Sawah 8' },
];

export function Maps() {
  const navigate = useNavigate();
  const mapDiv = useRef(null);
  const map = useRef(null);
  const overlays = useRef({});
  const tileIndex = useRef({});
  const currentMarker = useRef(null);
  const [active, setActive] = useState(() => new Set(LAYERS.filter((l) => l.default).map((l) => l.id)));
  const [panelOpen, setPanelOpen] = useState(false);
  const [coord, setCoord] = useState({ lat: '', lng: '' });

  function ensureLayer(id) {
    if (overlays.current[id]) return overlays.current[id];
    const meta = tileIndex.current[id] || {};
    const tile = L.tileLayer(`/tiles/${id}/{z}/{x}/{y}.png`, {
      opacity: 0.7, maxNativeZoom: meta.maxzoom || 19, minNativeZoom: meta.minzoom || 14,
      maxZoom: 19, bounds: meta.bounds || BASE_BOUNDS, updateWhenIdle: true,
    });
    overlays.current[id] = tile;
    return tile;
  }

  function toggleLayer(id) {
    const tile = ensureLayer(id);
    setActive((prev) => {
      const next = new Set(prev);
      if (map.current.hasLayer(tile)) { map.current.removeLayer(tile); next.delete(id); }
      else { tile.addTo(map.current); next.add(id); }
      return next;
    });
  }

  function zoomToLayer(id) {
    const tile = ensureLayer(id);
    if (!map.current.hasLayer(tile)) { tile.addTo(map.current); setActive((p) => new Set(p).add(id)); }
    const meta = tileIndex.current[id];
    map.current.flyToBounds(meta?.bounds || BASE_BOUNDS, { duration: 0.8, padding: [20, 20] });
  }

  function dropMarker(la, ln) {
    if (currentMarker.current) map.current.removeLayer(currentMarker.current);
    const m = L.marker([la, ln]).addTo(map.current);
    m.bindPopup(`Latitude: ${la.toFixed(6)}<br>Longitude: ${ln.toFixed(6)}`).openPopup();
    m.on('popupclose', () => { if (currentMarker.current) map.current.removeLayer(currentMarker.current); currentMarker.current = null; });
    currentMarker.current = m;
  }

  function search() {
    const la = parseFloat(coord.lat); const ln = parseFloat(coord.lng);
    if (Number.isNaN(la) || Number.isNaN(ln)) { alert('Masukkan koordinat yang valid!'); return; }
    dropMarker(la, ln);
    map.current.flyTo([la, ln], 18, { duration: 0.8 });
  }

  useEffect(() => {
    const m = L.map(mapDiv.current, { maxBounds: BASE_BOUNDS, maxBoundsViscosity: 1.0 }).setView([-8.14623, 113.79639], 13);
    map.current = m;
    L.tileLayer('/data/MapsJemberNew2/{z}/{x}/{y}.png', { maxZoom: 19, minZoom: 14, attribution: 'Offline Map - Jember', bounds: BASE_BOUNDS, updateWhenIdle: true, keepBuffer: 1 }).addTo(m);
    L.control.scale({ imperial: false }).addTo(m);
    m.on('click', (e) => dropMarker(e.latlng.lat, e.latlng.lng));

    fetch('/tiles/index.json').then((r) => (r.ok ? r.json() : {})).then((idx) => { tileIndex.current = idx || {}; })
      .catch(() => { tileIndex.current = {}; })
      .finally(() => { LAYERS.filter((l) => l.default).forEach((l) => ensureLayer(l.id).addTo(m)); });

    fetch('/data/photos.json').then((r) => r.json()).then((photos) => {
      const group = typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup({ showCoverageOnHover: false }) : L.layerGroup();
      photos.forEach((p) => {
        const path = '/' + p.file.replace(/^\/?/, '');
        const popup = `<div style="text-align:center"><h4 style="margin:0 0 6px;font-size:13px">${p.title}</h4><img src="${path}" style="width:150px;border-radius:4px;margin-bottom:6px" loading="lazy"/><p style="margin:3px 0;font-size:11px;color:#666">${p.description}</p><p style="margin:3px 0;font-size:10px;color:#999">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</p></div>`;
        L.marker([p.lat, p.lng]).bindPopup(popup, { maxWidth: 180 }).addTo(group);
      });
      group.addTo(m);
    }).catch((err) => console.error('photos:', err));

    return () => { m.remove(); map.current = null; };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4 shadow-sm">
        <Button variant="outline" size="sm" onClick={() => navigate('/menu')}><ArrowLeft className="h-4 w-4" /> Menu</Button>
        <div className="flex items-center gap-2"><MapPinned className="h-5 w-5 text-forest" strokeWidth={1.9} /><span className="font-bold tracking-tight">SmartGIS</span></div>
        <div className="w-[88px]" />
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* Search */}
        <div className="absolute left-4 top-4 z-[1000] rounded-2xl bg-card/95 p-4 shadow-soft backdrop-blur">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Search className="h-4 w-4 text-forest" /> Cari Koordinat</h3>
          <div className="flex items-center gap-2">
            <input className="w-32 rounded-md border border-input px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Latitude" value={coord.lat} onChange={(e) => setCoord((c) => ({ ...c, lat: e.target.value }))} />
            <input className="w-32 rounded-md border border-input px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Longitude" value={coord.lng} onChange={(e) => setCoord((c) => ({ ...c, lng: e.target.value }))} />
            <Button size="sm" onClick={search}>Cari</Button>
          </div>
        </div>

        {/* Layer control */}
        <div className="absolute right-4 top-4 z-[1000]">
          <Button size="icon" variant="outline" className="bg-card shadow-soft" onClick={() => setPanelOpen((v) => !v)} title="Layers"><Layers className="h-5 w-5" /></Button>
          {panelOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-card p-4 shadow-soft animate-fade-up">
              <div className="mb-3 text-sm font-semibold">Image Overlay</div>
              <div className="grid grid-cols-2 gap-2.5">
                {LAYERS.map((l) => (
                  <button key={l.id} onClick={() => toggleLayer(l.id)}
                    className={`relative aspect-square overflow-hidden rounded-xl border-[3px] transition-transform hover:scale-105 ${active.has(l.id) ? 'border-sky shadow-[0_2px_8px_rgba(2,132,199,0.3)]' : 'border-transparent'}`}>
                    <img src="/data/icon/ruteits.png" alt={l.label} className="h-full w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-card/95 py-1 text-center text-[11px] font-semibold">{l.label}</span>
                    <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); zoomToLayer(l.id); }}
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-card/90 shadow"><ZoomIn className="h-3.5 w-3.5" /></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
