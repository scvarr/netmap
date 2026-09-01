"""map composites and presentation variants

Revision ID: 0042_map_composites_presentation_variants
Revises: 0041_cable_label_history
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = "0042_map_composites_presentation_variants"
down_revision = "0041_cable_label_history"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("map_presentation_variants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("map_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        sa.UniqueConstraint("map_id", "name", name="uq_map_presentation_variants_map_name"),
    )
    maps = op.get_bind().execute(sa.text("SELECT id FROM saved_maps")).scalars()
    op.bulk_insert(sa.table("map_presentation_variants", sa.column("id", postgresql.UUID(as_uuid=True)), sa.column("map_id", postgresql.UUID(as_uuid=True)), sa.column("name", sa.String())), [{"id": uuid.uuid4(), "map_id": map_id, "name": "Основной"} for map_id in maps])
    op.add_column("map_view_positions", sa.Column("variant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE map_view_positions p SET variant_id = v.id FROM map_presentation_variants v JOIN map_placements mp ON mp.map_id = v.map_id WHERE mp.id = p.placement_id")
    op.alter_column("map_view_positions", "variant_id", nullable=False)
    op.drop_constraint("uq_map_view_positions_placement_view", "map_view_positions", type_="unique")
    op.create_unique_constraint("uq_map_view_positions_placement_variant_view", "map_view_positions", ["placement_id", "variant_id", "view_key"])
    op.create_foreign_key("fk_map_view_positions_variant", "map_view_positions", "map_presentation_variants", ["variant_id"], ["id"], ondelete="CASCADE")
    op.add_column("map_cable_routes", sa.Column("variant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE map_cable_routes r SET variant_id = v.id FROM map_presentation_variants v WHERE v.map_id = r.map_id")
    op.alter_column("map_cable_routes", "variant_id", nullable=False)
    op.drop_constraint("uq_map_cable_routes_map_cable_view", "map_cable_routes", type_="unique")
    op.create_unique_constraint("uq_map_cable_routes_variant_cable_view", "map_cable_routes", ["variant_id", "cable_id", "view_key"])
    op.create_foreign_key("fk_map_cable_routes_variant", "map_cable_routes", "map_presentation_variants", ["variant_id"], ["id"], ondelete="CASCADE")
    op.create_table("map_composites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True), sa.Column("map_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("saved_maps.id", ondelete="CASCADE"), nullable=False), sa.Column("name", sa.String(255), nullable=False), sa.CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"))
    op.create_table("map_composite_members",
        sa.Column("composite_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_composites.id", ondelete="CASCADE"), primary_key=True), sa.Column("placement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_placements.id", ondelete="CASCADE"), primary_key=True), sa.UniqueConstraint("placement_id", name="uq_map_composite_members_placement"))
    op.create_table("map_composite_presentations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True), sa.Column("composite_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_composites.id", ondelete="CASCADE"), nullable=False), sa.Column("variant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("map_presentation_variants.id", ondelete="CASCADE"), nullable=False), sa.Column("collapsed", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("x", sa.Float(), nullable=False, server_default="0"), sa.Column("y", sa.Float(), nullable=False, server_default="0"), sa.Column("width", sa.Float(), nullable=False, server_default="280"), sa.Column("height", sa.Float(), nullable=False, server_default="180"), sa.CheckConstraint("width > 0 AND height > 0", name="dimensions_positive"), sa.UniqueConstraint("composite_id", "variant_id", name="uq_map_composite_presentations_composite_variant"))


def downgrade():
    op.drop_table("map_composite_presentations")
    op.drop_table("map_composite_members")
    op.drop_table("map_composites")
    op.drop_constraint("fk_map_cable_routes_variant", "map_cable_routes", type_="foreignkey")
    op.drop_constraint("uq_map_cable_routes_variant_cable_view", "map_cable_routes", type_="unique")
    op.drop_column("map_cable_routes", "variant_id")
    op.create_unique_constraint("uq_map_cable_routes_map_cable_view", "map_cable_routes", ["map_id", "cable_id", "view_key"])
    op.drop_constraint("fk_map_view_positions_variant", "map_view_positions", type_="foreignkey")
    op.drop_constraint("uq_map_view_positions_placement_variant_view", "map_view_positions", type_="unique")
    op.drop_column("map_view_positions", "variant_id")
    op.create_unique_constraint("uq_map_view_positions_placement_view", "map_view_positions", ["placement_id", "view_key"])
    op.drop_table("map_presentation_variants")
