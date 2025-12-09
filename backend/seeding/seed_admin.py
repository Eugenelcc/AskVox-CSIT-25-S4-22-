import sys
import asyncio
from pathlib import Path

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.users import User, UserRole 
#from app.models.user_sessions import UserSession
from app.core.security import hash_password

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BASE_DIR))

ADMIN_EMAIL = "admin@askvox.com"
ADMIN_PASSWORD = "Admin123!"  # change after first login


async def main():
    async with SessionLocal() as db:
        res = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        user = res.scalar_one_or_none()

        if user:
            user.role = UserRole.admin.value
            user.is_active = True
            print("Admin already exists -> promoted/ensured active.")
        else:
            user = User(
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                role=UserRole.admin.value,
                is_active=True,
            )
            db.add(user)
            print("Created admin user.")

        await db.commit()
        print(f"ADMIN_EMAIL={ADMIN_EMAIL}")
        print(f"ADMIN_PASSWORD={ADMIN_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
