import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, Route as RouteIcon, MapPinned } from "lucide-react";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { DroneTelemetryProvider } from "@/components/gcs/DroneTelemetryProvider";
import { diagnosticsCoords, headingDeg, useDiagnostics } from "@/lib/gcs/diagnostics";
import { PreFlightAuditModal } from "@/components/gcs/PreFlightAuditModal";
import { FlightControlsPanel } from "@/components/maps/flight-plan/FlightControlsPanel";
import { setMissionPlan } from "@/lib/gcs/mission-plan";
import { pushSprayMission, executeMission, cancelSprayMission } from "@/lib/gcs/api";
import { ratesFromChambers } from "@/lib/gcs/spray-overlay";
import { readFlightPlanInput } from "@/lib/gcs/flight-plan-input";
import {
  featuresToTargets,
  defaultAngleDeg,
  planFlightPath,
  pathLengthMeters,
  targetsBounds,
  haversineMeters,
} from "@/lib/gcs/flight-geo";

const DEFAULT_LANE_SPACING = 2; // metres (line width / nozzle swath)
const DEFAULT_ALTITUDE = 5; // metres
const DEFAULT_SPEED = 3; // m/s
const MIN_CIRCLE_RADIUS_M = 0.5;

// No-fly obstacle rendering (dark "blocked" look, distinct from rose targets
// and the emerald path). interactive:false so taps pass through while drawing.
const OBSTACLE_STYLE = {
  color: "#1e293b",
  weight: 2,
  fillColor: "#334155",
  fillOpacity: 0.35,
  dashArray: "5 4",
  interactive: false,
};

// Redraw the in-progress obstacle draft (polygon vertices/edges or a circle
// centre) into the given layer group. Pure — no React — safe to call anywhere.
function drawDraft(map, groupRef, pts, center) {
  const group = groupRef.current;
  if (!map || !group) return;
  group.clearLayers();
  const dot = { color: "#1e293b", fillColor: "#ffffff", fillOpacity: 1, weight: 2, interactive: false };
  if (center) {
    L.circleMarker([center.lat, center.lng], { ...dot, radius: 5, fillColor: "#1e293b" }).addTo(group);
  }
  if (pts.length >= 2) {
    L.polyline(
      pts.map((p) => [p.lat, p.lng]),
      { color: "#1e293b", weight: 2, dashArray: "5 4", interactive: false },
    ).addTo(group);
  }
  for (const p of pts) {
    L.circleMarker([p.lat, p.lng], { ...dot, radius: 4 }).addTo(group);
  }
}

function flagIcon(kind) {
  const color = kind === "start" ? "#16a34a" : "#dc2626";
  const label = kind === "start" ? "S" : "E";
  return L.divIcon({
    className: "",
    iconSize: [30, 38],
    iconAnchor: [4, 36],
    html: `<div style="position:relative;width:30px;height:38px">
      <div style="position:absolute;left:3px;top:0;width:2px;height:36px;background:#0f172a;border-radius:1px"></div>
      <div style="position:absolute;left:5px;top:1px;width:18px;height:14px;background:${color};border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900;font-family:sans-serif">${label}</div>
    </div>`,
  });
}

