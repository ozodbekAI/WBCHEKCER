"""add_sku_economics_overview_cache

Revision ID: c7d8e9f0a1b2
Revises: f1a2b3c4d5e6
Create Date: 2026-04-01 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sku_economics_overviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sku_economics_overviews_id"), "sku_economics_overviews", ["id"], unique=False)
    op.create_index(
        "idx_sku_economics_overviews_store_period",
        "sku_economics_overviews",
        ["store_id", "period_start", "period_end"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_sku_economics_overviews_store_period", table_name="sku_economics_overviews")
    op.drop_index(op.f("ix_sku_economics_overviews_id"), table_name="sku_economics_overviews")
    op.drop_table("sku_economics_overviews")
