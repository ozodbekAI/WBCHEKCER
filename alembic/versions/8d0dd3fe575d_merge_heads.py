"""merge_heads

Revision ID: 8d0dd3fe575d
Revises: 007_last_active_at, b1c3d5e7f9a0
Create Date: 2026-02-27 00:39:47.748063

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8d0dd3fe575d'
down_revision: Union[str, None] = ('007_last_active_at', 'b1c3d5e7f9a0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
