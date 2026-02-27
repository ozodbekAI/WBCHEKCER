import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, 
    Enum, Text, ForeignKey, Index, JSON
)
from sqlalchemy.orm import relationship

from ..core.database import Base


class IssueSeverity(str, enum.Enum):
    CRITICAL = "critical"        # Блокирует показы или продажи
    WARNING = "warning"          # Снижает конверсию
    IMPROVEMENT = "improvement"  # Точки роста
    INFO = "info"               # Информационные


class IssueCategory(str, enum.Enum):
    TITLE = "title"
    DESCRIPTION = "description"
    PHOTOS = "photos"
    VIDEO = "video"
    CHARACTERISTICS = "characteristics"
    CATEGORY = "category"
    PRICE = "price"
    SEO = "seo"
    COMPLIANCE = "compliance"    # Соответствие требованиям WB
    OTHER = "other"


class IssueStatus(str, enum.Enum):
    PENDING = "pending"          # Ожидает исправления
    FIXED = "fixed"             # Исправлено
    SKIPPED = "skipped"         # Пропущено пользователем
    POSTPONED = "postponed"     # Отложено на потом
    AUTO_FIXED = "auto_fixed"   # Автоматически исправлено


class CardIssue(Base):
    """Issue/Problem detected in a card"""
    __tablename__ = "card_issues"
    
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)
    
    # Issue classification
    code = Column(String(100), nullable=False)  # Unique issue code
    severity = Column(
        Enum(IssueSeverity, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    category = Column(
        Enum(IssueCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    
    # Issue details
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)  # Why this is a problem
    
    # Current state
    current_value = Column(Text, nullable=True)  # What it is now
    field_path = Column(String(255), nullable=True)  # JSON path to the field
    
    # Suggestions
    suggested_value = Column(Text, nullable=True)  # Recommended fix
    alternatives = Column(JSON, default=list)  # Alternative suggestions
    
    # WB Catalog validation data
    charc_id = Column(Integer, nullable=True)  # WB characteristic ID
    allowed_values = Column(JSON, default=list)  # Allowed values from WB catalog
    error_details = Column(JSON, default=list)  # Detailed error info (limits, invalid values)
    
    # AI suggestions
    ai_suggested_value = Column(Text, nullable=True)  # AI recommended value
    ai_reason = Column(Text, nullable=True)  # AI explanation
    ai_alternatives = Column(JSON, default=list)  # AI alternative suggestions
    
    # Source of issue
    source = Column(String(50), default="code")  # "code" | "ai" | "merged"
    
    # Impact
    score_impact = Column(Integer, default=0)  # How much score will increase if fixed
    
    # Status tracking
    status = Column(
        Enum(IssueStatus, values_callable=lambda x: [e.value for e in x]),
        default=IssueStatus.PENDING,
        nullable=False
    )
    fixed_value = Column(Text, nullable=True)  # What user chose to fix with
    fixed_at = Column(DateTime, nullable=True)
    fixed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Postpone info
    postponed_until = Column(DateTime, nullable=True)
    postpone_reason = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    card = relationship("Card", back_populates="issues")
    fixed_by = relationship("User", foreign_keys=[fixed_by_id])
    
    __table_args__ = (
        Index("idx_card_issues_card_id", "card_id"),
        Index("idx_card_issues_severity", "severity"),
        Index("idx_card_issues_category", "category"),
        Index("idx_card_issues_status", "status"),
        Index("idx_card_issues_code", "code"),
    )


class IssueRule(Base):
    """Rules/templates for detecting issues"""
    __tablename__ = "issue_rules"
    
    id = Column(Integer, primary_key=True, index=True)
    
    code = Column(String(100), unique=True, nullable=False)
    severity = Column(
        Enum(IssueSeverity, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    category = Column(
        Enum(IssueCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    
    title_template = Column(String(500), nullable=False)
    description_template = Column(Text, nullable=True)
    
    # Rule configuration
    is_active = Column(Boolean, default=True)
    priority = Column(Integer, default=0)  # Higher = checked first
    
    # Score impact
    base_score_impact = Column(Integer, default=0)
    
    # Conditions (JSON schema for when this rule applies)
    conditions = Column(JSON, default=dict)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index("idx_issue_rules_code", "code"),
        Index("idx_issue_rules_severity", "severity"),
        Index("idx_issue_rules_category", "category"),
    )
