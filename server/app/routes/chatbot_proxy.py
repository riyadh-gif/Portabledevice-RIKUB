import asyncio
import itertools
import logging
import os
import sys
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

CHATBOT_UPSTREAM_URL = os.getenv("CHATBOT_UPSTREAM_URL", "http://100.116.176.70:5000")
# Gemma runs swap-backed on the Jetson (8GB RAM); a single reply can take 1.5-3+ min.
CHATBOT_PROXY_TIMEOUT = 300.0
# Health probe hits /docs (a static Swagger page), so keep it short and snappy.
CHATBOT_HEALTH_TIMEOUT = 5.0

# Self-contained logger: uvicorn's default config leaves the root logger without a
# handler, so INFO lines from a propagating logger would be dropped. Attach our own
# stderr handler (captured by uvicorn.log) and stop propagation to avoid double logs.
logger = logging.getLogger("chatbot_proxy")
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

# The Jetson can only serve ONE Gemma inference at a time; two concurrent calls spike
# memory and can OOM-kill ollama. A plain asyncio.Lock serializes upstream calls: this
# runs under a single uvicorn worker (one event loop), so no distributed lock is needed.
# Late arrivals await the lock and take their turn — queueing, not rejecting, is honest
# behavior since the Jetson genuinely processes requests one at a time.
_upstream_lock = asyncio.Lock()
_request_ids = itertools.count(1)


class _InflightCounter:
    """Counts proxy requests currently held (waiting for the lock + the one talking to
    Ollama), so /api/chat/health can report an accurate queue_depth."""

    def __init__(self) -> None:
        self.count = 0

    def __enter__(self) -> "_InflightCounter":
        self.count += 1
        return self

    def __exit__(self, *exc: object) -> bool:
        self.count -= 1
        return False


_inflight = _InflightCounter()


async def _proxy_post(path: str, body: dict) -> JSONResponse:
    req_id = next(_request_ids)
    with _inflight:
        logger.info(
            "[req %d] received path=%s queue_depth=%d", req_id, path, _inflight.count
        )
        arrived = time.monotonic()
        async with _upstream_lock:
            waited = time.monotonic() - arrived
            logger.info("[req %d] upstream start path=%s waited=%.1fs", req_id, path, waited)
            started = time.monotonic()
            try:
                # Timeout covers only the actual Ollama call, not the queue wait: a
                # request queued behind another 1.5-3 min inference must not fail merely
                # for waiting its turn, so the clock starts once the lock is acquired.
                async with httpx.AsyncClient(timeout=CHATBOT_PROXY_TIMEOUT) as client:
                    upstream = await client.post(
                        f"{CHATBOT_UPSTREAM_URL}{path}", json=body
                    )
                duration = time.monotonic() - started
                logger.info(
                    "[req %d] completed path=%s status=%d duration=%.1fs",
                    req_id,
                    path,
                    upstream.status_code,
                    duration,
                )
                return JSONResponse(
                    status_code=upstream.status_code, content=upstream.json()
                )
            except httpx.TimeoutException:
                logger.warning(
                    "[req %d] failed path=%s error=timeout after=%.1fs",
                    req_id,
                    path,
                    time.monotonic() - started,
                )
                return JSONResponse(
                    status_code=504,
                    content={"ok": False, "message": "Chatbot service tidak merespon (timeout)."},
                )
            except httpx.ConnectError:
                logger.warning("[req %d] failed path=%s error=connect", req_id, path)
                return JSONResponse(
                    status_code=502,
                    content={"ok": False, "message": "Chatbot service tidak dapat dihubungi."},
                )
            except Exception:  # noqa: BLE001 -- never leak a stack trace to the client
                logger.exception("[req %d] failed path=%s error=unexpected", req_id, path)
                return JSONResponse(
                    status_code=502,
                    content={"ok": False, "message": "Chatbot service mengalami kesalahan tak terduga."},
                )


@router.post("/api/chat")
async def proxy_chat(request: Request) -> JSONResponse:
    return await _proxy_post("/api/chat", await request.json())


@router.post("/api/parameter")
async def proxy_parameter(request: Request) -> JSONResponse:
    return await _proxy_post("/api/parameter", await request.json())


@router.get("/api/chat/health")
async def chat_health() -> JSONResponse:
    # Probe /docs (static Swagger page) instead of /api/chat so a health check never
    # loads the swap-backed Gemma model. This does NOT take the lock, so it stays fast
    # even while an inference is in flight and reports queue_depth truthfully.
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=CHATBOT_HEALTH_TIMEOUT) as client:
            resp = await client.get(f"{CHATBOT_UPSTREAM_URL}/docs")
        # Any HTTP answer (even 404) means the service is up; only 5xx counts as down.
        reachable = resp.status_code < 500
    except httpx.HTTPError:
        reachable = False
    except Exception:  # noqa: BLE001 -- health must never raise
        logger.exception("health probe error")
        reachable = False
    return JSONResponse(content={"reachable": reachable, "queue_depth": _inflight.count})
