from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, 
    Text, ForeignKey, Index, JSON, Float
)
from sqlalchemy.orm import relationship

from ..core.database import Base


class Card(Base):
    """WB Product Card"""
    __tablename__ = "cards"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    
    # WB identifiers
    nm_id = Column(Integer, nullable=False, index=True)  # WB nmID
    imt_id = Column(Integer, nullable=True)  # WB imtID
    vendor_code = Column(String(100), nullable=True)  # Артикул продавца
    
    # Basic info
    title = Column(String(500), nullable=True)
    brand = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    
    # Category
    subject_id = Column(Integer, nullable=True)
    subject_name = Column(String(255), nullable=True)
    category_name = Column(String(255), nullable=True)
    
    # Media
    photos = Column(JSON, default=list)  # List of photo URLs
    videos = Column(JSON, default=list)  # List of video URLs
    photos_count = Column(Integer, default=0)
    videos_count = Column(Integer, default=0)
    
    # Characteristics
    characteristics = Column(JSON, default=dict)
    
    # Pricing
    price = Column(Float, nullable=True)
    discount = Column(Integer, nullable=True)
    
    # Dimensions
    dimensions = Column(JSON, default=dict)  # length, width, height, weight
    
    # Score & Analysis
    score = Column(Integer, default=0)  # 0-100
    score_breakdown = Column(JSON, default=dict)  # Detailed score by category
    
    # Counts
    critical_issues_count = Column(Integer, default=0)
    warnings_count = Column(Integer, default=0)
    improvements_count = Column(Integer, default=0)
    growth_points_count = Column(Integer, default=0)
    
    # Raw WB data
    raw_data = Column(JSON, default=dict)

    # Product DNA — detailed technical description generated from photo ONCE,
    # reused in all subsequent AI calls (audit, title, description generation).
    product_dna = Column(Text, nullable=True)
    
    # Timestamps
    last_analysis_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # After applying our own fix to WB, skip the next scheduler re-analysis
    # (WB updates updatedAt after our fix, which would otherwise trigger re-analysis)
    skip_next_reanalyze = Column(Boolean, default=False, nullable=False, server_default="false")
    
    # Relationships
    store = relationship("Store", back_populates="cards")
    issues = relationship("CardIssue", back_populates="card", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("idx_cards_store_id", "store_id"),
        Index("idx_cards_nm_id", "nm_id"),
        Index("idx_cards_score", "score"),
        Index("idx_cards_store_nm", "store_id", "nm_id", unique=True),
    )
