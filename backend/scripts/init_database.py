from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base, engine
from app import business_models  # noqa: F401 - registers all business tables
from app import models  # noqa: F401 - registers auth tables


def main() -> None:
    Base.metadata.create_all(engine)
    print(f"Database initialized with {len(Base.metadata.tables)} tables.")
    for table_name in sorted(Base.metadata.tables):
        print(f"- {table_name}")


if __name__ == "__main__":
    main()
