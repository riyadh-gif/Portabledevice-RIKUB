import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Field, FieldImagery, SprayPolygon, TargetDetection

router = APIRouter(prefix="/fields", tags=["fields"])
imagery_router = APIRouter(prefix="/imagery", tags=["imagery"])
polygon_router = APIRouter(prefix="/polygons", tags=["polygons"])

SERVER_ROOT = Path(__file__).resolve().parents[2]


class ImageryRegister(BaseModel):
    capture_at: datetime | None = None
    rgb_tif_path: str
    ndvi_tif_path: str


class AutoImageryRegister(ImageryRegister):
    field_name: str


class NdviZonePreviewRequest(BaseModel):
    ndvi_min: float = PydanticField(default=0.0, ge=-1.0, le=1.0)
    ndvi_max: float = PydanticField(default=0.6, ge=-1.0, le=1.0)
    min_area_m2: float = PydanticField(default=2.0, ge=0.0)
    merge_distance_m: float = PydanticField(default=0.5, ge=0.0)


class ApprovedZonesSaveRequest(BaseModel):
    settings: NdviZonePreviewRequest
    geojson: dict


class PolygonChambersUpdate(BaseModel):
    mode: str
    selected_chambers: list[str] | None = None


class TargetDetectionCreate(BaseModel):
    disease_name: str
    confidence: float | None = None
    sample_lat: float | None = None
    sample_lng: float | None = None
    chamber: str
    image_path: str | None = None


def field_to_dict(field: Field) -> dict:
    return {
        "id": str(field.id),
        "name": field.name,
        "created_at": field.created_at.isoformat() if field.created_at else None,
    }


def imagery_to_dict(imagery: FieldImagery) -> dict:
    return {
        "id": str(imagery.id),
        "field_id": str(imagery.field_id),
        "capture_at": imagery.capture_at.isoformat() if imagery.capture_at else None,
        "rgb_tif_path": imagery.rgb_tif_path,
        "ndvi_tif_path": imagery.ndvi_tif_path,
        "rgb_png_path": imagery.rgb_png_path,
        "ndvi_png_path": imagery.ndvi_png_path,
        "top_left": imagery.top_left,
        "top_right": imagery.top_right,
        "bottom_left": imagery.bottom_left,
        "bottom_right": imagery.bottom_right,
        "ndvi_stats": imagery.ndvi_stats,
        "created_at": imagery.created_at.isoformat() if imagery.created_at else None,
    }


VALID_CHAMBERS = {"fungisida", "insektisida"}
VALID_CHAMBER_MODES = {"none", "auto", "manual"}


def normalize_chambers(values: list[str] | None) -> list[str]:
    chambers = []
    for value in values or []:
        chamber = value.strip().lower()
        if not chamber:
            continue
        if chamber not in VALID_CHAMBERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported chamber: {value}",
            )
        if chamber not in chambers:
            chambers.append(chamber)
    return chambers


def auto_chambers_from_detections(polygon: SprayPolygon) -> list[str]:
    return normalize_chambers([
        detection.chamber
        for detection in polygon.detections
        if detection.chamber
    ])


def detection_to_dict(detection: TargetDetection) -> dict:
    return {
        "id": str(detection.id),
        "polygon_id": str(detection.polygon_id),
        "disease_name": detection.disease_name,
        "confidence": detection.confidence,
        "sample_lat": detection.sample_lat,
        "sample_lng": detection.sample_lng,
        "chamber": detection.chamber,
        "image_path": detection.image_path,
        "created_at": detection.created_at.isoformat()
        if detection.created_at
        else None,
    }


def spray_polygon_to_dict(polygon: SprayPolygon) -> dict:
    return {
        "id": str(polygon.id),
        "field_id": str(polygon.field_id),
        "field_imagery_id": str(polygon.field_imagery_id),
        "zone_code": polygon.zone_code,
        "sequence_no": polygon.sequence_no,
        "geometry": polygon.geometry,
        "area_m2": polygon.area_m2,
        "mean_ndvi": polygon.mean_ndvi,
        "settings": polygon.settings,
        "selected_chambers": polygon.selected_chambers or [],
        "chamber_mode": polygon.chamber_mode or "none",
        "detections": [detection_to_dict(item) for item in polygon.detections],
        "created_at": polygon.created_at.isoformat()
        if polygon.created_at
        else None,
    }


