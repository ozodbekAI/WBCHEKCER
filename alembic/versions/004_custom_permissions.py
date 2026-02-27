"""add custom_permissions column to users

Revision ID: 004_custom_permissions
Revises: 003_rbac
Create Date: 2026-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '004_custom_permissions'
down_revision: Union[str, None] = '003_rbac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('custom_permissions', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'custom_permissions')
