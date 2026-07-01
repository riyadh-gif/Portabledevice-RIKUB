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
