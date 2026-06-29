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
  Drone,
  X,
  Minus,
  Plus,
  Sprout,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Info,
  Trash2,
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
    preview: "https://a.tile.opentopomap.org/5/26/16.png",
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 17,
    maxZoom: 24,
  },
};
const MAP_IMAGERY_LAYERS = [
  {
    id: "rgb",
    label: "RGB",
    preview: "/data/layer/RGB_layer_thumb.png",
    className: "bg-gradient-to-br from-sky-100 to-cyan-100 text-blue-700",
  },
  {
    id: "ndvi",
    label: "NDVI",
    preview: "/data/layer/NDVI_layer_thumb.png",
    className:
      "bg-gradient-to-br from-emerald-100 to-lime-100 text-emerald-700",
  },
];
const MAP_ANALYSIS_LAYERS = [
  {
    id: "ndvi-zones",
    label: "NDVI Zones",
    shortLabel: "Zones",
    preview: "/data/layer/NDVI_zones_layer_thumb.png",
    className: "bg-gradient-to-br from-amber-100 to-red-100 text-amber-800",
  },
  {
    id: "spray-targets",
    label: "Spray Targets",
    shortLabel: "Target",
    preview: "/data/layer/spray_targets_layer_thumb.png",
    className: "bg-gradient-to-br from-rose-100 to-pink-100 text-rose-700",
  },
  {
    id: "spraying-route",
    label: "Spraying Route",
    shortLabel: "Route",
    preview: "/data/layer/spraying_route_layer_thumb.png",
    className: "bg-gradient-to-br from-indigo-100 to-sky-100 text-indigo-700",
  },
];
const DEFAULT_NDVI_CATEGORIES = [
  {
    name: "Sangat Sehat",
    range: "0.8-1.0",
    color: "#0f7a3f",
    percentage: 35,
    area_ha: 0.82,
  },
  {
    name: "Sehat",
    range: "0.6-0.8",
    color: "#1fbf63",
    percentage: 26,
    area_ha: 0.61,
  },
  {
    name: "Cukup Sehat",
    range: "0.4-0.6",
    color: "#7bd85a",
    percentage: 18,
    area_ha: 0.43,
  },
  {
    name: "Kurang Sehat",
    range: "0.21-0.4",
    color: "#f59e0b",
    percentage: 12,
    area_ha: 0.28,
  },
  {
    name: "Tidak Sehat",
    range: "0-0.21",
    color: "#ef233c",
    percentage: 6,
    area_ha: 0.14,
  },
  {
    name: "Non-Vegetasi",
    range: "< 0",
    color: "#27272a",
    percentage: 3,
    area_ha: 0.06,
  },
];
const DEFAULT_NDVI_ZONE_SETTINGS = {
  ndvi_min: 0,
  ndvi_max: 0.6,
  min_area_m2: 2,
  merge_distance_m: 0.5,
};

