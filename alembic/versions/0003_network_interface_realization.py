"""Add canonical NetworkInterfaceRealization."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_interface_realization"
down_revision = "0002_interface_physical_binding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "network_interface_realizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("upper_interface_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lower_interface_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.CheckConstraint(
            "upper_interface_id <> lower_interface_id",
            name=op.f("ck_network_interface_realizations_distinct_interfaces"),
        ),
        sa.ForeignKeyConstraint(
            ["upper_interface_id"],
            ["network_interfaces.id"],
            name="fk_interface_realizations_upper_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["lower_interface_id"],
            ["network_interfaces.id"],
            name="fk_interface_realizations_lower_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_network_interface_realizations"),
        sa.UniqueConstraint(
            "upper_interface_id",
            "lower_interface_id",
            name="uq_interface_realization_upper_lower",
        ),
    )
    op.create_index(
        "ix_interface_realizations_upper_id",
        "network_interface_realizations",
        ["upper_interface_id"],
    )
    op.create_index(
        "ix_interface_realizations_lower_id",
        "network_interface_realizations",
        ["lower_interface_id"],
    )


def downgrade() -> None:
    op.drop_table("network_interface_realizations")
