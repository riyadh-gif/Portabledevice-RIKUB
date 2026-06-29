# Drone Control API

Reference for the `soerogis.DroneService` gRPC endpoints the frontend uses to
fly and monitor the drone: manual flight commands (arm, disarm, set mode, take
off, land, go to a point), the mission RPCs (push / execute / status), and a
single `Diagnostics` poll that returns all telemetry at once.

This document describes **only the endpoints, their inputs, and their outputs** —
not how the backend implements them.

## Transport & conventions

- **Protocol:** gRPC with **JSON request/response bodies** — there is no
  `.proto`. Every request and response is a JSON object.
- **Service name:** `soerogis.DroneService`
- **Method path:** `/soerogis.DroneService/<Method>` (e.g. `/soerogis.DroneService/Arm`).
- **Address:** a bare `host:port` (no scheme), default port `50051`, insecure
  channel. The frontend BFF reads it from `BACKEND_GRPC_ADDR` and can retarget
  the drone per request via the `x-drone-addr` header.

### Command model

Endpoints fall into three behavioural categories. This governs how a caller must
consume them:

| Model | Endpoints | Behaviour |
|-------|-----------|-----------|
| **Blocking** | `Arm`, `Disarm`, `SetMode`, `Land`, `PushMission` | The call blocks until the command completes, then returns the status object. For `Arm`/`Disarm`/`SetMode`/`Land`, a command that keeps being rejected (e.g. a refused arm) is **cancelled at `timeout`** and returns `DEADLINE_EXCEEDED`. `PushMission` has no `timeout` field (it can take ~60s). |
| **Fire-and-poll** | `Takeoff`, `Goto`, `ExecuteMission` | The call kicks off the work and returns **immediately** with `mission_running: true`. Poll `MissionStatus` until `mission_running` is `false`; check `last_error` for failures. |
| **Read-only poll** | `MissionStatus`, `Diagnostics` | Returns a snapshot immediately and **never aborts**. `MissionStatus` returns the status object; `Diagnostics` returns the full telemetry snapshot. |

Only **one** fire-and-poll command may run at a time — starting `Takeoff`,
`Goto`, or `ExecuteMission` while one is already running returns
`FAILED_PRECONDITION`. Blocking commands return `DEADLINE_EXCEEDED` if they
cannot start within `timeout`.

### Status object