def spray_polygons_to_geojson(polygons: list[SprayPolygon]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": polygon.geometry,
                "properties": {
                    "id": str(polygon.id),
                    "zone_code": polygon.zone_code,
                    "sequence_no": polygon.sequence_no,
                    "area_m2": polygon.area_m2,
                    "mean_ndvi": polygon.mean_ndvi,
                    "settings": polygon.settings,
                    "selected_chambers": polygon.selected_chambers or [],
                    "chamber_mode": polygon.chamber_mode or "none",
                    "detections": [
                        detection_to_dict(item) for item in polygon.detections
                    ],
                },
            }
            for polygon in polygons
        ],
    }


def resolve_server_path(relative_path: str) -> Path:
    path = Path(relative_path)
    if path.is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path must be relative to server/",
        )

    resolved = (SERVER_ROOT / path).resolve()
    try:
        resolved.relative_to(SERVER_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path escapes server directory",
        ) from exc

    return resolved


def ensure_existing_file(relative_path: str) -> None:
    resolved = resolve_server_path(relative_path)
    if not resolved.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {relative_path}",
        )


def png_url_from_tif_path(tif_path: str) -> str:
    png_path = Path(tif_path).with_suffix(".png")
    try:
        imagery_path = png_path.relative_to("storage")
        return "/" + imagery_path.as_posix()
    except ValueError:
        return "/" + png_path.as_posix()


def run_gdal_command(command: list[str]) -> None:
    executable = command[0]
    if shutil.which(executable) is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{executable} is not installed on this server",
        )

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{executable} failed: {message}",
        ) from exc


