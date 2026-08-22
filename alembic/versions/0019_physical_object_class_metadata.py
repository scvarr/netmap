"""Add bounded PhysicalObject class metadata.

Revision ID: 0019_physical_object_class_metadata
Revises: 0018_connection_point_display_aliases
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0019_physical_object_class_metadata"
down_revision: str | None = "0018_connection_point_display_aliases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_entity_metadata_display_alias_only"),
        "entity_metadata",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_entity_metadata_supported_key_target"),
        "entity_metadata",
        "key = 'alias.display' OR "
        "(key = 'class' AND physical_object_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM entity_metadata WHERE key = 'class'")
    )
    op.drop_constraint(
        op.f("ck_entity_metadata_supported_key_target"),
        "entity_metadata",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_entity_metadata_display_alias_only"),
        "entity_metadata",
        "key = 'alias.display'",
    )
