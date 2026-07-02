from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import app.db.models  # noqa: F401
from app.routes.drone import router as drone_router
from app.routes.fields import imagery_router, polygon_router, router as fields_router
from app.routes.health import router as health_router
from app.routes.jobs import router as jobs_router

app = FastAPI()
app.include_router(health_router)
app.include_router(fields_router)
app.include_router(imagery_router)
app.include_router(polygon_router)
app.include_router(drone_router)
app.include_router(jobs_router)
app.mount(
    "/imagery",
    StaticFiles(directory=Path(__file__).resolve().parents[1] / "storage" / "imagery"),
    name="imagery",
)
app.mount(
    "/detections",
    StaticFiles(directory=Path(__file__).resolve().parents[1] / "storage" / "detections"),
    name="detections",
)


@app.get("/")
async def root():
    return {"message": "Hello World"}
