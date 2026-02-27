"""add_rbac_and_approvals

Revision ID: 003_rbac
Revises: a6420c18072c
Create Date: 2026-02-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '003_rbac'
down_revision: Union[str, None] = 'a6420c18072c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Expand the userrole enum with new values
    #    Must run outside transaction for PostgreSQL
    connection = op.get_bind()
    connection.execute(sa.text("COMMIT"))
    connection.execute(sa.text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'owner'"))
    connection.execute(sa.text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'head_manager'"))
    connection.execute(sa.text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'viewer'"))
    connection.execute(sa.text("BEGIN"))

    # 2) Create approvalstatus enum
    approvalstatus_enum = postgresql.ENUM(
        'pending', 'approved', 'rejected', 'applied',
        name='approvalstatus',
        create_type=False,
    )
    connection.execute(sa.text(
        "DO $$ BEGIN "
        "CREATE TYPE approvalstatus AS ENUM ('pending', 'approved', 'rejected', 'applied'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$"
    ))

    # 3) Create card_approvals table
    op.create_table(
        'card_approvals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('store_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('prepared_by_id', sa.Integer(), nullable=False),
        sa.Column('reviewed_by_id', sa.Integer(), nullable=True),
        sa.Column('status', approvalstatus_enum, nullable=False, server_default='pending'),
        sa.Column('changes', sa.JSON(), server_default='[]'),
        sa.Column('total_fixes', sa.Integer(), server_default='0'),
        sa.Column('submit_note', sa.Text(), nullable=True),
        sa.Column('reviewer_comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
        sa.Column('applied_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prepared_by_id'], ['users.id']),
        sa.ForeignKeyConstraint(['reviewed_by_id'], ['users.id']),
    )
    op.create_index('idx_approvals_store', 'card_approvals', ['store_id'])
    op.create_index('idx_approvals_card', 'card_approvals', ['card_id'])
    op.create_index('idx_approvals_status', 'card_approvals', ['status'])
    op.create_index('idx_approvals_prepared_by', 'card_approvals', ['prepared_by_id'])


def downgrade() -> None:
    op.drop_table('card_approvals')
    sa.Enum(name='approvalstatus').drop(op.get_bind(), checkfirst=True)
    # NOTE: PostgreSQL doesn't support removing individual enum values;
    # the added roles (owner, head_manager, viewer) will stay in the type.
