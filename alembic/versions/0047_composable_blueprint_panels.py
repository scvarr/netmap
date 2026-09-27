"""Replace fixed Blueprint faces with version-owned presentation panels.

Revision ID: 0047_composable_blueprint_panels
Revises: 0046_direct_blueprint_slots
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0047_composable_blueprint_panels"
down_revision = "0046_direct_blueprint_slots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only development Blueprint provenance is discarded. Materialized canonical
    # objects, points, interfaces and connections remain independent facts.
    op.execute("DELETE FROM blueprint_instance_slots")
    op.execute("DELETE FROM blueprint_instances")
    op.execute("DELETE FROM blueprint_internal_links")
    op.execute("DELETE FROM blueprint_endpoint_slots")
    op.execute("DELETE FROM object_blueprint_versions")
    op.execute("DELETE FROM object_blueprints")

    op.create_table(
        "presentation_panels",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("blueprint_version_id", UUID(as_uuid=True), sa.ForeignKey("object_blueprint_versions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("panel_key", sa.String(255), nullable=False),
        sa.Column("panel_number", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("width", sa.Float(), nullable=False),
        sa.Column("height", sa.Float(), nullable=False),
        sa.CheckConstraint("char_length(btrim(panel_key)) > 0", name="ck_presentation_panels_panel_key_not_blank"),
        sa.CheckConstraint("panel_number > 0", name="ck_presentation_panels_panel_number_positive"),
        sa.CheckConstraint("width > 0 AND height > 0", name="ck_presentation_panels_size_positive"),
        sa.UniqueConstraint("blueprint_version_id", "panel_key", name="uq_presentation_panels_version_key"),
        sa.UniqueConstraint("blueprint_version_id", "panel_number", name="uq_presentation_panels_version_number"),
    )
    op.drop_constraint("ck_blueprint_endpoint_slots_face_supported", "blueprint_endpoint_slots", type_="check")
    op.drop_column("blueprint_endpoint_slots", "face")
    op.add_column("blueprint_endpoint_slots", sa.Column("panel_key", sa.String(255), nullable=False))
    op.create_foreign_key(
        "fk_blueprint_endpoint_slots_panel_version", "blueprint_endpoint_slots", "presentation_panels",
        ["blueprint_version_id", "panel_key"], ["blueprint_version_id", "panel_key"], ondelete="RESTRICT",
    )


def downgrade() -> None:
    raise RuntimeError("Destructive panel cutover cannot restore development Blueprint faces")
