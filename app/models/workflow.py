import enum
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from ..core.database import Base
from app.core.time import utc_now


class TicketType(str, enum.Enum):
    DELEGATION = "delegation"
    APPROVAL = "approval"


class TicketStatus(str, enum.Enum):
    PENDING = "pending"
    DONE = "done"


class CardDraft(Base):
    __tablename__ = "card_drafts"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    data = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    card = relationship("Card")
    author = relationship("User")

    __table_args__ = (
        UniqueConstraint("card_id", "author_id", name="uq_card_drafts_card_author"),
        Index("idx_card_drafts_card", "card_id"),
        Index("idx_card_drafts_author", "author_id"),
        Index("idx_card_drafts_updated_at", "updated_at"),
    )


class CardConfirmedSection(Base):
    __tablename__ = "card_confirmed_sections"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)
    section = Column(String(100), nullable=False)
    confirmed_by_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    card = relationship("Card")
    confirmed_by = relationship("User")

    __table_args__ = (
        UniqueConstraint("card_id", "section", name="uq_card_confirmed_sections_card_section"),
        Index("idx_card_confirmed_sections_card", "card_id"),
        Index("idx_card_confirmed_sections_section", "section"),
    )


class TeamTicket(Base):
    __tablename__ = "team_tickets"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)

    type = Column(
        Enum(TicketType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    status = Column(
        Enum(TicketStatus, values_callable=lambda x: [e.value for e in x]),
        default=TicketStatus.PENDING,
        nullable=False,
    )

    issue_id = Column(Integer, ForeignKey("card_issues.id", ondelete="SET NULL"), nullable=True)
    approval_id = Column(Integer, ForeignKey("card_approvals.id", ondelete="SET NULL"), nullable=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)

    issue_title = Column(String(500), nullable=True)
    issue_severity = Column(String(50), nullable=True)
    issue_code = Column(String(100), nullable=True)

    card_title = Column(String(500), nullable=True)
    card_photo = Column(String(1000), nullable=True)
    card_nm_id = Column(Integer, nullable=True)
    card_vendor_code = Column(String(100), nullable=True)

    from_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    to_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utc_now, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    completed_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    store = relationship("Store")
    card = relationship("Card")
    issue = relationship("CardIssue")
    approval = relationship("CardApproval")
    from_user = relationship("User", foreign_keys=[from_user_id])
    to_user = relationship("User", foreign_keys=[to_user_id])
    completed_by = relationship("User", foreign_keys=[completed_by_id])

    __table_args__ = (
        Index("idx_team_tickets_store", "store_id"),
        Index("idx_team_tickets_status", "status"),
        Index("idx_team_tickets_type", "type"),
        Index("idx_team_tickets_to_user", "to_user_id"),
        Index("idx_team_tickets_from_user", "from_user_id"),
        Index("idx_team_tickets_created_at", "created_at"),
    )
