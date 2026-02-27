"""add last_active_at to users

Revision ID: 007_last_active_at
Revises: 006_user_store_id
Create Date: 2026-02-25
"""
from alembic import op
import sqlalchemy as sa

revision = '007_last_active_at'
down_revision = '006_user_store_id'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('last_active_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('users', 'last_active_at')
