"""Add versioned bounded object blueprint authoring recipes.

Revision ID: 0021_blueprint_authoring_recipe
Revises: 0020_object_blueprints
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0021_blueprint_authoring_recipe"
down_revision: str | None = "0020_object_blueprints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "object_blueprint_versions",
        sa.Column("authoring_recipe", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("object_blueprint_versions", "authoring_recipe")
