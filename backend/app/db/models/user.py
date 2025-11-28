from .user import User  
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Integer, String
from app.db.base import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
