import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import app.db.models  # noqa: F401
from sqlalchemy import text

from app.db.database import Base, engine


def main() -> None:
    if engine is None:
        raise RuntimeError("DATABASE_URL is not configured")

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE spray_polygons ADD COLUMN IF NOT EXISTS selected_chambers JSONB NOT NULL DEFAULT '[]'::jsonb"))
        conn.execute(text("ALTER TABLE spray_polygons ADD COLUMN IF NOT EXISTS chamber_mode TEXT NOT NULL DEFAULT 'none'"))
        conn.execute(text("ALTER TABLE spray_polygons DROP COLUMN IF EXISTS chamber"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS disease_name TEXT"))
        conn.execute(text("UPDATE target_detections SET disease_name = name WHERE disease_name IS NULL AND name IS NOT NULL"))
        conn.execute(text("ALTER TABLE target_detections ALTER COLUMN disease_name SET NOT NULL"))
        conn.execute(text("ALTER TABLE target_detections DROP COLUMN IF EXISTS name"))
        conn.execute(text("ALTER TABLE target_detections DROP COLUMN IF EXISTS category"))
        conn.execute(text("ALTER TABLE target_detections DROP COLUMN IF EXISTS group_name"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS sample_lat DOUBLE PRECISION"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS sample_lng DOUBLE PRECISION"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS chamber TEXT"))
    print("Database tables are ready.")


if __name__ == "__main__":
    main()