export function Maps() {
  const navigate = useNavigate();
  const mapDiv = useRef(null);
  const map = useRef(null);
  const baseLayers = useRef({});
  const currentBaseLayer = useRef(null);
  const imageryOverlays = useRef({});
  const ndviZonesLayer = useRef(null);
  const ndviZoneLayerIndex = useRef({});
  const sprayTargetsLayer = useRef(null);
  const sprayTargetLayerIndex = useRef({});
  const selectedSprayTargetLayer = useRef(null);
  const imageryCache = useRef({});
  const currentMarker = useRef(null);
  const fieldLocationMarker = useRef(null);
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
  const [imageryLoading, setImageryLoading] = useState(false);
  const [imageryError, setImageryError] = useState("");
  const [ndviStats, setNdviStats] = useState(null);
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [selectedImagery, setSelectedImagery] = useState(null);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [ndviZoneSettings, setNdviZoneSettings] = useState(
    DEFAULT_NDVI_ZONE_SETTINGS,
  );
  const [ndviZonesLoading, setNdviZonesLoading] = useState(false);
  const [approveZonesLoading, setApproveZonesLoading] = useState(false);
  const [ndviZonesError, setNdviZonesError] = useState("");
  const [ndviZonesSummary, setNdviZonesSummary] = useState(null);
  const [ndviZoneFeatures, setNdviZoneFeatures] = useState([]);
  const [sprayTargetsLoading, setSprayTargetsLoading] = useState(false);
  const [sprayTargetsError, setSprayTargetsError] = useState("");
  const [sprayTargetFeatures, setSprayTargetFeatures] = useState([]);
  const [activeAnalysisPanel, setActiveAnalysisPanel] = useState("ndvi-zones");
  const [routeAltitude, setRouteAltitude] = useState(5);
  const [routeSpeed, setRouteSpeed] = useState(2);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [telemetryCollapsed, setTelemetryCollapsed] = useState(false);

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

  async function fetchLatestImagery(fieldId = selectedFieldId) {
    if (!fieldId) throw new Error("Pilih lahan dulu");
    if (imageryCache.current[fieldId]) return imageryCache.current[fieldId];
    const imageryRes = await fetch(`/fields/${fieldId}/imagery/latest`);
    if (!imageryRes.ok) throw new Error("Belum ada data imagery");
    const data = await imageryRes.json();
    imageryCache.current[fieldId] = data;
    return data;
  }

  function cornersToLeafletBounds(imagery) {
    const corners = [
      imagery?.top_left,
      imagery?.top_right,
      imagery?.bottom_left,
      imagery?.bottom_right,
    ].filter(Boolean);
    if (corners.length < 2) return null;
    const lats = corners.map((point) => point.lat);
    const lngs = corners.map((point) => point.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
  }

  function imageryCenter(imagery) {
    const corners = [
      imagery?.top_left,
      imagery?.top_right,
      imagery?.bottom_left,
      imagery?.bottom_right,
    ].filter(Boolean);
    if (!corners.length) return null;
    return {
      lat:
        corners.reduce((sum, point) => sum + Number(point.lat), 0) /
        corners.length,
      lng:
        corners.reduce((sum, point) => sum + Number(point.lng), 0) /
        corners.length,
    };
  }

  function formatCoordinate(value) {
    return Number.isFinite(value) ? value.toFixed(5) : "-";
  }

  function formatPopupCoordinate(value) {
    return Number.isFinite(value) ? value.toFixed(6) : "-";
  }

  function formatCaptureTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function formatNumber(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }).format(number);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function clampNdviValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(1, Math.max(-1, number));
  }

  function removeFieldLocationMarker() {
    const marker = fieldLocationMarker.current;
    if (marker && map.current?.hasLayer(marker))
      map.current.removeLayer(marker);
    fieldLocationMarker.current = null;
  }

  function removeImageryOverlay(id) {
    const overlay = imageryOverlays.current[id];
    if (overlay && map.current?.hasLayer(overlay))
      map.current.removeLayer(overlay);
    delete imageryOverlays.current[id];
  }

  function removeNdviZonesPreview() {
    const layer = ndviZonesLayer.current;
    if (layer && map.current?.hasLayer(layer)) map.current.removeLayer(layer);
    ndviZonesLayer.current = null;
    ndviZoneLayerIndex.current = {};
    setNdviZonesSummary(null);
    setNdviZoneFeatures([]);
    setNdviZonesError("");
  }

  function removeSprayTargetsLayer() {
    const layer = sprayTargetsLayer.current;
    if (layer && map.current?.hasLayer(layer)) map.current.removeLayer(layer);
    sprayTargetsLayer.current = null;
    sprayTargetLayerIndex.current = {};
    selectedSprayTargetLayer.current = null;
    setSprayTargetsError("");
  }

  function setSprayTargetHighlight(layer) {
    layer?.setStyle?.({
      color: "#ffffff",
      weight: 4,
      opacity: 1,
      fillColor: "#ffffff",
      fillOpacity: 0.28,
    });
    layer?.bringToFront?.();
  }

  function selectSprayTargetLayer(layer) {
    const previous = selectedSprayTargetLayer.current;
    if (previous && previous !== layer) {
      sprayTargetsLayer.current?.resetStyle?.(previous);
    }
    selectedSprayTargetLayer.current = layer;
    setSprayTargetHighlight(layer);
  }

  function clearSelectedSprayTargetLayer() {
    const selected = selectedSprayTargetLayer.current;
    if (selected) {
      sprayTargetsLayer.current?.resetStyle?.(selected);
      selected.closePopup?.();
    }
    selectedSprayTargetLayer.current = null;
  }

  function renderSprayTargetsGeoJson(geojson) {
    if (!map.current) return;
    removeSprayTargetsLayer();
    const featureCollection = geojson ?? {
      type: "FeatureCollection",
      features: [],
    };
    sprayTargetLayerIndex.current = {};
    const layer = L.geoJSON(
      featureCollection,
      {
        pane: "sprayTargetsPane",
        style: {
          color: "#e11d48",
          weight: 2.5,
          opacity: 1,
          fillColor: "#fb7185",
          fillOpacity: 0.18,
          lineCap: "round",
          lineJoin: "round",
        },
        onEachFeature: (feature, polygonLayer) => {
          const props = feature.properties ?? {};
          const targetKey = props.id ?? props.zone_code;
          if (targetKey != null) {
            sprayTargetLayerIndex.current[String(targetKey)] = polygonLayer;
          }
          polygonLayer.on({
            click: (event) => {
              L.DomEvent.stopPropagation(event);
              selectSprayTargetLayer(polygonLayer);
              openSprayTargetPopup(polygonLayer, event.latlng);
            },
            mouseover: (event) => {
              setSprayTargetHighlight(event.target);
            },
            mouseout: (event) => {
              if (selectedSprayTargetLayer.current !== event.target) {
                layer.resetStyle(event.target);
              }
            },
          });
        },
      },
    );
    sprayTargetsLayer.current = layer;
    layer.addTo(map.current);
    layer.bringToFront();
    setSprayTargetFeatures(
      Array.isArray(featureCollection.features) ? featureCollection.features : [],
    );
  }

  function addImageryOverlay(id, imagery, fit = false) {
    if (!map.current || !imagery) return;
    const bounds = cornersToLeafletBounds(imagery);
    if (!bounds) throw new Error("Koordinat imagery tidak tersedia");
    const urlKey = id === "rgb" ? "rgb_png_path" : "ndvi_png_path";
    const url = imagery[urlKey];
    if (!url) throw new Error("File imagery tidak tersedia");
    removeImageryOverlay(id);
    const overlay = L.imageOverlay(url, bounds, {
      opacity: 0.75,
      interactive: false,
    });
    imageryOverlays.current[id] = overlay;
    overlay.addTo(map.current);
    if (fit)
      map.current.fitBounds(bounds, {
        padding: [40, 40],
        animate: true,
        duration: 0.8,
      });
  }

  async function selectField(fieldId, options = {}) {
    if (!fieldId) return;
    removeFieldLocationMarker();
    removeNdviZonesPreview();
    removeSprayTargetsLayer();
    setSelectedFieldId(fieldId);
    setFieldPickerOpen(false);
    setImageryLoading(true);
    setImageryError("");
    try {
      const imagery = await fetchLatestImagery(fieldId);
      setSelectedImagery(imagery);
      setNdviStats(imagery.ndvi_stats ?? null);
      for (const layerId of ["rgb", "ndvi"]) {
        if (active.has(layerId))
          addImageryOverlay(layerId, imagery, options.fit ?? true);
      }
      if (active.has("spray-targets")) {
        loadSprayTargets(fieldId, imagery);
      }
      if (options.fit) zoomToSelectedField(imagery);
    } catch (err) {
      setImageryError(err.message || "Gagal memuat imagery");
      setSelectedImagery(null);
      setNdviStats(null);
    } finally {
      setImageryLoading(false);
    }
  }

  function zoomToSelectedField(imagery = selectedImagery) {
    const bounds = cornersToLeafletBounds(imagery);
    if (!bounds || !map.current) return;
    map.current.fitBounds(bounds, {
      padding: [40, 40],
      animate: true,
      duration: 0.8,
    });
  }

  function showSelectedFieldMarker() {
    if (!map.current || !selectedImagery) return;
    const center = imageryCenter(selectedImagery);
    if (!center) return;

    removeFieldLocationMarker();
    zoomToSelectedField(selectedImagery);

    const marker = createLocationMarker({
      lat: center.lat,
      lng: center.lng,
      title: selectedField?.name ?? "Lahan",
      detectedAt: formatCaptureTime(selectedImagery.capture_at),
      address: `${formatCoordinate(center.lat)}, ${formatCoordinate(center.lng)}`,
      onClose: removeFieldLocationMarker,
    }).addTo(map.current);

    fieldLocationMarker.current = marker;
    marker.openPopup();
  }

  async function toggleImageryLayer(id) {
    if (!map.current) return;
    const existing = imageryOverlays.current[id];
    if (existing) {
      if (map.current.hasLayer(existing)) {
        map.current.removeLayer(existing);
        setActive((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        existing.addTo(map.current);
        setActive((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
      return;
    }

    setImageryLoading(true);
    setImageryError("");
    try {
      const imagery = await fetchLatestImagery();
      setSelectedImagery(imagery);
      addImageryOverlay(id, imagery, true);
      if (id === "ndvi") setNdviStats(imagery.ndvi_stats ?? null);
      setActive((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    } catch (err) {
      setImageryError(err.message || "Gagal memuat imagery");
    } finally {
      setImageryLoading(false);
    }
  }

  function toggleAnalysisLayer(id) {
    const isActive = active.has(id);
    if (id === "ndvi-zones" && active.has(id)) {
      removeNdviZonesPreview();
    }
    if (id === "spray-targets") {
      if (active.has(id)) {
        removeSprayTargetsLayer();
      } else {
        loadSprayTargets();
      }
    }
    if (!isActive) {
      setActiveAnalysisPanel(id);
    } else if (activeAnalysisPanel === id) {
      const fallback = ["ndvi-zones", "spray-targets", "spraying-route"].find(
        (layerId) => layerId !== id && active.has(layerId),
      );
      if (fallback) setActiveAnalysisPanel(fallback);
    }
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function updateNdviZoneSetting(key, value) {
    setNdviZoneSettings((prev) => {
      const number = Number(value);
      if (key === "ndvi_min") {
        return {
          ...prev,
          ndvi_min: Math.min(clampNdviValue(number), prev.ndvi_max),
        };
      }
      if (key === "ndvi_max") {
        return {
          ...prev,
          ndvi_max: Math.max(clampNdviValue(number), prev.ndvi_min),
        };
      }
      return {
        ...prev,
        [key]: Number.isFinite(number) ? Math.max(0, number) : prev[key],
      };
    });
  }

  function focusNdviZone(zoneId) {
    const zoneLayer = ndviZoneLayerIndex.current[String(zoneId)];
    if (!zoneLayer || !map.current) return;
    if (typeof zoneLayer.getBounds === "function") {
      map.current.fitBounds(zoneLayer.getBounds(), {
        padding: [56, 56],
        animate: true,
        duration: 0.6,
        maxZoom: 20,
      });
    }
    const center = zoneLayer.getBounds?.().getCenter?.();
    if (center) {
      openNdviZonePopupAtCenter(zoneLayer);
    }
    zoneLayer.setStyle?.({
      color: "#ecfeff",
      weight: 4,
      fillOpacity: 0.22,
      lineCap: "round",
      lineJoin: "round",
    });
    setTimeout(() => {
      ndviZonesLayer.current?.resetStyle?.(zoneLayer);
    }, 1400);
  }

  function focusSprayTarget(targetId) {
    const targetLayer = sprayTargetLayerIndex.current[String(targetId)];
    if (!targetLayer || !map.current) return;
    if (typeof targetLayer.getBounds === "function") {
      map.current.fitBounds(targetLayer.getBounds(), {
        padding: [56, 56],
        animate: true,
        duration: 0.6,
        maxZoom: 20,
      });
    }
    openSprayTargetPopup(targetLayer);
    selectSprayTargetLayer(targetLayer);
  }

  function deleteNdviZone(zoneId) {
    const key = String(zoneId);
    const zoneLayer = ndviZoneLayerIndex.current[key];
    if (zoneLayer) {
      zoneLayer.closePopup();
      ndviZonesLayer.current?.removeLayer(zoneLayer);
      delete ndviZoneLayerIndex.current[key];
    }
    setNdviZoneFeatures((prev) =>
      prev.filter((f) => String(f.properties?.id ?? "") !== key),
    );
  }

  function ndviZonePopupLoadingContent(props) {
    const zoneId =
      props?.id != null ? `Z${String(props.id).padStart(2, "0")}` : null;
    return `<div class="min-w-[320px] rounded-2xl bg-white px-5 pb-4 pt-4 font-sans">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#4B7C63] ring-1 ring-emerald-900/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
          </span>
          <span class="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#4B7C63]">NDVI Zone</span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          ${zoneId ? `<span class="rounded-full bg-emerald-900 px-3 py-1.5 text-[13px] font-black leading-none text-white shadow-[0_4px_10px_rgba(6,78,59,0.22)]">${zoneId}</span>` : ""}
          <button type="button" class="jp-zone-close flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-emerald-200/55 transition-colors hover:bg-slate-200 hover:text-slate-700" aria-label="Tutup popup">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="flex min-h-[80px] flex-col items-center justify-center gap-2">
        <div class="jp-location-spinner"></div>
        <span class="text-[12px] font-medium text-gray-500">Memuat lokasi...</span>
      </div>
      <div class="border-t border-gray-200 pt-3">
        <button type="button" class="jp-zone-delete flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 py-2 text-[12px] font-bold text-red-500 transition-colors hover:bg-red-50 hover:text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Hapus Zone
        </button>
      </div>
    </div>`;
  }

  function ndviZonePopupContent(center, address, props) {
    const zoneId =
      props?.id != null ? `Z${String(props.id).padStart(2, "0")}` : null;
    const areaM2 =
      props?.area_m2 != null ? `${formatNumber(props.area_m2)} m²` : null;
    const meanNdvi =
      props?.mean_ndvi != null ? formatNumber(props.mean_ndvi, 4) : null;
    const hasStats = areaM2 != null || meanNdvi != null;
    return `<div class="min-w-[320px] rounded-2xl bg-white px-5 pb-4 pt-4 font-sans">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#4B7C63] ring-1 ring-emerald-900/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
          </span>
          <span class="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#4B7C63]">NDVI Zone</span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          ${zoneId ? `<span class="rounded-full bg-emerald-900 px-3 py-1.5 text-[13px] font-black leading-none text-white shadow-[0_4px_10px_rgba(6,78,59,0.22)]">${zoneId}</span>` : ""}
          <button type="button" class="jp-zone-close flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-emerald-200/55 transition-colors hover:bg-slate-200 hover:text-slate-700" aria-label="Tutup popup">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      ${hasStats ? `<div class="mb-3 h-[1px] w-full bg-gray-200"></div>
      <div class="mb-3 grid grid-cols-2 gap-4">
        ${areaM2 != null ? `<div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
            Area
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${areaM2}</p>
        </div>` : ""}
        ${meanNdvi != null ? `<div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Mean NDVI
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${meanNdvi}</p>
        </div>` : ""}
      </div>` : ""}
      <div class="mb-3 h-[1px] w-full bg-gray-200"></div>
      <div class="mb-4">
        <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Lokasi
        </div>
        <p class="m-0 text-[12px] font-bold text-gray-900 leading-[1.4]" style="margin-top:3px">${address}</p>
      </div>
      <div class="mb-3 h-[1px] w-full bg-gray-200"></div>
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <div class="flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] border-current">
              <div class="h-[1.5px] w-2 bg-current"></div>
            </div>
            LAT
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${formatPopupCoordinate(center?.lat)}</p>
        </div>
        <div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <div class="flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] border-current">
              <div class="h-[1.5px] w-2 rotate-90 bg-current"></div>
            </div>
            LONG
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${formatPopupCoordinate(center?.lng)}</p>
        </div>
      </div>
      <div class="border-t border-gray-200 pt-3">
        <button type="button" class="jp-zone-delete flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 py-2 text-[12px] font-bold text-red-500 transition-colors hover:bg-red-50 hover:text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Hapus Zone
        </button>
      </div>
    </div>`;
  }

  function attachNdviZonePopupClose(polygonLayer) {
    const popup = polygonLayer.getPopup();
    const element = popup?.getElement();
    const closeBtn = element?.querySelector(".jp-zone-close");
    if (closeBtn) {
      closeBtn.onclick = (event) => {
        event.stopPropagation();
        polygonLayer.closePopup();
      };
    }
    const deleteBtn = element?.querySelector(".jp-zone-delete");
    if (deleteBtn) {
      deleteBtn.onclick = (event) => {
        event.stopPropagation();
        const zoneId = polygonLayer.feature?.properties?.id;
        if (zoneId != null) deleteNdviZone(zoneId);
        polygonLayer.closePopup();
      };
    }
  }

  function loadNdviZonePopupAddress(polygonLayer, center, props) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng))
      return;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`,
    )
      .then((res) => res.json())
      .then((data) => {
        const address =
          data?.display_name || "Tidak ada data lokasi di titik ini.";
        polygonLayer
          .getPopup()
          ?.setContent(ndviZonePopupContent(center, address, props));
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachNdviZonePopupClose(polygonLayer);
        });
      })
      .catch(() => {
        polygonLayer
          .getPopup()
          ?.setContent(
            ndviZonePopupContent(center, "Gagal memuat alamat.", props),
          );
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachNdviZonePopupClose(polygonLayer);
        });
      });
  }

  function openNdviZonePopupAtCenter(polygonLayer) {
    const center = polygonLayer.getBounds?.().getCenter?.();
    if (!center) return;
    const props = polygonLayer.feature?.properties ?? {};
    polygonLayer.bindPopup(ndviZonePopupLoadingContent(props), {
      closeButton: false,
      className: "jp-location-popup",
      minWidth: 320,
      maxWidth: 360,
    });
    polygonLayer.once("popupopen", () => attachNdviZonePopupClose(polygonLayer));
    polygonLayer.openPopup(center);
    loadNdviZonePopupAddress(polygonLayer, center, props);
  }

  const S = "font-family:system-ui,-apple-system,sans-serif";
  const DIV = "height:1px;background:#fce7f3;margin-bottom:14px";
  const LBL = "font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#e11d48";
  const VAL = "font-size:12px;font-weight:800;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums";

  function sprayTargetPopupHeader(zoneCode) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="width:32px;height:32px;border-radius:10px;background:#fff1f2;display:grid;place-items:center;color:#be123c;box-shadow:inset 0 0 0 1px rgba(190,18,60,.12);flex-shrink:0">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><path d="M2 12h20"/><path d="m5 7-3 5 3 5"/><path d="m19 7 3 5-3 5"/></svg>
        </span>
        <span style="font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#be123c">Spray Target</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="background:#e11d48;color:#fff;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:900;line-height:1">${zoneCode}</span>
        <button type="button" class="jp-spray-target-close" style="width:32px;height:32px;border-radius:50%;background:#fff1f2;border:none;display:grid;place-items:center;color:#be123c;cursor:pointer;flex-shrink:0" aria-label="Tutup popup">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`;
  }

  function sprayTargetPopupLoadingContent(props) {
    const zoneCode = escapeHtml(props?.zone_code ?? "Target");
    return `<div style="min-width:300px;padding:20px 20px 16px;${S}">
      ${sprayTargetPopupHeader(zoneCode)}
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:80px">
        <div class="jp-location-spinner"></div>
        <span style="font-size:12px;font-weight:500;color:#94a3b8">Memuat lokasi...</span>
      </div>
    </div>`;
  }

  function sprayTargetPopupContent(center, address, props = {}) {
    const zoneCode = escapeHtml(props?.zone_code ?? "Target");
    const chamber = escapeHtml(props?.chamber ?? "none");
    const detections = Array.isArray(props?.detections) ? props.detections : [];
    const areaM2 = props?.area_m2 != null ? `${formatNumber(props.area_m2)} m²` : "-";
    const meanNdvi = props?.mean_ndvi != null ? formatNumber(props.mean_ndvi, 4) : "-";

    const chamberOpts = ["none", "fungisida", "bakterisida", "insektisida"]
      .map((opt) => {
        const active = chamber === opt;
        return `<div class="jp-chamber-opt" data-value="${opt}" style="padding:9px 12px;font-size:12px;font-weight:700;color:${active ? "#be123c" : "#334155"};cursor:pointer;display:flex;align-items:center;gap:8px;background:${active ? "#fff1f2" : "transparent"}">
          <span style="width:7px;height:7px;border-radius:50%;background:${active ? "#e11d48" : "#e2e8f0"};flex-shrink:0"></span>${opt}
        </div>`;
      })
      .join("");

    const navBtns = detections.length > 1
      ? `<div style="display:flex;gap:5px">
          <button class="jp-det-prev" style="width:26px;height:26px;border-radius:50%;border:1.5px solid #fecaca;background:#fff1f2;color:#e11d48;display:grid;place-items:center;cursor:pointer;opacity:.35" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button class="jp-det-next" style="width:26px;height:26px;border-radius:50%;border:1.5px solid #fecaca;background:#fff1f2;color:#e11d48;display:grid;place-items:center;cursor:pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>`
      : "";

    let detBody;
    if (detections.length === 0) {
      detBody = `<div style="border:1.5px dashed #fecaca;border-radius:12px;padding:14px;text-align:center;margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;color:#fca5a5">Belum ada deteksi HPT</div>
      </div>`;
    } else {
      const cards = detections.map((d) => {
        const name = escapeHtml(d.name ?? "-");
        const cat = escapeHtml([d.category, d.group_name].filter(Boolean).join(" · "));
        const conf = d.confidence != null ? Math.round(d.confidence * 100) : null;
        const confBar = conf != null
          ? `<div style="display:flex;align-items:center;gap:6px;margin-top:7px">
               <div style="flex:1;height:4px;background:#fecaca;border-radius:999px;overflow:hidden">
                 <div style="width:${conf}%;height:100%;background:#f59e0b;border-radius:999px"></div>
               </div>
               <span style="font-size:10px;font-weight:800;color:#b45309">${conf}%</span>
             </div>`
          : "";
        const img = d.image_path
          ? `<img src="${escapeHtml(d.image_path)}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;flex-shrink:0" />`
          : `<div style="width:52px;height:52px;border-radius:8px;background:#fce7f3;flex-shrink:0;display:grid;place-items:center;font-size:20px">🌾</div>`;
        return `<div class="jp-det-card" style="scroll-snap-align:start;flex:0 0 100%;display:flex;gap:10px;align-items:center;padding:10px 12px">
          ${img}
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:800;color:#0f172a">${name}</div>
            <div style="font-size:10px;font-weight:600;color:#be123c;margin-top:1px">${cat}</div>
            ${confBar}
          </div>
        </div>`;
      }).join("");

      const dots = detections
        .map((_, i) => `<div class="jp-det-dot" style="height:4px;width:${i === 0 ? "14" : "4"}px;border-radius:999px;background:${i === 0 ? "#e11d48" : "#fecaca"};transition:width .2s,background .2s"></div>`)
        .join("");

      detBody = `<div style="background:#fff1f2;border-radius:12px;overflow:hidden;margin-bottom:12px">
        <div class="jp-det-slider" style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory">
          ${cards}
        </div>
        ${detections.length > 1 ? `<div class="jp-det-dots" style="display:flex;gap:4px;justify-content:center;padding:6px 0 10px">${dots}</div>` : ""}
      </div>`;
    }

    const ctaLabel = detections.length === 0 ? "Deteksi HPT" : "Tambah Deteksi";
    const ctaStyle = detections.length === 0
      ? "background:#e11d48;border:none;color:#fff;box-shadow:0 4px 14px rgba(225,29,72,.35)"
      : "background:#fff;border:1.5px solid #fecaca;color:#be123c";

    return `<div style="min-width:300px;padding:20px 20px 16px;${S}">
      ${sprayTargetPopupHeader(zoneCode)}
      <div style="${DIV}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px">
        <div><div style="${LBL}">Area</div><div style="${VAL}">${areaM2}</div></div>
        <div><div style="${LBL}">Mean NDVI</div><div style="${VAL}">${meanNdvi}</div></div>
      </div>
      <div style="${DIV}"></div>
      <div style="margin-bottom:14px">
        <div style="${LBL};margin-bottom:7px">Chamber</div>
        <div class="jp-chamber-dd" style="position:relative">
          <div class="jp-chamber-trigger" style="width:100%;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 36px 9px 12px;font-size:12px;font-weight:700;color:#0f172a;cursor:pointer;display:flex;align-items:center;box-sizing:border-box;position:relative">
            <span class="jp-chamber-label">${chamber}</span>
            <svg class="jp-chamber-arrow" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;right:11px;transition:transform .2s"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="jp-chamber-menu" style="display:none;position:absolute;left:0;right:0;background:#fff;border:1.5px solid #e11d48;border-top:none;border-bottom-left-radius:10px;border-bottom-right-radius:10px;overflow:hidden;z-index:99;box-shadow:0 8px 20px rgba(225,29,72,.1)">
            ${chamberOpts}
          </div>
        </div>
      </div>
      <div style="${DIV}"></div>
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="${LBL}">Deteksi HPT</div>
            <span style="background:#fff1f2;color:#be123c;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800">${detections.length}</span>
          </div>
          ${navBtns}
        </div>
        ${detBody}
        <div style="display:flex;justify-content:center">
          <button class="jp-detect-btn" style="${ctaStyle};border-radius:999px;padding:9px 18px;display:inline-flex;align-items:center;gap:7px;cursor:pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            <span style="font-size:12px;font-weight:800">${ctaLabel}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        </div>
      </div>
      <div style="${DIV}"></div>
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:5px;${LBL};margin-bottom:5px">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Lokasi
        </div>
        <div style="font-size:12px;font-weight:700;color:#0f172a;line-height:1.4;overflow-wrap:break-word">${escapeHtml(address)}</div>
      </div>
      <div style="${DIV}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><div style="${LBL}">Lat</div><div style="font-size:12px;font-weight:800;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums">${formatPopupCoordinate(center?.lat)}</div></div>
        <div><div style="${LBL}">Long</div><div style="font-size:12px;font-weight:800;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums">${formatPopupCoordinate(center?.lng)}</div></div>
      </div>
    </div>`;
  }

  function attachSprayTargetPopupInteractions(polygonLayer, props) {
    const popup = polygonLayer.getPopup();
    const el = popup?.getElement();
    if (!el) return;

    el.querySelector(".jp-spray-target-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      polygonLayer.closePopup();
    });

    const trigger = el.querySelector(".jp-chamber-trigger");
    const menu = el.querySelector(".jp-chamber-menu");
    const arrow = el.querySelector(".jp-chamber-arrow");
    const label = el.querySelector(".jp-chamber-label");

    if (trigger && menu) {
      trigger.addEventListener("click", () => {
        const isOpen = menu.style.display !== "none";
        menu.style.display = isOpen ? "none" : "block";
        trigger.style.borderBottomLeftRadius = isOpen ? "10px" : "0";
        trigger.style.borderBottomRightRadius = isOpen ? "10px" : "0";
        trigger.style.borderColor = isOpen ? "#e2e8f0" : "#e11d48";
        if (arrow) {
          arrow.style.transform = isOpen ? "" : "rotate(180deg)";
          arrow.setAttribute("stroke", isOpen ? "#94a3b8" : "#e11d48");
        }
      });

      el.querySelectorAll(".jp-chamber-opt").forEach((opt) => {
        opt.addEventListener("click", async () => {
          const value = opt.dataset.value;
          if (label) label.textContent = value;
          menu.style.display = "none";
          trigger.style.borderBottomLeftRadius = "10px";
          trigger.style.borderBottomRightRadius = "10px";
          trigger.style.borderColor = "#e2e8f0";
          if (arrow) { arrow.style.transform = ""; arrow.setAttribute("stroke", "#94a3b8"); }
          el.querySelectorAll(".jp-chamber-opt").forEach((o) => {
            const dot = o.querySelector("span");
            const active = o === opt;
            o.style.color = active ? "#be123c" : "#334155";
            o.style.background = active ? "#fff1f2" : "transparent";
            if (dot) dot.style.background = active ? "#e11d48" : "#e2e8f0";
          });
          if (props?.id) {
            await fetch(`/polygons/${props.id}/chamber`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chamber: value }),
            }).catch(() => {});
          }
        });
      });
    }

    const slider = el.querySelector(".jp-det-slider");
    if (slider) {
      const cards = slider.querySelectorAll(".jp-det-card");
      const total = cards.length;
      const dotsEl = el.querySelector(".jp-det-dots");
      const prevBtn = el.querySelector(".jp-det-prev");
      const nextBtn = el.querySelector(".jp-det-next");

      function syncNav() {
        const i = Math.round(slider.scrollLeft / slider.offsetWidth);
        dotsEl?.querySelectorAll(".jp-det-dot").forEach((d, idx) => {
          d.style.width = idx === i ? "14px" : "4px";
          d.style.background = idx === i ? "#e11d48" : "#fecaca";
        });
        if (prevBtn) prevBtn.style.opacity = i === 0 ? ".35" : "1";
        if (nextBtn) nextBtn.style.opacity = i === total - 1 ? ".35" : "1";
      }

      slider.addEventListener("scroll", syncNav, { passive: true });
      prevBtn?.addEventListener("click", () => {
        const i = Math.round(slider.scrollLeft / slider.offsetWidth);
        slider.scrollTo({ left: Math.max(0, i - 1) * slider.offsetWidth, behavior: "smooth" });
      });
      nextBtn?.addEventListener("click", () => {
        const i = Math.round(slider.scrollLeft / slider.offsetWidth);
        slider.scrollTo({ left: Math.min(total - 1, i + 1) * slider.offsetWidth, behavior: "smooth" });
      });
    }

    el.querySelector(".jp-detect-btn")?.addEventListener("click", () => {
      const pid = encodeURIComponent(props?.id ?? "");
      const zc = encodeURIComponent(props?.zone_code ?? "");
      navigate(`/detection?polygon_id=${pid}&zone_code=${zc}`);
      polygonLayer.closePopup();
    });
  }

  function loadSprayTargetPopupAddress(polygonLayer, center, props) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng))
      return;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`,
    )
      .then((res) => res.json())
      .then((data) => {
        const address = data?.display_name || "Tidak ada data lokasi di titik ini.";
        polygonLayer.getPopup()?.setContent(sprayTargetPopupContent(center, address, props));
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachSprayTargetPopupInteractions(polygonLayer, props);
        });
      })
      .catch(() => {
        polygonLayer.getPopup()?.setContent(sprayTargetPopupContent(center, "Gagal memuat alamat.", props));
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachSprayTargetPopupInteractions(polygonLayer, props);
        });
      });
  }

  function openSprayTargetPopup(polygonLayer, point = null) {
    const popupPoint = point ?? polygonLayer.getBounds?.().getCenter?.();
    if (!popupPoint) return;
    const props = polygonLayer.feature?.properties ?? {};
    polygonLayer.bindPopup(sprayTargetPopupLoadingContent(props), {
      closeButton: false,
      className: "jp-location-popup",
      minWidth: 320,
      maxWidth: 360,
    });
    polygonLayer.once("popupopen", () => attachSprayTargetPopupInteractions(polygonLayer, props));
    polygonLayer.openPopup(popupPoint);
    loadSprayTargetPopupAddress(polygonLayer, popupPoint, props);
  }

  async function generateNdviZones() {
    if (!map.current) return;
    setNdviZonesLoading(true);
    setNdviZonesError("");
    try {
      const imagery = selectedImagery ?? (await fetchLatestImagery());
      setSelectedImagery(imagery);
      if (!active.has("ndvi-zones")) {
        setActive((prev) => {
          const next = new Set(prev);
          next.add("ndvi-zones");
          return next;
        });
      }

      const res = await fetch(`/imagery/${imagery.id}/ndvi-zones/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ndviZoneSettings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Gagal generate NDVI Zones");

      removeNdviZonesPreview();
      const geojson = data.geojson ?? {
        type: "FeatureCollection",
        features: [],
      };
      ndviZoneLayerIndex.current = {};
      const layer = L.geoJSON(geojson, {
        pane: "ndviZonesPane",
        style: {
          color: "#06b6d4",
          weight: 2.5,
          opacity: 1,
          fillColor: "#22d3ee",
          fillOpacity: 0.12,
          lineCap: "round",
          lineJoin: "round",
        },
        onEachFeature: (feature, polygonLayer) => {
          const props = feature.properties ?? {};
          if (props.id != null) {
            ndviZoneLayerIndex.current[String(props.id)] = polygonLayer;
          }
          polygonLayer.on({
            click: (event) => {
              L.DomEvent.stopPropagation(event);
              openNdviZonePopupAtCenter(polygonLayer);
            },
            mouseover: (event) => {
              event.target.setStyle({
                color: "#ecfeff",
                weight: 3.5,
                fillOpacity: 0.2,
                lineCap: "round",
                lineJoin: "round",
              });
            },
            mouseout: (event) => {
              layer.resetStyle(event.target);
            },
          });
        },
      });
      ndviZonesLayer.current = layer;
      layer.addTo(map.current);
      layer.bringToFront();
      setNdviZonesSummary(data.summary ?? null);
      setNdviZoneFeatures(
        Array.isArray(geojson.features) ? geojson.features : [],
      );
    } catch (err) {
      setNdviZonesError(err.message || "Gagal generate NDVI Zones");
    } finally {
      setNdviZonesLoading(false);
    }
  }

  async function loadSprayTargets(
    fieldId = selectedFieldId,
    imagery = selectedImagery,
  ) {
    if (!fieldId || !imagery) return;
    setSprayTargetsLoading(true);
    setSprayTargetsError("");
    try {
      const params = new URLSearchParams({ imagery_id: imagery.id });
      const res = await fetch(
        `/fields/${fieldId}/spray-targets?${params.toString()}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Gagal memuat spray targets");
      renderSprayTargetsGeoJson(data.geojson);
    } catch (err) {
      setSprayTargetsError(err.message || "Gagal memuat spray targets");
    } finally {
      setSprayTargetsLoading(false);
    }
  }

  async function approveNdviZones() {
    if (!selectedImagery || ndviZoneFeatures.length === 0) return;
    setApproveZonesLoading(true);
    setNdviZonesError("");
    try {
      const geojson = {
        type: "FeatureCollection",
        features: ndviZoneFeatures,
      };
      const res = await fetch(
        `/imagery/${selectedImagery.id}/ndvi-zones/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settings: ndviZoneSettings,
            geojson,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Gagal approve zones");

      removeNdviZonesPreview();
      renderSprayTargetsGeoJson(data.geojson);
      setActiveAnalysisPanel("spray-targets");
      setActive((prev) => {
        const next = new Set(prev);
        next.delete("ndvi-zones");
        next.add("spray-targets");
        return next;
      });
    } catch (err) {
      setNdviZonesError(err.message || "Gagal approve zones");
    } finally {
      setApproveZonesLoading(false);
    }
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
      zoomControl: false,
      maxZoom: 24,
    }).setView([-2.5, 118], 5);
    map.current = m;
    m.createPane("ndviZonesPane");
    m.getPane("ndviZonesPane").style.zIndex = 650;
    m.getPane("ndviZonesPane").style.pointerEvents = "auto";
    m.createPane("sprayTargetsPane");
    m.getPane("sprayTargetsPane").style.zIndex = 660;
    m.getPane("sprayTargetsPane").style.pointerEvents = "auto";
    ensureBaseLayer("satellite").addTo(m);
    currentBaseLayer.current = "satellite";
    L.control.scale({ imperial: false }).addTo(m);
    m.on("click", (e) => {
      clearSelectedSprayTargetLayer();
      dropMarker(e.latlng.lat, e.latlng.lng);
    });

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
      imageryOverlays.current = {};
      ndviZonesLayer.current = null;
      sprayTargetsLayer.current = null;
      imageryCache.current = {};
      fieldLocationMarker.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFields() {
      setFieldsLoading(true);
      setFieldError("");
      try {
        const res = await fetch("/fields");
        if (!res.ok) throw new Error("Gagal memuat daftar lahan");
        const data = await res.json();
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : []).toSorted((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aTime - bTime;
        });
        setFields(list);
        if (list.length > 0) {
          await selectField(list[0].id, { fit: false });
        }
      } catch (err) {
        if (!cancelled)
          setFieldError(err.message || "Gagal memuat daftar lahan");
      } finally {
        if (!cancelled) setFieldsLoading(false);
      }
    }

    loadFields();
    return () => {
      cancelled = true;
    };
  }, []);

  const ndviCategories = ndviStats?.categories ?? DEFAULT_NDVI_CATEGORIES;
  const dominantNdvi = ndviCategories.reduce(
    (best, cat) =>
      Number(cat.percentage) > Number(best.percentage) ? cat : best,
    ndviCategories[0],
  );
  const selectedField = fields.find((field) => field.id === selectedFieldId);
  const selectedCenter = imageryCenter(selectedImagery);
  const selectedLocationText = selectedCenter
    ? `${formatCoordinate(selectedCenter.lat)}, ${formatCoordinate(selectedCenter.lng)}`
    : "-";
  const ndviRangeMinPercent = ((ndviZoneSettings.ndvi_min + 1) / 2) * 100;
  const ndviRangeMaxPercent = ((ndviZoneSettings.ndvi_max + 1) / 2) * 100;
  const routeActive = active.has("spraying-route");
  const sprayTargetAreaM2 = sprayTargetFeatures.reduce(
    (sum, feature) => sum + Number(feature.properties?.area_m2 || 0),
    0,
  );
  const sprayReadyCount = sprayTargetFeatures.filter(
    (feature) => feature.properties?.chamber !== "none",
  ).length;
  const routeWaypointCount = sprayTargetFeatures.length > 0 ? sprayTargetFeatures.length * 4 : 0;
  const shouldFillFieldPanel = ndviZoneFeatures.length > 0 || routeActive;
  const activeLayerPanels = [
    { id: "ndvi-zones", label: "NDVI Zones" },
    { id: "spray-targets", label: "Spray Targets" },
    { id: "spraying-route", label: "Spraying Route" },
  ].filter((panel) => active.has(panel.id));

  function renderAnalysisPanelSwitch() {
    if (activeLayerPanels.length <= 1) return null;
    return (
      <div className="flex shrink-0 rounded-2xl bg-gray-50 p-0.5 ring-1 ring-gray-200">
        {activeLayerPanels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            onClick={() => setActiveAnalysisPanel(panel.id)}
            className={`h-7 rounded-xl px-2.5 text-[10px] font-black transition-colors ${
              activeAnalysisPanel === panel.id
                ? "bg-white text-emerald-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
            title={panel.label}
          >
            {panel.id === "ndvi-zones" ? "Zones" : panel.id === "spray-targets" ? "Targets" : "Route"}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-16 items-center justify-between gap-3 border-b border-emerald-950/10 bg-white/92 px-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <button
          type="button"
          onClick={() => navigate("/menu")}
          className="group flex h-10 items-center gap-2 rounded-2xl border border-emerald-900/15 bg-white px-3 text-[13px] font-extrabold text-emerald-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-900/35 hover:bg-emerald-50 active:translate-y-0"
          title="Kembali ke menu"
        >
          <span className="grid h-6 w-6 place-items-center rounded-xl bg-emerald-900 text-white transition-colors group-hover:bg-emerald-800">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
          <span>Menu</span>
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-900 text-white shadow-[0_8px_18px_rgba(6,78,59,0.22)]">
            <MapPinned className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 text-center sm:text-left">
            <div className="truncate text-[15px] font-black leading-tight text-gray-950">
              SmartGIS
            </div>
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Peta Lahan
            </div>
          </div>
        </div>
        <div className="w-[86px]" />
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* Search */}
        <div className="absolute left-4 top-4 z-[1000] w-[min(320px,calc(100vw-32px))] md:w-[340px]">
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

        {leftPanelCollapsed && (
          <button
            type="button"
            onClick={() => setLeftPanelCollapsed(false)}
            className="absolute left-4 top-[76px] z-[1000] flex h-11 items-center gap-2 rounded-2xl border border-white/70 bg-white px-3 text-sm font-black text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-colors hover:bg-emerald-50"
            title="Buka panel SmartGIS"
          >
            <ChevronRight className="h-4 w-4" />
            Panel
          </button>
        )}

        {!leftPanelCollapsed && (
          <>
            {/* Field selector */}
            <div
              className="absolute bottom-4 left-4 top-[76px] z-[1000] w-[min(380px,calc(100vw-32px))]"
            >
              <div
                className={`rounded-[18px] border border-white/70 bg-white p-3 shadow-[0_12px_34px_rgba(15,23,42,0.15)] ${
                  shouldFillFieldPanel
                    ? "flex h-full flex-col overflow-hidden"
                    : "max-h-full overflow-y-auto overscroll-contain"
                }`}
              >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                    Pilih Lahan
                  </div>
                {fieldError && (
                  <div className="mt-0.5 truncate text-[10px] font-semibold text-red-500">
                    {fieldError}
                  </div>
                )}
              </div>
              {fieldsLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-forest" />
              )}
              <button
                type="button"
                onClick={() => setLeftPanelCollapsed(true)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                title="Sembunyikan panel SmartGIS"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setFieldPickerOpen((value) => !value)}
                disabled={fieldsLoading || fields.length === 0}
                className={`flex h-11 w-full items-center justify-between gap-3 rounded-2xl border bg-white px-3 text-left text-[13px] font-extrabold text-gray-800 shadow-sm transition-colors disabled:border-gray-200 disabled:text-gray-400 ${
                  fieldPickerOpen
                    ? "border-emerald-900 ring-2 ring-emerald-900/10"
                    : "border-gray-200 hover:border-emerald-900"
                }`}
              >
                <span className="min-w-0 truncate">
                  {selectedField?.name ??
                    (fieldsLoading ? "Memuat lahan..." : "Belum ada lahan")}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-emerald-700 transition-transform ${fieldPickerOpen ? "rotate-180" : ""}`}
                />
              </button>

              {fieldPickerOpen && fields.length > 0 && (
                <div className="mt-2 max-h-52 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-1 shadow-[0_16px_36px_rgba(15,23,42,0.16)]">
                  {fields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => selectField(field.id, { fit: true })}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-bold transition-colors ${
                        selectedFieldId === field.id
                          ? "bg-emerald-50 text-emerald-800"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="min-w-0 truncate">{field.name}</span>
                      {selectedFieldId === field.id && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2 rounded-2xl bg-gray-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
                  Lokasi Lahan
                </div>
                <div className="mt-0.5 truncate text-[12px] font-extrabold tabular-nums text-gray-800">
                  {selectedLocationText}
                </div>
              </div>
              <button
                type="button"
                onClick={showSelectedFieldMarker}
                disabled={!selectedImagery}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-900 bg-white text-emerald-800 shadow-sm transition-colors hover:bg-emerald-50 disabled:border-gray-200 disabled:text-gray-300"
                title="Tandai lokasi lahan"
              >
                <MapPin className="h-4 w-4" />
              </button>
            </div>

            {active.has("ndvi-zones") &&
              activeAnalysisPanel === "ndvi-zones" && (
              <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-t border-gray-100 pt-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-emerald-900/10">
                      <SlidersHorizontal
                        className="h-3.5 w-3.5"
                        strokeWidth={2.2}
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-black leading-tight text-gray-950">
                        NDVI Zones
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {renderAnalysisPanelSwitch()}
                    <button
                      type="button"
                      onClick={() => toggleAnalysisLayer("ndvi-zones")}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                      title="Tutup NDVI Zones"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_132px] gap-2 rounded-xl border border-emerald-950/10 bg-white px-2.5 py-2 shadow-sm">
                  <div className="min-w-0">
                    <span className="flex items-center gap-1 text-[10px] font-black text-gray-600">
                      <span>NDVI Range</span>
                      <button
                        type="button"
                        className="group relative grid h-4 w-4 place-items-center rounded-full text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 focus:outline-none"
                        aria-label="Info NDVI Range"
                        title="Threshold Min dan Max menentukan rentang nilai NDVI yang akan dijadikan kandidat zona."
                      >
                        <Info className="h-3 w-3" />
                        <span className="pointer-events-none absolute left-0 top-full z-[1003] mt-1 hidden w-48 rounded-lg border border-emerald-100 bg-white px-2 py-1.5 text-left text-[10px] font-semibold leading-snug text-gray-700 shadow-[0_10px_28px_rgba(15,23,42,0.16)] group-hover:block group-focus:block">
                          Threshold Min dan Max menentukan rentang nilai NDVI
                          yang akan dijadikan kandidat zona.
                        </span>
                      </button>
                    </span>

                    <div className="ndvi-range-slider mt-3">
                      <div className="ndvi-range-track" />
                      <div
                        className="ndvi-range-window"
                        style={{
                          left: `${ndviRangeMinPercent}%`,
                          width: `${Math.max(0, ndviRangeMaxPercent - ndviRangeMinPercent)}%`,
                        }}
                      />
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={ndviZoneSettings.ndvi_min}
                        onChange={(event) =>
                          updateNdviZoneSetting("ndvi_min", event.target.value)
                        }
                        className="ndvi-range-input ndvi-range-input-min"
                        style={{
                          zIndex:
                            ndviZoneSettings.ndvi_min >
                            ndviZoneSettings.ndvi_max - 0.12
                              ? 5
                              : 3,
                        }}
                        aria-label="Geser NDVI minimum"
                      />
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={ndviZoneSettings.ndvi_max}
                        onChange={(event) =>
                          updateNdviZoneSetting("ndvi_max", event.target.value)
                        }
                        className="ndvi-range-input ndvi-range-input-max"
                        aria-label="Geser NDVI maksimum"
                      />
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[linear-gradient(to_right,#27272a_0%,#27272a_50%,#ef233c_50%,#f59e0b_60.5%,#7bd85a_70%,#1fbf63_80%,#0f7a3f_90%,#0f7a3f_100%)] shadow-inner" />
                    <div className="mt-0.5 flex justify-between text-[8px] font-bold tabular-nums text-gray-400">
                      <span>-1</span>
                      <span>0</span>
                      <span>1</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="space-y-1">
                      <label className="block">
                        <span className="block text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                          Min
                        </span>
                        <input
                          type="number"
                          min="-1"
                          max="1"
                          step="0.01"
                          value={ndviZoneSettings.ndvi_min}
                          onChange={(event) =>
                            updateNdviZoneSetting(
                              "ndvi_min",
                              event.target.value,
                            )
                          }
                          className="mt-0.5 h-7 w-full rounded-lg border border-gray-200 bg-gray-50 px-1 text-center text-[12px] font-black tabular-nums text-gray-900 outline-none transition-colors focus:border-emerald-700"
                          aria-label="NDVI minimum"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                          Max
                        </span>
                        <input
                          type="number"
                          min="-1"
                          max="1"
                          step="0.01"
                          value={ndviZoneSettings.ndvi_max}
                          onChange={(event) =>
                            updateNdviZoneSetting(
                              "ndvi_max",
                              event.target.value,
                            )
                          }
                          className="mt-0.5 h-7 w-full rounded-lg border border-gray-200 bg-gray-50 px-1 text-center text-[12px] font-black tabular-nums text-gray-900 outline-none transition-colors focus:border-emerald-700"
                          aria-label="NDVI maksimum"
                        />
                      </label>
                    </div>

                    <div className="space-y-1">
                      <label className="block">
                        <span className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                          <span>Area</span>
                          <button
                            type="button"
                            className="group relative grid h-3 w-3 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 focus:outline-none"
                            aria-label="Info area minimum"
                            title="Polygon lebih kecil dari nilai ini dibuang sebagai noise."
                          >
                            <Info className="h-2.5 w-2.5" />
                            <span className="pointer-events-none absolute bottom-full right-0 z-[1003] mb-1 hidden w-44 rounded-lg border border-emerald-100 bg-white px-2 py-1.5 text-left text-[10px] font-semibold leading-snug text-gray-700 shadow-[0_10px_28px_rgba(15,23,42,0.16)] group-hover:block group-focus:block">
                              Polygon lebih kecil dari nilai ini dibuang sebagai
                              noise.
                            </span>
                          </button>
                        </span>
                        <div className="mt-0.5 flex h-7 items-center rounded-lg border border-gray-200 bg-gray-50 px-1 transition-colors focus-within:border-emerald-700">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={ndviZoneSettings.min_area_m2}
                            onChange={(event) =>
                              updateNdviZoneSetting(
                                "min_area_m2",
                                event.target.value,
                              )
                            }
                            className="min-w-0 flex-1 bg-transparent text-center text-[12px] font-black tabular-nums text-gray-900 outline-none"
                          />
                          <span className="shrink-0 text-[8px] font-bold text-gray-400">
                            m2
                          </span>
                        </div>
                      </label>
                      <label className="block">
                        <span className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                          <span>Merge</span>
                          <button
                            type="button"
                            className="group relative grid h-3 w-3 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 focus:outline-none"
                            aria-label="Info merge distance"
                            title="Polygon yang jaraknya dekat akan digabung dalam radius ini."
                          >
                            <Info className="h-2.5 w-2.5" />
                            <span className="pointer-events-none absolute bottom-full right-0 z-[1003] mb-1 hidden w-44 rounded-lg border border-emerald-100 bg-white px-2 py-1.5 text-left text-[10px] font-semibold leading-snug text-gray-700 shadow-[0_10px_28px_rgba(15,23,42,0.16)] group-hover:block group-focus:block">
                              Polygon yang jaraknya dekat akan digabung dalam
                              radius ini.
                            </span>
                          </button>
                        </span>
                        <div className="mt-0.5 flex h-7 items-center rounded-lg border border-gray-200 bg-gray-50 px-1 transition-colors focus-within:border-emerald-700">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={ndviZoneSettings.merge_distance_m}
                            onChange={(event) =>
                              updateNdviZoneSetting(
                                "merge_distance_m",
                                event.target.value,
                              )
                            }
                            className="min-w-0 flex-1 bg-transparent text-center text-[12px] font-black tabular-nums text-gray-900 outline-none"
                          />
                          <span className="shrink-0 text-[8px] font-bold text-gray-400">
                            m
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    onClick={generateNdviZones}
                    disabled={ndviZonesLoading || !selectedImagery}
                    className="flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-[12px] font-black text-white shadow-[0_10px_20px_rgba(6,95,70,0.18)] transition-colors hover:bg-emerald-900 disabled:bg-gray-200 disabled:text-gray-500"
                  >
                    {ndviZonesLoading && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    Generate Zones
                  </button>
                  <button
                    type="button"
                    onClick={approveNdviZones}
                    disabled={
                      approveZonesLoading ||
                      ndviZonesLoading ||
                      ndviZoneFeatures.length === 0
                    }
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 text-[11px] font-black text-emerald-800 shadow-sm transition-colors hover:bg-emerald-50 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                    title="Simpan zona preview sebagai Spray Targets"
                  >
                    {approveZonesLoading && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Approve Zones
                  </button>
                </div>

                {ndviZonesError && (
                  <div className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                    {ndviZonesError}
                  </div>
                )}

                {ndviZonesSummary && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
                        <div className="text-[8px] font-black uppercase tracking-[0.1em] text-emerald-700">
                          Polygon
                        </div>
                        <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                          {ndviZonesSummary.polygon_count}
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
                        <div className="text-[8px] font-black uppercase tracking-[0.1em] text-emerald-700">
                          Area
                        </div>
                        <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                          {formatNumber(ndviZonesSummary.total_area_m2)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-rose-950/10 bg-rose-50 px-2 py-1.5">
                        <div className="text-[8px] font-black uppercase tracking-[0.1em] text-rose-700">
                          Mean
                        </div>
                        <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                          {formatNumber(ndviZonesSummary.mean_ndvi, 4)}
                        </div>
                      </div>
                    </div>
                    {ndviZoneFeatures.length > 0 && (
                      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                        <div className="grid grid-cols-[56px_1fr_76px_72px] items-center gap-2 border-b border-gray-100 bg-gray-50 py-2 pl-2.5 pr-[22px]">
                          <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                            Zona
                          </span>
                          <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                            Area
                          </span>
                          <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                            NDVI
                          </span>
                          <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                            Aksi
                          </span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                          {ndviZoneFeatures.map((feature, index) => {
                            const props = feature.properties ?? {};
                            const zoneId = props.id ?? index + 1;
                            return (
                              <div
                                key={zoneId}
                                className="grid w-full grid-cols-[56px_1fr_76px_72px] items-center gap-2 border-b border-gray-100 px-2.5 py-2 last:border-b-0"
                              >
                                <span className="text-center text-[12px] font-black text-gray-950">
                                  Z{String(zoneId).padStart(2, "0")}
                                </span>
                                <span className="min-w-0 truncate text-center text-[11px] font-black tabular-nums text-gray-700">
                                  {formatNumber(props.area_m2)} m2
                                </span>
                                <span className="inline-flex h-6 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-center text-[10px] font-black tabular-nums text-emerald-800">
                                  {formatNumber(props.mean_ndvi, 4)}
                                </span>
                                <div className="mx-auto flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => focusNdviZone(zoneId)}
                                    className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50"
                                    title="Lihat di peta"
                                  >
                                    <MapPin className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteNdviZone(zoneId)}
                                    className="grid h-8 w-8 place-items-center rounded-xl border border-red-100 bg-white text-red-400 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                                    title="Hapus zone"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {active.has("spray-targets") &&
              activeAnalysisPanel === "spray-targets" && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-black leading-tight text-gray-950">
                      Spray Targets
                    </div>
                    <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
                      Polygon final dari database
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {sprayTargetsLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-rose-600" />
                    )}
                    {renderAnalysisPanelSwitch()}
                  </div>
                </div>
                {sprayTargetsError && (
                  <div className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                    {sprayTargetsError}
                  </div>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-rose-950/10 bg-rose-50 px-2 py-1.5">
                    <div className="text-[8px] font-black uppercase tracking-[0.1em] text-rose-700">
                      Target
                    </div>
                    <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                      {sprayTargetFeatures.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-rose-950/10 bg-rose-50 px-2 py-1.5">
                    <div className="text-[8px] font-black uppercase tracking-[0.1em] text-rose-700">
                      Area
                    </div>
                    <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                      {formatNumber(sprayTargetAreaM2)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
                    <div className="text-[8px] font-black uppercase tracking-[0.1em] text-emerald-700">
                      Ready
                    </div>
                    <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                      {sprayReadyCount}
                    </div>
                  </div>
                </div>
                {sprayTargetFeatures.length > 0 && (
                  <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <div className="grid grid-cols-[58px_minmax(0,1fr)_92px_54px] items-center justify-items-center gap-2 border-b border-gray-100 bg-gray-50 px-2.5 py-2">
                      <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                        Zona
                      </span>
                      <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                        Area
                      </span>
                      <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                        Chamber
                      </span>
                      <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                        Aksi
                      </span>
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                      {sprayTargetFeatures.map((feature, index) => {
                        const props = feature.properties ?? {};
                        const targetId = props.id ?? props.zone_code ?? index;
                        return (
                          <div
                            key={targetId}
                            className="grid w-full grid-cols-[58px_minmax(0,1fr)_92px_54px] items-center justify-items-center gap-2 border-b border-gray-100 px-2.5 py-2 last:border-b-0"
                          >
                            <span className="text-center text-[12px] font-black text-gray-950">
                              {props.zone_code ?? `Z${String(index + 1).padStart(2, "0")}`}
                            </span>
                            <span className="min-w-0 truncate text-center text-[11px] font-black tabular-nums text-gray-700">
                              {formatNumber(props.area_m2)} m2
                            </span>
                            <span
                              className={`inline-flex h-7 w-full max-w-[92px] items-center justify-center rounded-full border px-2 text-center text-[10px] font-black ${
                                props.chamber && props.chamber !== "none"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : "border-gray-200 bg-gray-50 text-gray-400"
                              }`}
                            >
                              {props.chamber ?? "none"}
                            </span>
                            <div className="flex items-center justify-center">
                              <button
                                type="button"
                                onClick={() => focusSprayTarget(targetId)}
                                className="grid h-8 w-9 place-items-center rounded-xl border border-rose-200 bg-white text-rose-700 shadow-sm transition-colors hover:bg-rose-50"
                                title="Lihat di peta"
                              >
                                <MapPin className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {active.has("spraying-route") &&
              activeAnalysisPanel === "spraying-route" && (
              <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-gray-100 pt-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-black leading-tight text-gray-950">
                      Misi Penyemprotan
                    </div>
                    <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
                      Rute, waypoint, dan status drone
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {renderAnalysisPanelSwitch()}
                    <button
                      type="button"
                      onClick={() => toggleAnalysisLayer("spraying-route")}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                      title="Tutup Spraying Route"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {sprayTargetFeatures.length === 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-dashed border-emerald-200 bg-gradient-to-br from-emerald-50 to-cream">
                    <div className="px-4 pb-5 pt-4 text-center">
                      <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-white text-forest shadow-sm ring-1 ring-emerald-100">
                        <Layers className="h-5 w-5" />
                      </div>
                      <div className="text-[13px] font-black text-emerald-950">
                        Belum ada target semprot
                      </div>
                      <p className="mx-auto mt-1 max-w-[310px] text-xs font-semibold leading-snug text-emerald-800">
                        Aktifkan Spray Targets atau approve NDVI Zones terlebih dahulu sebelum membuat rute.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (!active.has("spray-targets")) {
                            toggleAnalysisLayer("spray-targets");
                          } else {
                            setActiveAnalysisPanel("spray-targets");
                          }
                        }}
                        className="mt-4 inline-flex h-9 items-center justify-center rounded-xl bg-forest px-4 text-[11px] font-black text-white shadow-[0_10px_20px_rgba(0,98,65,0.18)] transition-colors hover:bg-house"
                      >
                        Buka Spray Targets
                      </button>
                    </div>
                    <div className="grid grid-cols-3 border-t border-emerald-100 bg-white/70 text-center text-[9px] font-black uppercase tracking-[0.08em] text-emerald-800">
                      <div className="px-2 py-2">Targets</div>
                      <div className="border-x border-emerald-100 px-2 py-2">Route</div>
                      <div className="px-2 py-2">Mission</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
                        <div className="text-[8px] font-black uppercase tracking-[0.1em] text-forest">
                          Target
                        </div>
                        <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                          {sprayTargetFeatures.length}
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
                        <div className="text-[8px] font-black uppercase tracking-[0.1em] text-forest">
                          Waypoint
                        </div>
                        <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                          {routeWaypointCount}
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
                        <div className="text-[8px] font-black uppercase tracking-[0.1em] text-emerald-700">
                          Ready
                        </div>
                        <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
                          {sprayReadyCount}/{sprayTargetFeatures.length}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2.5">
                      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-gray-500">
                        Flight Settings
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="block text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                            Altitude
                          </span>
                          <div className="mt-0.5 flex h-9 items-center rounded-xl border border-gray-200 bg-gray-50 px-2 focus-within:border-forest">
                            <input
                              type="number"
                              min="1"
                              step="0.5"
                              value={routeAltitude}
                              onChange={(event) => setRouteAltitude(Math.max(1, Number(event.target.value) || 1))}
                              className="min-w-0 flex-1 bg-transparent text-center text-[14px] font-black tabular-nums text-gray-900 outline-none"
                            />
                            <span className="text-[10px] font-bold text-gray-400">m</span>
                          </div>
                        </label>
                        <label className="block">
                          <span className="block text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                            Speed
                          </span>
                          <div className="mt-0.5 flex h-9 items-center rounded-xl border border-gray-200 bg-gray-50 px-2 focus-within:border-forest">
                            <input
                              type="number"
                              min="0.5"
                              step="0.5"
                              value={routeSpeed}
                              onChange={(event) => setRouteSpeed(Math.max(0.5, Number(event.target.value) || 0.5))}
                              className="min-w-0 flex-1 bg-transparent text-center text-[14px] font-black tabular-nums text-gray-900 outline-none"
                            />
                            <span className="text-[10px] font-bold text-gray-400">m/s</span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2">
                      <button
                        type="button"
                        className="flex h-10 items-center justify-center rounded-xl bg-forest px-4 text-[12px] font-black text-white shadow-[0_10px_20px_rgba(0,98,65,0.18)] transition-colors hover:bg-house"
                      >
                        Generate Route
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled
                          className="flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-3 text-[11px] font-black text-gray-400"
                          title="Belum terhubung ke backend drone"
                        >
                          Upload Mission
                        </button>
                        <button
                          type="button"
                          disabled
                          className="flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-3 text-[11px] font-black text-gray-400"
                          title="Belum terhubung ke backend drone"
                        >
                          Execute
                        </button>
                      </div>
                    </div>
                  </>
                )}

              </div>
            )}
          </div>
            </div>
          </>
        )}

        {/* NDVI Health Stats */}
        {active.has("ndvi") && (
          <div className="absolute right-4 top-[208px] z-[1000] w-[min(314px,calc(100vw-32px))] lg:right-20 lg:top-4">
            <div className="max-h-[calc(100dvh-160px)] overflow-y-auto overscroll-contain rounded-[20px] border border-white/70 bg-white/95 shadow-[0_18px_45px_rgba(15,23,42,0.18)] backdrop-blur lg:max-h-[calc(100dvh-88px)]">
              <div className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-lime-700 px-4 pb-3 pt-3 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/14 ring-1 ring-white/20">
                      <Sprout className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-bold leading-tight">
                        Kesehatan Tanaman
                      </div>
                      <div className="text-[10px] font-medium text-emerald-50/75">
                        Analisis NDVI area aktif
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full bg-white/14 px-2.5 py-1 text-right text-[11px] font-bold tabular-nums text-white ring-1 ring-white/20">
                    {ndviStats ? ndviStats.total_area_ha : "-"} Ha
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-emerald-200/25 bg-white/10 px-3 py-2 shadow-inner">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-50/70">
                      Dominan
                    </div>
                    <div className="truncate text-[14px] font-bold">
                      {dominantNdvi?.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[22px] font-black leading-none tabular-nums">
                      {Math.round(Number(dominantNdvi?.percentage || 0))}%
                    </div>
                    <div className="text-[9px] font-semibold text-emerald-50/70">
                      {dominantNdvi?.area_ha} Ha
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-4 pb-2 pt-2.5">
                <div className="mb-1.5 text-[10px] font-semibold text-gray-500">
                  <span>Skala NDVI</span>
                </div>
                <div
                  className="h-2.5 w-full rounded-full shadow-inner"
                  style={{
                    background:
                      "linear-gradient(to right,#27272a 0%,#27272a 50%,#ef233c 50%,#f59e0b 60.5%,#7bd85a 70%,#1fbf63 80%,#0f7a3f 90%,#0f7a3f 100%)",
                  }}
                />
                <div className="relative mt-0.5 h-3">
                  {[
                    { label: "-1", left: "0%" },
                    { label: "0", left: "50%" },
                    { label: "0.4", left: "70%" },
                    { label: "0.8", left: "90%" },
                    { label: "1", left: "100%" },
                  ].map(({ label, left }) => (
                    <span
                      key={label}
                      className="absolute -translate-x-1/2 text-[9px] font-medium tabular-nums text-gray-400"
                      style={{ left }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mx-4 h-px bg-gray-100" />

              <div className="space-y-0.5 px-3 pb-2.5 pt-2">
                {ndviCategories.map((cat) => (
                  <div
                    key={cat.name}
                    className="rounded-xl border border-transparent px-2.5 py-1 transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(15,23,42,0.05)]"
                          style={{ background: cat.color }}
                        />
                        <span className="min-w-0 truncate text-[12px] font-bold leading-tight text-gray-800">
                          {cat.name}
                        </span>
                        <span className="shrink-0 text-[9.5px] font-semibold tabular-nums text-gray-400">
                          NDVI {cat.range}
                        </span>
                      </div>
                      <span className="shrink-0 text-[12px] font-extrabold tabular-nums text-gray-800">
                        {cat.percentage}%
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-[18px]">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80 shadow-inner">
                        <div
                          className="h-full min-w-[8px] rounded-full shadow-[0_0_0_1px_rgba(15,23,42,0.04)]"
                          style={{
                            width: `${Math.min(100, Math.max(0, Number(cat.percentage || 0)))}%`,
                            background: cat.color,
                          }}
                        />
                      </div>
                      <span className="w-[66px] shrink-0 text-right text-[10px] font-bold tabular-nums text-gray-500">
                        {cat.area_ha} Ha
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {routeActive && (
          <div className="absolute bottom-6 left-4 right-20 z-[1000] flex justify-end lg:left-auto lg:max-w-[calc(100vw-8rem)]">
            <div className="max-w-full rounded-2xl border border-white/15 bg-slate-950/76 px-3 py-1.5 text-white shadow-[0_14px_34px_rgba(15,23,42,0.32)] backdrop-blur-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400 ring-4 ring-slate-400/15" />
                  <span className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-slate-100">
                    Drone Offline
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!telemetryCollapsed && (
                    <span className="rounded-full bg-slate-700/80 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-slate-100 ring-1 ring-white/10">
                      Mission Idle
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setTelemetryCollapsed((collapsed) => !collapsed)}
                    className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-slate-100 ring-1 ring-white/10 transition hover:bg-white/20"
                    aria-label={telemetryCollapsed ? "Expand telemetry" : "Collapse telemetry"}
                    title={telemetryCollapsed ? "Expand telemetry" : "Collapse telemetry"}
                  >
                    {telemetryCollapsed ? (
                      <ChevronLeft className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
              {!telemetryCollapsed && (
                <div className="mt-1.5 grid max-h-[34dvh] gap-1.5 overflow-y-auto overscroll-contain pr-1 text-[10px] font-bold tabular-nums text-slate-50 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl bg-white/7 px-2 py-1.5 ring-1 ring-white/8">
                    <div className="mb-1 text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">
                      Flight State
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span><span className="text-slate-400">Connected</span> No Link</span>
                      <span><span className="text-slate-400">Armed</span> Disarmed</span>
                      <span><span className="text-slate-400">Guided</span> No</span>
                      <span><span className="text-slate-400">Manual</span> -</span>
                      <span><span className="text-slate-400">Mode</span> -</span>
                      <span><span className="text-slate-400">System</span> -</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/7 px-2 py-1.5 ring-1 ring-white/8">
                    <div className="mb-1 text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">
                      GPS
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span><span className="text-slate-400">Fix</span> No Fix</span>
                      <span><span className="text-slate-400">Sat</span> -</span>
                      <span><span className="text-slate-400">Lat</span> -</span>
                      <span><span className="text-slate-400">Lon</span> -</span>
                      <span><span className="text-slate-400">Speed</span> -</span>
                      <span><span className="text-slate-400">Course</span> -</span>
                      <span><span className="text-slate-400">EPH</span> -</span>
                      <span><span className="text-slate-400">EPV</span> -</span>
                      <span><span className="text-slate-400">Alt MSL</span> -</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/7 px-2 py-1.5 ring-1 ring-white/8">
                    <div className="mb-1 text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">
                      Global Position
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span><span className="text-slate-400">Lat</span> -</span>
                      <span><span className="text-slate-400">Lon</span> -</span>
                      <span><span className="text-slate-400">Alt Ellip</span> -</span>
                      <span><span className="text-slate-400">Source</span> -</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/7 px-2 py-1.5 ring-1 ring-white/8">
                    <div className="mb-1 text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">
                      IMU
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span><span className="text-slate-400">Accel X</span> -</span>
                      <span><span className="text-slate-400">Accel Y</span> -</span>
                      <span><span className="text-slate-400">Accel Z</span> -</span>
                      <span><span className="text-slate-400">Gyro X</span> -</span>
                      <span><span className="text-slate-400">Gyro Y</span> -</span>
                      <span><span className="text-slate-400">Gyro Z</span> -</span>
                      <span><span className="text-slate-400">Quat X</span> -</span>
                      <span><span className="text-slate-400">Quat Y</span> -</span>
                      <span><span className="text-slate-400">Quat Z</span> -</span>
                      <span><span className="text-slate-400">Quat W</span> -</span>
                      <span><span className="text-slate-400">Heading</span> -</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute right-4 top-[82px] z-[1000] overflow-hidden rounded-[16px] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:top-4">
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
        <div className="absolute right-4 top-[188px] z-[1000] sm:top-[120px]">
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
            <div className="absolute right-[56px] top-0 w-[min(360px,calc(100vw-88px))] rounded-2xl bg-card p-3 shadow-soft animate-fade-up sm:p-3.5">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="text-[14px] font-bold text-foreground">
                  Map type
                </div>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Tutup lapisan"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-2.5 grid grid-cols-3 gap-2">
                {Object.entries(BASE_LAYERS).map(([id, layer]) => (
                  <button
                    key={id}
                    onClick={() => setBaseLayer(id)}
                    className={`group flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-semibold transition-colors hover:bg-muted sm:text-xs ${baseLayer === id ? "text-forest" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`block h-12 w-12 overflow-hidden rounded-xl border-2 bg-white p-0.5 sm:h-[56px] sm:w-[56px] ${baseLayer === id ? "border-leaf ring-2 ring-leaf/20" : "border-border"}`}
                    >
                      <img
                        src={layer.preview}
                        alt={layer.label}
                        className="h-full w-full rounded-[8px] object-cover"
                      />
                    </span>
                    {layer.label}
                  </button>
                ))}
              </div>

              <div className="mb-1.5 border-t border-border pt-2 text-[14px] font-bold text-foreground">
                Map Imagery
              </div>
              {imageryError && (
                <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                  {imageryError}
                </div>
              )}
              <div className="mb-2.5 grid grid-cols-3 gap-2">
                {MAP_IMAGERY_LAYERS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => toggleImageryLayer(l.id)}
                    disabled={imageryLoading}
                    className={`group flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-semibold transition-colors hover:bg-muted sm:text-xs ${active.has(l.id) ? "text-forest" : "text-muted-foreground"} disabled:opacity-60`}
                  >
                    <span
                      className={`relative block h-12 w-12 overflow-hidden rounded-xl border-2 bg-white p-0.5 sm:h-[56px] sm:w-[56px] ${active.has(l.id) ? "border-leaf ring-2 ring-leaf/20" : "border-border"}`}
                    >
                      <img
                        src={l.preview}
                        alt={l.label}
                        className="h-full w-full rounded-[8px] object-cover"
                      />
                      {imageryLoading && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-[8px] bg-white/70">
                          <Loader2 className="h-4 w-4 animate-spin text-forest" />
                        </span>
                      )}
                    </span>
                    {l.label}
                  </button>
                ))}
              </div>

              <div className="mb-1.5 border-t border-border pt-2 text-[14px] font-bold text-foreground">
                Map Analysis
              </div>
              <div className="grid grid-cols-3 gap-2">
                {MAP_ANALYSIS_LAYERS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => toggleAnalysisLayer(l.id)}
                    className={`group flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-semibold transition-colors hover:bg-muted sm:text-xs ${active.has(l.id) ? "text-forest" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`block h-12 w-12 overflow-hidden rounded-xl border-2 bg-white p-0.5 sm:h-[56px] sm:w-[56px] ${active.has(l.id) ? "border-leaf ring-2 ring-leaf/20" : "border-border"}`}
                    >
                      <img
                        src={l.preview}
                        alt={l.label}
                        className="h-full w-full rounded-[8px] object-cover"
                      />
                    </span>
                    <span className="w-full text-center leading-tight">
                      {l.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Drone tools */}
        <Button
          size="icon"
          variant="outline"
          className={`absolute right-4 top-[248px] z-[1000] h-12 w-12 rounded-[16px] border-0 bg-white text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:bg-gray-50 sm:top-[180px] ${
            routeActive ? "ring-2 ring-leaf/30" : ""
          }`}
          onClick={() => {
            if (!routeActive) toggleAnalysisLayer("spraying-route");
            setActiveAnalysisPanel("spraying-route");
          }}
          title="Drone Tools"
        >
          <Drone className="h-5 w-5" />
        </Button>

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
