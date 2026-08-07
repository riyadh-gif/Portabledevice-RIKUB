# Drone Control API

Standard drone-control endpoints exposed by the `soerogis.DroneService` gRPC
service. These commands drive the single ROS2 (`rclpy`) + MAVROS `Drone` node
(`src/drone.py`) for the common manual operations: arm, disarm, take off, land,
fly to a point, and switch flight mode — alongside the existing mission RPCs and
a `Diagnostics` endpoint that polls all drone telemetry (state, GPS, IMU) at once.

## Transport & conventions

- **Protocol:** gRPC with **JSON request/response bodies** — there is no
  `.proto`. Every request and response is a JSON object (a dict).
- **Service name:** `soerogis.DroneService`
- **Address:** `0.0.0.0:50051` (insecure channel by default)
- **Wiring:** `server.py` registers each method →
  `DroneService` (request validation) → `DroneController` (threading/asyncio
  bridge) → `Drone` node (`drone.py`, MAVROS).

### Command model

Two command-execution models (matching the rest of the backend), plus read-only
polls that never abort:

| Model | Endpoints | Behaviour |
|-------|-----------|-----------|
| **Blocking** | `Arm`, `Disarm`, `SetMode`, `Land` | The call blocks until the FCU accepts the command, then returns the current status. If the FCU keeps rejecting it (e.g. a refused arm), the command is **cancelled at `timeout`** and returns `DEADLINE_EXCEEDED` — `timeout` is the authoritative bound. |
| **Fire-and-poll** | `Takeoff`, `Goto` | The call kicks off background work and returns **immediately** with `mission_running: true`. Poll `MissionStatus` until `mission_running` is `false`; check `last_error` for failures. |
| **Read-only poll** | `MissionStatus`, `Diagnostics` | Returns a snapshot immediately and **never aborts**. `MissionStatus` returns the status object; `Diagnostics` returns the full telemetry snapshot. |

Only **one** fire-and-poll command can run at a time. Starting `Takeoff` or
`Goto` while one is already running returns `FAILED_PRECONDITION`. Blocking
commands serialize behind any running command via an internal lock and will
return `DEADLINE_EXCEEDED` if they cannot acquire it within `timeout`.

### Status object