Every **command** endpoint (`Arm`, `Disarm`, `SetMode`, `Takeoff`, `Land`,
`Goto`, `PushMission`, `ExecuteMission`) and `MissionStatus` return the **status
object**. `Diagnostics` is the exception — see [its section](#diagnostics).

```json
{
  "available": true,
  "init_error": "",
  "mission_running": false,
  "last_command": "arm",
  "last_error": "",
  "fcu_connected": true,
  "armed": true,
  "mode": "GUIDED",
  "position": { "x": 0.0, "y": 0.0, "z": 1.98 }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `available` | bool | Whether the drone controller is up. When `false`, the fields below are absent. |
| `init_error` | string | Reason the controller is unavailable (empty when healthy). |
| `mission_running` | bool | `true` while a fire-and-poll command (`Takeoff`/`Goto`/`ExecuteMission`) is in progress. |
| `last_command` | string | Name of the most recently issued command. |
| `last_error` | string | Error from the last background command, or empty. |
| `fcu_connected` | bool | Live flight-controller link. |
| `armed` | bool | Vehicle armed state. |
| `mode` | string | Current flight mode (e.g. `GUIDED`, `AUTO`, `LAND`). |
| `position` | object \| null | Local position `{x, y, z}` in metres, or `null` if no pose yet. |

> `fcu_connected`, `armed`, `mode`, and `position` are present only when
> `available` is `true`.

### Error codes

| gRPC status | When |
|-------------|------|
| `FAILED_PRECONDITION` | Controller unavailable, or a fire-and-poll command is already running. |
| `INVALID_ARGUMENT` | Required field missing or invalid (e.g. `mode`, `x/y/z`, bad `method`). |
| `DEADLINE_EXCEEDED` | A blocking command did not complete within `timeout`. |
| `INTERNAL` | Unexpected failure starting/executing a command. |

### Frontend usage

Every endpoint is reached through a BFF route handler (browser → `/api/...` →
gRPC). The endpoints this service exposes and where the frontend uses them:

| RPC | BFF route | Used by |
|-----|-----------|---------|
| `MissionStatus` | `GET /api/drone/status` | Flight Test Bench (polls every 2s; completion watcher for fire-and-poll commands) |
| `Diagnostics` | `GET /api/drone/diagnostics` | Telemetry provider (sole poller; Header, dashboard, settings read the cached snapshot) |
| `PushMission` | `POST /api/drone/mission` | Spraying planner, mission planner (`mapping/new`), Flight Test Bench |
| `ExecuteMission` | `POST /api/drone/mission/execute` | Spraying planner, mission planner |
| `Arm` | `POST /api/drone/arm` | Flight Test Bench |
| `Disarm` | `POST /api/drone/disarm` | Flight Test Bench |
| `SetMode` | `POST /api/drone/setmode` | Flight Test Bench |
| `Takeoff` | `POST /api/drone/takeoff` | Flight Test Bench |
| `Land` | `POST /api/drone/land` | Flight Test Bench |
| `Goto` | `POST /api/drone/goto` | Flight Test Bench |

---

## Telemetry & status

### `MissionStatus`

Return the current status object. **Read-only poll** — never aborts. Use it to
watch fire-and-poll commands (`Takeoff`/`Goto`/`ExecuteMission`) until
`mission_running` becomes `false`.

**Request**

```json
{}
```

**Response:** [status object](#status-object).

---

### `Diagnostics`

Poll **all** drone telemetry in one call: flight-controller state plus the latest
global position, IMU, and raw GPS. **Read-only** — never aborts. Each section
holds the latest sample of that kind, or `null` until the first one arrives.

**Request**

```json
{}
```

**Response**

| Field | Type | Contents |
|-------|------|----------|
| `available` | bool | `false` when the controller is down; then every section below is `null`. |
| `job_id` | string | The mapping job the drone is flying, or `"idle"` when no mission is running. Set from the `job_id`/`session_id` passed to `ExecuteMission`; cleared to `"idle"` on completion. (May be absent on older backends — treat missing as `"idle"`.) |
| `state` | object \| null | Flight-controller state: `connected`, `armed`, `guided`, `manual_input`, `mode`, `system_status` (MAV_STATE enum; `4` = ACTIVE). |
| `global_position` | object \| null | Fused position: `latitude`/`longitude` (deg), `altitude` (m, ellipsoid), `status`, `position_covariance` (`double[9]`). |
| `imu` | object \| null | `orientation` (quaternion `{x,y,z,w}`), `angular_velocity`, `linear_acceleration`, and their covariances. |
| `gps_raw` | object \| null | Raw receiver fix: `fix_type` (0/1 none, 2 = 2D, 3 = 3D, 4 = DGPS, 5/6 = RTK), `satellites_visible`, `lat`/`lon` (degE7), `alt` (mm, MSL), `eph`/`epv` (cm), `vel` (cm/s), `cog` (cdeg), `h_acc`/`v_acc`/`vel_acc` (mm), `hdg_acc` (degE5), `yaw` (cdeg). |

> **`available: false` vs a `null` section.** `available: false` means the
> controller is down and **all** sections are `null`. When `available: true`, a
> `null` section just means no sample of that kind has arrived yet.

A representative populated response (covariances and timestamps abbreviated):

```json
{
  "available": true,
  "job_id": "idle",
  "state": {
    "connected": true, "armed": false, "guided": true,
    "manual_input": false, "mode": "GUIDED", "system_status": 4
  },
  "global_position": {
    "status": { "status": 0, "service": 1 },
    "latitude": -7.2756, "longitude": 112.7946, "altitude": 12.3,
    "position_covariance": [0,0,0,0,0,0,0,0,0], "position_covariance_type": 0
  },
  "imu": {
    "orientation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 },
    "angular_velocity": { "x": 0.0, "y": 0.0, "z": 0.0 },
    "linear_acceleration": { "x": 0.0, "y": 0.0, "z": 9.81 }
  },
  "gps_raw": {
    "fix_type": 3, "lat": -72756000, "lon": 1127946000, "alt": 12300,
    "eph": 80, "epv": 120, "vel": 350, "cog": 18000, "satellites_visible": 14,
    "alt_ellipsoid": 12000, "h_acc": 500, "v_acc": 800, "vel_acc": 200,
    "hdg_acc": 10000, "yaw": 9000, "dgps_numch": 0, "dgps_age": 0
  }
}
```

---

## Mission

### `PushMission`

Upload a waypoint list to the flight controller. Does **not** fly it — call
`ExecuteMission` to run the uploaded mission. **Blocking** (may take up to ~60s).

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `waypoints` | `[number, number][]` | — | **Required.** Ordered list of `[latitude, longitude]` pairs (degrees). |
| `altitude` | float | backend default | Mission altitude (metres). |
| `speed` | float | backend default | Cruise speed (m/s). |
| `hold_time` | float | backend default | Seconds to hold at each waypoint. |
| `acceptance_radius` | float | backend default | Arrival radius (metres) per waypoint. |

```json
{
  "waypoints": [[-7.2756, 112.7946], [-7.2757, 112.7949]],
  "altitude": 15.0, "speed": 5.0, "hold_time": 0.0, "acceptance_radius": 1.0
}
```

**Response:** [status object](#status-object).

---

### `ExecuteMission`

Arm → take off → switch to `AUTO` to run the previously uploaded mission.
**Fire-and-poll** — returns immediately with `mission_running: true`; poll
`MissionStatus` until it clears.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | backend default | Mission mode label (the frontend sends `"mapping"` or `"spraying"`). |
| `altitude` | float | backend default | Take-off altitude (metres). |
| `job_id` | string | — | Optional. The active mapping/mission id; echoed back by `Diagnostics` as the running `job_id`. |
| `session_id` | string | — | Optional alias for `job_id` (the frontend sends the id under both keys). |

```json
{ "mode": "spraying", "altitude": 5.0, "job_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** [status object](#status-object), immediately, with
`mission_running: true`.

---

## Manual commands

### `Arm`

Arm the vehicle. **Blocking** — returns once armed or at `timeout`.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_retries` | int | `10` | Retries before giving up (ultimately bounded by `timeout`). |
| `timeout` | float | `30.0` | Seconds before the command is cancelled with `DEADLINE_EXCEEDED`. |

```json
{ "max_retries": 10, "timeout": 30.0 }
```

**Response:** status object (`armed: true` on success). A flight controller that
refuses to arm (e.g. failed pre-arm checks) yields `DEADLINE_EXCEEDED`.

---

### `Disarm`

Disarm the vehicle. **Blocking.**

**Request:** same fields as [`Arm`](#arm).

```json
{ "max_retries": 10, "timeout": 30.0 }
```

**Response:** status object (`armed: false` on success).

---

### `SetMode`

Switch the flight mode. **Blocking** — returns once the change is accepted.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | — | **Required.** ArduPilot mode name, e.g. `GUIDED`, `AUTO`, `LOITER`, `RTL`, `LAND`. |
| `max_retries` | int | `10` | Retries before giving up. |
| `timeout` | float | `30.0` | Seconds before `DEADLINE_EXCEEDED`. |

```json
{ "mode": "GUIDED" }
```

**Response:** status object (`mode` reflects the new mode).

---

### `Takeoff`

Set `GUIDED`, arm, and climb to the target altitude. **Fire-and-poll.**

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `altitude` | float | `2.0` | Target altitude (metres), relative to the take-off height. |

```json
{ "altitude": 5.0 }
```

**Response:** status object, immediately, with `mission_running: true`. Poll
`MissionStatus` until it clears.

---

### `Land`

Switch to `LAND` mode. **Blocking only until the mode is accepted** — not until
touchdown. Watch `armed`/`position` via `MissionStatus` to confirm the vehicle
is down.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | float | `30.0` | Seconds before `DEADLINE_EXCEEDED`. |

```json
{}
```

**Response:** status object (`mode: "LAND"` on success).

---

### `Goto`

Fly to a local setpoint. **Fire-and-poll.** Requires the vehicle to already be
flying in a position-controllable mode (e.g. after `Takeoff`, which leaves it in
`GUIDED`).

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `x` | float | — | **Required.** Local X (metres). |
| `y` | float | — | **Required.** Local Y (metres). |
| `z` | float | — | **Required.** Altitude (metres), relative to take-off height. |
| `tolerance` | float | `0.1` | Arrival radius (metres). |
| `hold_duration` | float | `0.0` | Seconds to stay within `tolerance` before completing. |
| `method` | string | `"position"` | `"position"` (position setpoints) or `"velocity"` (proportional velocity commands). |
| `max_speed` | float \| null | `null` | Velocity cap (m/s) — only used when `method` is `"velocity"`. |

```json
{ "x": 10.0, "y": 5.0, "z": 5.0, "tolerance": 0.25, "hold_duration": 2.0 }
```

**Response:** status object, immediately, with `mission_running: true`. Poll
`MissionStatus` until it clears.

---

## Typical flow

A manual take-off → move → land sequence:

```text
SetMode  { "mode": "GUIDED" }          # optional; Takeoff also forces GUIDED
Takeoff  { "altitude": 5.0 }           # poll MissionStatus -> mission_running: false
Goto     { "x": 10, "y": 0, "z": 5 }   # poll MissionStatus -> mission_running: false
Goto     { "x": 10, "y": 10, "z": 5 }  # poll MissionStatus -> mission_running: false
Land     {}                            # then poll MissionStatus for armed: false
```

A planned mission:

```text
PushMission     { "waypoints": [[lat,lng], ...], "altitude": 15 }   # blocks, uploads
ExecuteMission  { "mode": "spraying", "altitude": 5 }               # poll MissionStatus
```

## Example call

JSON-over-gRPC with a generic channel (the server (de)serializes the JSON bytes):

```python
import json
import grpc

channel = grpc.insecure_channel("localhost:50051")

def call(method: str, payload: dict) -> dict:
    fn = channel.unary_unary(
        f"/soerogis.DroneService/{method}",
        request_serializer=lambda d: json.dumps(d).encode("utf-8"),
        response_deserializer=lambda b: json.loads(b.decode("utf-8")),
    )
    return fn(payload)

call("Takeoff", {"altitude": 5.0})
while call("MissionStatus", {})["mission_running"]:
    pass  # add a sleep in real code
call("Goto", {"x": 10.0, "y": 0.0, "z": 5.0})

diag = call("Diagnostics", {})         # one poll for all telemetry
if diag["available"] and diag["gps_raw"]:
    print("fix_type", diag["gps_raw"]["fix_type"], "mode", diag["state"]["mode"])
```
