"""add fixed_file_entries table

Revision ID: b1c3d5e7f9a0
Revises: a6420c18072c
Create Date: 2026-02-26 19:00:00.000000
"""
from typing import Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b1c3d5e7f9a0'
down_revision: Union[str, None] = 'a6420c18072c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'fixed_file_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('store_id', sa.Integer(), nullable=False),
        sa.Column('nm_id', sa.Integer(), nullable=False),
        sa.Column('brand', sa.String(255), nullable=True),
        sa.Column('subject_name', sa.String(255), nullable=True),
        sa.Column('char_name', sa.String(255), nullable=False),
        sa.Column('fixed_value', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('store_id', 'nm_id', 'char_name', name='uq_fixed_entry'),
    )
    op.create_index('idx_fixed_file_store_nm', 'fixed_file_entries', ['store_id', 'nm_id'])
    op.create_index('idx_fixed_file_store', 'fixed_file_entries', ['store_id'])


def downgrade() -> None:
    op.drop_index('idx_fixed_file_store')
    op.drop_index('idx_fixed_file_store_nm')
    op.drop_table('fixed_file_entries')
