import math
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.grpc_backend import BACKEND_GRPC_ADDR, call_grpc, drone_addr_from_request

router = APIRouter(prefix="/api/drone", tags=["drone"])
DRONE = "/soerogis.DroneService"


async def _read_json(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _payload(body: dict[str, Any] | None) -> dict[str, Any]:
    return body or {}


@router.get("/config")
def config():
    return {"default_addr": BACKEND_GRPC_ADDR, "defaultDroneAddr": BACKEND_GRPC_ADDR}


@router.get("/diagnostics")
def diagnostics(request: Request):
    return call_grpc(f"{DRONE}/Diagnostics", {}, timeout=15, addr=drone_addr_from_request(request))


@router.get("/status")
def status(request: Request):
    return call_grpc(f"{DRONE}/MissionStatus", {}, timeout=30, addr=drone_addr_from_request(request))


@router.post("/mission")
async def push_mission(request: Request):
    body = await _read_json(request)
    geo_waypoints = body.get("geo_waypoints") or []
    waypoints = body.get("waypoints") or []

    if geo_waypoints:
        payload = {
            "waypoints": [[point["lat"], point["lng"]] for point in geo_waypoints],
            "altitude": body.get("altitude"),
            "speed": body.get("speed"),
            "hold_time": body.get("hold_time"),
            "acceptance_radius": body.get("acceptance_radius"),
        }
    elif waypoints:
        origin = waypoints[0]
        meters_per_pixel = float(body.get("meters_per_pixel") or os.getenv("METERS_PER_PIXEL", "0.05"))
        payload = {
            "waypoints": [
                [-(point["y"] - origin["y"]) * meters_per_pixel, (point["x"] - origin["x"]) * meters_per_pixel]
                for point in waypoints
            ],
            "altitude": body.get("altitude"),
            "speed": body.get("speed"),
            "hold_time": body.get("hold_time"),
            "acceptance_radius": body.get("acceptance_radius"),
        }
    else:
        raise HTTPException(status_code=400, detail="geo_waypoints or waypoints are required")

    return call_grpc(f"{DRONE}/PushMission", payload, timeout=70, addr=drone_addr_from_request(request))


@router.post("/mission/execute")
async def execute_mission(request: Request):
    body = await _read_json(request)
    return call_grpc(
        f"{DRONE}/ExecuteMission",
        {
            "mode": body.get("mode"),
            "altitude": body.get("altitude"),
            "job_id": body.get("job_id"),
            "session_id": body.get("session_id"),
        },
        timeout=30,
        addr=drone_addr_from_request(request),
    )


@router.post("/mapping-mission")
async def push_capture_mission(request: Request):
    """Upload a discrete-capture-point mapping mission (PushCaptureMission): a
    LOITER_UNLIM mission that visits each `{lat,lng}` capture station in order,
    holding for a photo. Blocking upload — returns the drone status object. Then
    call `POST /api/drone/mission/execute` with `{mode: "mapping", job_id}` to
    fly it. See docs/mapping.md (drone capture pipeline) + docs/drone_api.md."""
    body = await _read_json(request)
    points = body.get("capture_points") or []
    valid = [
        {"lat": p["lat"], "lng": p["lng"]}
        for p in points
        if isinstance(p, dict)
        and isinstance(p.get("lat"), (int, float))
        and isinstance(p.get("lng"), (int, float))
    ]
    if not valid:
        raise HTTPException(
            status_code=400,
            detail="capture_points must be a non-empty array of { lat, lng } numbers",
        )

    payload: dict[str, Any] = {
        "capture_points": valid,
        "altitude": body.get("altitude"),
        "hold_time": body.get("hold_time"),
        "session_id": body.get("session_id"),
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    return call_grpc(
        f"{DRONE}/PushCaptureMission", payload, timeout=70, addr=drone_addr_from_request(request)
    )


@router.get("/mapping-mission")
def mapping_mission_status(request: Request):
    """Read-only poll of the mapping capture mission's progress
    (MappingMissionStatus): `{running, session_id, phase, captures_done,
    total_captures, odm_job_id, last_error}`. `odm_job_id` is populated at
    mission end — resolve it to a session via `GET /api/jobs/{id}`."""
    return call_grpc(
        f"{DRONE}/MappingMissionStatus", {}, timeout=30, addr=drone_addr_from_request(request)
    )


@router.get("/spray/status")
def spray_status(
    request: Request,
    since_seq: int | None = None,
    max_samples: int | None = None,
):
    """Poll the reactive spray session (SprayMissionStatus): live per-pump state,
    cumulative totals, and the incremental sprayed-sample track for the map
    overlay. Read-only — never aborts. Pass the previous response's `next_seq`
    back as `since_seq` to fetch only newer samples."""
    payload: dict[str, Any] = {}
    if since_seq is not None:
        payload["since_seq"] = since_seq
    if max_samples is not None:
        payload["max_samples"] = max_samples
    return call_grpc(
        f"{DRONE}/SprayMissionStatus", payload, timeout=15, addr=drone_addr_from_request(request)
    )


@router.post("/spray/mission")
async def push_spray_mission(request: Request):
    """Upload a reactive spray mission (PushSprayMission): the flight path plus
    the spray polygons and their per-liquid application rates. Accepts
    `geo_waypoints` ([{lat,lng}]) or `waypoints` ([[lat,lng]]); zones are
    `{id?, polygon: [[lat,lng]], rates?: {right,left}}`."""
    body = await _read_json(request)
    geo_waypoints = body.get("geo_waypoints") or []
    waypoints = body.get("waypoints") or []
    if geo_waypoints:
        waypoints = [[point["lat"], point["lng"]] for point in geo_waypoints]
    if not waypoints:
        raise HTTPException(status_code=400, detail="geo_waypoints or waypoints are required")

    zones = body.get("zones") or []
    if not zones:
        raise HTTPException(status_code=400, detail="zones are required")

    payload: dict[str, Any] = {
        "session_id": body.get("session_id"),
        "waypoints": waypoints,
        "zones": zones,
        "rates": body.get("rates"),
        "swath_width_m": body.get("swath_width_m"),
        "altitude": body.get("altitude"),
        "speed": body.get("speed"),
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    return call_grpc(
        f"{DRONE}/PushSprayMission", payload, timeout=70, addr=drone_addr_from_request(request)
    )


@router.post("/spray/cancel")
async def cancel_spray_mission(request: Request):
    """Cancel/disarm the reactive spray monitor (CancelSprayMission): forces both
    pumps off and releases the session. Safe to call when idle."""
    return call_grpc(
        f"{DRONE}/CancelSprayMission", {}, timeout=15, addr=drone_addr_from_request(request)
    )


@router.post("/spray/config")
async def spray_config(request: Request):
    """Tune the reactive spray controller at runtime (SetSprayConfig). All fields
    optional; returns the full current config."""
    body = await _read_json(request)
    return call_grpc(
        f"{DRONE}/SetSprayConfig", _payload(body), timeout=10, addr=drone_addr_from_request(request)
    )


@router.post("/flow-config")
async def flow_config(request: Request):
    """Calibrate the sprayer flowmeters (SetFlowConfig). `sensor_id` (1=D32,
    2=D4) targets one line; omit it to calibrate both."""
    body = await _read_json(request)
    ppl = body.get("pulses_per_liter")
    if (
        isinstance(ppl, bool)
        or not isinstance(ppl, (int, float))
        or not math.isfinite(ppl)
        or ppl <= 0
    ):
        raise HTTPException(status_code=400, detail="pulses_per_liter must be a number > 0")
    payload: dict[str, Any] = {"pulses_per_liter": ppl}
    sensor_id = body.get("sensor_id")
    if sensor_id is not None:
        if isinstance(sensor_id, bool) or not isinstance(sensor_id, int) or sensor_id <= 0:
            raise HTTPException(status_code=400, detail="sensor_id must be a positive integer")
        payload["sensor_id"] = sensor_id
    return call_grpc(
        f"{DRONE}/SetFlowConfig", payload, timeout=10, addr=drone_addr_from_request(request)
    )


@router.post("/arm")
async def arm(request: Request):
    body = await _read_json(request)
    timeout = float(body.get("timeout", 30))
    return call_grpc(f"{DRONE}/Arm", _payload(body), timeout=timeout + 5, addr=drone_addr_from_request(request))


@router.post("/disarm")
async def disarm(request: Request):
    body = await _read_json(request)
    timeout = float(body.get("timeout", 30))
    return call_grpc(
        f"{DRONE}/Disarm", _payload(body), timeout=timeout + 5, addr=drone_addr_from_request(request)
    )


@router.post("/setmode")
async def set_mode(request: Request):
    body = await _read_json(request)
    if not body.get("mode"):
        raise HTTPException(status_code=400, detail="mode is required")
    timeout = float(body.get("timeout", 30))
    return call_grpc(
        f"{DRONE}/SetMode", _payload(body), timeout=timeout + 5, addr=drone_addr_from_request(request)
    )


@router.post("/takeoff")
async def takeoff(request: Request):
    body = await _read_json(request)
    return call_grpc(f"{DRONE}/Takeoff", _payload(body), timeout=30, addr=drone_addr_from_request(request))


@router.post("/land")
async def land(request: Request):
    body = await _read_json(request)
    timeout = float(body.get("timeout", 30))
    return call_grpc(f"{DRONE}/Land", _payload(body), timeout=timeout + 5, addr=drone_addr_from_request(request))


@router.post("/goto")
async def goto(request: Request):
    body = await _read_json(request)
    for field in ("x", "y", "z"):
        if field not in body:
            raise HTTPException(status_code=400, detail=f"{field} is required")
    return call_grpc(f"{DRONE}/Goto", _payload(body), timeout=30, addr=drone_addr_from_request(request))
