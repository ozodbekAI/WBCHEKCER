"""add_sku_economics_tables

Revision ID: e7b9c4d2a1f0
Revises: d4f6c7b8e9a1
Create Date: 2026-03-30 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e7b9c4d2a1f0"
down_revision: Union[str, None] = "d4f6c7b8e9a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sku_economics_costs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("nm_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("vendor_code", sa.String(length=100), nullable=True),
        sa.Column("unit_cost", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sku_economics_costs_id"), "sku_economics_costs", ["id"], unique=False)
    op.create_index("idx_sku_economics_costs_store_nm", "sku_economics_costs", ["store_id", "nm_id"], unique=True)

    op.create_table(
        "sku_economics_manual_spend",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("nm_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("spend", sa.Float(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("clicks", sa.Integer(), nullable=True),
        sa.Column("orders", sa.Integer(), nullable=True),
        sa.Column("gmv", sa.Float(), nullable=True),
        sa.Column("source_file_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sku_economics_manual_spend_id"), "sku_economics_manual_spend", ["id"], unique=False)
    op.create_index(
        "idx_sku_economics_manual_spend_store_nm_period",
        "sku_economics_manual_spend",
        ["store_id", "nm_id", "period_start", "period_end"],
        unique=True,
    )

    op.create_table(
        "sku_economics_manual_finance",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("nm_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("revenue", sa.Float(), nullable=False),
        sa.Column("wb_costs", sa.Float(), nullable=False),
        sa.Column("payout", sa.Float(), nullable=True),
        sa.Column("orders", sa.Integer(), nullable=True),
        sa.Column("source_file_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sku_economics_manual_finance_id"), "sku_economics_manual_finance", ["id"], unique=False)
    op.create_index(
        "idx_sku_economics_manual_finance_store_nm_period",
        "sku_economics_manual_finance",
        ["store_id", "nm_id", "period_start", "period_end"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_sku_economics_manual_finance_store_nm_period", table_name="sku_economics_manual_finance")
    op.drop_index(op.f("ix_sku_economics_manual_finance_id"), table_name="sku_economics_manual_finance")
    op.drop_table("sku_economics_manual_finance")

    op.drop_index("idx_sku_economics_manual_spend_store_nm_period", table_name="sku_economics_manual_spend")
    op.drop_index(op.f("ix_sku_economics_manual_spend_id"), table_name="sku_economics_manual_spend")
    op.drop_table("sku_economics_manual_spend")

    op.drop_index("idx_sku_economics_costs_store_nm", table_name="sku_economics_costs")
    op.drop_index(op.f("ix_sku_economics_costs_id"), table_name="sku_economics_costs")
    op.drop_table("sku_economics_costs")
