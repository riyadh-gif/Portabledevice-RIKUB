import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import {
  ArrowLeft, MapPinned, Pencil, Ban, Undo2, Check, Trash2, Plane, Loader2,
  AlertTriangle, Camera, Compass, Layers, Image as ImageIcon, Ruler, Timer,
  Crosshair, Grid3x3, CircleDashed, X, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/gcs/basemap";
import { DroneTelemetryProvider } from "@/components/gcs/DroneTelemetryProvider";
import { PreFlightAuditModal } from "@/components/gcs/PreFlightAuditModal";
import { diagnosticsCoords, headingDeg, useDiagnostics } from "@/lib/gcs/diagnostics";
import { pushCaptureMission, executeMission, fetchMappingMissionStatus } from "@/lib/gcs/api";
import { pathLengthMeters, haversineMeters, defaultAngleDeg } from "@/lib/gcs/flight-geo";
import {
  CAMERA_PRESETS, DEFAULT_CAMERA, cameraById, surveySpacing, planSurvey,
} from "@/lib/gcs/survey-grid";
import {
  useDroneOffset, hasOffset, applyOffsetToCoords, correctGeoWaypointsForCommand,
} from "@/lib/gcs/drone-offset";

const NOMINAL_SPEED_MPS = 5; // display-only estimate for flight-time (WPNAV cruise)
const MIN_CIRCLE_RADIUS_M = 1;
const TERMINAL_PHASES = new Set(["complete", "failed", "canceled"]);

const AREA_STYLE = { color: "#006241", weight: 2.5, fillColor: "#00754A", fillOpacity: 0.14, lineJoin: "round" };
const OBSTACLE_STYLE = { color: "#1e293b", weight: 2, fillColor: "#334155", fillOpacity: 0.35, dashArray: "5 4", interactive: false };

// Survey-station dot style — hundreds can render at once for a dense grid, so use
// lightweight canvas circleMarkers (not divIcon markers) to keep the map smooth.
const CAPTURE_DOT = { radius: 3.5, color: "#ffffff", weight: 1.5, fillColor: "#f59e0b", fillOpacity: 1, interactive: false };

function droneIcon(rotationDeg) {
  const deg = Number.isFinite(rotationDeg) ? rotationDeg - 45 : 0;
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="position:relative;width:34px;height:34px">
      <svg width="22" height="22" viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;margin-left:-11px;margin-top:-11px;filter:drop-shadow(0 3px 6px rgba(0,41,82,0.5));transform:rotate(${deg}deg)"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" fill="#005bb3" stroke="white" stroke-width="1"/></svg>
    </div>`,
  });
}

// In-progress polygon draft (vertices + edges), drawn into a layer group.
function drawDraft(group, pts, center) {
  if (!group) return;
  group.clearLayers();
  const dot = { color: "#0f172a", fillColor: "#ffffff", fillOpacity: 1, weight: 2, interactive: false };
  if (center) L.circleMarker([center.lat, center.lng], { ...dot, radius: 5, fillColor: "#0f172a" }).addTo(group);
  if (pts.length >= 2) {
    L.polyline(pts.map((p) => [p.lat, p.lng]), { color: "#0f172a", weight: 2, dashArray: "5 4", interactive: false }).addTo(group);
  }
  for (const p of pts) L.circleMarker([p.lat, p.lng], { ...dot, radius: 4 }).addTo(group);
}

function ringAreaHa(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  try {
    const coords = ring.map((c) => [c.lng, c.lat]);
    coords.push(coords[0]);
    return turf.area(turf.polygon([coords])) / 10_000;
  } catch {
    return 0;
  }
}

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-leaf/10 text-leaf"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

// A slider whose value can also be typed directly and pushed BEYOND the slider's
// [min,max] — the slider covers the common range, the number input is the escape
// hatch. Only a sane positive hard bound [hardMin,hardMax] is enforced so the
// GSD/spacing math stays finite; the slider thumb clamps into range when the
// value is outside it. Optional `icon` (lucide) + `action` (e.g. an "Auto"
// button) render in the header.
function SliderInputRow({ label, value, suffix, min, max, step, onChange, hardMin = 1, hardMax = 999, icon: Icon, action }) {
  const commit = (raw) => {
    if (raw === "" || raw == null) return; // let the field clear while typing
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.max(hardMin, Math.min(hardMax, n)));
  };
  const outOfSliderRange = value < min || value > max;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {Icon && <Icon className="h-3.5 w-3.5" />}{label}
        </label>
        <div className="flex items-center gap-1.5">
          {action}
          <input
            type="number" inputMode="decimal" min={hardMin} max={hardMax} step={step} value={value}
            onChange={(e) => commit(e.target.value)}
            className="w-14 rounded-lg border border-border bg-card px-2 py-1 text-right text-sm font-bold tabular-nums text-forest outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
          />
          <span className="text-sm font-bold text-forest">{suffix.trim()}</span>
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={Math.max(min, Math.min(max, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-leaf"
      />
      {outOfSliderRange && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">Di luar rentang umum ({min}–{max}{suffix}) — nilai manual dipakai.</p>
      )}
    </div>
  );
}

export function MappingPlan() {
  const navigate = useNavigate();
  const { data: diag } = useDiagnostics();
  const offset = useDroneOffset();
  const drone = diagnosticsCoords(diag); // raw {lat, lon}
  const displayDrone = applyOffsetToCoords(drone, offset); // {lat, lng} drift-corrected
  const displayLat = displayDrone?.lat ?? null;
  const displayLng = displayDrone?.lng ?? null;
  const displayHeading = headingDeg(diag);
  const droneAvailable = displayLat != null && displayLng != null;

  // --- Geometry (real lat/lng) ---
  const [areas, setAreas] = useState([]); // [{ id, ring: [{lat,lng}] }]
  const [obstacles, setObstacles] = useState([]); // planFlightPath shape
  const [drawMode, setDrawMode] = useState("none"); // none | area | obstacle | circle
  const [draftCount, setDraftCount] = useState(0);
  const [draftHasCenter, setDraftHasCenter] = useState(false);

  // --- Coverage / camera settings ---
  const [cameraId, setCameraId] = useState(DEFAULT_CAMERA.id);
  const [altitude, setAltitude] = useState(40);
  const [frontOverlap, setFrontOverlap] = useState(75);
  const [sideOverlap, setSideOverlap] = useState(65);
  const [angleDeg, setAngleDeg] = useState(0);
  const [angleTouched, setAngleTouched] = useState(false);
  const [holdTime, setHoldTime] = useState(2);
  const [startFromDrone, setStartFromDrone] = useState(true);

  // --- Launch / mission state ---
  const [showAudit, setShowAudit] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [mission, setMission] = useState(null); // MappingMissionStatus once flying
  const [polling, setPolling] = useState(false); // drives the status poll loop
  const [error, setError] = useState(null);

  const mapDiv = useRef(null);
  const map = useRef(null);
  const areasLayer = useRef(null);
  const obstaclesLayer = useRef(null);
  const draftLayer = useRef(null);
  const pathLayer = useRef(null);
  const capturesLayer = useRef(null);
  const droneMarker = useRef(null);
  const draftPts = useRef([]);
  const draftCenter = useRef(null);
  const geomId = useRef(0);
  const onMapClick = useRef(null);
  const seededView = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const cam = useMemo(() => cameraById(cameraId), [cameraId]);
  const spacing = useMemo(
    () => surveySpacing(cam, { altitudeM: altitude, frontOverlap, sideOverlap }),
    [cam, altitude, frontOverlap, sideOverlap],
  );

  const startLngLat = startFromDrone && droneAvailable ? { lat: displayLat, lng: displayLng } : null;
  const hasAreas = areas.some((a) => a.ring.length >= 3);

  const survey = useMemo(() => {
    if (!hasAreas) return { geoPath: [], captures: [], plan: null };
    return planSurvey({
      areas: areas.filter((a) => a.ring.length >= 3),
      obstacles,
      laneSpacing: spacing.laneSpacing,
      photoSpacing: spacing.photoSpacing,
      angleDeg,
      startLngLat,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, obstacles, spacing.laneSpacing, spacing.photoSpacing, angleDeg, startLngLat?.lat, startLngLat?.lng, hasAreas]);

  const captures = survey.captures;
  const geoPath = survey.geoPath;
  const photoCount = captures.length;
  const distanceM = geoPath.length >= 2 ? pathLengthMeters(geoPath) : 0;
  const areaHa = useMemo(() => areas.reduce((s, a) => s + ringAreaHa(a.ring), 0), [areas]);
  const estSeconds = distanceM / NOMINAL_SPEED_MPS + photoCount * holdTime;

  // --- Leaflet init (once) ---------------------------------------------------
  useEffect(() => {
    const container = mapDiv.current;
    if (!container) return;
    const m = L.map(container, { zoomControl: true, maxZoom: 24, center: [DEFAULT_CENTER[1], DEFAULT_CENTER[0]], zoom: DEFAULT_ZOOM });
    const sat = BASE_LAYERS.satellite;
    L.tileLayer(sat.url, { attribution: sat.attribution, maxNativeZoom: sat.maxNativeZoom, maxZoom: sat.maxZoom }).addTo(m);
    areasLayer.current = L.featureGroup().addTo(m);
    obstaclesLayer.current = L.layerGroup().addTo(m);
    pathLayer.current = L.layerGroup().addTo(m);
    capturesLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    m.on("click", (e) => onMapClick.current?.(e));
    map.current = m;
    setMapReady(true);
    return () => {
      m.remove();
      map.current = null;
      areasLayer.current = obstaclesLayer.current = pathLayer.current = null;
      capturesLayer.current = draftLayer.current = droneMarker.current = null;
      setMapReady(false);
    };
  }, []);

  // Center on the drone the first time a fix arrives while the canvas is empty.
  useEffect(() => {
    if (!mapReady || seededView.current || !droneAvailable) return;
    if (areas.length || obstacles.length) return;
    seededView.current = true;
    map.current?.setView([displayLat, displayLng], 18);
  }, [mapReady, droneAvailable, displayLat, displayLng, areas.length, obstacles.length]);

  // --- Map click delegation (append vertices / place circle) ------------------
  useEffect(() => {
    onMapClick.current = (e) => {
      const { lat, lng } = e.latlng;
      if (drawMode === "area" || drawMode === "obstacle") {
        draftPts.current = [...draftPts.current, { lat, lng }];
        setDraftCount(draftPts.current.length);
        drawDraft(draftLayer.current, draftPts.current, draftCenter.current);
      } else if (drawMode === "circle") {
        if (!draftCenter.current) {
          draftCenter.current = { lat, lng };
          setDraftHasCenter(true);
          drawDraft(draftLayer.current, [], draftCenter.current);
        } else {
          const radiusM = haversineMeters(draftCenter.current, { lat, lng });
          if (radiusM < MIN_CIRCLE_RADIUS_M) return;
          geomId.current += 1;
          setObstacles((prev) => [...prev, { id: geomId.current, kind: "circle", center: { ...draftCenter.current }, radiusM }]);
          draftCenter.current = null;
          setDraftHasCenter(false);
          setDrawMode("none");
          drawDraft(draftLayer.current, [], null);
        }
      }
    };
  });

  // --- Render survey areas ---------------------------------------------------
  useEffect(() => {
    const group = areasLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const a of areas) {
      if (a.ring.length < 3) continue;
      L.polygon(a.ring.map((p) => [p.lat, p.lng]), { ...AREA_STYLE, interactive: false }).addTo(group);
    }
  }, [areas]);

  // --- Render obstacles ------------------------------------------------------
  useEffect(() => {
    const group = obstaclesLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const o of obstacles) {
      if (o.kind === "polygon" && o.ring?.length >= 3) L.polygon(o.ring.map((p) => [p.lat, p.lng]), OBSTACLE_STYLE).addTo(group);
      else if (o.kind === "circle" && o.radiusM > 0) L.circle([o.center.lat, o.center.lng], { radius: o.radiusM, ...OBSTACLE_STYLE }).addTo(group);
    }
  }, [obstacles]);

  // --- Render coverage path + capture stations -------------------------------
  useEffect(() => {
    const pg = pathLayer.current;
    const cg = capturesLayer.current;
    if (!pg || !cg) return;
    pg.clearLayers();
    cg.clearLayers();
    if (geoPath.length >= 2) {
      L.polyline(geoPath.map((p) => [p.lat, p.lng]), { color: "#059669", weight: 2.5, opacity: 0.9, interactive: false }).addTo(pg);
    }
    for (const c of captures) L.circleMarker([c.lat, c.lng], CAPTURE_DOT).addTo(cg);
  }, [geoPath, captures]);

  // --- Live drone marker -----------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!droneAvailable) {
      if (droneMarker.current) { m.removeLayer(droneMarker.current); droneMarker.current = null; }
      return;
    }
    const pos = [displayLat, displayLng];
    if (droneMarker.current) {
      droneMarker.current.setLatLng(pos);
      droneMarker.current.setIcon(droneIcon(displayHeading));
    } else {
      droneMarker.current = L.marker(pos, { icon: droneIcon(displayHeading), zIndexOffset: 1200, interactive: false }).addTo(m);
    }
  }, [droneAvailable, displayLat, displayLng, displayHeading]);

  // --- Poll the capture mission once it's flying -----------------------------
  // Gated on `polling` (a stable flag), NOT on `mission` — the loop calls
  // setMission() on every tick, so depending on `mission` would restart the
  // effect each response and fire back-to-back polls with no delay.
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    let timer;
    async function tick() {
      try {
        const s = await fetchMappingMissionStatus();
        if (!alive) return;
        setMission(s);
        // odm_job_id is populated at mission end — jump straight to the session.
        if (s?.odm_job_id) { setPolling(false); navigate(`/mapping/${encodeURIComponent(s.odm_job_id)}`); return; }
        // Real terminal (failed/canceled/complete-without-session): stop polling
        // and let the operator open the repository. `idle`/`arming` are NOT
        // terminal — they can appear before the mission spins up, so keep going.
        if (s && !s.running && TERMINAL_PHASES.has(s.phase)) { setPolling(false); return; }
        timer = setTimeout(tick, 3000);
      } catch {
        if (alive) timer = setTimeout(tick, 5000);
      }
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [polling, navigate]);

  // --- Drawing controls ------------------------------------------------------
  function startDraw(mode) {
    draftPts.current = [];
    draftCenter.current = null;
    setDraftCount(0);
    setDraftHasCenter(false);
    drawDraft(draftLayer.current, [], null);
    setDrawMode(mode);
  }
  function cancelDraw() {
    draftPts.current = [];
    draftCenter.current = null;
    setDraftCount(0);
    setDraftHasCenter(false);
    drawDraft(draftLayer.current, [], null);
    setDrawMode("none");
  }
  function undoPoint() {
    draftPts.current = draftPts.current.slice(0, -1);
    setDraftCount(draftPts.current.length);
    drawDraft(draftLayer.current, draftPts.current, draftCenter.current);
  }
  function finishPolygon() {
    if (draftPts.current.length < 3) return;
    const ring = draftPts.current;
    geomId.current += 1;
    if (drawMode === "area") {
      const id = geomId.current;
      setAreas((prev) => [...prev, { id, ring }]);
      if (!angleTouched) setAngleDeg(defaultAngleDeg([{ ring }]));
    } else {
      setObstacles((prev) => [...prev, { id: geomId.current, kind: "polygon", ring }]);
    }
    cancelDraw();
  }
  function clearAll() {
    setAreas([]);
    setObstacles([]);
    cancelDraw();
  }

  // --- Launch ----------------------------------------------------------------
  async function handleLaunch() {
    if (photoCount === 0) { setError("Belum ada titik foto — gambar area pemetaan dulu."); setShowAudit(false); return; }
    setLaunching(true);
    setError(null);
    try {
      const sessionId = `map-${Date.now().toString(36)}`;
      // Capture points are planned in the MAP frame; shift into the drone's
      // (drifted) GPS frame before sending so it flies the intended ground track.
      const commandPoints = correctGeoWaypointsForCommand(captures, offset);
      await pushCaptureMission({ capturePoints: commandPoints, altitude, holdTime, sessionId });
      await executeMission({ mode: "mapping", altitude, jobId: sessionId });
      setShowAudit(false);
      setMission({ running: true, session_id: sessionId, phase: "arming", captures_done: 0, total_captures: photoCount, odm_job_id: "", last_error: "" });
      setPolling(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai misi pemetaan");
      setShowAudit(false);
    } finally {
      setLaunching(false);
    }
  }

  const drawing = drawMode !== "none";
  const gsdCm = spacing.gsd > 0 ? (spacing.gsd * 100).toFixed(2) : "—";

  const inputCls = "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20";

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 shadow-sm backdrop-blur">
        <Button variant="outline" size="sm" onClick={() => navigate("/mapping")}><ArrowLeft className="h-4 w-4" /> Pemetaan</Button>
        <div className="flex min-w-0 items-center gap-2">
          <MapPinned className="h-5 w-5 shrink-0 text-harvest" strokeWidth={1.9} />
          <div className="min-w-0 text-center">
            <div className="truncate text-sm font-bold leading-tight text-forest">Rencana Misi Pemetaan</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-leaf">Survey Fotogrametri Otonom</div>
          </div>
        </div>
        <div className="w-[92px]" aria-hidden />
      </header>

      <DroneTelemetryProvider />

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0 bg-[#dfe8e2]" />

        {/* Draw hint banner */}
        {drawing && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur">
            {drawMode === "circle"
              ? draftHasCenter ? "Ketuk lagi untuk menetapkan radius rintangan" : "Ketuk untuk menetapkan pusat rintangan lingkaran"
              : drawMode === "obstacle" ? "Ketuk untuk menambah titik rintangan" : "Ketuk untuk menambah titik area pemetaan"}
          </div>
        )}

        {/* Control panel */}
        <div className="pointer-events-none absolute right-3 top-3 bottom-3 z-[1000] flex w-[300px] max-w-[calc(100vw-24px)] items-start">
          <Card className="pointer-events-auto flex max-h-full w-full flex-col overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-bold text-forest">Perencanaan</h2>
              {(areas.length > 0 || obstacles.length > 0) && !drawing && (
                <button onClick={clearAll} className="inline-flex items-center gap-1 text-xs font-semibold text-destructive hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Bersihkan
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {drawing ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    {drawMode === "circle"
                      ? "Ketuk pusat lalu radius rintangan lingkaran."
                      : `${draftCount} titik — minimal 3 untuk menyelesaikan.`}
                  </p>
                  {drawMode !== "circle" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={undoPoint} disabled={draftCount === 0}><Undo2 className="h-4 w-4" /> Undo</Button>
                      <Button variant="accent" size="sm" onClick={finishPolygon} disabled={draftCount < 3}><Check className="h-4 w-4" /> Selesai</Button>
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={cancelDraw}><Ban className="h-4 w-4" /> Batal</Button>
                </div>
              ) : mission ? (
                <MissionProgress mission={mission} onOpenList={() => navigate("/mapping")} />
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Geometry */}
                  <div className="flex flex-col gap-2">
                    <Button variant="accent" onClick={() => startDraw("area")}><Pencil className="h-4 w-4" /> Gambar Area Pemetaan</Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={() => startDraw("obstacle")} disabled={!hasAreas} title={hasAreas ? "" : "Gambar area dulu"}><Grid3x3 className="h-4 w-4" /> Rintangan</Button>
                      <Button variant="outline" size="sm" onClick={() => startDraw("circle")} disabled={!hasAreas} title={hasAreas ? "" : "Gambar area dulu"}><CircleDashed className="h-4 w-4" /> Lingkaran</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {areas.length} area · {obstacles.length} rintangan{obstacles.length === 1 ? "" : ""}
                    </p>
                  </div>

                  {hasAreas && (
                    <>
                      {/* Camera + coverage */}
                      <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
                        <div>
                          <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Camera className="h-3.5 w-3.5" /> Kamera</label>
                          <select className={inputCls} value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                            {CAMERA_PRESETS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                        </div>
                        <SliderInputRow label="Ketinggian" value={altitude} suffix=" m" min={5} max={40} step={1} onChange={setAltitude} hardMin={1} hardMax={400} />
                        <SliderInputRow label="Tumpang Tindih Depan" value={frontOverlap} suffix="%" min={40} max={90} step={5} onChange={setFrontOverlap} hardMin={0} hardMax={95} />
                        <SliderInputRow label="Tumpang Tindih Samping" value={sideOverlap} suffix="%" min={40} max={90} step={5} onChange={setSideOverlap} hardMin={0} hardMax={95} />
                        <SliderInputRow
                          label="Sudut Jalur" icon={Compass} value={angleDeg} suffix="°"
                          min={0} max={180} step={5} hardMin={0} hardMax={360}
                          onChange={(v) => { setAngleTouched(true); setAngleDeg(v); }}
                          action={<button onClick={() => { setAngleTouched(false); setAngleDeg(defaultAngleDeg(areas.filter((a) => a.ring.length >= 3))); }} className="text-[11px] font-semibold text-leaf hover:underline">Auto</button>}
                        />
                        <SliderInputRow label="Jeda / Foto" value={holdTime} suffix=" s" min={0} max={6} step={0.5} onChange={setHoldTime} hardMin={0} hardMax={60} />
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Crosshair className="h-3.5 w-3.5" /> Mulai dari drone</span>
                          <input type="checkbox" checked={startFromDrone} onChange={(e) => setStartFromDrone(e.target.checked)} disabled={!droneAvailable} className="h-4 w-4 accent-leaf" />
                        </label>
                      </div>

                      {/* Derived stats */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border/70 pt-3">
                        <Stat icon={ImageIcon} label="Titik Foto" value={String(photoCount)} />
                        <Stat icon={Grid3x3} label="GSD" value={`≈ ${gsdCm} cm/px`} />
                        <Stat icon={Layers} label="Cakupan" value={`${areaHa.toFixed(2)} ha`} />
                        <Stat icon={Ruler} label="Jarak" value={distanceM > 0 ? `${(distanceM / 1000).toFixed(2)} km` : "—"} />
                        <Stat icon={Timer} label="Estimasi" value={fmtDuration(estSeconds)} />
                        <Stat icon={Grid3x3} label="Jarak Jalur" value={`${spacing.laneSpacing.toFixed(1)} m`} />
                      </div>

                      {hasOffset(offset) && (
                        <p className="rounded-lg bg-leaf/10 px-2.5 py-1.5 text-[10px] text-forest">
                          Kalibrasi drift GPS aktif — titik foto dikoreksi ke frame drone saat dikirim.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {error && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>

            {!drawing && !mission && (
              <div className="border-t border-border p-3">
                <Button variant="accent" className="w-full" disabled={photoCount === 0 || launching} onClick={() => setShowAudit(true)}>
                  {launching ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</> : <><Plane className="h-4 w-4" /> Terbangkan Misi ({photoCount} foto)</>}
                </Button>
                {photoCount === 0 && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Gambar area pemetaan untuk membuat titik foto.</p>}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* BAYUCARAKA pre-flight audit (same gate as the spray planner) */}
      <div className="relative z-[2000] gcs-app">
        <PreFlightAuditModal isOpen={showAudit} onClose={() => setShowAudit(false)} onExecute={handleLaunch} />
      </div>
    </div>
  );
}

function MissionProgress({ mission, onOpenList }) {
  const total = mission.total_captures || 0;
  const done = mission.captures_done || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const failed = mission.phase === "failed" || mission.last_error;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {failed
          ? <AlertTriangle className="h-5 w-5 text-destructive" />
          : mission.running
            ? <Loader2 className="h-5 w-5 animate-spin text-harvest" />
            : <CheckCircle2 className="h-5 w-5 text-leaf" />}
        <div>
          <p className="text-sm font-bold text-forest">
            {failed ? "Misi gagal" : mission.running ? "Menerbangkan misi…" : "Misi selesai"}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Fase: {mission.phase || "—"}</p>
        </div>
      </div>

      {total > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Foto terambil</span>
            <span className="tabular-nums">{done}/{total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-harvest transition-all duration-300" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
        </div>
      )}

      {mission.last_error && (
        <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {mission.last_error}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Saat misi selesai, hasil pemetaan (orthophoto & zona) akan otomatis diproses dan halaman ini membuka detailnya.
      </p>
      <Button variant="outline" size="sm" onClick={onOpenList}>Buka daftar pemetaan</Button>
    </div>
  );
}
