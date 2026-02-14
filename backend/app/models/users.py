from datetime import datetime, timezone
import enum

from sqlalchemy import String, Boolean, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    user = "user"
    developer = "developer"
    educational = "educational"
    educational_user = "educational_user"
    unregistered = "unregistered" 



# Gender enum for user profiles
class GenderEnum(enum.IntEnum):
    male = 0
    female = 1
    rather_not_say = 2


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    gender: Mapped[int] = mapped_column(Integer, nullable=False, default=GenderEnum.rather_not_say.value)
    date_of_birth: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=UserRole.user.value)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="registered")  # account state / plan
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    payment_card = relationship("UserPaymentCard", uselist=False, back_populates="user")
    payment_history = relationship("PaymentHistory", back_populates="user", cascade="all, delete-orphan")
    subscription = relationship("Subscription", back_populates="user", uselist=False)
    wake_word: Mapped[str] = mapped_column(String(64), default="askvox", nullable=False)
    recommendations = relationship("Recommendation", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )
    chat_sessions = relationship(
        "ChatSession",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    queries = relationship(
        "Query",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    flagged_responses = relationship(
        "FlaggedResponse",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    daily_usage = relationship("UserUsage", back_populates="user", cascade="all, delete-orphan")

