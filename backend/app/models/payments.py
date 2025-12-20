from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserPaymentCard(Base):
    __tablename__ = "user_payment_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    card_number: Mapped[str] = mapped_column(String(20), nullable=False)
    card_holder_name: Mapped[str] = mapped_column(String(128), nullable=False)
    expiry_date: Mapped[str] = mapped_column(String(7), nullable=False)  # MM/YYYY
    cvv: Mapped[str] = mapped_column(String(4), nullable=False)
    card_type: Mapped[str] = mapped_column(String(16), nullable=False)  # e.g., "MasterCard", "AMEX"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    user = relationship("User", back_populates="payment_card")

class PaymentHistory(Base):
    __tablename__ = "payment_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    payment_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    description: Mapped[str] = mapped_column(String(128), nullable=False, default="AskVox Premium Subscription")
    transaction_status: Mapped[str] = mapped_column(String(32), nullable=False, default="Completed")
    method: Mapped[str] = mapped_column(String(32), nullable=False)  # e.g., "Credit Card"

    user = relationship("User", back_populates="payment_history")
