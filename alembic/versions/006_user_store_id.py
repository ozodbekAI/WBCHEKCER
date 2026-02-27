"""add store_id to users

Revision ID: 006_user_store_id
Revises: 005_invite_tokens
Create Date: 2026-02-25
"""
from alembic import op
import sqlalchemy as sa

revision = '006_user_store_id'
down_revision = '005_invite_tokens'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('store_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_users_store_id', 'users', 'stores',
        ['store_id'], ['id'], ondelete='SET NULL'
    )


def downgrade():
    op.drop_constraint('fk_users_store_id', 'users', type_='foreignkey')
    op.drop_column('users', 'store_id')
