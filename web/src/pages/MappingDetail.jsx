import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import {
  ArrowLeft, Loader2, AlertTriangle, Download, Trash2, Ban, Layers,
  Image as ImageIcon, Ruler, MapPinned, CheckCircle2, X, SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchJob, cancelJob, removeJob } from "@/lib/gcs/api";
import { parseKml } from "@/lib/gcs/kml";
import { decodeOrthoPreview } from "@/lib/gcs/ortho";
import { fetchBlobWithProgress } from "@/lib/gcs/fetch-progress";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/gcs/basemap";

const STATUS_LABEL = {
  unstitched: "Menunggu",
  stitching: "Menjahit Peta",
  clustering: "Analisis Zona",
  ready: "Peta Siap",
  failed: "Gagal",
  canceled: "Dibatalkan",
};
const TERMINAL = new Set(["ready", "failed", "canceled"]);
const BUSY = new Set(["unstitched", "stitching", "clustering"]);

function isNotFound(msg) {
  return /\b404\b/.test(msg) || /not[\s-]?found|tidak ditemukan/i.test(msg);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function zoneAreaHa(coords) {
  try {
    const ring = coords.map((c) => [c.lng, c.lat]);
    ring.push(ring[0]);
    return turf.area(turf.polygon([ring])) / 10_000;
  } catch {
    return 0;
  }
}

function ProgressBar({ pct, label }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-leaf transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatItem({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-leaf/10 text-leaf"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

export function MappingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const mapDiv = useRef(null);
  const map = useRef(null);
  const zonesLayer = useRef(null);
  const orthoOverlay = useRef(null);
  const pollGen = useRef(0);
  const [mapReady, setMapReady] = useState(false);

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  const [zones, setZones] = useState([]);
  const [kmlProgress, setKmlProgress] = useState(null);
  const [kmlError, setKmlError] = useState(null);
  const [tifProgress, setTifProgress] = useState(null);
  const [tifError, setTifError] = useState(null);
  const [orthoProjected, setOrthoProjected] = useState(false);

  const [downloading, setDownloading] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const kmlUrl = job?.artifacts?.clusters_kml || null;
  const tifUrl = job?.artifacts?.stitched_tif || null;
  const status = job?.status;
  const busy = BUSY.has(status);

  // --- Leaflet init (once; StrictMode-safe via cleanup + mapReady flag) --------
  useEffect(() => {
    const container = mapDiv.current;
    if (!container) return;
    const m = L.map(container, { attributionControl: true });
    const meta = BASE_LAYERS.satellite;
    L.tileLayer(meta.url, {
      attribution: meta.attribution,
      maxNativeZoom: meta.maxNativeZoom,
      maxZoom: meta.maxZoom,
    }).addTo(m);
    m.setView([DEFAULT_CENTER[1], DEFAULT_CENTER[0]], DEFAULT_ZOOM);
    map.current = m;
    setMapReady(true);
    return () => {
      m.remove();
      map.current = null;
      zonesLayer.current = null;
      orthoOverlay.current = null;
      setMapReady(false);
    };
  }, []);

  // --- Poll the session until terminal; stop on not-found; back off on the
  //     documented-deferred `clustering` state; ignore responses from a stale
  //     generation so an in-flight poll can't revert an optimistic cancel. ------
  useEffect(() => {
    let alive = true;
    let timer;
    const gen = ++pollGen.current;
    async function tick() {
      try {
        const j = await fetchJob(id);
        if (!alive || gen !== pollGen.current) return;
        setJob(j);
        setError(null);
        setLoading(false);
        // Every non-terminal status is transient — clustering runs automatically
        // when a stitch completes (docs/mapping.md) — so keep polling quickly.
        if (!TERMINAL.has(j.status)) timer = setTimeout(tick, 4000);
      } catch (e) {
        if (!alive || gen !== pollGen.current) return;
        setLoading(false);
        const msg = e instanceof Error ? e.message : "Gagal memuat pemetaan";
        if (isNotFound(msg)) { setNotFound(true); return; }
        setError(msg);
        timer = setTimeout(tick, 6000);
      }
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  // --- Load cluster zones (KML) once the artifact exists -----------------------
  useEffect(() => {
    if (!kmlUrl || !mapReady) return;
    let alive = true;
    const controller = new AbortController();
    setKmlProgress(0);
    setKmlError(null);
    (async () => {
      try {
        const blob = await fetchBlobWithProgress(
          kmlUrl,
          (l, t) => { if (alive && t) setKmlProgress(Math.min(100, (l / t) * 100)); },
          controller.signal,
        );
        const text = await blob.text();
        if (!alive) return;
        const parsed = parseKml(text, { id, name: id });
        const parsedZones = parsed.polygons.map((p) => ({
          id: p.id,
          name: p.name,
          latlngs: p.coords.map((c) => [c.lat, c.lng]),
          areaHa: zoneAreaHa(p.coords),
        }));
        setZones(parsedZones);

        if (zonesLayer.current) zonesLayer.current.remove();
        const group = L.featureGroup();
        parsedZones.forEach((z) => {
          L.polygon(z.latlngs, {
            color: "#006241", weight: 2, opacity: 1,
            fillColor: "#00754A", fillOpacity: 0.2, lineJoin: "round",
          })
            .bindPopup(`<b>${escapeHtml(z.name)}</b><br/>${z.areaHa.toFixed(3)} ha`)
            .addTo(group);
        });
        group.addTo(map.current);
        zonesLayer.current = group;
        try { map.current.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 20 }); } catch { /* empty */ }
        setKmlProgress(100);
      } catch (e) {
        if (alive && e?.name !== "AbortError") {
          setKmlProgress(null);
          setKmlError(e instanceof Error ? e.message : "Gagal memuat zona");
        }
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [kmlUrl, mapReady, id]);

  // --- Decode + overlay the orthophoto (true-colour GeoTIFF) once it exists -----
  useEffect(() => {
    if (!tifUrl || !mapReady) return;
    let alive = true;
    const controller = new AbortController();
    setTifProgress(0);
    setTifError(null);
    setOrthoProjected(false);
    (async () => {
      try {
        const blob = await fetchBlobWithProgress(
          tifUrl,
          (l, t) => { if (alive && t) setTifProgress(Math.min(90, (l / t) * 90)); },
          controller.signal,
        );
        const buf = await blob.arrayBuffer();
        if (!alive) return;
        setTifProgress(94);
        const result = await decodeOrthoPreview(buf);
        if (!alive) return;
        if (result.geographic && result.dataUrl) {
          const [minLng, minLat, maxLng, maxLat] = result.bbox;
          const bounds = [[minLat, minLng], [maxLat, maxLng]];
          if (orthoOverlay.current) orthoOverlay.current.remove();
          const overlay = L.imageOverlay(result.dataUrl, bounds, { opacity: 0.9, interactive: false });
          overlay.addTo(map.current);
          orthoOverlay.current = overlay;
          zonesLayer.current?.bringToFront();
          if (!zonesLayer.current) {
            try { map.current.fitBounds(bounds, { padding: [40, 40] }); } catch { /* empty */ }
          }
        } else {
          // Projected CRS (e.g. UTM) — can't place on the lat/lng basemap without
          // reprojection. Zones still render; the full raster is downloadable.
          setOrthoProjected(true);
        }
        setTifProgress(100);
      } catch (e) {
        if (alive && e?.name !== "AbortError") {
          setTifProgress(null);
          setTifError(e instanceof Error ? e.message : "Gagal memuat orthophoto");
        }
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [tifUrl, mapReady]);

  async function download(url, filename, key) {
    setDownloading(key);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
    } catch (e) {
      setError(`Gagal mengunduh: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDownloading(null);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    pollGen.current++; // invalidate any in-flight poll so it can't revert status
    try {
      const j = await cancelJob(id);
      setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan");
    } finally {
      setCancelling(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    pollGen.current++;
    try {
      await removeJob(id);
      navigate("/mapping");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const zonesTotalHa = useMemo(() => zones.reduce((s, z) => s + (z.areaHa || 0), 0), [zones]);
  const title = job?.name || job?.area_name || id;
  const areaValue = job?.area_m2 != null
    ? `${(job.area_m2 / 10_000).toFixed(2)} ha`
    : (zonesTotalHa > 0 ? `${zonesTotalHa.toFixed(2)} ha` : "—");
  const zonesValue = job?.cluster_count ?? (zones.length || "—");

  if (notFound) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-background px-[clamp(16px,3vw,40px)] py-5">
        <header className="mb-4 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/mapping")}><ArrowLeft className="h-4 w-4" /> Pemetaan</Button>
        </header>
        <div className="grid flex-1 place-items-center">
          <div className="text-center">
            <SearchX className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
            <h2 className="font-bold text-forest">Pemetaan tidak ditemukan</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Sesi <span className="font-mono">{id}</span> mungkin sudah dihapus atau ID-nya salah.</p>
            <Button variant="accent" className="mt-4" onClick={() => navigate("/mapping")}>Kembali ke daftar</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-[clamp(16px,3vw,40px)] py-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate("/mapping")}><ArrowLeft className="h-4 w-4" /> Pemetaan</Button>
        <div className="flex min-w-0 items-center gap-2">
          <MapPinned className="h-5 w-5 shrink-0 text-harvest" strokeWidth={1.9} />
          <span className="truncate font-bold tracking-tight text-forest">{title}</span>
        </div>
        <div className="w-[84px]" aria-hidden />
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_320px]">
        {/* Map preview */}
        <Card className="overflow-hidden p-0">
          <div ref={mapDiv} className="h-[46vh] min-h-[320px] w-full bg-[#dfe8e2]" />
          {(kmlProgress !== null && kmlProgress < 100) && (
            <div className="border-t border-border p-3"><ProgressBar pct={kmlProgress} label="Memuat zona lahan…" /></div>
          )}
          {(tifProgress !== null && tifProgress < 100) && (
            <div className="border-t border-border p-3"><ProgressBar pct={tifProgress} label="Membaca orthophoto…" /></div>
          )}
          {orthoProjected && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Orthophoto dalam proyeksi terproyeksi (mis. UTM) — pratinjau raster butuh reproyeksi; zona tetap tampil & orthophoto penuh dapat diunduh.
            </div>
          )}
          {kmlError && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Gagal memuat zona: {kmlError}
            </div>
          )}
          {tifError && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Gagal memuat orthophoto: {tifError}
            </div>
          )}
        </Card>

        {/* Side panel: status, stats, actions */}
        <div className="flex flex-col gap-4">
          {!job && loading ? (
            <Card className="grid place-items-center gap-3 p-8 text-center">
              <Loader2 className="h-7 w-7 animate-spin text-leaf" />
              <p className="text-sm text-muted-foreground">Memuat pemetaan…</p>
            </Card>
          ) : job ? (
            <>
              <Card className="flex flex-col gap-4 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-forest">Status</h3>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-foreground">
                    {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                    {status === "ready" && <CheckCircle2 className="h-3.5 w-3.5 text-leaf" />}
                    {STATUS_LABEL[status] ?? "—"}
                  </span>
                </div>

                {status === "stitching" && (
                  // `progress` is a PERCENTAGE 0–100 (unscaled NodeODM value —
                  // docs/mapping.md), and freezes at its last polled value.
                  <ProgressBar
                    pct={Math.min(100, Math.max(0, Math.round(Number(job.progress) || 0)))}
                    label="Menjahit peta"
                  />
                )}
                {status === "clustering" && (
                  <p className="flex items-center gap-2 text-sm text-harvest">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {job.has_stitched ? "Orthophoto siap — zona menyusul…" : "Menganalisis zona vegetasi…"}
                  </p>
                )}
                {status === "unstitched" && (
                  <p className="text-sm text-muted-foreground">Gambar tersimpan, menunggu proses penjahitan.</p>
                )}
                {status === "failed" && job.error && (
                  <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {job.error}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-4 border-t border-border/70 pt-4">
                  <StatItem icon={ImageIcon} label="Gambar" value={`${job.image_count ?? 0} foto`} />
                  <StatItem icon={Ruler} label="Cakupan" value={areaValue} />
                  <StatItem icon={Layers} label="Zona" value={String(zonesValue)} />
                  <StatItem icon={MapPinned} label="ID" value={id} />
                </div>
              </Card>

              <Card className="flex flex-col gap-2.5 p-5">
                <h3 className="mb-1 font-bold text-forest">Aksi</h3>
                {tifUrl && (
                  <Button variant="outline" onClick={() => download(tifUrl, `${id}-orthophoto.tif`, "tif")} disabled={downloading === "tif"}>
                    {downloading === "tif" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Unduh Orthophoto
                  </Button>
                )}
                {kmlUrl && (
                  <Button variant="outline" onClick={() => download(kmlUrl, `${id}-zona.kml`, "kml")} disabled={downloading === "kml"}>
                    {downloading === "kml" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Unduh Zona (KML)
                  </Button>
                )}
                {busy && (
                  <Button variant="outline" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Batalkan
                  </Button>
                )}
                <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                  <Trash2 className="h-4 w-4" /> Hapus Pemetaan
                </Button>
                {!tifUrl && !kmlUrl && !busy && (
                  <p className="text-xs text-muted-foreground">Belum ada artefak untuk diunduh.</p>
                )}
              </Card>
            </>
          ) : (
            <Card className="p-5">
              <p className="text-sm text-muted-foreground">Data pemetaan tidak dapat dimuat.</p>
            </Card>
          )}
        </div>

        {/* Zones list — spans full width under the map + panel */}
        {zones.length > 0 && (
          <Card className="p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-forest">Zona Lahan</h3>
              <span className="text-xs text-muted-foreground">{zones.length} zona · {zonesTotalHa.toFixed(2)} ha total</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {zones.map((z, i) => (
                <div key={z.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-leaf/12 text-xs font-bold text-forest">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{z.name}</p>
                    <p className="text-xs text-muted-foreground">{z.areaHa.toFixed(3)} ha</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {error && (
        <div className="mx-auto mt-4 w-full max-w-6xl">
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-house/40 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(false)} />
          <Card className="relative z-10 w-full max-w-sm p-6">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="h-5 w-5" /></span>
                <h2 className="font-bold text-forest">Hapus pemetaan?</h2>
              </div>
              <button onClick={() => !deleting && setConfirmDelete(false)} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Tutup"><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-5 text-sm text-muted-foreground">
              Gambar mentah, orthophoto, dan zona untuk pemetaan ini akan dihapus permanen dari server.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Batal</Button>
              <Button variant="default" className="border-destructive bg-destructive hover:bg-destructive/90" onClick={handleDelete} disabled={deleting}>
                {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Menghapus…</> : <><Trash2 className="h-4 w-4" /> Hapus</>}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
