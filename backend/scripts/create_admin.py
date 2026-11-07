from getpass import getpass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from argon2 import PasswordHasher
from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import AdminUser


def main() -> None:
    Base.metadata.create_all(engine)
    username = input("Admin username: ").strip()
    password = getpass("Admin password: ")
    confirmation = getpass("Confirm password: ")
    if not username or len(password) < 12 or password != confirmation:
        raise SystemExit("Username, a password of at least 12 characters, and matching confirmation are required.")
    with SessionLocal() as database:
        if database.scalar(select(AdminUser).where(AdminUser.username == username)):
            raise SystemExit("That username already exists.")
        database.add(AdminUser(username=username, password_hash=PasswordHasher().hash(password)))
        database.commit()
    print(f"Created administrator: {username}")


if __name__ == "__main__":
    main()
