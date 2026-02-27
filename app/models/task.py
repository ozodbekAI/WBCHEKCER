from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, DateTime, 
    ForeignKey, Index, JSON
)
from sqlalchemy.orm import relationship

from ..core.database import Base


class AnalysisTask(Base):
    """Background analysis task tracking"""
    __tablename__ = "analysis_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    task_type = Column(String(50), nullable=False)  # full_analysis, quick_analysis, sync_cards
    
    # Progress tracking
    total_items = Column(Integer, default=0)
    processed_items = Column(Integer, default=0)
    
    # Results
    result = Column(JSON, default=dict)
    error_message = Column(String(1000), nullable=True)
    
    # Celery task ID
    celery_task_id = Column(String(255), nullable=True)
    
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    store = relationship("Store")
    
    __table_args__ = (
        Index("idx_analysis_tasks_store_id", "store_id"),
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
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User")
    store = relationship("Store")
    
    __table_args__ = (
        Index("idx_activity_logs_user_id", "user_id"),
        Index("idx_activity_logs_store_id", "store_id"),
        Index("idx_activity_logs_action", "action"),
        Index("idx_activity_logs_created_at", "created_at"),
    )
