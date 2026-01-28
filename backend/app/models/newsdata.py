from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.base import Base # Ensure this import matches your project structure

class NewsCache(Base):
    __tablename__ = "news_cache"

    # 1. Use category as the Primary Key (No more 'id' confusion)
    category = Column(String, primary_key=True, index=True)
    
    # 2. Use JSONB for data (matches Supabase)
    data = Column(JSONB, nullable=False)
    
    # 3. Timestamps
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())