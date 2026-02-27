import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, DateTime,
    Enum, Text, ForeignKey, Index, JSON
)
from sqlalchemy.orm import relationship

from ..core.database import Base


class ApprovalStatus(str, enum.Enum):
    PENDING = "pending"       # Ожидает проверки
    APPROVED = "approved"     # Одобрено
    REJECTED = "rejected"     # Отклонено
    APPLIED = "applied"       # Применено на WB


class CardApproval(Base):
    """
    When a Manager finishes fixing issues for a card, they submit it
    for review.  A Head-Manager / Owner reviews and approves / rejects.
    Once approved the fixes are applied to WB.
    """
    __tablename__ = "card_approvals"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)

    # Who prepared (manager)
    prepared_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Who reviewed (head_manager / owner)
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    status = Column(
        Enum(ApprovalStatus, values_callable=lambda x: [e.value for e in x]),
        default=ApprovalStatus.PENDING,
        nullable=False,
    )

    # Snapshot of changes: [{issue_id, field_path, old_value, new_value, title}]
    changes = Column(JSON, default=list)
    total_fixes = Column(Integer, default=0)

    # Manager's note when submitting
    submit_note = Column(Text, nullable=True)
    # Reviewer's comment
    reviewer_comment = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    applied_at = Column(DateTime, nullable=True)

    # ── Relationships ──
    store = relationship("Store")
    card = relationship("Card")
    prepared_by = relationship("User", foreign_keys=[prepared_by_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_id])

    __table_args__ = (
        Index("idx_approvals_store", "store_id"),
        Index("idx_approvals_card", "card_id"),
        Index("idx_approvals_status", "status"),
        Index("idx_approvals_prepared_by", "prepared_by_id"),
    )
