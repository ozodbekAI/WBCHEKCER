import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, 
    Enum, Text, ForeignKey, Index, JSON
)
from sqlalchemy.orm import relationship

from ..core.database import Base
from app.core.time import utc_now


class StoreStatus(str, enum.Enum):
    PENDING = "pending"          # API key entered, not validated
    VALIDATING = "validating"    # Currently validating API key
    ACTIVE = "active"            # API key valid, store connected
    ERROR = "error"              # API key invalid or connection error
    DISABLED = "disabled"        # Manually disabled


class Store(Base):
    __tablename__ = "stores"
    
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    name = Column(String(255), nullable=False)
    api_key = Column(Text, nullable=False)  # WB API key (encrypted in production)
    
    status = Column(
        Enum(StoreStatus, values_callable=lambda x: [e.value for e in x]),
        default=StoreStatus.PENDING,
        nullable=False
    )
    status_message = Column(Text, nullable=True)  # Error message if status is ERROR
    
    # WB Store info (populated after validation)
    wb_supplier_id = Column(String(100), nullable=True)
    wb_supplier_name = Column(String(255), nullable=True)
    wb_ping_access = Column(JSON, nullable=True)
    wb_ping_checked_at = Column(DateTime, nullable=True)
    
    # Statistics (cached)
    total_cards = Column(Integer, default=0)
    critical_issues = Column(Integer, default=0)
    warnings_count = Column(Integer, default=0)
    growth_potential = Column(Integer, default=0)  # Percentage
    
    last_sync_at = Column(DateTime, nullable=True)
    last_analysis_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
    
    # Relationships
    owner = relationship("User", back_populates="stores", foreign_keys=[owner_id])
    cards = relationship("Card", back_populates="store", cascade="all, delete-orphan")
    feature_api_keys = relationship("StoreApiKey", back_populates="store", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_stores_owner_id", "owner_id"),
        Index("idx_stores_status", "status"),
    )

    @property
    def wb_token_access(self) -> dict:
        from ..services.wb_token_access import summarize_store_wb_token_access

        return summarize_store_wb_token_access(self)
