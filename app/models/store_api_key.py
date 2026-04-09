from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index, Text, UniqueConstraint, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utc_now


class StoreApiKey(Base):
    __tablename__ = "store_api_keys"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    slot_key = Column(String(50), nullable=False)
    api_key = Column(Text, nullable=False)
    wb_supplier_id = Column(String(100), nullable=True)
    wb_supplier_name = Column(String(255), nullable=True)
    wb_ping_access = Column(JSON, nullable=True)
    wb_ping_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    store = relationship("Store", back_populates="feature_api_keys")

    __table_args__ = (
        UniqueConstraint("store_id", "slot_key", name="uq_store_api_keys_store_slot"),
        Index("idx_store_api_keys_store_id", "store_id"),
        Index("idx_store_api_keys_slot_key", "slot_key"),
    )
