"""add_wb_updated_at_and_task_runtime_fields

Revision ID: 4b6f9d3c2a10
Revises: f2b4c6d8e0f1
Create Date: 2026-04-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4b6f9d3c2a10"
down_revision: Union[str, None] = "f2b4c6d8e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cards", schema=None) as batch_op:
        batch_op.add_column(sa.Column("wb_updated_at", sa.DateTime(), nullable=True))
        batch_op.create_index("idx_cards_wb_updated_at", ["wb_updated_at"], unique=False)

    with op.batch_alter_table("analysis_tasks", schema=None) as batch_op:
        batch_op.alter_column("store_id", existing_type=sa.Integer(), nullable=True)
        batch_op.add_column(sa.Column("started_by_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("progress", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("current_step", sa.String(length=1000), nullable=True))
        batch_op.add_column(sa.Column("task_meta", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("cancellation_requested_at", sa.DateTime(), nullable=True))
        batch_op.create_foreign_key(
            "fk_analysis_tasks_started_by_id_users",
            "users",
            ["started_by_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("idx_analysis_tasks_started_by_id", ["started_by_id"], unique=False)

    op.execute("UPDATE analysis_tasks SET progress = COALESCE(processed_items, 0) WHERE progress IS NULL")
    op.execute("UPDATE analysis_tasks SET task_meta = '{}' WHERE task_meta IS NULL")

    with op.batch_alter_table("analysis_tasks", schema=None) as batch_op:
        batch_op.alter_column("progress", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("analysis_tasks", schema=None) as batch_op:
        batch_op.drop_index("idx_analysis_tasks_started_by_id")
        batch_op.drop_constraint("fk_analysis_tasks_started_by_id_users", type_="foreignkey")
        batch_op.drop_column("cancellation_requested_at")
        batch_op.drop_column("task_meta")
        batch_op.drop_column("current_step")
        batch_op.drop_column("progress")
        batch_op.drop_column("started_by_id")
        batch_op.alter_column("store_id", existing_type=sa.Integer(), nullable=False)

    with op.batch_alter_table("cards", schema=None) as batch_op:
        batch_op.drop_index("idx_cards_wb_updated_at")
        batch_op.drop_column("wb_updated_at")
