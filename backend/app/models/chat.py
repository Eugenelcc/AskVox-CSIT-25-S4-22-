from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

##A whole conversation (like one chat thread).
class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    news_article_id: Mapped[int | None] = mapped_column(ForeignKey("news_articles.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user = relationship("User", back_populates="chat_sessions")
    news_article = relationship("NewsArticle")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")
    queries = relationship("Query", back_populates="session", cascade="all, delete-orphan")

##Each message bubble shown in the chat UI.
class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False, index=True)
    sender: Mapped[str] = mapped_column(String(16), nullable=False)  # "user" or "assistant"
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    query_id: Mapped[int | None] = mapped_column(ForeignKey("queries.id"), nullable=True, index=True)
    response_id: Mapped[int | None] = mapped_column(ForeignKey("responses.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")
