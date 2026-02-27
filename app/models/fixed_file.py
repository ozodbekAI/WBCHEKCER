from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Index, UniqueConstraint
from sqlalchemy.orm import relationship

from ..core.database import Base


class FixedFileEntry(Base):
    """One correct (fixed) value for a specific card characteristic.
    Uploaded via Excel by store owner / head_manager.
    During card analysis these values take priority over AI suggestions.
    """
    __tablename__ = "fixed_file_entries"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    nm_id = Column(Integer, nullable=False)          # WB nmID
    brand = Column(String(255), nullable=True)
    subject_name = Column(String(255), nullable=True)
    char_name = Column(String(255), nullable=False)  # Characteristic name (e.g. "Состав")
    fixed_value = Column(Text, nullable=False)        # The correct value from the file

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    store = relationship("Store")
    created_by = relationship("User", foreign_keys=[created_by_id])

    __table_args__ = (
        # One correct value per (store, card, characteristic)
        UniqueConstraint("store_id", "nm_id", "char_name", name="uq_fixed_entry"),
        Index("idx_fixed_file_store_nm", "store_id", "nm_id"),
        Index("idx_fixed_file_store", "store_id"),
    )
