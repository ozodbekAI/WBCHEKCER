"""add avatar_url and registration_access_requests

Revision ID: 009_profile_avatar_access
Revises: 8d0dd3fe575d
Create Date: 2026-03-02
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "009_profile_avatar_access"
down_revision: Union[str, None] = "8d0dd3fe575d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    user_cols = {c["name"] for c in insp.get_columns("users")}
    if "avatar_url" not in user_cols:
        op.add_column("users", sa.Column("avatar_url", sa.String(length=500), nullable=True))

    table_names = set(insp.get_table_names())
    if "registration_access_requests" not in table_names:
        op.create_table(
            "registration_access_requests",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("temp_password_hash", sa.String(length=255), nullable=False),
            sa.Column("first_name", sa.String(length=100), nullable=True),
            sa.Column("last_name", sa.String(length=100), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("cooldown_until", sa.DateTime(), nullable=False),
            sa.Column("sent_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_registration_access_requests_email", "registration_access_requests", ["email"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    table_names = set(insp.get_table_names())
    if "registration_access_requests" in table_names:
        indexes = {i["name"] for i in insp.get_indexes("registration_access_requests")}
        if "ix_registration_access_requests_email" in indexes:
            op.drop_index("ix_registration_access_requests_email", table_name="registration_access_requests")
        op.drop_table("registration_access_requests")

    user_cols = {c["name"] for c in insp.get_columns("users")}
    if "avatar_url" in user_cols:
        op.drop_column("users", "avatar_url")