Every **command** endpoint returns the **status object** (the same shape as
`MissionStatus`); the read-only `Diagnostics` poll is the exception, returning
the telemetry snapshot documented in [its own section](#diagnostics):

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

| Field | Meaning |
|-------|---------|
| `available` | Whether the drone controller initialized successfully. |
| `init_error` | Reason the controller is unavailable (empty when healthy). |
| `mission_running` | `true` while a fire-and-poll command (`Takeoff`/`Goto`/`ExecuteMission`) is in progress. |
| `last_command` | Name of the most recently issued command. |
| `last_error` | Error from the last background command, or empty. |
| `fcu_connected` | MAVROS reports a live flight-controller link. |
| `armed` | Vehicle armed state. |
| `mode` | Current flight mode (e.g. `GUIDED`, `AUTO`, `LAND`). |
| `position` | Local position `{x, y, z}` in metres, or `null` if no pose yet. |

> `fcu_connected`, `armed`, `mode`, and `position` are only present when
> `available` is `true`.

### Error codes

| gRPC status | When |
|-------------|------|
| `FAILED_PRECONDITION` | Controller unavailable (no FCU/ROS), or a fire-and-poll command is already running. |
| `INVALID_ARGUMENT` | Required field missing or invalid (e.g. `mode`, `x/y/z`, bad `method`). |
| `DEADLINE_EXCEEDED` | A blocking command did not complete within `timeout` (often: FCU not connected). |
| `INTERNAL` | Unexpected failure starting/executing a command. |

---

## Endpoints

### `Arm`

Arm the vehicle. Blocks until armed or `timeout`.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_retries` | int | `10` | Forwarded to the node's retry loop. Note: a persistently rejecting FCU is ultimately bounded by `timeout`, not this value. |
| `timeout` | float | `30.0` | Authoritative bound — the command is cancelled and returns `DEADLINE_EXCEEDED` after this many seconds. |

```json
{ "max_retries": 10, "timeout": 30.0 }
```

**Response:** status object (`armed: true` on success). With the FCU refusing to
arm (failed pre-arm checks, e.g. no battery), this returns `DEADLINE_EXCEEDED`.

---

### `Disarm`

Disarm the vehicle. Blocks until disarmed or `timeout`.

**Request:** same fields as `Arm`.

```json
{ "max_retries": 10, "timeout": 30.0 }
```

**Response:** status object (`armed: false` on success).

---

### `SetMode`

Switch the flight mode. Blocks until the mode change is accepted.

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
| `altitude` | float | `2.0` | Target altitude in metres, relative to the takeoff height. |

```json
{ "altitude": 5.0 }
```

**Response:** status object, immediately, with `mission_running: true`. Poll
`MissionStatus` until `mission_running` is `false`.

---

### `Land`

Switch to `LAND` mode. Blocks only until the mode is accepted — **not** until
the vehicle is on the ground. Watch `armed`/`position` via `MissionStatus` to
confirm touchdown.

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

Fly to a local setpoint. **Fire-and-poll.** Requires the vehicle to be flying
in a position-controllable mode (e.g. after `Takeoff`, which leaves it in
`GUIDED`).

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `x` | float | — | **Required.** Local X (metres). |
| `y` | float | — | **Required.** Local Y (metres). |
| `z` | float | — | **Required.** Altitude (metres), relative to takeoff height. |
| `tolerance` | float | `0.1` | Arrival radius (metres) before the point is considered reached. |
| `hold_duration` | float | `0.0` | Seconds to stay within `tolerance` before completing. |
| `method` | string | `"position"` | `"position"` (publish position setpoints) or `"velocity"` (proportional velocity commands). |
| `max_speed` | float | `null` | Velocity cap (m/s) — only used when `method` is `"velocity"`. |

```json
{ "x": 10.0, "y": 5.0, "z": 5.0, "tolerance": 0.25, "hold_duration": 2.0 }
```

**Response:** status object, immediately, with `mission_running: true`. Poll
`MissionStatus` until `mission_running` is `false`.

---

### `Diagnostics`

Poll **all** drone telemetry in one call: flight-controller state plus the latest
global position, IMU, and raw GPS messages. A consolidated alternative to one
endpoint per topic — intended for a frontend diagnostics panel.

**Read-only.** Like `MissionStatus`, it never aborts. Each section holds the most
recent message from its topic, coerced field-for-field to JSON-native types, or
`null` until the first message on that topic arrives.

**Request**

```json
{}
```

**Response**

| Field | Source topic | Message | Contents |
|-------|--------------|---------|----------|
| `available` | — | — | `false` when the controller failed to initialize; then every section is `null`. |
| `job_id` | — | — | The job the drone is currently flying, or `"idle"` when no mission is running. Set from the `job_id` (or `session_id`) passed to `ExecuteMission`; cleared back to `"idle"` when the mission finishes. |
| `state` | `/mavros/state` | `mavros_msgs/State` | `connected`, `armed`, `guided`, `manual_input`, `mode`, `system_status`. |
| `global_position` | `/mavros/global_position/global` | `sensor_msgs/NavSatFix` | Fused `latitude`/`longitude` (deg), `altitude` (m), `status`, `position_covariance` (`double[9]`). |
| `imu` | `/mavros/imu/data` | `sensor_msgs/Imu` | `orientation` (quaternion), `angular_velocity`, `linear_acceleration`, and their covariances. |
| `gps_raw` | `/mavros/gpsstatus/gps1/raw` | `mavros_msgs/GPSRAW` | Raw receiver fix: `fix_type`, `satellites_visible`, `lat`/`lon` (degE7), `alt` (mm, MSL), `eph`/`epv`, `vel` (cm/s), `cog` (cdeg), `h_acc`/`v_acc`/`vel_acc` (mm), `hdg_acc` (degE5), `yaw` (cdeg). |
| `flow` | ESP serial | — | Flow-meter telemetry: fleet-wide `flow_rate_lpm`/`total_liters` plus a per-sensor `sensors[]` breakdown. `null` until the ESP link has a reading. |
| `spray` | — | — | Compact live spraying state (see [Spraying](#spraying-pipeline)): `running`, `phase`, `in_zone`, `zone_id`, `speed_mps`, per-pump `right`/`left` (`target_lpm`, `measured_lpm`, `pwm`/`on`, `liters`), `last_seq`. |

> **`available: false` vs a `null` section.** `available: false` means the
> controller is down (no ROS/FCU link) and **all** sections are `null`. When
> `available: true`, a `null` section just means no message has arrived on that
> topic yet.

A representative populated response (covariances abbreviated):

```json
{
  "available": true,
  "job_id": "idle",
  "state": {
    "header": { "frame_id": "", "stamp": { "sec": 0, "nanosec": 0 } },
    "connected": true, "armed": false, "guided": true,
    "manual_input": false, "mode": "GUIDED", "system_status": 4
  },
  "global_position": {
    "header": { "frame_id": "base_link", "stamp": { "sec": 0, "nanosec": 0 } },
    "status": { "status": 0, "service": 1 },
    "latitude": -7.2756, "longitude": 112.7946, "altitude": 12.3,
    "position_covariance": [0,0,0,0,0,0,0,0,0], "position_covariance_type": 0
  },
  "imu": {
    "header": { "frame_id": "base_link", "stamp": { "sec": 0, "nanosec": 0 } },
    "orientation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 },
    "orientation_covariance": [0,0,0,0,0,0,0,0,0],
    "angular_velocity": { "x": 0.0, "y": 0.0, "z": 0.0 },
    "angular_velocity_covariance": [0,0,0,0,0,0,0,0,0],
    "linear_acceleration": { "x": 0.0, "y": 0.0, "z": 9.81 },
    "linear_acceleration_covariance": [0,0,0,0,0,0,0,0,0]
  },
  "gps_raw": {
    "header": { "frame_id": "", "stamp": { "sec": 0, "nanosec": 0 } },
    "fix_type": 3, "lat": -72756000, "lon": 1127946000, "alt": 12300,
    "eph": 80, "epv": 120, "vel": 350, "cog": 18000, "satellites_visible": 14,
    "alt_ellipsoid": 12000, "h_acc": 500, "v_acc": 800, "vel_acc": 200,
    "hdg_acc": 10000, "yaw": 9000, "dgps_numch": 0, "dgps_age": 0
  },
  "flow": {
    "connected": true, "flow_rate_lpm": 2.3, "total_liters": 5.5,
    "raw_hz": 146.0, "total_pulses": 24090, "pulses_per_liter": 4380.0, "updated_at": 1789456.1,
    "sensors": [
      { "id": 1, "connected": true, "flow_rate_lpm": 1.1, "total_liters": 2.1,
        "raw_hz": 73.0, "total_pulses": 9198, "pulses_per_liter": 4380.0, "updated_at": 1789456.1 },
      { "id": 2, "connected": true, "flow_rate_lpm": 1.2, "total_liters": 3.4,
        "raw_hz": 73.0, "total_pulses": 14892, "pulses_per_liter": 4380.0, "updated_at": 1789456.1 }
    ]
  },
  "spray": {
    "available": true, "running": true, "phase": "spraying", "session_id": "spray-001",
    "in_zone": true, "zone_id": "z1", "speed_mps": 2.1,
    "right": { "target_lpm": 1.20, "measured_lpm": 1.15, "pwm": 1650, "liters": 3.4 },
    "left":  { "target_lpm": 0.90, "measured_lpm": 0.88, "on": true,  "liters": 2.1 },
    "last_seq": 128
  }
}
```

> `flow` is `null` until the ESP link has a reading; `spray` reports
> `running: false, phase: "idle"` (all fields zero/empty) until a spray session is
> armed. Both are `null` when `available` is `false`.

---

### Related (existing) mission RPCs

These predate the standard-command endpoints and remain unchanged:

| RPC | Model | Purpose |
|-----|-------|---------|
| `PushMission` | Blocking | Upload a waypoint list to the FCU (does not fly it). |
| `ExecuteMission` | Fire-and-poll | Arm → takeoff → `AUTO` to run the uploaded mission. Accepts an optional `job_id` (or `session_id`) that `Diagnostics` reports as the active job while the mission runs. |
| `MissionStatus` | Blocking | Return the current status object (use it to poll all fire-and-poll commands). |

---

## Spraying pipeline

Reactive, closed-loop spraying. The frontend uploads a spray mission (a flight
path **plus** spray polygons with per-liquid application rates); the backend flies
it in `AUTO` and, on every control tick, decides how much of each of two liquids
to lay down and drives the two pumps to match — closing the loop on the flowmeters.

**The two pumps / liquids.**

| Pump | FC output | Actuation | Controller | Flowmeter |
|------|-----------|-----------|------------|-----------|
| **right** | servo channel 9 | `MAV_CMD_DO_SET_SERVO` (PWM speed) | PID → PWM | `FLOW 2` (D4) |
| **left** | servo 10 (PWM broken) | `MAV_CMD_DO_SET_RELAY` (on/off) | hysteresis (bang-bang) | `FLOW 1` (D32) |

The left pump is temporarily on/off via relay **instance 10** (`SPRAY_LEFT_RELAY_INDEX`)
while its PWM output is broken; its controller has the same interface as the right
pump, so it upgrades to PID→PWM by flipping one config value once the servo is fixed.

**Dose model.** For each liquid, per tick:

```
target_flow(L/min) = application_rate(L/ha) × ground_speed(m/s) × swath_width(m) / 10000 × 60
```

Ground speed comes from `/mavros/local_position/velocity_local` (GPS `vel`
fallback). The pump is held **off** when the drone is outside every spray polygon,
below `SPRAY_MIN_SPEED_MPS`, not armed, or not in an active mode (`AUTO`).

**Lifecycle** (mirrors the mapping-capture flow):

```text
PushSprayMission  { waypoints, zones, rates, swath }   # upload path to FC + arm monitor (standby)
ExecuteMission    { mode: "spraying", job_id }          # arm → AUTO; the loop begins actuating
SprayMissionStatus{ since_seq }                         # poll incremental sprayed samples (overlay)
Diagnostics       {}                                    # poll compact live spray state (HUD)
```

### `PushSprayMission`

Upload the flight path to the FC and arm the reactive spray monitor. **Blocking**
(bounded by `timeout`); returns the status object. Refused with
`FAILED_PRECONDITION` while a mapping **or** spray session is already active.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `waypoints` | `[[lat, lng], …]` | — | **Required.** Flight path, uploaded to the FC as an `AUTO` waypoint mission (a takeoff waypoint is inserted, same as `PushMission`). |
| `zones` | array | — | **Required.** Spray polygons: `{ "id"?, "polygon": [[lat,lng],…], "rates"?: {"right","left"} }`, or a bare `[[lat,lng],…]` ring. ≥ 3 points each. |
| `rates` | `{right, left}` | config | Mission-level default application rate (L/ha) per pump, used where a zone omits its own `rates`. |
| `swath_width_m` | float | `SPRAY_SWATH_WIDTH_M` (4.0) | Nozzle coverage width (m). |
| `altitude` | float | `5.0` | Mission altitude (m). |
| `speed` | float | `2.0` | Cruise speed hint (m/s). |
| `session_id` | string | auto | Session id (also accepted as `job_id`); pass the same value as `ExecuteMission`'s `job_id`. |

```json
{
  "session_id": "spray-001",
  "waypoints": [[-7.2750, 112.7946], [-7.2748, 112.7946], [-7.2748, 112.7950]],
  "altitude": 6.0, "speed": 2.0, "swath_width_m": 4.0,
  "rates": { "right": 50.0, "left": 30.0 },
  "zones": [
    { "id": "z1", "polygon": [[-7.2751,112.7945],[-7.2747,112.7945],[-7.2747,112.7951],[-7.2751,112.7951]],
      "rates": { "right": 60.0, "left": 0.0 } }
  ]
}
```

**Response:** status object. Then call `ExecuteMission { "mode": "spraying", "job_id": "spray-001" }`.

### `SprayMissionStatus`

Poll spray progress and the incremental sprayed-sample track for the realtime
overlay. **Read-only**, never aborts.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `since_seq` | int | `null` | Return only samples with `seq >= since_seq`. Pass back the previous response's `next_seq` to fetch just the new points. |
| `max_samples` | int | `null` | Cap the number of samples returned. |

**Response**

```json
{
  "running": true, "phase": "spraying", "session_id": "spray-001",
  "swath_width_m": 4.0,
  "zones": [ { "id": "z1", "area_ha": 1.23, "point_count": 4, "rates": { "right": 60.0, "left": 0.0 } } ],
  "totals": { "right_liters": 3.4, "left_liters": 2.1 },
  "current": {
    "in_zone": true, "zone_id": "z1", "speed_mps": 2.1,
    "right": { "target_lpm": 1.2, "measured_lpm": 1.15, "pwm": 1650, "liters": 3.4 },
    "left":  { "target_lpm": 0.0, "measured_lpm": 0.0, "on": false, "liters": 2.1 }
  },
  "next_seq": 129,
  "samples": [
    { "seq": 128, "t": 1789456.1, "lat": -7.2749, "lng": 112.7947, "speed_mps": 2.1,
      "in_zone": true, "zone_id": "z1",
      "right": { "target_lpm": 1.2, "measured_lpm": 1.15, "pwm": 1650 },
      "left":  { "target_lpm": 0.0, "measured_lpm": 0.0, "on": false } }
  ]
}
```

**Response fields**

| Field | Type | Meaning |
|-------|------|---------|
| `running` | bool | A spray session is armed/active. |
| `phase` | string | `idle` (never armed) → `armed` → `standby` (armed, waiting for AUTO) → `spraying` (flying & actuating) → `complete` / `failed`. |
| `session_id` | string | The armed session's id. |
| `swath_width_m` | float | Effective nozzle swath used in the dose model. |
| `zones[]` | array | Each zone's `id`, `area_ha` (computed), `point_count`, and `rates` (L/ha per pump). |
| `totals.{right,left}_liters` | float | Cumulative litres dispensed this session (integrated from **measured** flow). |
| `current` | object | Live state (same object as `Diagnostics.spray` minus `available/running/phase/session_id`) — see below. |
| `next_seq` | int | **Cursor.** Pass as the next `since_seq` to get only newer samples. Lossless even when `max_samples` truncates. |
| `samples[]` | array | One entry per control tick while flying (see below). |

**`current` / `sample` object**

| Field | Type | Meaning |
|-------|------|---------|
| `seq` | int | Monotonic sample index (sample only). |
| `t` | float | Unix timestamp, seconds (sample only). |
| `lat`, `lng` | float | Drone position at this tick (sample only). |
| `in_zone` | bool | Inside a spray polygon right now. |
| `zone_id` | string | Which zone (empty if outside all). |
| `speed_mps` | float | Ground speed used for the dose. |
| `right.target_lpm` / `left.target_lpm` | float | Commanded flow setpoint (L/min); `0` when not spraying. |
| `right.measured_lpm` / `left.measured_lpm` | float | Flowmeter reading (L/min). |
| `right.pwm` | int | Right-pump servo PWM (µs); `pwm_min` = off. |
| `left.on` | bool | Left-pump relay state. |
| `right.liters` / `left.liters` | float | Cumulative litres per pump (`current` only). |

Draw each `sample` as a swath-wide segment along `(lat,lng)`, coloured by
`in_zone` / measured flow, to build the sprayed-area overlay.

### `SetSprayConfig`

Runtime tuning without a redeploy — for manually tuning each pump's PID/thresholds
in the field. All fields optional; returns the full current config.

| Field | Applies to |
|-------|-----------|
| `right_kp`, `right_ki`, `right_kd` | right-pump PID gains |
| `pwm_min`, `pwm_max` | right-pump PWM range |
| `left_on_threshold_lpm`, `left_off_threshold_lpm` | left-pump relay hysteresis (L/min) |
| `swath_width_m`, `min_speed_mps` | dose model |
| `rate_right_lpha`, `rate_left_lpha` | default rates for future missions (an armed mission keeps its zone rates) |

```json
{ "right_kp": 0.2, "right_ki": 0.35, "left_on_threshold_lpm": 0.05 }
```

### `CancelSprayMission`

Cancel/disarm the spray monitor: forces both pumps off and releases the session.
Use it to abort a run, or to release a session that was armed via `PushSprayMission`
but never executed (otherwise a new `PushSprayMission` is refused with
`FAILED_PRECONDITION` — "a spray session is already active"). Safe to call when idle.

**Request:** `{}` — **Response:** the spray status object (with `running: false`).

### End-to-end spraying flow

```text
PushSprayMission { waypoints, zones, rates, swath_width_m, session_id: "spray-001" }
  → returns status object (mission uploaded, monitor armed in standby)
ExecuteMission   { mode: "spraying", job_id: "spray-001" }
  → arm → AUTO; the control loop starts actuating on entering a zone

# then, on a timer (e.g. 2 Hz), incrementally pull sprayed samples for the overlay:
cursor = 0
loop:
    res = SprayMissionStatus { since_seq: cursor, max_samples: 500 }
    drawSprayedSamples(res.samples)          # append to the overlay
    cursor = res.next_seq                     # advance — never skips samples
    updateHud(res.current, res.totals)        # or read Diagnostics.spray for the HUD
    if not res.running: break                 # phase == "complete" | "failed"

# abort / release at any time:
CancelSprayMission {}                          # forces pumps off, frees the session
```

Poll `Diagnostics` (its `spray` section) for the live HUD and `SprayMissionStatus`
for the incremental overlay track — both are read-only and never abort. `phase`
reaches `complete` when the FC finishes the mission (or the vehicle disarms).

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

## Example client

Using `grpc` with the JSON codec (raw bytes; the server (de)serializes JSON):

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

# One poll for all telemetry (state + global position + IMU + raw GPS):
diag = call("Diagnostics", {})
if diag["available"]:
    gps = diag["gps_raw"]          # None until the first GPSRAW message arrives
    if gps:
        print("fix_type", gps["fix_type"], "sats", gps["satellites_visible"])
    print("mode", diag["state"]["mode"])
```