def read_geotiff_corners(relative_path: str) -> dict | None:
    tif_path = resolve_server_path(relative_path)
    if shutil.which("gdalinfo") is None:
        return None

    try:
        result = subprocess.run(
            ["gdalinfo", "-json", str(tif_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        info = json.loads(result.stdout)
        coordinates = info["wgs84Extent"]["coordinates"][0]
    except (subprocess.CalledProcessError, KeyError, IndexError, json.JSONDecodeError):
        return None

    def point(index: int) -> dict:
        lng, lat = coordinates[index]
        return {"lat": lat, "lng": lng}

    return {
        "top_left": point(0),
        "top_right": point(3),
        "bottom_left": point(1),
        "bottom_right": point(2),
    }


def convert_rgb_tif_to_png(relative_path: str) -> str:
    tif_path = resolve_server_path(relative_path)
    png_path = tif_path.with_suffix(".png")

    run_gdal_command(
        [
            "gdal_translate",
            "-of",
            "PNG",
            "-b",
            "1",
            "-b",
            "2",
            "-b",
            "3",
            str(tif_path),
            str(png_path),
        ]
    )
    return png_url_from_tif_path(relative_path)


def compute_ndvi_stats(relative_path: str) -> dict | None:
    tif_path = resolve_server_path(relative_path)
    try:
        import math

        import numpy as np
        import rasterio
    except ImportError:
        return None

    try:
        with rasterio.open(tif_path) as src:
            ndvi = src.read(1)
            valid_mask = (src.read_masks(1) > 0) & np.isfinite(ndvi)
            if src.nodata is not None and not math.isnan(src.nodata):
                valid_mask &= ~np.isclose(ndvi, src.nodata)
            ndvi_clean = np.nan_to_num(ndvi, nan=0.0, posinf=1.0, neginf=-1.0)
            ndvi_clipped = np.clip(ndvi_clean, -1, 1)

            pixel_width = abs(src.transform[0])
            pixel_height = abs(src.transform[4])
            if src.crs and src.crs.is_geographic:
                bounds = src.bounds
                lat_center = (bounds.top + bounds.bottom) / 2
                lat_rad = math.radians(lat_center)
                pixel_area_m2 = (pixel_width * 111320 * math.cos(lat_rad)) * (pixel_height * 111320)
            else:
                pixel_area_m2 = pixel_width * pixel_height

        total_valid = int(np.sum(valid_mask))
        if total_valid == 0:
            return None

        cat_defs = [
            ("Sangat Sehat", "0.8–1.0", "#1a5c2a", (ndvi_clipped >= 0.8) & valid_mask),
            ("Sehat",        "0.6–0.8", "#1a9850", (ndvi_clipped >= 0.6) & (ndvi_clipped < 0.8) & valid_mask),
            ("Cukup Sehat",  "0.4–0.6", "#91cf60", (ndvi_clipped >= 0.4) & (ndvi_clipped < 0.6) & valid_mask),
            ("Kurang Sehat", "0.21–0.4","#f9a825", (ndvi_clipped >= 0.21) & (ndvi_clipped < 0.4) & valid_mask),
            ("Tidak Sehat",  "0–0.21",  "#d73027", (ndvi_clipped >= 0) & (ndvi_clipped < 0.21) & valid_mask),
            ("Non-Vegetasi", "< 0",     "#2d2d2d", (ndvi_clipped < 0) & valid_mask),
        ]

        categories = []
        for name, range_str, color, mask in cat_defs:
            count = int(np.sum(mask))
            area_ha = round((count * pixel_area_m2) / 10000, 4)
            pct = round((count / total_valid) * 100, 1)
            categories.append({"name": name, "range": range_str, "color": color, "area_ha": area_ha, "percentage": pct})

        total_area_ha = round((total_valid * pixel_area_m2) / 10000, 4)
        return {"total_area_ha": total_area_ha, "categories": categories}
    except Exception:
        return None


def convert_ndvi_tif_to_png(relative_path: str) -> str:
    tif_path = resolve_server_path(relative_path)
    png_path = tif_path.with_suffix(".png")
    matplotlib_config_dir = Path("/tmp/matplotlib")
    matplotlib_config_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(matplotlib_config_dir))

    try:
        import matplotlib
        import numpy as np
        import rasterio
        from PIL import Image
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "NDVI colormap dependencies are missing. "
                "Install rasterio, numpy, pillow, and matplotlib."
            ),
        ) from exc

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    with rasterio.open(tif_path) as src:
        ndvi = src.read(1)
        valid_mask = (src.read_masks(1) > 0) & np.isfinite(ndvi)
        if src.nodata is not None and not np.isnan(src.nodata):
            valid_mask &= ~np.isclose(ndvi, src.nodata)

    ndvi_clean = np.nan_to_num(ndvi, nan=0.0, posinf=1.0, neginf=-1.0)
    ndvi_clipped = np.clip(ndvi_clean, -1, 1)

    height, width = ndvi_clipped.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)

    mask_black = (ndvi_clipped < 0) & valid_mask
    rgba[mask_black] = [0, 0, 0, 255]

    mask_vegetation = (ndvi_clipped >= 0) & valid_mask
    ndvi_for_cmap = np.zeros_like(ndvi_clipped, dtype=float)
    ndvi_for_cmap[mask_vegetation] = ndvi_clipped[mask_vegetation]

    rgba_colored = (plt.cm.RdYlGn(ndvi_for_cmap) * 255).astype(np.uint8)
    rgba[mask_vegetation] = rgba_colored[mask_vegetation]
    rgba[~valid_mask, 3] = 0

    Image.fromarray(rgba).save(png_path, "PNG")

    return png_url_from_tif_path(relative_path)


