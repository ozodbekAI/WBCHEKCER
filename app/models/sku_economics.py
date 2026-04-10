from datetime import datetime, date

from sqlalchemy import Column, Integer, Float, DateTime, Date, ForeignKey, Index, String, JSON, Boolean

from ..core.database import Base
from app.core.time import utc_now


class SkuEconomicsCost(Base):
    __tablename__ = "sku_economics_costs"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    nm_id = Column(Integer, nullable=False)
    title = Column(String(500), nullable=True)
    vendor_code = Column(String(100), nullable=True)
    unit_cost = Column(Float, nullable=False, default=0)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index("idx_sku_economics_costs_store_nm", "store_id", "nm_id", unique=True),
    )


class SkuEconomicsManualSpend(Base):
    __tablename__ = "sku_economics_manual_spend"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    nm_id = Column(Integer, nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    title = Column(String(500), nullable=True)
    spend = Column(Float, nullable=False, default=0)
    views = Column(Integer, nullable=True)
    clicks = Column(Integer, nullable=True)
    orders = Column(Integer, nullable=True)
    gmv = Column(Float, nullable=True)
    source_file_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index(
            "idx_sku_economics_manual_spend_store_nm_period",
            "store_id",
            "nm_id",
            "period_start",
            "period_end",
            unique=True,
        ),
    )


class SkuEconomicsManualFinance(Base):
    __tablename__ = "sku_economics_manual_finance"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    nm_id = Column(Integer, nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    title = Column(String(500), nullable=True)
    revenue = Column(Float, nullable=False, default=0)
    wb_costs = Column(Float, nullable=False, default=0)
    payout = Column(Float, nullable=True)
    orders = Column(Integer, nullable=True)
    source_file_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index(
            "idx_sku_economics_manual_finance_store_nm_period",
            "store_id",
            "nm_id",
            "period_start",
            "period_end",
            unique=True,
        ),
    )


class SkuEconomicsSnapshot(Base):
    __tablename__ = "sku_economics_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    nm_id = Column(Integer, nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    title = Column(String(500), nullable=True)
    vendor_code = Column(String(100), nullable=True)
    status = Column(String(32), nullable=False)
    diagnosis = Column(String(32), nullable=False)
    priority = Column(String(32), nullable=False, default="medium")
    precision = Column(String(32), nullable=False, default="exact")
    revenue = Column(Float, nullable=False, default=0)
    ad_cost = Column(Float, nullable=False, default=0)
    net_profit = Column(Float, nullable=False, default=0)
    max_cpo = Column(Float, nullable=False, default=0)
    actual_cpo = Column(Float, nullable=False, default=0)
    profit_delta = Column(Float, nullable=False, default=0)
    ctr = Column(Float, nullable=False, default=0)
    cr = Column(Float, nullable=False, default=0)
    orders = Column(Integer, nullable=False, default=0)
    ad_orders = Column(Integer, nullable=False, default=0)
    generated_at = Column(DateTime, default=utc_now, nullable=False)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index(
            "idx_sku_economics_snapshots_store_nm_period",
            "store_id",
            "nm_id",
            "period_start",
            "period_end",
            unique=True,
        ),
    )


class SkuEconomicsOverviewCache(Base):
    __tablename__ = "sku_economics_overviews"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    payload = Column(JSON, nullable=False)
    generated_at = Column(DateTime, default=utc_now, nullable=False)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index(
            "idx_sku_economics_overviews_store_period",
            "store_id",
            "period_start",
            "period_end",
            unique=True,
        ),
    )


class SkuEconomicsDailyMetric(Base):
    __tablename__ = "sku_economics_daily_metrics"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    nm_id = Column(Integer, nullable=False)
    metric_date = Column(Date, nullable=False)
    title = Column(String(500), nullable=True)
    vendor_code = Column(String(100), nullable=True)

    advert_views = Column(Integer, nullable=False, default=0)
    advert_clicks = Column(Integer, nullable=False, default=0)
    advert_orders = Column(Integer, nullable=False, default=0)
    advert_gmv = Column(Float, nullable=False, default=0)
    advert_exact_spend = Column(Float, nullable=False, default=0)
    advert_estimated_spend = Column(Float, nullable=False, default=0)

    finance_revenue = Column(Float, nullable=False, default=0)
    finance_payout = Column(Float, nullable=False, default=0)
    finance_wb_costs = Column(Float, nullable=False, default=0)
    finance_orders = Column(Integer, nullable=False, default=0)

    funnel_open_count = Column(Integer, nullable=False, default=0)
    funnel_cart_count = Column(Integer, nullable=False, default=0)
    funnel_order_count = Column(Integer, nullable=False, default=0)
    funnel_order_sum = Column(Float, nullable=False, default=0)
    funnel_buyout_count = Column(Integer, nullable=False, default=0)
    funnel_buyout_sum = Column(Float, nullable=False, default=0)

    has_advert = Column(Boolean, nullable=False, default=False)
    has_finance = Column(Boolean, nullable=False, default=False)
    has_funnel = Column(Boolean, nullable=False, default=False)
    synced_at = Column(DateTime, default=utc_now, nullable=False)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index(
            "idx_sku_economics_daily_metrics_store_nm_date",
            "store_id",
            "nm_id",
            "metric_date",
            unique=True,
        ),
        Index(
            "idx_sku_economics_daily_metrics_store_date",
            "store_id",
            "metric_date",
        ),
    )


class AdAnalysisBootstrapJob(Base):
    __tablename__ = "ad_analysis_bootstrap_jobs"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    requested_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    status = Column(String(32), nullable=False, default="pending")
    current_stage = Column(String(64), nullable=True)
    stage_progress = Column(Integer, nullable=False, default=0)
    step = Column(String(1000), nullable=True)

    days = Column(Integer, nullable=False, default=14)
    preset = Column(String(32), nullable=False, default="14d")
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)

    source_statuses = Column(JSON, nullable=False, default=list)
    is_partial = Column(Boolean, nullable=False, default=False)
    failed_source = Column(String(64), nullable=True)
    result = Column(JSON, nullable=True)
    error_message = Column(String(1000), nullable=True)

    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    heartbeat_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        Index("idx_ad_analysis_bootstrap_jobs_store_id", "store_id"),
        Index("idx_ad_analysis_bootstrap_jobs_status", "status"),
        Index("idx_ad_analysis_bootstrap_jobs_created_at", "created_at"),
    )
