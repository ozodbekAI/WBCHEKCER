"""add ad analysis bootstrap jobs

Revision ID: 9f4a7c2d1e30
Revises: 4b6f9d3c2a10
Create Date: 2026-04-10 09:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "9f4a7c2d1e30"
down_revision: Union[str, None] = "4b6f9d3c2a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "ad_analysis_bootstrap_jobs" in tables:
        return

    op.create_table(
        "ad_analysis_bootstrap_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("current_stage", sa.String(length=64), nullable=True),
        sa.Column("stage_progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("step", sa.String(length=1000), nullable=True),
        sa.Column("days", sa.Integer(), nullable=False, server_default="14"),
        sa.Column("preset", sa.String(length=32), nullable=False, server_default="14d"),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("source_statuses", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("is_partial", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("failed_source", sa.String(length=64), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_ad_analysis_bootstrap_jobs_store_id",
        "ad_analysis_bootstrap_jobs",
        ["store_id"],
        unique=False,
    )
    op.create_index(
        "idx_ad_analysis_bootstrap_jobs_status",
        "ad_analysis_bootstrap_jobs",
        ["status"],
        unique=False,
    )
    op.create_index(
        "idx_ad_analysis_bootstrap_jobs_created_at",
        "ad_analysis_bootstrap_jobs",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "ad_analysis_bootstrap_jobs" not in tables:
        return

    for index_name in (
        "idx_ad_analysis_bootstrap_jobs_created_at",
        "idx_ad_analysis_bootstrap_jobs_status",
        "idx_ad_analysis_bootstrap_jobs_store_id",
    ):
        try:
            op.drop_index(index_name, table_name="ad_analysis_bootstrap_jobs")
        except Exception:
            pass
    op.drop_table("ad_analysis_bootstrap_jobs")