def auto_utm_epsg(lng: float, lat: float) -> int:
    zone = int((lng + 180) / 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def iter_polygon_geometries(geom):
    if geom.is_empty:
        return
    if geom.geom_type == "Polygon":
        yield geom
    elif geom.geom_type == "MultiPolygon":
        yield from geom.geoms
    elif geom.geom_type == "GeometryCollection":
        for part in geom.geoms:
            yield from iter_polygon_geometries(part)


def smooth_polygon_for_preview(polygon, tolerance_m: float = 0.15):
    if polygon.is_empty:
        return polygon

    smoothed = polygon.simplify(tolerance_m, preserve_topology=True)
    if smoothed.is_empty or not smoothed.is_valid:
        smoothed = polygon.buffer(tolerance_m).buffer(-tolerance_m)
    if smoothed.is_empty or not smoothed.is_valid:
        return polygon
    return smoothed


def generate_ndvi_zone_preview(
    imagery: FieldImagery,
    settings: NdviZonePreviewRequest,
) -> dict:
    try:
        import math

        import numpy as np
        import rasterio
        from rasterio import features
        from shapely.geometry import mapping, shape
        from shapely.ops import transform as shapely_transform
        from shapely.ops import unary_union
        from pyproj import Transformer
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "NDVI zone dependencies are missing. "
                "Install shapely and pyproj in the server environment."
            ),
        ) from exc

    if settings.ndvi_min > settings.ndvi_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ndvi_min must be less than or equal to ndvi_max",
        )

    tif_path = resolve_server_path(imagery.ndvi_tif_path)
    if not tif_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {imagery.ndvi_tif_path}",
        )

    with rasterio.open(tif_path) as src:
        ndvi = src.read(1)
        valid_mask = (src.read_masks(1) > 0) & np.isfinite(ndvi)
        if src.nodata is not None and not math.isnan(src.nodata):
            valid_mask &= ~np.isclose(ndvi, src.nodata)

        ndvi_clean = np.nan_to_num(ndvi, nan=0.0, posinf=1.0, neginf=-1.0)
        ndvi_clipped = np.clip(ndvi_clean, -1, 1)
        target_mask = (
            (ndvi_clipped >= settings.ndvi_min)
            & (ndvi_clipped <= settings.ndvi_max)
            & valid_mask
        )

        if int(np.sum(target_mask)) == 0:
            return {
                "imagery_id": str(imagery.id),
                "settings": settings.model_dump(),
                "summary": {
                    "polygon_count": 0,
                    "total_area_m2": 0.0,
                    "total_area_ha": 0.0,
                    "mean_ndvi": None,
                },
                "geojson": {"type": "FeatureCollection", "features": []},
            }

        crs = src.crs
        if crs is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="NDVI GeoTIFF does not have a CRS",
            )

        transform = src.transform
        polygons = [
            shape(geom)
            for geom, value in features.shapes(
                target_mask.astype(np.uint8),
                mask=target_mask,
                transform=transform,
            )
            if value == 1
        ]

        if not polygons:
            return {
                "imagery_id": str(imagery.id),
                "settings": settings.model_dump(),
                "summary": {
                    "polygon_count": 0,
                    "total_area_m2": 0.0,
                    "total_area_ha": 0.0,
                    "mean_ndvi": None,
                },
                "geojson": {"type": "FeatureCollection", "features": []},
            }

        unioned_wgs = unary_union(polygons)
        centroid = unioned_wgs.centroid
        projected_crs = f"EPSG:{auto_utm_epsg(centroid.x, centroid.y)}" if crs.is_geographic else crs
        to_projected = Transformer.from_crs(crs, projected_crs, always_xy=True)
        to_original = Transformer.from_crs(projected_crs, crs, always_xy=True)
        to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        projected_polygons = [
            shapely_transform(to_projected.transform, polygon)
            for polygon in polygons
            if not polygon.is_empty
        ]

        if settings.merge_distance_m > 0:
            buffer_distance = settings.merge_distance_m / 2
            merged = unary_union(
                [polygon.buffer(buffer_distance) for polygon in projected_polygons]
            ).buffer(-buffer_distance)
        else:
            merged = unary_union(projected_polygons)

        features_out = []
        summary_ndvi_values = []

        for index, projected_polygon in enumerate(iter_polygon_geometries(merged), start=1):
            if projected_polygon.is_empty or not projected_polygon.is_valid:
                projected_polygon = projected_polygon.buffer(0)
            if projected_polygon.is_empty:
                continue

            area_m2 = float(projected_polygon.area)
            if area_m2 < settings.min_area_m2:
                continue

            original_polygon = shapely_transform(to_original.transform, projected_polygon)
            poly_mask = features.rasterize(
                [(mapping(original_polygon), 1)],
                out_shape=ndvi_clipped.shape,
                transform=transform,
                fill=0,
                dtype=np.uint8,
            )
            ndvi_values = ndvi_clipped[(poly_mask == 1) & target_mask]
            mean_ndvi = round(float(np.mean(ndvi_values)), 4) if ndvi_values.size else None
            if ndvi_values.size:
                summary_ndvi_values.append(ndvi_values)

            preview_polygon = smooth_polygon_for_preview(projected_polygon)
            preview_original_polygon = shapely_transform(to_original.transform, preview_polygon)
            wgs84_polygon = shapely_transform(to_wgs84.transform, preview_original_polygon)

            features_out.append(
                {
                    "type": "Feature",
                    "geometry": mapping(wgs84_polygon),
                    "properties": {
                        "id": len(features_out) + 1,
                        "area_m2": round(area_m2, 2),
                        "area_ha": round(area_m2 / 10000, 4),
                        "mean_ndvi": mean_ndvi,
                        "ndvi_min": settings.ndvi_min,
                        "ndvi_max": settings.ndvi_max,
                    },
                }
            )

        total_area_m2 = round(
            sum(feature["properties"]["area_m2"] for feature in features_out),
            2,
        )
        summary_values = (
            np.concatenate(summary_ndvi_values)
            if summary_ndvi_values
            else np.array([], dtype=float)
        )
        summary_mean_ndvi = (
            round(float(np.mean(summary_values)), 4) if summary_values.size else None
        )

        return {
            "imagery_id": str(imagery.id),
            "settings": settings.model_dump(),
            "summary": {
                "polygon_count": len(features_out),
                "total_area_m2": total_area_m2,
                "total_area_ha": round(total_area_m2 / 10000, 4),
                "mean_ndvi": summary_mean_ndvi,
            },
            "geojson": {
                "type": "FeatureCollection",
                "features": features_out,
            },
        }


