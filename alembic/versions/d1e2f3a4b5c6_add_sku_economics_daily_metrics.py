"""add_sku_economics_daily_metrics

Revision ID: d1e2f3a4b5c6
Revises: c7d8e9f0a1b2
Create Date: 2026-04-01 18:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sku_economics_daily_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("nm_id", sa.Integer(), nullable=False),
        sa.Column("metric_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("vendor_code", sa.String(length=100), nullable=True),
        sa.Column("advert_views", sa.Integer(), nullable=False),
        sa.Column("advert_clicks", sa.Integer(), nullable=False),
        sa.Column("advert_orders", sa.Integer(), nullable=False),
        sa.Column("advert_gmv", sa.Float(), nullable=False),
        sa.Column("advert_exact_spend", sa.Float(), nullable=False),
        sa.Column("advert_estimated_spend", sa.Float(), nullable=False),
        sa.Column("finance_revenue", sa.Float(), nullable=False),
        sa.Column("finance_payout", sa.Float(), nullable=False),
        sa.Column("finance_wb_costs", sa.Float(), nullable=False),
        sa.Column("finance_orders", sa.Integer(), nullable=False),
        sa.Column("funnel_open_count", sa.Integer(), nullable=False),
        sa.Column("funnel_cart_count", sa.Integer(), nullable=False),
        sa.Column("funnel_order_count", sa.Integer(), nullable=False),
        sa.Column("funnel_order_sum", sa.Float(), nullable=False),
        sa.Column("funnel_buyout_count", sa.Integer(), nullable=False),
        sa.Column("funnel_buyout_sum", sa.Float(), nullable=False),
        sa.Column("has_advert", sa.Boolean(), nullable=False),
        sa.Column("has_finance", sa.Boolean(), nullable=False),
        sa.Column("has_funnel", sa.Boolean(), nullable=False),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sku_economics_daily_metrics_id"), "sku_economics_daily_metrics", ["id"], unique=False)
    op.create_index(
        "idx_sku_economics_daily_metrics_store_nm_date",
        "sku_economics_daily_metrics",
        ["store_id", "nm_id", "metric_date"],
        unique=True,
    )
    op.create_index(
        "idx_sku_economics_daily_metrics_store_date",
        "sku_economics_daily_metrics",
        ["store_id", "metric_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_sku_economics_daily_metrics_store_date", table_name="sku_economics_daily_metrics")
    op.drop_index("idx_sku_economics_daily_metrics_store_nm_date", table_name="sku_economics_daily_metrics")
    op.drop_index(op.f("ix_sku_economics_daily_metrics_id"), table_name="sku_economics_daily_metrics")
    op.drop_table("sku_economics_daily_metrics")
