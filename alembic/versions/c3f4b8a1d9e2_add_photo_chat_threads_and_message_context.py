"""add_photo_chat_threads_and_message_context

Revision ID: c3f4b8a1d9e2
Revises: 9f4a7c2d1e30
Create Date: 2026-04-10 10:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3f4b8a1d9e2"
down_revision: Union[str, None] = "9f4a7c2d1e30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_THREAD_CONTEXT = {
    "last_generated_asset_id": None,
    "working_asset_ids": [],
    "pending_question": None,
    "last_action": None,
    "locale": None,
}


def upgrade() -> None:
    op.create_table(
        "photo_chat_threads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "context",
            sa.JSON(),
            server_default=sa.text(
                """'{"last_generated_asset_id": null, "working_asset_ids": [], "pending_question": null, "last_action": null, "locale": null}'::json"""
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["photo_chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_photo_chat_threads_id"), "photo_chat_threads", ["id"], unique=False)
    op.create_index(op.f("ix_photo_chat_threads_session_id"), "photo_chat_threads", ["session_id"], unique=False)
    op.create_index("ix_photo_chat_threads_session_active", "photo_chat_threads", ["session_id", "is_active"], unique=False)

    op.add_column("photo_chat_messages", sa.Column("thread_id", sa.Integer(), nullable=True))
    op.add_column("photo_chat_messages", sa.Column("request_id", sa.String(length=128), nullable=True))
    op.create_foreign_key(
        "fk_photo_chat_messages_thread_id_photo_chat_threads",
        "photo_chat_messages",
        "photo_chat_threads",
        ["thread_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(op.f("ix_photo_chat_messages_thread_id"), "photo_chat_messages", ["thread_id"], unique=False)
    op.create_index(op.f("ix_photo_chat_messages_request_id"), "photo_chat_messages", ["request_id"], unique=False)

    bind = op.get_bind()

    photo_chat_sessions = sa.table(
        "photo_chat_sessions",
        sa.column("id", sa.Integer()),
    )
    photo_chat_threads = sa.table(
        "photo_chat_threads",
        sa.column("id", sa.Integer()),
        sa.column("session_id", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
        sa.column("context", sa.JSON()),
    )
    photo_chat_messages = sa.table(
        "photo_chat_messages",
        sa.column("id", sa.Integer()),
        sa.column("session_id", sa.Integer()),
        sa.column("thread_id", sa.Integer()),
    )

    bind.execute(
        sa.insert(photo_chat_threads).from_select(
            ["session_id", "is_active", "context"],
            sa.select(
                photo_chat_sessions.c.id,
                sa.literal(True),
                sa.literal(DEFAULT_THREAD_CONTEXT, type_=sa.JSON()),
            ),
        )
    )

    default_thread_id = (
        sa.select(photo_chat_threads.c.id)
        .where(photo_chat_threads.c.session_id == photo_chat_messages.c.session_id)
        .limit(1)
        .scalar_subquery()
    )
    bind.execute(
        sa.update(photo_chat_messages)
        .where(photo_chat_messages.c.thread_id.is_(None))
        .values(thread_id=default_thread_id)
    )

    op.alter_column("photo_chat_messages", "thread_id", nullable=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_photo_chat_messages_request_id"), table_name="photo_chat_messages")
    op.drop_index(op.f("ix_photo_chat_messages_thread_id"), table_name="photo_chat_messages")
    op.drop_constraint("fk_photo_chat_messages_thread_id_photo_chat_threads", "photo_chat_messages", type_="foreignkey")
    op.drop_column("photo_chat_messages", "request_id")
    op.drop_column("photo_chat_messages", "thread_id")

    op.drop_index("ix_photo_chat_threads_session_active", table_name="photo_chat_threads")
    op.drop_index(op.f("ix_photo_chat_threads_session_id"), table_name="photo_chat_threads")
    op.drop_index(op.f("ix_photo_chat_threads_id"), table_name="photo_chat_threads")
    op.drop_table("photo_chat_threads")
