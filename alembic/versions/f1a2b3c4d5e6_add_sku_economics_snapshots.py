"""add_sku_economics_snapshots

Revision ID: f1a2b3c4d5e6
Revises: e7b9c4d2a1f0
Create Date: 2026-03-30 18:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e7b9c4d2a1f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sku_economics_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("nm_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("vendor_code", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("diagnosis", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.String(length=32), nullable=False),
        sa.Column("precision", sa.String(length=32), nullable=False),
        sa.Column("revenue", sa.Float(), nullable=False),
        sa.Column("ad_cost", sa.Float(), nullable=False),
        sa.Column("net_profit", sa.Float(), nullable=False),
        sa.Column("max_cpo", sa.Float(), nullable=False),
        sa.Column("actual_cpo", sa.Float(), nullable=False),
        sa.Column("profit_delta", sa.Float(), nullable=False),
        sa.Column("ctr", sa.Float(), nullable=False),
        sa.Column("cr", sa.Float(), nullable=False),
        sa.Column("orders", sa.Integer(), nullable=False),
        sa.Column("ad_orders", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sku_economics_snapshots_id"), "sku_economics_snapshots", ["id"], unique=False)
    op.create_index(
        "idx_sku_economics_snapshots_store_nm_period",
        "sku_economics_snapshots",
        ["store_id", "nm_id", "period_start", "period_end"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_sku_economics_snapshots_store_nm_period", table_name="sku_economics_snapshots")
    op.drop_index(op.f("ix_sku_economics_snapshots_id"), table_name="sku_economics_snapshots")
    op.drop_table("sku_economics_snapshots")
