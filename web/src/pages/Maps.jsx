import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  ArrowLeft,
  MapPinned,
  Search,
  Layers,
  LocateFixed,
  Loader2,
  MapPin,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createLocationMarker } from "@/components/maps/locationPopup";

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const BASE_BOUNDS = [
  [-8.23324, 113.68652],
  [-8.05923, 113.90625],
];
const BASE_LAYERS = {
  default: {
    label: "Default",
    preview: "https://a.tile.openstreetmap.org/5/26/16.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    maxZoom: 24,
  },
  satellite: {
    label: "Satelit",
    preview:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/16/26",
    attribution: "Tiles &copy; Esri",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 18,
    maxZoom: 24,
  },
  terrain: {
    label: "Terrain",
    preview: "https://a.tile.opentopomap.org/5/16/26.png",
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 17,
    maxZoom: 24,
  },
};
const MAP_DETAIL_LAYERS = [
  {
    id: "rgb",
    label: "RGB",
    className: "bg-gradient-to-br from-sky-100 to-cyan-100 text-blue-700",
  },
  {
    id: "ndvi",
    label: "NDVI",
    className:
      "bg-gradient-to-br from-emerald-100 to-lime-100 text-emerald-700",
  },
];

export function Maps() {
  const navigate = useNavigate();
  const mapDiv = useRef(null);
  const map = useRef(null);
  const baseLayers = useRef({});
  const currentBaseLayer = useRef(null);
  const overlays = useRef({});
  const tileIndex = useRef({});
  const currentMarker = useRef(null);
  const userLocationMarker = useRef(null);
  const userLocationCircle = useRef(null);
  const searchTimeout = useRef(null);
  const [baseLayer, setBaseLayerState] = useState("satellite");
  const [active, setActive] = useState(() => new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locating, setLocating] = useState(false);

  function ensureBaseLayer(id) {
    if (baseLayers.current[id]) return baseLayers.current[id];
    const meta = BASE_LAYERS[id];
    const tile = L.tileLayer(meta.url, {
      attribution: meta.attribution,
      maxNativeZoom: meta.maxNativeZoom,
      maxZoom: meta.maxZoom,
      updateWhenIdle: true,
      keepBuffer: 1,
    });
    baseLayers.current[id] = tile;
    return tile;
  }

  function setBaseLayer(id) {
    if (!map.current || id === currentBaseLayer.current) return;
    if (currentBaseLayer.current) {
      map.current.removeLayer(ensureBaseLayer(currentBaseLayer.current));
    }
    ensureBaseLayer(id).addTo(map.current);
    currentBaseLayer.current = id;
    setBaseLayerState(id);
  }

  function ensureLayer(id) {
    if (overlays.current[id]) return overlays.current[id];
    const meta = tileIndex.current[id] || {};
    const tile = L.tileLayer(`/tiles/${id}/{z}/{x}/{y}.png`, {
      opacity: 0.7,
      maxNativeZoom: meta.maxzoom || 19,
      minNativeZoom: meta.minzoom || 14,
      maxZoom: 19,
      bounds: meta.bounds || BASE_BOUNDS,
      updateWhenIdle: true,
    });
    overlays.current[id] = tile;
    return tile;
  }

  function toggleLayer(id) {
    const tile = ensureLayer(id);
    setActive((prev) => {
      const next = new Set(prev);
      if (map.current.hasLayer(tile)) {
        map.current.removeLayer(tile);
        next.delete(id);
      } else {
        tile.addTo(map.current);
        next.add(id);
      }
      return next;
    });
  }

  function dropMarker(la, ln) {
    if (currentMarker.current) map.current.removeLayer(currentMarker.current);
    let isRemoving = false;
    let m;
    const removeMarker = () => {
      if (isRemoving) return;
      isRemoving = true;
      if (currentMarker.current === m) currentMarker.current = null;
      if (map.current?.hasLayer(m)) map.current.removeLayer(m);
      isRemoving = false;
    };

    m = createLocationMarker({
      lat: la,
      lng: ln,
      onClose: removeMarker,
    }).addTo(map.current);
    m.openPopup();
    m.on("remove", () => {
      currentMarker.current = null;
    });
    currentMarker.current = m;
  }

  function moveToPlace(place) {
    if (!map.current || !place) return;
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    if (place.boundingbox) {
      map.current.fitBounds(
        [
          [parseFloat(place.boundingbox[0]), parseFloat(place.boundingbox[2])],
          [parseFloat(place.boundingbox[1]), parseFloat(place.boundingbox[3])],
        ],
        { animate: true, duration: 1 },
      );
    } else {
      map.current.flyTo([lat, lng], 15, { duration: 1 });
    }
    dropMarker(lat, lng);
  }

  async function fetchSuggestions(searchText) {
    const q = searchText.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=id`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("suggestions:", err);
    }
  }

  function handleSearchInput(e) {
    const value = e.target.value;
    setQuery(value);
    setSearchError("");
    setShowSuggestions(true);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchSuggestions(value), 400);
  }

  function selectSuggestion(place) {
    setQuery(place.display_name);
    setShowSuggestions(false);
    setSuggestions([]);
    moveToPlace(place);
  }

  async function searchLocation(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q || !map.current) return;

    if (showSuggestions && suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }

    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setSearchError("Lokasi tidak ditemukan");
        return;
      }

      moveToPlace(data[0]);
      setShowSuggestions(false);
      setSuggestions([]);
    } catch (err) {
      console.error("search:", err);
      setSearchError("Gagal mencari lokasi");
    } finally {
      setSearching(false);
    }
  }

  function zoomIn() {
    map.current?.zoomIn();
  }

  function zoomOut() {
    map.current?.zoomOut();
  }

  function locateUser() {
    if (!map.current || !navigator.geolocation) {
      alert("Browser tidak mendukung geolocation.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = [position.coords.latitude, position.coords.longitude];
        const accuracy = position.coords.accuracy;

        if (userLocationMarker.current)
          map.current.removeLayer(userLocationMarker.current);
        if (userLocationCircle.current)
          map.current.removeLayer(userLocationCircle.current);

        const icon = L.divIcon({
          className: "",
          iconSize: [40, 40],
          iconAnchor: [20, 20],
          html: '<div class="relative flex h-10 w-10 items-center justify-center"><div class="absolute h-10 w-10 animate-ping rounded-full bg-[#4B7C63]/35"></div><div class="absolute h-7 w-7 rounded-full bg-[#4B7C63]/20"></div><div class="relative h-4 w-4 rounded-full border-2 border-white bg-[#4B7C63] shadow-[0_4px_14px_rgba(15,23,42,0.35)]"></div></div>',
        });

        userLocationCircle.current = L.circle(latlng, {
          radius: accuracy,
          color: "#4B7C63",
          fillColor: "#4B7C63",
          fillOpacity: 0.12,
          opacity: 0.35,
          weight: 1,
        }).addTo(map.current);
        userLocationMarker.current = L.marker(latlng, {
          icon,
          interactive: false,
        }).addTo(map.current);
        map.current.flyTo(latlng, 17, { duration: 1 });
        setLocating(false);
      },
      () => {
        setLocating(false);
        alert("Tidak dapat menemukan lokasi. Pastikan izin lokasi aktif.");
      },
      { enableHighAccuracy: true },
    );
  }

  useEffect(() => {
    const m = L.map(mapDiv.current, {
      maxBounds: BASE_BOUNDS,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
      maxZoom: 24,
    }).setView([-8.14623, 113.79639], 13);
    map.current = m;
    ensureBaseLayer("satellite").addTo(m);
    currentBaseLayer.current = "satellite";
    L.control.scale({ imperial: false }).addTo(m);
    m.on("click", (e) => dropMarker(e.latlng.lat, e.latlng.lng));

    fetch("/tiles/index.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((idx) => {
        tileIndex.current = idx || {};
      })
      .catch(() => {
        tileIndex.current = {};
      })
      .finally(() => {});

    fetch("/data/photos.json")
      .then((r) => r.json())
      .then((photos) => {
        const group =
          typeof L.markerClusterGroup === "function"
            ? L.markerClusterGroup({ showCoverageOnHover: false })
            : L.layerGroup();
        photos.forEach((p) => {
          const path = "/" + p.file.replace(/^\/?/, "");
          const popup = `<div style="text-align:center"><h4 style="margin:0 0 6px;font-size:13px">${p.title}</h4><img src="${path}" style="width:150px;border-radius:4px;margin-bottom:6px" loading="lazy"/><p style="margin:3px 0;font-size:11px;color:#666">${p.description}</p><p style="margin:3px 0;font-size:10px;color:#999">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</p></div>`;
          L.marker([p.lat, p.lng])
            .bindPopup(popup, { maxWidth: 180 })
            .addTo(group);
        });
        group.addTo(m);
      })
      .catch((err) => console.error("photos:", err));

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      m.remove();
      map.current = null;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4 shadow-sm">
        <Button variant="outline" size="sm" onClick={() => navigate("/menu")}>
          <ArrowLeft className="h-4 w-4" /> Menu
        </Button>
        <div className="flex items-center gap-2">
          <MapPinned className="h-5 w-5 text-forest" strokeWidth={1.9} />
          <span className="font-bold tracking-tight">SmartGIS</span>
        </div>
        <div className="w-[88px]" />
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* Search */}
        <div className="absolute left-4 right-4 top-4 z-[1000] sm:right-auto sm:w-[360px]">
          <form
            onSubmit={searchLocation}
            className={`flex h-[52px] items-center bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] focus-within:shadow-[0_8px_30px_rgba(0,0,0,0.16)] ${
              showSuggestions && suggestions.length > 0
                ? "rounded-t-[20px] rounded-b-none border-b border-gray-100"
                : "rounded-[20px]"
            }`}
          >
            <div className="pl-5 pr-3 text-forest">
              <MapPin className="h-[22px] w-[22px]" strokeWidth={1.7} />
            </div>
            <input
              type="text"
              value={query}
              onChange={handleSearchInput}
              onFocus={() => {
                if (query.trim()) setShowSuggestions(true);
              }}
              onBlur={() => {
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              placeholder="Cari lokasi lahan..."
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-gray-800 outline-none placeholder:text-gray-400"
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="mr-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-forest text-white transition-colors hover:bg-house disabled:bg-gray-200 disabled:text-gray-400"
              title="Cari lokasi"
            >
              {searching ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <Search className="h-[18px] w-[18px]" />
              )}
            </button>
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-[1001] w-full overflow-hidden rounded-b-[20px] bg-white shadow-[0_16px_30px_rgba(0,0,0,0.12)]">
              {suggestions.map((place, index) => {
                const [title, ...rest] = place.display_name.split(",");
                return (
                  <button
                    key={`${place.place_id ?? index}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(place)}
                    className="flex w-full items-start gap-3 border-t border-gray-100 px-5 py-3 text-left transition-colors hover:bg-emerald-50/60"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-800">
                        {title}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {rest.join(",").trim()}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {searchError && (
            <div className="mt-3 inline-flex rounded-full bg-red-950/80 px-4 py-2 text-xs font-semibold text-red-100 shadow-lg">
              {searchError}
            </div>
          )}
        </div>

        {/* Zoom controls */}
        <div className="absolute right-4 top-4 z-[1000] overflow-hidden rounded-[16px] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <button
            onClick={zoomIn}
            className="grid h-12 w-12 place-items-center text-forest transition-colors hover:bg-gray-50"
            title="Perbesar peta"
          >
            <Plus className="h-5 w-5" />
          </button>
          <div className="h-px bg-gray-100" />
          <button
            onClick={zoomOut}
            className="grid h-12 w-12 place-items-center text-forest transition-colors hover:bg-gray-50"
            title="Perkecil peta"
          >
            <Minus className="h-5 w-5" />
          </button>
        </div>

        {/* Layer control */}
        <div className="absolute right-4 top-[120px] z-[1000]">
          <Button
            size="icon"
            variant="outline"
            className="h-12 w-12 rounded-[16px] border-0 bg-white text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:bg-gray-50"
            onClick={() => setPanelOpen((v) => !v)}
            title="Layers"
          >
            <Layers className="h-5 w-5" />
          </Button>
          {panelOpen && (
            <div className="absolute right-0 mt-2 w-[340px] rounded-2xl bg-card p-4 shadow-soft animate-fade-up">
              <div className="mb-3 text-[15px] font-bold text-foreground">
                Map type
              </div>
              <div className="mb-4 grid grid-cols-3 gap-3">
                {Object.entries(BASE_LAYERS).map(([id, layer]) => (
                  <button
                    key={id}
                    onClick={() => setBaseLayer(id)}
                    className={`group flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-xs font-semibold transition-colors hover:bg-muted ${baseLayer === id ? "text-forest" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`block h-[60px] w-[60px] overflow-hidden rounded-xl border-[3px] ${baseLayer === id ? "border-leaf" : "border-border"}`}
                    >
                      <img
                        src={layer.preview}
                        alt={layer.label}
                        className="h-full w-full object-cover"
                      />
                    </span>
                    {layer.label}
                  </button>
                ))}
              </div>

              <div className="mb-3 border-t border-border pt-3 text-[15px] font-bold text-foreground">
                Map details
              </div>
              <div className="grid grid-cols-4 gap-3">
                {MAP_DETAIL_LAYERS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => toggleLayer(l.id)}
                    className={`group flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-xs font-semibold transition-colors hover:bg-muted ${active.has(l.id) ? "text-forest" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`grid h-[60px] w-[60px] place-items-center rounded-xl border-[3px] ${active.has(l.id) ? "border-leaf" : "border-border"} ${l.className}`}
                    >
                      <span className="text-sm font-black tracking-wide">
                        {l.label}
                      </span>
                    </span>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Locate user */}
        <button
          onClick={locateUser}
          disabled={locating}
          className="absolute bottom-6 right-4 z-[1000] grid h-12 w-12 place-items-center rounded-[16px] bg-white text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-colors hover:bg-gray-50 disabled:text-gray-400"
          title="Lokasi saya"
        >
          {locating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <LocateFixed className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
