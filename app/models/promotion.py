# models/promotion.py
from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional, List

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum as SQLEnum, ForeignKey, BigInteger, Float
from sqlalchemy.orm import relationship

from app.core.database import Base


class PromotionStatus(enum.Enum):
    CREATED = "created"      # company created in WB, but not started yet
    RUNNING = "running"      # bids set + scheduler running
    FINISHED = "finished"    # winner selected, main photo set
    FAILED = "failed"
    STOPPED = "stopped"


class PromotionCompany(Base):
    __tablename__ = "promotion_companies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # WB ids
    wb_company_id = Column(BigInteger, nullable=False, index=True)  # advert id

    nm_id = Column(BigInteger, nullable=False, index=True)
    card_id = Column(BigInteger, nullable=False, index=True)

    title = Column(String(512), nullable=False)
    title_changed = Column(Boolean, default=False, nullable=False)

    from_main = Column(Boolean, default=False, nullable=False)
    max_slots = Column(Integer, default=4, nullable=False)

    photos_count = Column(Integer, default=0, nullable=False)
    views_per_photo = Column(Integer, default=0, nullable=False)

    # bidding
    cpm = Column(Integer, default=0, nullable=False)          # stored as kopecks (same unit as WB bid_kopecks)
    spend_rub = Column(Integer, default=0, nullable=False)

    status = Column(SQLEnum(PromotionStatus), default=PromotionStatus.CREATED, nullable=False, index=True)

    # scheduler counters (campaign total -> deltas)
    last_total_shows = Column(Integer, default=0, nullable=False)
    last_total_clicks = Column(Integer, default=0, nullable=False)

    # current active photo
    current_photo_order = Column(Integer, default=1, nullable=False)
    winner_photo_order = Column(Integer, nullable=True)

    last_polled_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    error_message = Column(String(1024), nullable=True)

    # If True: at the end of A/B test the winner is set as main photo and newly uploaded losing photos are removed.
    keep_winner_as_main = Column(Boolean, default=True, nullable=False)

    # Original WB media URLs (JSON list) saved at start of test, to restore after finish
    original_media_json = Column(String(8000), nullable=True)
    # Current uploaded test photo URL on WB card (not part of original_media_json). Used to delete on switch/finish.
    current_uploaded_wb_url = Column(String(1024), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    photos = relationship("PromotionPhoto", back_populates="company", cascade="all, delete-orphan", order_by="PromotionPhoto.order")

    user = relationship("User", backref="promotion_companies")


class PromotionPhoto(Base):
    __tablename__ = "promotion_photos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("promotion_companies.id", ondelete="CASCADE"), nullable=False, index=True)

    order = Column(Integer, nullable=False)  # 1..N in test sequence
    file_url = Column(String(1024), nullable=False)          # original url from frontend
    wb_url = Column(String(1024), nullable=True)             # url on WB (wbbasket) after upload/sync

    # stats collected while this photo is active
    shows = Column(Integer, default=0, nullable=False)
    clicks = Column(Integer, default=0, nullable=False)
    ctr = Column(Float, default=0.0, nullable=False)

    is_winner = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    company = relationship("PromotionCompany", back_populates="photos")