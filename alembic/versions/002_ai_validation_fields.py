"""Add AI and WB validation fields to card_issues

Revision ID: 002
Revises: 001
Create Date: 2026-02-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add WB catalog validation fields
    op.add_column('card_issues', sa.Column('charc_id', sa.Integer(), nullable=True))
    op.add_column('card_issues', sa.Column('allowed_values', sa.JSON(), nullable=True, server_default='[]'))
    op.add_column('card_issues', sa.Column('error_details', sa.JSON(), nullable=True, server_default='[]'))
    
    # Add AI suggestion fields
    op.add_column('card_issues', sa.Column('ai_suggested_value', sa.Text(), nullable=True))
    op.add_column('card_issues', sa.Column('ai_reason', sa.Text(), nullable=True))
    op.add_column('card_issues', sa.Column('ai_alternatives', sa.JSON(), nullable=True, server_default='[]'))
    
    # Add source field
    op.add_column('card_issues', sa.Column('source', sa.String(50), nullable=True, server_default='code'))


def downgrade() -> None:
    op.drop_column('card_issues', 'source')
    op.drop_column('card_issues', 'ai_alternatives')
    op.drop_column('card_issues', 'ai_reason')
    op.drop_column('card_issues', 'ai_suggested_value')
    op.drop_column('card_issues', 'error_details')
    op.drop_column('card_issues', 'allowed_values')
    op.drop_column('card_issues', 'charc_id')
