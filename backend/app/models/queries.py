from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Query(Base):
    __tablename__ = "queries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    input_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    raw_audio_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    transcribed_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_domain: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class Response(Base):
    __tablename__ = "responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    query_id: Mapped[int] = mapped_column(ForeignKey("queries.id"), nullable=False, index=True)
    response_text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(64), nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
