from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.grpc_backend import call_grpc, normalize_session

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
JOBS = "/soerogis.MappingJobService"


async def _read_json(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


@router.get("")
def list_jobs():
    result = call_grpc(f"{JOBS}/ListJobs", {}, timeout=30)
    if isinstance(result, list):
        sessions = result
    else:
        sessions = result.get("sessions") or result.get("jobs") or []
    return [normalize_session(item) for item in sessions]


@router.post("")
async def create_job(request: Request):
    body = await _read_json(request)
    source_dir = body.get("source_dir")
    if not source_dir:
        raise HTTPException(status_code=400, detail="source_dir is required")
    payload = {
        "source_dir": source_dir,
        "name": body.get("name"),
        "area_name": body.get("area_name"),
        "captured_at": body.get("captured_at"),
        "image_glob": body.get("image_glob"),
        "options": body.get("options") or {},
    }
    return normalize_session(call_grpc(f"{JOBS}/CreateOdmJob", payload, timeout=30))


@router.get("/{session_id}")
def get_job(session_id: str):
    return normalize_session(call_grpc(f"{JOBS}/GetJob", {"session_id": session_id}, timeout=30))


@router.post("/{session_id}/cancel")
def cancel_job(session_id: str):
    return normalize_session(call_grpc(f"{JOBS}/CancelJob", {"session_id": session_id}, timeout=30))


@router.delete("/{session_id}")
def remove_job(session_id: str):
    return call_grpc(f"{JOBS}/RemoveJob", {"session_id": session_id}, timeout=30)
