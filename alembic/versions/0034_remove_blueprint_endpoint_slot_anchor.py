"""Remove obsolete BlueprintEndpointSlot perimeter anchors.

Revision ID: 0034_remove_blueprint_endpoint_slot_anchor
Revises: 0033_map_view_position_display_width_physical_only
"""
from collections.abc import Sequence
from alembic import op

revision: str = "0034_remove_blueprint_endpoint_slot_anchor"
down_revision: str | None = "0033_map_view_position_display_width_physical_only"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    op.drop_constraint("anchor_side_supported", "blueprint_endpoint_slots", type_="check")
    op.drop_constraint("anchor_offset_range", "blueprint_endpoint_slots", type_="check")
    op.drop_column("blueprint_endpoint_slots", "anchor_side")
    op.drop_column("blueprint_endpoint_slots", "anchor_offset")

def downgrade() -> None:
    op.add_column("blueprint_endpoint_slots", __import__('sqlalchemy').Column("anchor_side", __import__('sqlalchemy').String(16), nullable=True))
    op.add_column("blueprint_endpoint_slots", __import__('sqlalchemy').Column("anchor_offset", __import__('sqlalchemy').Float(), nullable=True))
