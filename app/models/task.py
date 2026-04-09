from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, DateTime, 
    ForeignKey, Index, JSON
)
from sqlalchemy.orm import relationship

from ..core.database import Base
from app.core.time import utc_now


class AnalysisTask(Base):
    """Background analysis task tracking"""
    __tablename__ = "analysis_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=True)
    started_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    
    status = Column(String(50), default="pending")  # pending, running, cancelling, completed, failed, cancelled
    task_type = Column(String(50), nullable=False)  # full_analysis, quick_analysis, sync_cards
    
    # Progress tracking
    total_items = Column(Integer, default=0)
    processed_items = Column(Integer, default=0)
    progress = Column(Integer, default=0, nullable=False)
    current_step = Column(String(1000), nullable=True)
    
    # Results
    result = Column(JSON, default=dict)
    task_meta = Column(JSON, default=dict)
    error_message = Column(String(1000), nullable=True)
    cancellation_requested_at = Column(DateTime, nullable=True)
    
    # Celery task ID
    celery_task_id = Column(String(255), nullable=True)
    
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    
    # Relationships
    store = relationship("Store")
    started_by = relationship("User")
    
    __table_args__ = (
        Index("idx_analysis_tasks_store_id", "store_id"),
        Index("idx_analysis_tasks_started_by_id", "started_by_id"),
        Index("idx_analysis_tasks_status", "status"),
    )


class ActivityLog(Base):
    """User activity logging"""
    __tablename__ = "activity_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="SET NULL"), nullable=True)
    
    action = Column(String(100), nullable=False)  # issue_fixed, card_updated, etc.
    entity_type = Column(String(50), nullable=True)  # card, issue, store
    entity_id = Column(Integer, nullable=True)
    
    details = Column(JSON, default=dict)
    
    created_at = Column(DateTime, default=utc_now)
    
    # Relationships
    user = relationship("User")
    store = relationship("Store")
    
    __table_args__ = (
        Index("idx_activity_logs_user_id", "user_id"),
        Index("idx_activity_logs_store_id", "store_id"),
        Index("idx_activity_logs_action", "action"),
        Index("idx_activity_logs_created_at", "created_at"),
    )
