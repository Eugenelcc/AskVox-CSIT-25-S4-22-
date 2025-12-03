from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[str] = mapped_column(String(32), nullable=False)
    transaction_status: Mapped[str] = mapped_column(String(32), nullable=False, default="Completed")
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
