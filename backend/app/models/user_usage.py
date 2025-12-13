from datetime import datetime, timezone, date as DateType

from sqlalchemy import Date, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserUsage(Base):
    __tablename__ = "user_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[DateType] = mapped_column(Date, nullable=False, default=lambda: datetime.now(timezone.utc).date())
    
    # Daily limits tracking
    chat_minutes_used: Mapped[int] = mapped_column(Integer, default=0)
    documents_uploaded: Mapped[int] = mapped_column(Integer, default=0)
    multimedia_responses: Mapped[int] = mapped_column(Integer, default=0)

    # Optional: Track quizzes attempted per day
    quizzes_attempted: Mapped[int] = mapped_column(Integer, default=0)

    user = relationship("User", back_populates="daily_usage")
