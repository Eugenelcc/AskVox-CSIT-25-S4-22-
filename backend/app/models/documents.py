from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    input_type: Mapped[str] = mapped_column(String(16), nullable=False)  # "pdf", "word", "text"
    file_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    content: Mapped[Text | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    analyses = relationship("DocumentAnalysis", back_populates="document", cascade="all, delete-orphan")


class DocumentAnalysis(Base):
    __tablename__ = "document_analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    askvox_confidence: Mapped[float] = mapped_column(Float, nullable=False)  # percentage of AskVox-generated text
    human_confidence: Mapped[float] = mapped_column(Float, nullable=False)   # percentage of human-written text
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    document = relationship("Document", back_populates="analyses")
