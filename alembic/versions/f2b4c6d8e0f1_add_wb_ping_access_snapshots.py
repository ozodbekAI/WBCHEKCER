"""add wb ping access snapshots

Revision ID: f2b4c6d8e0f1
Revises: d1e2f3a4b5c6
Create Date: 2026-04-03 14:48:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "f2b4c6d8e0f1"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    store_columns = {column["name"] for column in inspector.get_columns("stores")}
    if "wb_ping_access" not in store_columns:
        op.add_column("stores", sa.Column("wb_ping_access", sa.JSON(), nullable=True))
    if "wb_ping_checked_at" not in store_columns:
        op.add_column("stores", sa.Column("wb_ping_checked_at", sa.DateTime(), nullable=True))

    key_columns = {column["name"] for column in inspector.get_columns("store_api_keys")}
    if "wb_ping_access" not in key_columns:
        op.add_column("store_api_keys", sa.Column("wb_ping_access", sa.JSON(), nullable=True))
    if "wb_ping_checked_at" not in key_columns:
        op.add_column("store_api_keys", sa.Column("wb_ping_checked_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    key_columns = {column["name"] for column in inspector.get_columns("store_api_keys")}
    if "wb_ping_checked_at" in key_columns:
        op.drop_column("store_api_keys", "wb_ping_checked_at")
    if "wb_ping_access" in key_columns:
        op.drop_column("store_api_keys", "wb_ping_access")

    store_columns = {column["name"] for column in inspector.get_columns("stores")}
    if "wb_ping_checked_at" in store_columns:
        op.drop_column("stores", "wb_ping_checked_at")
    if "wb_ping_access" in store_columns:
        op.drop_column("stores", "wb_ping_access")