def create_imagery_for_field(
    field: Field,
    payload: ImageryRegister,
    db: Session,
) -> FieldImagery:
    ensure_existing_file(payload.rgb_tif_path)
    ensure_existing_file(payload.ndvi_tif_path)
    corners = read_geotiff_corners(payload.rgb_tif_path) or {}
    rgb_png_path = convert_rgb_tif_to_png(payload.rgb_tif_path)
    ndvi_png_path = convert_ndvi_tif_to_png(payload.ndvi_tif_path)
    ndvi_stats = compute_ndvi_stats(payload.ndvi_tif_path)

    imagery = FieldImagery(
        field_id=field.id,
        capture_at=payload.capture_at,
        rgb_tif_path=payload.rgb_tif_path,
        ndvi_tif_path=payload.ndvi_tif_path,
        rgb_png_path=rgb_png_path,
        ndvi_png_path=ndvi_png_path,
        top_left=corners.get("top_left"),
        top_right=corners.get("top_right"),
        bottom_left=corners.get("bottom_left"),
        bottom_right=corners.get("bottom_right"),
        ndvi_stats=ndvi_stats,
    )
    db.add(imagery)
    db.commit()
    db.refresh(imagery)
    return imagery


@router.get("")
def list_fields(db: Session = Depends(get_db)) -> list[dict]:
    fields = db.query(Field).order_by(desc(Field.created_at)).all()
    return [field_to_dict(field) for field in fields]


@imagery_router.post("/register", status_code=status.HTTP_201_CREATED)
def register_imagery_with_field(
    payload: AutoImageryRegister,
    db: Session = Depends(get_db),
) -> dict:
    field_name = payload.field_name.strip()
    if not field_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="field_name is required",
        )

    field = db.query(Field).filter(Field.name == field_name).first()
    if field is None:
        field = Field(name=field_name)
        db.add(field)
        db.flush()

    imagery = create_imagery_for_field(field, payload, db)
    response = imagery_to_dict(imagery)
    response["field"] = field_to_dict(field)
    return response


@imagery_router.post("/{imagery_id}/ndvi-zones/preview")
def preview_ndvi_zones(
    imagery_id: UUID,
    payload: NdviZonePreviewRequest,
    db: Session = Depends(get_db),
) -> dict:
    imagery = db.get(FieldImagery, imagery_id)
    if imagery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imagery not found: {imagery_id}",
        )

    return generate_ndvi_zone_preview(imagery, payload)


