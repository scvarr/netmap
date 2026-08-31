"""Add optional canonical Location assistance to SavedMap Regions.

Revision ID: 0039_map_region_location_association
Revises: 0038_location_canonical_foundation
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0039_map_region_location_association"
down_revision: str | None = "0038_location_canonical_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("map_regions", sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_map_regions_location_id_locations",
        "map_regions",
        "locations",
        ["location_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_map_regions_location_id", "map_regions", ["location_id"])


def downgrade() -> None:
    op.drop_index("ix_map_regions_location_id", table_name="map_regions")
    op.drop_constraint("fk_map_regions_location_id_locations", "map_regions", type_="foreignkey")
    op.drop_column("map_regions", "location_id")
