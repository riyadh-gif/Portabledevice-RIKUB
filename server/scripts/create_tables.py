import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import app.db.models  # noqa: F401
from app.db.database import Base, engine


def main() -> None:
    if engine is None:
        raise RuntimeError("DATABASE_URL is not configured")

    Base.metadata.create_all(bind=engine)
    print("Database tables are ready.")


if __name__ == "__main__":
    main()