@imagery_router.post("/{imagery_id}/ndvi-zones/save", status_code=status.HTTP_201_CREATED)
def save_ndvi_zones(
    imagery_id: UUID,
    payload: ApprovedZonesSaveRequest,
    db: Session = Depends(get_db),
) -> dict:
    imagery = db.get(FieldImagery, imagery_id)
    if imagery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imagery not found: {imagery_id}",
        )

    features = payload.geojson.get("features")
    if not isinstance(features, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="geojson.features must be a list",
        )

    db.query(SprayPolygon).filter(
        SprayPolygon.field_imagery_id == imagery.id,
    ).delete(synchronize_session=False)

    settings = payload.settings.model_dump()
    polygons = []
    for index, feature in enumerate(features, start=1):
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        properties = feature.get("properties", {}) if isinstance(feature, dict) else {}
        if not geometry:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Feature {index} does not have geometry",
            )

        area_m2 = properties.get("area_m2")
        if area_m2 is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Feature {index} does not have area_m2",
            )

        polygon = SprayPolygon(
            field_id=imagery.field_id,
            field_imagery_id=imagery.id,
            zone_code=f"Z{index:02d}",
            sequence_no=index,
            geometry=geometry,
            area_m2=float(area_m2),
            mean_ndvi=properties.get("mean_ndvi"),
            settings=settings,
            selected_chambers=[],
            chamber_mode="none",
        )
        db.add(polygon)
        polygons.append(polygon)

    db.commit()
    for polygon in polygons:
        db.refresh(polygon)

    return {
        "field_id": str(imagery.field_id),
        "field_imagery_id": str(imagery.id),
        "polygons": [spray_polygon_to_dict(polygon) for polygon in polygons],
        "geojson": spray_polygons_to_geojson(polygons),
    }


@router.get("/{field_id}/spray-targets")
def list_spray_targets(
    field_id: UUID,
    imagery_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    field = db.get(Field, field_id)
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field not found: {field_id}",
        )

    query = db.query(SprayPolygon).filter(SprayPolygon.field_id == field_id)
    if imagery_id is not None:
        query = query.filter(SprayPolygon.field_imagery_id == imagery_id)

    polygons = query.order_by(SprayPolygon.sequence_no).all()
    return {
        "field_id": str(field_id),
        "field_imagery_id": str(imagery_id) if imagery_id else None,
        "polygons": [spray_polygon_to_dict(polygon) for polygon in polygons],
        "geojson": spray_polygons_to_geojson(polygons),
    }


@polygon_router.patch("/{polygon_id}/chambers")
def update_polygon_chambers(
    polygon_id: UUID,
    payload: PolygonChambersUpdate,
    db: Session = Depends(get_db),
) -> dict:
    polygon = db.get(SprayPolygon, polygon_id)
    if polygon is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Polygon not found: {polygon_id}",
        )

    mode = payload.mode.strip().lower()
    if mode not in VALID_CHAMBER_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="mode must be one of: none, auto, manual",
        )

    if mode == "manual":
        selected_chambers = normalize_chambers(payload.selected_chambers)
        if not selected_chambers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="selected_chambers is required for manual mode",
            )
    elif mode == "auto":
        selected_chambers = auto_chambers_from_detections(polygon)
    else:
        selected_chambers = []

    polygon.selected_chambers = selected_chambers
    polygon.chamber_mode = mode
    db.commit()
    db.refresh(polygon)
    return spray_polygon_to_dict(polygon)


@polygon_router.post("/{polygon_id}/detections", status_code=status.HTTP_201_CREATED)
def add_target_detection(
    polygon_id: UUID,
    payload: TargetDetectionCreate,
    db: Session = Depends(get_db),
) -> dict:
    polygon = db.get(SprayPolygon, polygon_id)
    if polygon is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Polygon not found: {polygon_id}",
        )

    disease_name = payload.disease_name.strip()
    chamber = payload.chamber.strip().lower()
    if not disease_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="disease_name is required",
        )
    normalize_chambers([chamber])

    detection = TargetDetection(
        polygon_id=polygon.id,
        disease_name=disease_name,
        confidence=payload.confidence,
        sample_lat=payload.sample_lat,
        sample_lng=payload.sample_lng,
        chamber=chamber,
        image_path=payload.image_path,
    )

    db.add(detection)
    db.flush()
    if polygon.chamber_mode != "manual":
        polygon.selected_chambers = auto_chambers_from_detections(polygon)
        polygon.chamber_mode = "auto" if polygon.selected_chambers else "none"

    db.commit()
    db.refresh(detection)
    return detection_to_dict(detection)


@router.get("/{field_id}/imagery/latest")
def latest_imagery(field_id: UUID, db: Session = Depends(get_db)) -> dict:
    field = db.get(Field, field_id)
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field not found: {field_id}",
        )

    imagery = (
        db.query(FieldImagery)
        .filter(FieldImagery.field_id == field_id)
        .order_by(desc(FieldImagery.capture_at), desc(FieldImagery.created_at))
        .first()
    )
    if imagery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imagery not found for field: {field_id}",
        )

    return imagery_to_dict(imagery)
