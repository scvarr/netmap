"""Add canonical Locations and explicit PhysicalObject association.

Revision ID: 0038_location_canonical_foundation
Revises: 0037_map_text_annotations
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0038_location_canonical_foundation"
down_revision: str | None = "0037_map_text_annotations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "locations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=255), nullable=True),
        sa.Column("parent_location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        sa.CheckConstraint("type IS NULL OR char_length(btrim(type)) > 0", name="type_not_blank"),
        sa.CheckConstraint("parent_location_id IS NULL OR parent_location_id <> id", name="parent_not_self"),
        sa.ForeignKeyConstraint(["parent_location_id"], ["locations.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_locations_parent_location_id", "locations", ["parent_location_id"])
    op.add_column(
        "physical_objects",
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_physical_objects_location_id_locations",
        "physical_objects",
        "locations",
        ["location_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_physical_objects_location_id", "physical_objects", ["location_id"])


def downgrade() -> None:
    op.drop_index("ix_physical_objects_location_id", table_name="physical_objects")
    op.drop_constraint("fk_physical_objects_location_id_locations", "physical_objects", type_="foreignkey")
    op.drop_column("physical_objects", "location_id")
    op.drop_index("ix_locations_parent_location_id", table_name="locations")
    op.drop_table("locations")
