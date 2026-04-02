"""add_workflow_tables

Revision ID: d4f6c7b8e9a1
Revises: 211b84143ca6
Create Date: 2026-03-27 10:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4f6c7b8e9a1'
down_revision: Union[str, None] = '211b84143ca6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(
        "DO $$ BEGIN "
        "CREATE TYPE tickettype AS ENUM ('delegation', 'approval'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$"
    ))
    bind.execute(sa.text(
        "DO $$ BEGIN "
        "CREATE TYPE ticketstatus AS ENUM ('pending', 'done'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$"
    ))
    ticket_type = postgresql.ENUM('delegation', 'approval', name='tickettype', create_type=False)
    ticket_status = postgresql.ENUM('pending', 'done', name='ticketstatus', create_type=False)

    op.create_table(
        'card_drafts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('card_id', 'author_id', name='uq_card_drafts_card_author'),
    )
    op.create_index(op.f('ix_card_drafts_id'), 'card_drafts', ['id'], unique=False)
    op.create_index('idx_card_drafts_card', 'card_drafts', ['card_id'], unique=False)
    op.create_index('idx_card_drafts_author', 'card_drafts', ['author_id'], unique=False)
    op.create_index('idx_card_drafts_updated_at', 'card_drafts', ['updated_at'], unique=False)

    op.create_table(
        'card_confirmed_sections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('section', sa.String(length=100), nullable=False),
        sa.Column('confirmed_by_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['confirmed_by_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('card_id', 'section', name='uq_card_confirmed_sections_card_section'),
    )
    op.create_index(op.f('ix_card_confirmed_sections_id'), 'card_confirmed_sections', ['id'], unique=False)
    op.create_index('idx_card_confirmed_sections_card', 'card_confirmed_sections', ['card_id'], unique=False)
    op.create_index('idx_card_confirmed_sections_section', 'card_confirmed_sections', ['section'], unique=False)

    op.create_table(
        'team_tickets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('store_id', sa.Integer(), nullable=False),
        sa.Column('type', ticket_type, nullable=False),
        sa.Column('status', ticket_status, nullable=False),
        sa.Column('issue_id', sa.Integer(), nullable=True),
        sa.Column('approval_id', sa.Integer(), nullable=True),
        sa.Column('card_id', sa.Integer(), nullable=True),
        sa.Column('issue_title', sa.String(length=500), nullable=True),
        sa.Column('issue_severity', sa.String(length=50), nullable=True),
        sa.Column('issue_code', sa.String(length=100), nullable=True),
        sa.Column('card_title', sa.String(length=500), nullable=True),
        sa.Column('card_photo', sa.String(length=1000), nullable=True),
        sa.Column('card_nm_id', sa.Integer(), nullable=True),
        sa.Column('card_vendor_code', sa.String(length=100), nullable=True),
        sa.Column('from_user_id', sa.Integer(), nullable=True),
        sa.Column('to_user_id', sa.Integer(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('completed_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['approval_id'], ['card_approvals.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['completed_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['from_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['issue_id'], ['card_issues.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['to_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_team_tickets_id'), 'team_tickets', ['id'], unique=False)
    op.create_index('idx_team_tickets_store', 'team_tickets', ['store_id'], unique=False)
    op.create_index('idx_team_tickets_status', 'team_tickets', ['status'], unique=False)
    op.create_index('idx_team_tickets_type', 'team_tickets', ['type'], unique=False)
    op.create_index('idx_team_tickets_to_user', 'team_tickets', ['to_user_id'], unique=False)
    op.create_index('idx_team_tickets_from_user', 'team_tickets', ['from_user_id'], unique=False)
    op.create_index('idx_team_tickets_created_at', 'team_tickets', ['created_at'], unique=False)


def downgrade() -> None:
    ticket_type = sa.Enum('delegation', 'approval', name='tickettype')
    ticket_status = sa.Enum('pending', 'done', name='ticketstatus')

    op.drop_index('idx_team_tickets_created_at', table_name='team_tickets')
    op.drop_index('idx_team_tickets_from_user', table_name='team_tickets')
    op.drop_index('idx_team_tickets_to_user', table_name='team_tickets')
    op.drop_index('idx_team_tickets_type', table_name='team_tickets')
    op.drop_index('idx_team_tickets_status', table_name='team_tickets')
    op.drop_index('idx_team_tickets_store', table_name='team_tickets')
    op.drop_index(op.f('ix_team_tickets_id'), table_name='team_tickets')
    op.drop_table('team_tickets')

    op.drop_index('idx_card_confirmed_sections_section', table_name='card_confirmed_sections')
    op.drop_index('idx_card_confirmed_sections_card', table_name='card_confirmed_sections')
    op.drop_index(op.f('ix_card_confirmed_sections_id'), table_name='card_confirmed_sections')
    op.drop_table('card_confirmed_sections')

    op.drop_index('idx_card_drafts_updated_at', table_name='card_drafts')
    op.drop_index('idx_card_drafts_author', table_name='card_drafts')
    op.drop_index('idx_card_drafts_card', table_name='card_drafts')
    op.drop_index(op.f('ix_card_drafts_id'), table_name='card_drafts')
    op.drop_table('card_drafts')

    ticket_status.drop(op.get_bind(), checkfirst=True)
    ticket_type.drop(op.get_bind(), checkfirst=True)
