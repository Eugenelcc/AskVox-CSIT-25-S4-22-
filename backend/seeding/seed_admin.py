import sys
from pathlib import Path

# Ensure the repository root (backend/) is on sys.path before importing `app`.
# This allows running the script directly: `python seeding/seed_admin.py` from the backend folder.
BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BASE_DIR))

import asyncio
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.users import User, UserRole
# from app.models.user_sessions import UserSession
from app.core.security import hash_password

ADMIN_EMAIL = "justin@askvox.com"
ADMIN_PASSWORD = "justin!"  # change after first login


async def main():
    async with SessionLocal() as db:
        res = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        user = res.scalar_one_or_none()

        if user:
            user.role = UserRole.admin.value
            user.is_active = True
            # Ensure existing users have required non-null fields (migration requires them)
            if not getattr(user, "profile_name", None):
                user.profile_name = "Admin"
            if not getattr(user, "status", None):
                user.status = "registered"
            if not getattr(user, "wake_word", None):
                user.wake_word = "askvox"
            print("Admin already exists -> promoted/ensured active and required fields set.")
        else:
            user = User(
                profile_name="Admin",
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                role=UserRole.admin.value,
                status="registered",
                wake_word="askvox",
                is_active=True,
            )
            db.add(user)
            print("Created admin user.")

        await db.commit()
        print(f"ADMIN_EMAIL={ADMIN_EMAIL}")
        print(f"ADMIN_PASSWORD={ADMIN_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
