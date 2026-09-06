# Mapping API

Endpoints exposed by the `soerogis.MappingJobService` gRPC service. This is the
current mapping path: it organizes work into **mapping sessions** — persisted
folders under `data/sessions/<id>/` — and runs **OpenDroneMap** photogrammetry
over each session's images via a **NodeODM** instance (driven with PyODM).

State lives in `session_store.py` (`SessionStore`); `odm_jobs.py`
(`MappingJobService`) is the thin gRPC layer over it.

## Transport & conventions

- **Protocol:** gRPC with **JSON request/response bodies** — there is no
  `.proto`. Every request and response is a JSON object (a dict).
- **Service name:** `soerogis.MappingJobService`
- **Address:** `0.0.0.0:50051` (insecure channel by default)
- **Artifact files:** served over plain **HTTP** by a static file server on
  `0.0.0.0:8000` (separate from gRPC). Responses reference artifacts by URL, not
  by server path — see [Fetching artifacts](#fetching-artifacts).
- **Wiring:** `server.py` registers each method → `MappingJobService`
  (request validation) → `SessionStore` (folders, persistence, NodeODM).

### Session model

A **session** is one mapping run, persisted as a folder whose `metadata.json` is
the single source of truth (so the registry **survives restarts** — on boot it
rehydrates every session and re-attaches any in-flight stitch to its NodeODM
task by `backend_ref`).

```
data/sessions/<id>/
  metadata.json      # session state (the response object below)
  raw/               # input images (.jpg/.jpeg/.png/.tif/.tiff), saved before any stitch
  stitched.tif       # ODM orthophoto, copied out of odm/
  clusters.kml       # vegetation-cluster polygons (mapping.generate_kml)
  odm/               # full NodeODM asset bundle
```

### Where sessions come from

Two producers write into the same registry, so `ListJobs`/`GetJob` see both:

1. **A client**, via `CreateSession` / `CreateOdmJob` (below).
2. **The drone capture pipeline** — `DroneService.PushCaptureMission` (see
   [drone_api.md](drone_api.md)). At mission end the mapping monitor calls
   `CreateSession` + `StartStitching` itself against the *shared* `SessionStore`,
   so a flight-created session **appears in `ListJobs` with no client call**. Its
   `name` is the capture session id (`mapping-<hex>`); `area_name` and
   `captured_at` are empty. To tie a flight to its session, read
   `MappingMissionStatus.odm_job_id`.

Capture-produced `raw/` folders hold **PNG** frames (demosaiced from MAPIR
`.RAW`), not tiffs — don't filter the listing on `.tif`.

### Two-phase flow

Photos are saved into the backend **first**, then stitched:

1. **`CreateSession`** — create the session folder and populate `raw/` (copy from
   a server-side `source_dir`, or let the camera driver write the tiffs directly).
   Status starts at `unstitched`.
2. **`StartStitching`** — send `raw/` to NodeODM. **Fire-and-poll:** returns
   immediately; poll `GetJob` until the session reaches a terminal status.

`CreateOdmJob` is a one-shot convenience that does both in a single call
(back-compat with the older job-oriented API).

### Status lifecycle

```
unstitched ──StartStitching──▶ stitching ──ODM done──▶ clustering ──▶ ready
                                   │                        │
                                   │                        └──▶ failed
                                   └──▶ failed / canceled
```

| Status | Meaning |
|--------|---------|
| `unstitched` | Session created, `raw/` present, no stitch started. |
| `stitching` | ODM task queued/running on NodeODM. `progress` advances 0→100. |
| `clustering` | ODM finished; the asset bundle is downloading and `generate_kml` (NDVI → DBSCAN → alpha-shape → polygons) is turning the orthophoto into `clusters.kml`. Runs **automatically** when a stitch completes. Transient — advances to `ready` on success, `failed` on error. `has_stitched` flips to `true` partway through, so gate an orthophoto fetch on `has_stitched` / a non-null `artifacts.stitched_tif`, **not** on this status. |
| `ready` | Terminal. `clusters.kml` exists — the frontend can build a spraying flight plan from it. Implies `stitched.tif` is also present. |
| `failed` | Terminal. See `error`. Reachable *after* a successful stitch too — both the asset download (`asset download failed: …`) and clustering (`clustering: stitched.tif missing`, `clustering failed: …`) fail the session. |
| `canceled` | Terminal. Stitch was cancelled. |

### Session object

Every endpoint returns the **session object** (the same shape as `metadata.json`,
plus absolute artifact paths and a `job_id` alias):

```json
{
  "id": "20260612T092100_sawah-blok-utara",
  "job_id": "20260612T092100_sawah-blok-utara",
  "name": "Blok Utara pagi",
  "status": "stitching",
  "area_name": "Sawah Blok Utara",
  "area_m2": null,
  "captured_at": "2026-06-12T09:21:00+07:00",
  "created_at": "2026-06-12T09:21:05+07:00",
  "updated_at": "2026-06-12T09:23:40+07:00",
  "image_count": 142,
  "image_glob": "",
  "backend_ref": "a1b2c3d4-...",
  "progress": 37.0,
  "error": "",
  "has_stitched": false,
  "has_clusters": false,
  "cluster_count": null,
  "artifacts": {
    "raw_dir": "http://localhost:8000/sessions/<id>/raw/",
    "stitched_tif": "http://localhost:8000/sessions/<id>/stitched.tif",
    "clusters_kml": "http://localhost:8000/sessions/<id>/clusters.kml"
  }
}
```

| Field | Meaning |
|-------|---------|
| `id` / `job_id` | Session id (filesystem-safe). `job_id` is a back-compat alias. |
| `name` | Human label. |
| `status` | Lifecycle status (see above). |
| `area_name` | Field/plot name supplied at creation. |
| `area_m2` | Best-effort coverage in m², computed from the ortho once stitched (only for projected CRS; `null` otherwise). |
| `captured_at` | Capture time, supplied by the caller (ISO 8601). |
| `created_at` / `updated_at` | Session create / last-change time (ISO 8601). |
| `image_count` | Images counted into `raw/` at ingest, recounted when `StartStitching` runs. **Not a live directory count** — a session created without `source_dir` (camera driver writing `raw/` itself) reports `0` until stitching starts. |
| `image_glob` | Glob used to select images at ingest (empty = all images). |
| `backend_ref` | NodeODM task uuid (the reconciliation handle). |
| `progress` | ODM progress as a **percentage, 0–100**, while `stitching` (NodeODM's value, passed through unscaled by PyODM). Frozen at the last polled value afterwards — not reset to 100 on completion. |
| `error` | Failure reason, or empty. |
| `has_stitched` / `has_clusters` | Whether `stitched.tif` / `clusters.kml` exist. |
| `cluster_count` | Number of vegetation clusters (set by the clustering step). |
| `artifacts` | **HTTP URLs** (served by the file server): `raw_dir`, and `stitched_tif` / `clusters_kml` (`null` until produced). See [Fetching artifacts](#fetching-artifacts). |

### Error codes

| gRPC status | When |
|-------------|------|
| `INVALID_ARGUMENT` | Required field missing (`source_dir`, `session_id`), `source_dir` not found, or no images found in `raw/`. |
| `NOT_FOUND` | No session with the given `session_id`. |
| `INTERNAL` | Unexpected failure creating a session or starting a stitch. |

---

## Endpoints

### `CreateSession`

Create a session and save its input photos into the backend (`raw/`). Status
starts at `unstitched`. Does **not** start stitching.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `""` | Human label; also seeds the session id. |
| `area_name` | string | `""` | Field/plot name. |
| `captured_at` | string | `""` | Capture time (ISO 8601). |
| `source_dir` | string | `null` | Server-side folder to **copy** images from into `raw/`. Omit if the camera driver writes `raw/` directly. |
| `image_glob` | string | `null` | Glob to pick images out of `source_dir` (e.g. `"*_D.JPG"`). Omitted = all files with image extensions. |

```json
{ "name": "Blok Utara pagi", "area_name": "Sawah Blok Utara",
  "source_dir": "/data/incoming/2026-06-12-am", "image_glob": "*.tif" }
```

**Response:** session object (`status: "unstitched"`; `image_count` is set only
when `source_dir` was supplied, otherwise `0`).

---

### `StartStitching`

Send the session's `raw/` images to NodeODM. **Fire-and-poll** — returns
immediately with `status: "stitching"`; poll `GetJob` until terminal.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |
| `options` | object | `{}` | ODM task options passed through to NodeODM (e.g. `{ "orthophoto-resolution": 2 }`). |

```json
{ "session_id": "20260612T092100_sawah-blok-utara", "options": {} }
```

**Response:** session object (`status: "stitching"`). Returns `INVALID_ARGUMENT`
if `raw/` is empty or the session is already stitching — but `INTERNAL` if the
`raw/` folder is *missing entirely* (e.g. deleted out-of-band from a session
rehydrated on boot).

---

### `StartClustering`

Run the clustering step (`generate_kml`: NDVI → DBSCAN → alpha-shape → polygons)
over the session's `stitched.tif`, producing `clusters.kml` and promoting the
session to `ready`. **Fire-and-poll.** Use this to (re)cluster a session that
already has a `stitched.tif`; the normal pipeline runs clustering automatically
when an ODM stitch completes.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object (`status: "clustering"`). Poll `GetJob` until
`ready` (then `has_clusters: true`, `cluster_count` set, `clusters_kml` URL
populated) or `failed`. Returns `INVALID_ARGUMENT` if there is no `stitched.tif`.

---

### `CreateOdmJob`

One-shot convenience: `CreateSession` + `StartStitching` in a single call.
Requires `source_dir`. Back-compat with the older job API.

**Request:** the union of `CreateSession` (with `source_dir` **required**) and
`StartStitching` (`options`).

```json
{ "name": "Blok Utara pagi", "source_dir": "/data/incoming/2026-06-12-am",
  "image_glob": "*.tif", "options": {} }
```

**Response:** session object (`status: "stitching"`).

---

### `GetJob`

Fetch one session, refreshing it against NodeODM if it is mid-stitch.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object. `NOT_FOUND` if the id is unknown.

---

### `ListJobs`

List all sessions, refreshing any in-flight stitches.

**Request:** `{}`

**Response**

```json
{ "sessions": [ { ...session object... } ], "jobs": [ ... ] }
```

> `jobs` duplicates `sessions` for back-compat; prefer `sessions`.

---

### `CancelJob`

Cancel a session's stitch on NodeODM and mark it `canceled`.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object (`status: "canceled"`).

---

### `RemoveJob`

Remove the NodeODM task **and delete the on-disk session folder** (raw images,
orthophoto, KML, metadata — all of it).

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response**

```json
{ "session_id": "20260612T092100_sawah-blok-utara", "job_id": "...", "removed": true }
```

---

## Fetching artifacts

Artifact files are **not** returned over gRPC — `GetJob`/`ListJobs` give you HTTP
URLs in `artifacts`, which a static file server (default `0.0.0.0:8000`, rooted
at `data/`) serves. Fetch them directly:

| Artifact | URL (from `artifacts`) | Use |
|----------|------------------------|-----|
| `clusters_kml` | `…/sessions/<id>/clusters.kml` | Vegetation/spray zones — load onto the map, build the flight plan. |
| `stitched_tif` | `…/sessions/<id>/stitched.tif` | Orthophoto raster overlay. |
| `raw_dir` | `…/sessions/<id>/raw/` | Directory listing of the source images (PNG on the capture path, TIFF/JPEG when ingested from a `source_dir`). |

- `null` artifacts mean the file isn't produced yet (e.g. `clusters_kml` is
  `null` until `status: "ready"`). A **non-null URL is not proof the file is
  fetchable**: the HTTP server is best-effort — if it can't bind, gRPC still
  serves and the URLs still appear, they just won't resolve. Handle a connection
  failure separately from a `null` artifact.
- The server supports **HTTP Range requests** (`206 Partial Content`) and sends
  `Access-Control-Allow-Origin: *`, so browser clients (Leaflet/georaster) can
  page through the large GeoTIFF without downloading it whole.
- **Deployment:** set `FILE_SERVER_BASE_URL` (e.g. `http://192.168.1.10:8000`)
  so the URLs point at the server's reachable address rather than `localhost`.
  `FILE_SERVER_HOST` / `FILE_SERVER_PORT` set where it binds. It is
  unauthenticated — keep it on a trusted LAN.
- The `data/` root also serves **`sd_captures/<ts>/`** — manual camera-SD dumps
  produced by `DroneService.DownloadCaptures`. Those folders are a valid
  `source_dir` for `CreateSession`. Same unauthenticated port.

```bash
curl -s "http://localhost:8000/sessions/<id>/clusters.kml" -o clusters.kml
curl -s -r 0-1023 "http://localhost:8000/sessions/<id>/stitched.tif" -o head.bin   # range
```

## Typical flow

Two-phase: save photos, then stitch and poll to completion.

```text
CreateSession   { "name": "Blok Utara pagi", "source_dir": "/data/incoming/am", "image_glob": "*.tif" }
                  -> { "id": "<sid>", "status": "unstitched", "image_count": 142 }
StartStitching  { "session_id": "<sid>" }
                  -> { "status": "stitching" }
GetJob          { "session_id": "<sid>" }   # poll until status in {ready, failed, canceled}
                  -> { "status": "ready", "has_stitched": true, "artifacts": { "stitched_tif": ".../stitched.tif" } }
```

Or the one-shot equivalent:

```text
CreateOdmJob    { "name": "...", "source_dir": "/data/incoming/am", "image_glob": "*.tif" }
GetJob          { "session_id": "<sid>" }   # poll until terminal
```

## Example client

Using `grpc` with the JSON codec (raw bytes; the server (de)serializes JSON):

```python
import json
import grpc

channel = grpc.insecure_channel("localhost:50051")

def call(method: str, payload: dict) -> dict:
    fn = channel.unary_unary(
        f"/soerogis.MappingJobService/{method}",
        request_serializer=lambda d: json.dumps(d).encode("utf-8"),
        response_deserializer=lambda b: json.loads(b.decode("utf-8")),
    )
    return fn(payload)

s = call("CreateSession", {
    "name": "Blok Utara pagi",
    "source_dir": "/data/incoming/2026-06-12-am",
    "image_glob": "*.tif",
})
call("StartStitching", {"session_id": s["id"]})

while call("GetJob", {"session_id": s["id"]})["status"] not in ("ready", "failed", "canceled"):
    pass  # add a sleep in real code

job = call("GetJob", {"session_id": s["id"]})
print(job["status"], job["artifacts"]["stitched_tif"])
```