function droneIcon(rotationDeg) {
  const deg = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  return L.divIcon({
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div style="position:relative;width:40px;height:40px">
      <span style="position:absolute;left:50%;top:50%;width:36px;height:36px;margin-left:-18px;margin-top:-18px;border-radius:9999px;background:rgba(0,91,179,0.22);animation:fp-ping 2.4s cubic-bezier(0,0,0.2,1) infinite"></span>
      <svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;margin-left:-12px;margin-top:-12px;filter:drop-shadow(0 4px 8px rgba(0,41,82,0.5));transform:rotate(${deg}deg)"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" fill="#005bb3" stroke="white" stroke-width="1"/></svg>
    </div>`,
  });
}

export function FlightPlan() {
  const navigate = useNavigate();
  const { data: diagnosticsData } = useDiagnostics();
  const drone = diagnosticsCoords(diagnosticsData);
  const droneLat = drone?.lat ?? null;
  const droneLon = drone?.lon ?? null;
  const heading = headingDeg(diagnosticsData);

  const [input] = useState(() => readFlightPlanInput());
  const targets = useMemo(
    () => featuresToTargets(input?.featureCollection?.features),
    [input],
  );

  const [laneSpacing, setLaneSpacing] = useState(DEFAULT_LANE_SPACING);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [angleDeg, setAngleDeg] = useState(() => defaultAngleDeg(targets));
  const [startLngLat, setStartLngLat] = useState(null);
  const [plan, setPlan] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [obstacles, setObstacles] = useState([]);
  const [drawMode, setDrawMode] = useState("none"); // "none" | "polygon" | "circle"
  const [draftPointCount, setDraftPointCount] = useState(0);
  const [draftHasCenter, setDraftHasCenter] = useState(false);

  const mapDiv = useRef(null);
  const map = useRef(null);
  const pathLayer = useRef(null);
  const startMarker = useRef(null);
  const endMarker = useRef(null);
  const droneMarker = useRef(null);
  const startSeeded = useRef(false);
  const draftLayer = useRef(null);
  const obstacleLayer = useRef(null);
  const draftPts = useRef([]);
  const draftCenter = useRef(null);
  const obstacleId = useRef(0);
  const onMapClick = useRef(null);

  const hasTargets = targets.length > 0;

  // Derived summary
  const geoPath = plan?.geoPath ?? [];
  const pathReady = geoPath.length >= 2;
  const waypointCount = geoPath.length;
  const distanceMeters = pathReady ? pathLengthMeters(geoPath) : 0;
  const areaHa = targets.reduce((sum, t) => sum + t.areaM2, 0) / 10000;
  const chambers = useMemo(() => {
    const set = new Set();
    for (const target of targets) for (const c of target.chambers) set.add(c);
    return [...set];
  }, [targets]);

  // Create the interactive map once, draw the target polygons, fit the view.
  useEffect(() => {
    if (!hasTargets || !mapDiv.current || map.current) return;
    const m = L.map(mapDiv.current, { zoomControl: true, maxZoom: 24 });
    map.current = m;

    const sat = BASE_LAYERS.satellite;
    L.tileLayer(sat.url, {
      attribution: sat.attribution,
      maxNativeZoom: sat.maxNativeZoom,
      maxZoom: sat.maxZoom,
    }).addTo(m);

    L.geoJSON(input.featureCollection, {
      interactive: false, // let map clicks pass through for obstacle drawing
      style: {
        color: "#e11d48",
        weight: 2.5,
        opacity: 1,
        fillColor: "#fb7185",
        fillOpacity: 0.18,
        lineCap: "round",
        lineJoin: "round",
      },
    }).addTo(m);

    // Obstacles below, active draft above (both above tiles, below path/markers).
    obstacleLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);

    // Attach the click listener here (in lock-step with the map's lifecycle) and
    // delegate to the latest handler ref so it always sees current drawMode/draft.
    m.on("click", (event) => onMapClick.current?.(event));

    const bounds = targetsBounds(targets);
    if (bounds) {
      m.fitBounds(
        [
          [bounds.minLat, bounds.minLng],
          [bounds.maxLat, bounds.maxLng],
        ],
        { padding: [60, 60], maxZoom: 21 },
      );
    }

    return () => {
      m.remove();
      map.current = null;
      pathLayer.current = null;
      startMarker.current = null;
      endMarker.current = null;
      droneMarker.current = null;
      draftLayer.current = null;
      obstacleLayer.current = null;
    };
  }, [hasTargets, targets, input]);

  // Seed the start point from the live drone GPS ONCE, the first time it is
  // available. We deliberately do not re-seed on later ticks: GPS jitter would
  // otherwise reshuffle the whole coverage path on every poll. After this, the
  // start only moves when the user drags the flag or taps "Mulai dari drone".
  useEffect(() => {
    if (startSeeded.current) return;
    if (droneLat == null || droneLon == null) return;
    setStartLngLat({ lat: droneLat, lng: droneLon });
    startSeeded.current = true;
  }, [droneLat, droneLon]);

  // Re-plan whenever inputs (including obstacles) change.
  useEffect(() => {
    if (!hasTargets) return;
    setPlan(planFlightPath({ targets, obstacles, laneSpacing, angleDeg, startLngLat }));
  }, [hasTargets, targets, obstacles, laneSpacing, angleDeg, startLngLat]);

  // Render committed obstacles into their layer group.
  useEffect(() => {
    const group = obstacleLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const obstacle of obstacles) {
      if (obstacle.kind === "polygon" && obstacle.ring.length >= 3) {
        L.polygon(obstacle.ring.map((p) => [p.lat, p.lng]), OBSTACLE_STYLE).addTo(group);
      } else if (obstacle.kind === "circle" && obstacle.radiusM > 0) {
        L.circle([obstacle.center.lat, obstacle.center.lng], {
          radius: obstacle.radiusM,
          ...OBSTACLE_STYLE,
        }).addTo(group);
      }
    }
  }, [obstacles]);

  // Draw / refresh the path polyline + start (draggable) & end flags.
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    if (!pathReady) {
      for (const ref of [pathLayer, startMarker, endMarker]) {
        if (ref.current) {
          m.removeLayer(ref.current);
          ref.current = null;
        }
      }
      return;
    }

    const latlngs = geoPath.map((p) => [p.lat, p.lng]);
    const start = latlngs[0];
    const end = latlngs[latlngs.length - 1];

    if (pathLayer.current) pathLayer.current.setLatLngs(latlngs);
    else
      pathLayer.current = L.polyline(latlngs, {
        color: "#059669",
        weight: 3,
        opacity: 0.95,
        interactive: false,
      }).addTo(m);

    if (startMarker.current) {
      startMarker.current.setLatLng(start);
    } else {
      startMarker.current = L.marker(start, {
        icon: flagIcon("start"),
        draggable: true,
        zIndexOffset: 1000,
      }).addTo(m);
      startMarker.current.on("dragend", (event) => {
        const ll = event.target.getLatLng();
        startSeeded.current = true;
        setStartLngLat({ lat: ll.lat, lng: ll.lng });
      });
    }

    if (endMarker.current) endMarker.current.setLatLng(end);
    else
      endMarker.current = L.marker(end, {
        icon: flagIcon("end"),
        zIndexOffset: 900,
        interactive: false,
      }).addTo(m);
  }, [plan, pathReady, geoPath]);

  // Live drone marker.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (droneLat == null || droneLon == null) {
      if (droneMarker.current) {
        m.removeLayer(droneMarker.current);
        droneMarker.current = null;
      }
      return;
    }
    const pos = [droneLat, droneLon];
    if (droneMarker.current) {
      droneMarker.current.setLatLng(pos);
      droneMarker.current.setIcon(droneIcon(heading));
    } else {
      droneMarker.current = L.marker(pos, {
        icon: droneIcon(heading),
        zIndexOffset: 1200,
        interactive: false,
      }).addTo(m);
    }
  }, [droneLat, droneLon, heading]);

  // Keep the latest map-click handler in a ref so a single stable listener can
  // delegate to it while always seeing current drawMode / draft state.
  useEffect(() => {
    onMapClick.current = (event) => {
      if (drawMode === "none") return;
      const { lat, lng } = event.latlng;
      if (drawMode === "polygon") {
        draftPts.current = [...draftPts.current, { lat, lng }];
        setDraftPointCount(draftPts.current.length);
        drawDraft(map.current, draftLayer, draftPts.current, draftCenter.current);
        return;
      }
      // circle: first tap sets the centre, second tap sets the radius.
      if (!draftCenter.current) {
        draftCenter.current = { lat, lng };
        setDraftHasCenter(true);
        drawDraft(map.current, draftLayer, [], draftCenter.current);
        return;
      }
      const radiusM = haversineMeters(draftCenter.current, { lat, lng });
      if (radiusM < MIN_CIRCLE_RADIUS_M) return; // ignore near-zero mis-tap
      const center = draftCenter.current;
      obstacleId.current += 1;
      setObstacles((prev) => [...prev, { id: obstacleId.current, kind: "circle", center, radiusM }]);
      draftCenter.current = null;
      setDraftHasCenter(false);
      setDrawMode("none");
      drawDraft(map.current, draftLayer, [], null);
    };
  });

  function resetDraft() {
    draftPts.current = [];
    draftCenter.current = null;
    setDraftPointCount(0);
    setDraftHasCenter(false);
    drawDraft(map.current, draftLayer, [], null);
  }
  function startDraw(mode) {
    resetDraft();
    setDrawMode(mode);
  }
  function cancelDraw() {
    resetDraft();
    setDrawMode("none");
  }
  function undoDraftPoint() {
    draftPts.current = draftPts.current.slice(0, -1);
    setDraftPointCount(draftPts.current.length);
    drawDraft(map.current, draftLayer, draftPts.current, draftCenter.current);
  }
  function finishPolygon() {
    if (draftPts.current.length < 3) return;
    const ring = draftPts.current;
    obstacleId.current += 1;
    setObstacles((prev) => [...prev, { id: obstacleId.current, kind: "polygon", ring }]);
    resetDraft();
    setDrawMode("none");
  }
  function deleteObstacle(id) {
    setObstacles((prev) => prev.filter((o) => o.id !== id));
  }

  async function handleStartFlying() {
    if (!pathReady) return;
    setSubmitting(true);
    setError(null);
    try {
      const geoWaypoints = geoPath.map((p) => ({ lat: p.lat, lng: p.lng }));
      // Each spray target polygon becomes a spray zone; its selected chambers
      // (drugs) map to per-pump application rates. See lib/gcs/spray-overlay.js.
      const zones = targets.map((target) => ({
        id: String(target.zoneCode ?? target.id),
        zoneCode: target.zoneCode ?? null,
        polygon: target.ring.map((point) => [point.lat, point.lng]),
        chambers: target.chambers,
        rates: ratesFromChambers(target.chambers),
      }));
      const sessionId = `spray-${Date.now().toString(36)}`;
      setMissionPlan({
        source: "flight-plan",
        mode: "spraying",
        sessionId,
        fieldName: input?.fieldName ?? null,
        geoWaypoints,
        zones,
        chambers,
        swathWidthM: laneSpacing,
        altitude,
        laneSpacing,
        angleDeg,
        createdAt: new Date().toISOString(),
      });
      // Release any previously-armed spray session so a re-plan isn't refused
      // with FAILED_PRECONDITION ("a spray session is already active").
      await cancelSprayMission().catch(() => {});
      await pushSprayMission({
        sessionId,
        geoWaypoints,
        zones: zones.map((zone) => ({ id: zone.id, polygon: zone.polygon, rates: zone.rates })),
        swathWidthM: laneSpacing,
        altitude,
        speed: DEFAULT_SPEED,
      });
      await executeMission({ mode: "spraying", jobId: sessionId });
      setShowAudit(false);
      navigate("/monitoring");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai misi");
      setSubmitting(false);
      setShowAudit(false);
    }
  }

  if (!hasTargets) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-emerald-100 text-forest">
          <MapPinned className="h-8 w-8" />
        </span>
        <div>
          <div className="text-xl font-black text-gray-950">Belum ada target semprot</div>
          <p className="mx-auto mt-1 max-w-sm text-sm font-semibold text-gray-500">
            Tetapkan obat untuk semua polygon di halaman Peta terlebih dahulu, lalu tekan
            &ldquo;Mulai Perencanaan Terbang&rdquo;.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/maps")}
          className="flex h-11 items-center gap-2 rounded-2xl bg-forest px-5 text-sm font-black text-white shadow-[0_10px_20px_rgba(0,98,65,0.2)] transition-colors hover:bg-house"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali ke Peta
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-16 items-center justify-between gap-3 border-b border-emerald-950/10 bg-white/92 px-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <button
          type="button"
          onClick={() => navigate("/maps")}
          className="group flex h-10 items-center gap-2 rounded-2xl border border-emerald-900/15 bg-white px-3 text-[13px] font-extrabold text-emerald-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-900/35 hover:bg-emerald-50 active:translate-y-0"
          title="Kembali ke Peta"
        >
          <span className="grid h-6 w-6 place-items-center rounded-xl bg-emerald-900 text-white transition-colors group-hover:bg-emerald-800">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
          <span>Peta</span>
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-900 text-white shadow-[0_8px_18px_rgba(6,78,59,0.22)]">
            <RouteIcon className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 text-center sm:text-left">
            <div className="truncate text-[15px] font-black leading-tight text-gray-950">
              Perencanaan Terbang
            </div>
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Rute Penyemprotan Otonom
            </div>
          </div>
        </div>
        <div className="w-[86px]" />
      </header>

      <DroneTelemetryProvider />

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* Full-height wrapper gives the panel a definite max-height so it can
            scroll internally; pointer-events-none lets map taps (obstacle
            drawing) pass through the empty area below the panel. */}
        <div className="pointer-events-none absolute right-4 top-4 bottom-4 z-[1000] flex items-start">
          <FlightControlsPanel
            fieldName={input?.fieldName}
            laneSpacing={laneSpacing}
            altitude={altitude}
            angleDeg={angleDeg}
            onLaneSpacingChange={setLaneSpacing}
            onAltitudeChange={setAltitude}
            onAngleChange={setAngleDeg}
            onAngleAuto={() => setAngleDeg(defaultAngleDeg(targets))}
            droneAvailable={droneLat != null && droneLon != null}
            onResetStartToDrone={() => {
              if (droneLat == null || droneLon == null) return;
              startSeeded.current = true;
              setStartLngLat({ lat: droneLat, lng: droneLon });
            }}
            waypointCount={waypointCount}
            distanceMeters={distanceMeters}
            areaHa={areaHa}
            chambers={chambers}
            obstacles={obstacles}
            drawMode={drawMode}
            draftPointCount={draftPointCount}
            draftHasCenter={draftHasCenter}
            onStartPolygon={() => startDraw("polygon")}
            onStartCircle={() => startDraw("circle")}
            onFinishPolygon={finishPolygon}
            onUndoPoint={undoDraftPoint}
            onCancelDraw={cancelDraw}
            onDeleteObstacle={deleteObstacle}
            pathReady={pathReady}
            submitting={submitting}
            error={error}
            onStartFlying={() => setShowAudit(true)}
          />
        </div>
      </div>

      {/* .gcs-app scopes the glass-panel styling so the reused BAYUCARAKA
          pre-flight modal renders exactly like the drone-dashboard one; the
          relative z-[2000] wrapper lifts the modal above the header/panel. */}
      <div className="relative z-[2000] gcs-app">
        <PreFlightAuditModal
          isOpen={showAudit}
          onClose={() => setShowAudit(false)}
          onExecute={handleStartFlying}
        />
      </div>
    </div>
  );
}
