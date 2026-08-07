import asyncio
import logging

import cv2
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/camera", tags=["camera"])
logger = logging.getLogger("camera")

CAMERA_DEVICE = "/dev/video0"
STREAM_FPS = 10
JPEG_QUALITY = 80

# The physical device only supports one open handle reliably; this lock keeps
# the live-preview stream and the "capture a still" endpoint from opening it
# concurrently (getUserMedia() in the WebKitGTK kiosk browser cannot read this
# webcam at all - a WebKit/GStreamer caps-negotiation bug confirmed via direct
# GStreamer testing, which worked fine outside the browser - so capture is
# done here, server-side, instead).
_camera_lock = asyncio.Lock()
_cap: cv2.VideoCapture | None = None


def _open() -> cv2.VideoCapture:
    global _cap
    if _cap is None or not _cap.isOpened():
        _cap = cv2.VideoCapture(CAMERA_DEVICE)
        if not _cap.isOpened():
            raise RuntimeError(f"Tidak dapat membuka kamera di {CAMERA_DEVICE}")
    return _cap


def _release() -> None:
    global _cap
    if _cap is not None:
        _cap.release()
        _cap = None


def _read_jpeg() -> bytes:
    cap = _open()
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError("Gagal membaca frame dari kamera")
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise RuntimeError("Gagal mengenkode frame ke JPEG")
    return buf.tobytes()


@router.get("/stream")
async def stream(request: Request):
    async def frames():
        try:
            while True:
                if await request.is_disconnected():
                    break
                async with _camera_lock:
                    try:
                        jpeg = await run_in_threadpool(_read_jpeg)
                    except RuntimeError as exc:
                        logger.warning("camera stream error: %s", exc)
                        break
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
                )
                await asyncio.sleep(1 / STREAM_FPS)
        finally:
            # Release as soon as the viewer navigates away/closes the tab so
            # the camera (and its LED) isn't left open indefinitely.
            async with _camera_lock:
                _release()

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.post("/capture")
async def capture():
    async with _camera_lock:
        try:
            jpeg = await run_in_threadpool(_read_jpeg)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
            ) from exc
    return Response(content=jpeg, media_type="image/jpeg")
