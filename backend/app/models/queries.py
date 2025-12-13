from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

#The raw user input before the model responds (text or audio).
class Query(Base):
    __tablename__ = "queries"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    input_mode: Mapped[str] = mapped_column(String(16), nullable=False)  # "text" or "audio"
    raw_audio_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    transcribed_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_domain: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="queries")
    user = relationship("User", back_populates="queries")
    responses = relationship("Response", back_populates="query", cascade="all, delete-orphan")

#The model’s generated answer + metadata.
class Response(Base):
    __tablename__ = "responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    query_id: Mapped[int] = mapped_column(ForeignKey("queries.id"), nullable=False, index=True)
    response_text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(64), nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    query = relationship("Query", back_populates="responses")
    multimedia_items = relationship("MultimediaItem", back_populates="response", cascade="all, delete-orphan")
    flagged_items = relationship("FlaggedResponse", back_populates="response")