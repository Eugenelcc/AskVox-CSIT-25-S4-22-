from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SystemModel(Base):
    __tablename__ = "system_models"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location: Mapped[str] = mapped_column(String(256), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
