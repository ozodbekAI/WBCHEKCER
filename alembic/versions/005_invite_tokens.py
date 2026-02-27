"""Add user_invites table

Revision ID: 005_invite_tokens
Revises: adb6bc5d6680
Create Date: 2026-02-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision = '005_invite_tokens'
down_revision = '004_custom_permissions'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_invites',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('token', sa.String(128), unique=True, nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('role', sa.String(50), nullable=False, server_default='manager'),
        sa.Column('custom_permissions', JSON, nullable=True),
        sa.Column('first_name', sa.String(100), nullable=True),
        sa.Column('store_id', sa.Integer(), sa.ForeignKey('stores.id', ondelete='SET NULL'), nullable=True),
        sa.Column('invited_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('is_used', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('NOW()'), nullable=False),
    )
    op.create_index('ix_user_invites_token', 'user_invites', ['token'])
    op.create_index('ix_user_invites_email', 'user_invites', ['email'])


def downgrade():
    op.drop_table('user_invites')
