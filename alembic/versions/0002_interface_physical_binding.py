"""Add the minimal NetworkInterface to L1 physical binding bridge."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_interface_physical_binding"
down_revision = "0001_canonical_l1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "network_interfaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_network_interfaces"),
    )
    op.create_table(
        "interface_physical_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interface_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("point_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("point_member", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "point_member >= 1",
            name=op.f("ck_interface_physical_bindings_point_member_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["interface_id"],
            ["network_interfaces.id"],
            name="fk_interface_physical_bindings_interface_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["point_id"],
            ["connection_points.id"],
            name="fk_interface_physical_bindings_point_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_interface_physical_bindings"),
        sa.UniqueConstraint(
            "point_id",
            "point_member",
            name="uq_physical_binding_point_member",
        ),
    )
    op.create_index(
        "ix_physical_bindings_interface_id",
        "interface_physical_bindings",
        ["interface_id"],
    )


def downgrade() -> None:
    op.drop_table("interface_physical_bindings")
    op.drop_table("network_interfaces")
