# Mapping API

Reference for the `soerogis.MappingJobService` gRPC endpoints the frontend uses
to create and track **mapping sessions** and to fetch their georeferenced
outputs (orthophoto + vegetation-cluster KML).

Most methods return a **session object** (`ListJobs` returns an array of them;
`RemoveJob` returns a small confirmation). Large outputs (the orthophoto and KML)
are **not** returned over gRPC — the session object carries HTTP URLs to them,
which the browser fetches directly (see [Fetching artifacts](#fetching-artifacts)).

This document describes **only the endpoints, their inputs, and their outputs** —
not how the backend implements them.

## Transport & conventions

- **Protocol:** gRPC with **JSON request/response bodies** — there is no
  `.proto`. Every request and response is a JSON object.
- **Service name:** `soerogis.MappingJobService`
- **Method path:** `/soerogis.MappingJobService/<Method>` (e.g. `/soerogis.MappingJobService/ListJobs`).
- **Address:** a bare `host:port` (no scheme), default port `50051`, insecure
  channel. The frontend BFF reads it from `BACKEND_GRPC_ADDR` (mapping calls do
  not use the per-request drone-address override).
- **Artifacts:** served over plain **HTTP** by a separate static file server
  (default port `8000`). Session objects reference them by URL.
- **`session_id` / `job_id`:** every request that targets a session takes
  `session_id`; `job_id` is accepted as an alias. In responses, `id` and
  `job_id` are the same value.

### Status lifecycle

The session `status` field moves through these values:

```
unstitched ──▶ stitching ──▶ clustering ──▶ ready
                   │
                   └────────▶ failed / canceled
```

| Status | Meaning for the caller |
|--------|------------------------|
| `unstitched` | Session created, source images present, stitching not started. |
| `stitching` | Stitching in progress. `progress` advances `0.0 → 1.0`. |
| `clustering` | The orthophoto is ready; clustering produces the cluster KML. **Currently deferred** — sessions can rest here without auto-advancing to `ready`. |
| `ready` | Terminal. The cluster KML exists (implies the orthophoto exists too) — the frontend can build a spraying flight plan from it. |
| `failed` | Terminal. See `error`. |
| `canceled` | Terminal. Stitching was cancelled. |

### Session object

Every endpoint returns this object — `ListJobs` as an array of them — except
`RemoveJob`:

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
  "progress": 0.37,
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

| Field | Type | Meaning |
|-------|------|---------|
| `id` / `job_id` | string | Session id (filesystem-safe). `job_id` is a back-compat alias. |
| `name` | string | Human label. |
| `status` | string | Lifecycle status (see above). |
| `area_name` | string | Field/plot name supplied at creation. |
| `area_m2` | number \| null | Coverage in m², computed once stitched (projected CRS only; `null` otherwise). |
| `captured_at` | string | Capture time, supplied by the caller (ISO 8601). |
| `created_at` / `updated_at` | string | Create / last-change time (ISO 8601). |
| `image_count` | int | Number of source images. |
| `image_glob` | string | Glob used to select images at ingest (empty = all images). |
| `backend_ref` | string | Opaque reference to the stitch task. |
| `progress` | float | Stitch progress `0.0–1.0` while `stitching`. |
| `error` | string | Failure reason, or empty. |
| `has_stitched` / `has_clusters` | bool | Whether the orthophoto / cluster KML have been produced. |
| `cluster_count` | int \| null | Number of vegetation clusters once clustered. |
| `artifacts` | object | HTTP URLs: `raw_dir`, `stitched_tif`, `clusters_kml`. `stitched_tif`/`clusters_kml` are `null` until produced. See [Fetching artifacts](#fetching-artifacts). |

### Error codes

| gRPC status | When |
|-------------|------|
| `INVALID_ARGUMENT` | Required field missing (`source_dir`, `session_id`), `source_dir` not found, or no images found. |
| `NOT_FOUND` | No session with the given `session_id`. |
| `INTERNAL` | Unexpected failure creating a session or starting a stitch. |

### Frontend usage

Most endpoints are reached through a BFF route handler (browser → `/api/...` →
gRPC); the two-phase helpers below have no route yet. The endpoints this service
exposes and where the frontend uses them:

| RPC | BFF route | Used by |
|-----|-----------|---------|
| `ListJobs` | `GET /api/jobs` | Mapping repository (polls every 5s); Spraying planner source list |
| `CreateOdmJob` | `POST /api/jobs` | Mapping repository "Create" button |
| `GetJob` | `GET /api/jobs/[id]` | Mapping detail/editor; Spraying planner; live dashboard (active-job refresh, every 10s) |
| `CancelJob` | `POST /api/jobs/[id]/cancel` | Route + client wrapper exist; not currently invoked by any screen |
| `RemoveJob` | `DELETE /api/jobs/[id]` | Route + client wrapper exist; not currently invoked by any screen |
| `CreateSession` | — | Server-side helper only — no route or browser wrapper (reserved for a future two-phase flow) |
| `StartStitching` | — | Server-side helper only — no route or browser wrapper |
| `StartClustering` | — | Server-side helper only — no route or browser wrapper |

---

## Endpoints

### `CreateOdmJob`

Create a session and start stitching in one call. This is the create path the
GUI uses.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `source_dir` | string | — | **Required.** Server-side folder to ingest images from. |
| `name` | string | `""` | Human label; also seeds the session id. |
| `area_name` | string | `""` | Field/plot name. |
| `captured_at` | string | `""` | Capture time (ISO 8601). |
| `image_glob` | string | `null` | Glob to pick images out of `source_dir` (e.g. `"*_D.JPG"`). Omitted = all images. |
| `options` | object | `{}` | Stitch options passed through to the photogrammetry engine. |

```json
{ "name": "Blok Utara pagi", "source_dir": "/data/incoming/2026-06-12-am",
  "image_glob": "*.tif", "options": {} }
```

**Response:** session object (`status: "stitching"`).

---

### `GetJob`

Fetch one session by id.

**Request**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object. `NOT_FOUND` if the id is unknown.

---

### `ListJobs`

List all sessions.

**Request:** `{}`

**Response**

```json
{ "sessions": [ { ...session object... } ], "jobs": [ ... ] }
```

> `jobs` duplicates `sessions` for back-compat; prefer `sessions`.

---

### `CancelJob`

Cancel a session's stitch and mark it `canceled`.

**Request**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object (`status: "canceled"`).

---

### `RemoveJob`

Delete the session and all of its outputs.

**Request**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response** (not a session object):

```json
{ "session_id": "20260612T092100_sawah-blok-utara", "job_id": "...", "removed": true }
```

---

### `CreateSession`

Two-phase step 1: create the session and ingest its images **without** starting
a stitch (status starts at `unstitched`). *Not currently invoked by the GUI.*

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `""` | Human label; also seeds the session id. |
| `area_name` | string | `""` | Field/plot name. |
| `captured_at` | string | `""` | Capture time (ISO 8601). |
| `source_dir` | string | `null` | Server-side folder to ingest images from. |
| `image_glob` | string | `null` | Glob to pick images. Omitted = all images. |

```json
{ "name": "Blok Utara pagi", "source_dir": "/data/incoming/2026-06-12-am", "image_glob": "*.tif" }
```

**Response:** session object (`status: "unstitched"`, `image_count` set).

---

### `StartStitching`

Two-phase step 2: start stitching a session created by `CreateSession`.
**Fire-and-poll** — returns `status: "stitching"`; poll `GetJob` until terminal.
*Not currently invoked by the GUI.*

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |
| `options` | object | `{}` | Stitch options passed through to the photogrammetry engine. |

```json
{ "session_id": "20260612T092100_sawah-blok-utara", "options": {} }
```

**Response:** session object (`status: "stitching"`). `INVALID_ARGUMENT` if there
are no images or the session is already stitching.

---

### `StartClustering`

(Re)run clustering over a session that already has an orthophoto, producing the
cluster KML and promoting it toward `ready`. **Fire-and-poll.** *Not currently
invoked by the GUI.*

**Request**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object (`status: "clustering"`). Poll `GetJob` until `ready`
(`has_clusters: true`, `cluster_count` set, `clusters_kml` URL populated) or
`failed`. `INVALID_ARGUMENT` if there is no orthophoto yet.

---

## Fetching artifacts

Artifact files are **not** returned over gRPC — the session object's `artifacts`
gives HTTP URLs that a static file server serves. Fetch them directly from the
browser:

| Artifact | Field | Use |
|----------|-------|-----|
| Cluster KML | `clusters_kml` | Vegetation/spray zones — load onto the map, build the flight plan. |
| Orthophoto | `stitched_tif` | NDVI raster overlay. |
| Source images | `raw_dir` | Directory of the source images. |

- A `null` artifact means the file isn't produced yet (e.g. `clusters_kml` is
  `null` until `status: "ready"`).
- The file server supports **HTTP Range requests** (`206 Partial Content`) and
  sends `Access-Control-Allow-Origin: *`, so browsers can fetch directly.
- The frontend BFF rewrites artifact URL origins to a browser-reachable host
  before handing sessions to the browser, so these URLs are ready to fetch as-is.

```bash
curl -s "http://localhost:8000/sessions/<id>/clusters.kml" -o clusters.kml
curl -s -r 0-1023 "http://localhost:8000/sessions/<id>/stitched.tif" -o head.bin   # range
```

## Typical flow

One-shot (the path the GUI uses):

```text
CreateOdmJob  { "name": "...", "source_dir": "/data/incoming/am", "image_glob": "*.tif" }
                -> { "id": "<sid>", "status": "stitching" }
GetJob        { "session_id": "<sid>" }   # poll until status in {ready, failed, canceled}
                -> { "status": "ready", "has_stitched": true,
                     "artifacts": { "stitched_tif": ".../stitched.tif", "clusters_kml": ".../clusters.kml" } }
```

Two-phase (helpers available, not wired to the GUI):

```text
CreateSession   { "name": "...", "source_dir": "/data/incoming/am", "image_glob": "*.tif" }
StartStitching  { "session_id": "<sid>" }
GetJob          { "session_id": "<sid>" }   # poll until terminal
```

## Example call

JSON-over-gRPC with a generic channel (the server (de)serializes the JSON bytes):

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

s = call("CreateOdmJob", {
    "name": "Blok Utara pagi",
    "source_dir": "/data/incoming/2026-06-12-am",
    "image_glob": "*.tif",
})
while call("GetJob", {"session_id": s["id"]})["status"] not in ("ready", "failed", "canceled"):
    pass  # add a sleep in real code

job = call("GetJob", {"session_id": s["id"]})
print(job["status"], job["artifacts"]["stitched_tif"])
```
