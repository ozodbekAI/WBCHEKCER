"""Initial migration

Revision ID: 001
Revises: 
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('first_name', sa.String(100), nullable=True),
        sa.Column('last_name', sa.String(100), nullable=True),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('role', sa.Enum('admin', 'manager', 'user', name='userrole'), nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('is_verified', sa.Boolean(), default=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('last_login', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_users_email', 'users', ['email'], unique=True)
    op.create_index('idx_users_role', 'users', ['role'])
    
    # Stores table
    op.create_table(
        'stores',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('api_key', sa.Text(), nullable=False),
        sa.Column('status', sa.Enum('pending', 'validating', 'active', 'error', 'disabled', name='storestatus'), nullable=False),
        sa.Column('status_message', sa.Text(), nullable=True),
        sa.Column('wb_supplier_id', sa.String(100), nullable=True),
        sa.Column('wb_supplier_name', sa.String(255), nullable=True),
        sa.Column('total_cards', sa.Integer(), default=0),
        sa.Column('critical_issues', sa.Integer(), default=0),
        sa.Column('warnings_count', sa.Integer(), default=0),
        sa.Column('growth_potential', sa.Integer(), default=0),
        sa.Column('last_sync_at', sa.DateTime(), nullable=True),
        sa.Column('last_analysis_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_stores_owner_id', 'stores', ['owner_id'])
    op.create_index('idx_stores_status', 'stores', ['status'])
    
    # Cards table
    op.create_table(
        'cards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('store_id', sa.Integer(), nullable=False),
        sa.Column('nm_id', sa.Integer(), nullable=False),
        sa.Column('imt_id', sa.Integer(), nullable=True),
        sa.Column('vendor_code', sa.String(100), nullable=True),
        sa.Column('title', sa.String(500), nullable=True),
        sa.Column('brand', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('subject_id', sa.Integer(), nullable=True),
        sa.Column('subject_name', sa.String(255), nullable=True),
        sa.Column('category_name', sa.String(255), nullable=True),
        sa.Column('photos', sa.JSON(), default=list),
        sa.Column('videos', sa.JSON(), default=list),
        sa.Column('photos_count', sa.Integer(), default=0),
        sa.Column('videos_count', sa.Integer(), default=0),
        sa.Column('characteristics', sa.JSON(), default=dict),
        sa.Column('price', sa.Float(), nullable=True),
        sa.Column('discount', sa.Integer(), nullable=True),
        sa.Column('dimensions', sa.JSON(), default=dict),
        sa.Column('score', sa.Integer(), default=0),
        sa.Column('score_breakdown', sa.JSON(), default=dict),
        sa.Column('critical_issues_count', sa.Integer(), default=0),
        sa.Column('warnings_count', sa.Integer(), default=0),
        sa.Column('improvements_count', sa.Integer(), default=0),
        sa.Column('growth_points_count', sa.Integer(), default=0),
        sa.Column('raw_data', sa.JSON(), default=dict),
        sa.Column('last_analysis_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_cards_store_id', 'cards', ['store_id'])
    op.create_index('idx_cards_nm_id', 'cards', ['nm_id'])
    op.create_index('idx_cards_score', 'cards', ['score'])
    op.create_index('idx_cards_store_nm', 'cards', ['store_id', 'nm_id'], unique=True)
    
    # Card Issues table
    op.create_table(
        'card_issues',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(100), nullable=False),
        sa.Column('severity', sa.Enum('critical', 'warning', 'improvement', 'info', name='issueseverity'), nullable=False),
        sa.Column('category', sa.Enum('title', 'description', 'photos', 'video', 'characteristics', 'category', 'price', 'seo', 'compliance', 'other', name='issuecategory'), nullable=False),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('current_value', sa.Text(), nullable=True),
        sa.Column('field_path', sa.String(255), nullable=True),
        sa.Column('suggested_value', sa.Text(), nullable=True),
        sa.Column('alternatives', sa.JSON(), default=list),
        sa.Column('score_impact', sa.Integer(), default=0),
        sa.Column('status', sa.Enum('pending', 'fixed', 'skipped', 'postponed', 'auto_fixed', name='issuestatus'), default='pending'),
        sa.Column('fixed_value', sa.Text(), nullable=True),
        sa.Column('fixed_at', sa.DateTime(), nullable=True),
        sa.Column('fixed_by_id', sa.Integer(), nullable=True),
        sa.Column('postponed_until', sa.DateTime(), nullable=True),
        sa.Column('postpone_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['fixed_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_card_issues_card_id', 'card_issues', ['card_id'])
    op.create_index('idx_card_issues_severity', 'card_issues', ['severity'])
    op.create_index('idx_card_issues_category', 'card_issues', ['category'])
    op.create_index('idx_card_issues_status', 'card_issues', ['status'])
    op.create_index('idx_card_issues_code', 'card_issues', ['code'])
    
    # Issue Rules table
    op.create_table(
        'issue_rules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(100), nullable=False, unique=True),
        sa.Column('severity', sa.Enum('critical', 'warning', 'improvement', 'info', name='issueseverity'), nullable=False),
        sa.Column('category', sa.Enum('title', 'description', 'photos', 'video', 'characteristics', 'category', 'price', 'seo', 'compliance', 'other', name='issuecategory'), nullable=False),
        sa.Column('title_template', sa.String(500), nullable=False),
        sa.Column('description_template', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('priority', sa.Integer(), default=0),
        sa.Column('base_score_impact', sa.Integer(), default=0),
        sa.Column('conditions', sa.JSON(), default=dict),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Analysis Tasks table
    op.create_table(
        'analysis_tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('store_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(50), default='pending'),
        sa.Column('task_type', sa.String(50), nullable=False),
        sa.Column('total_items', sa.Integer(), default=0),
        sa.Column('processed_items', sa.Integer(), default=0),
        sa.Column('result', sa.JSON(), default=dict),
        sa.Column('error_message', sa.String(1000), nullable=True),
        sa.Column('celery_task_id', sa.String(255), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_analysis_tasks_store_id', 'analysis_tasks', ['store_id'])
    op.create_index('idx_analysis_tasks_status', 'analysis_tasks', ['status'])
    
    # Activity Logs table
    op.create_table(
        'activity_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('store_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('entity_type', sa.String(50), nullable=True),
        sa.Column('entity_id', sa.Integer(), nullable=True),
        sa.Column('details', sa.JSON(), default=dict),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_activity_logs_user_id', 'activity_logs', ['user_id'])
    op.create_index('idx_activity_logs_store_id', 'activity_logs', ['store_id'])
    op.create_index('idx_activity_logs_action', 'activity_logs', ['action'])
    op.create_index('idx_activity_logs_created_at', 'activity_logs', ['created_at'])


def downgrade() -> None:
    op.drop_table('activity_logs')
    op.drop_table('analysis_tasks')
    op.drop_table('issue_rules')
    op.drop_table('card_issues')
    op.drop_table('cards')
    op.drop_table('stores')
    op.drop_table('users')
    
    # Drop enums
    op.execute('DROP TYPE IF EXISTS userrole')
    op.execute('DROP TYPE IF EXISTS storestatus')
    op.execute('DROP TYPE IF EXISTS issueseverity')
    op.execute('DROP TYPE IF EXISTS issuecategory')
    op.execute('DROP TYPE IF EXISTS issuestatus')
