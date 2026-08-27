"""Remove obsolete BlueprintEndpointSlot perimeter anchors.

Revision ID: 0034_remove_blueprint_endpoint_slot_anchor
Revises: 0033_map_view_position_display_width_physical_only
"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0034_remove_blueprint_endpoint_slot_anchor"
down_revision: str | None = "0033_map_view_position_display_width_physical_only"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    # Use raw DDL: Alembic's naming convention would prefix an already-expanded
    # historical constraint name a second time.
    op.execute("ALTER TABLE blueprint_endpoint_slots DROP CONSTRAINT IF EXISTS ck_blueprint_endpoint_slots_anchor_side_supported")
    op.execute("ALTER TABLE blueprint_endpoint_slots DROP CONSTRAINT IF EXISTS ck_blueprint_endpoint_slots_anchor_offset_range")
    op.drop_column("blueprint_endpoint_slots", "anchor_side")
    op.drop_column("blueprint_endpoint_slots", "anchor_offset")

def downgrade() -> None:
    op.add_column("blueprint_endpoint_slots", sa.Column("anchor_side", sa.String(16), nullable=True))
    op.add_column("blueprint_endpoint_slots", sa.Column("anchor_offset", sa.Float(), nullable=True))
    op.create_check_constraint("ck_blueprint_endpoint_slots_anchor_side_supported", "blueprint_endpoint_slots", "anchor_side IN ('LEFT', 'RIGHT', 'TOP', 'BOTTOM')")
    op.create_check_constraint("ck_blueprint_endpoint_slots_anchor_offset_range", "blueprint_endpoint_slots", "anchor_offset >= 0 AND anchor_offset <= 1")
