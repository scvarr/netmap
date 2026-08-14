"""Create the canonical L1 slice."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_canonical_l1"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "physical_objects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_physical_objects"),
    )
    op.create_table(
        "connection_points",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("physical_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cardinality", sa.Integer(), nullable=False),
        sa.CheckConstraint("cardinality >= 1", name="ck_connection_points_cardinality_positive"),
        sa.ForeignKeyConstraint(
            ["physical_object_id"], ["physical_objects.id"],
            name="fk_connection_points_physical_object_id", ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_connection_points"),
    )
    op.create_index("ix_connection_points_physical_object_id", "connection_points", ["physical_object_id"])
    op.create_table(
        "connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("point_a_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("point_b_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cardinality", sa.Integer(), nullable=False),
        sa.CheckConstraint("cardinality >= 1", name="ck_connections_cardinality_positive"),
        sa.CheckConstraint("point_a_id <> point_b_id", name="ck_connections_distinct_points"),
        sa.ForeignKeyConstraint(
            ["point_a_id"], ["connection_points.id"],
            name="fk_connections_point_a_id", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["point_b_id"], ["connection_points.id"],
            name="fk_connections_point_b_id", ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_connections"),
    )
    op.create_index("ix_connections_point_a_id", "connections", ["point_a_id"])
    op.create_index("ix_connections_point_b_id", "connections", ["point_b_id"])
    op.create_table(
        "connection_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.Column("point_a_member", sa.Integer(), nullable=False),
        sa.Column("point_b_member", sa.Integer(), nullable=False),
        sa.CheckConstraint("index >= 1", name="ck_connection_members_index_positive"),
        sa.CheckConstraint("point_a_member >= 1", name="ck_connection_members_a_positive"),
        sa.CheckConstraint("point_b_member >= 1", name="ck_connection_members_b_positive"),
        sa.ForeignKeyConstraint(
            ["connection_id"], ["connections.id"],
            name="fk_connection_members_connection_id", ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_connection_members"),
        sa.UniqueConstraint("connection_id", "index", name="uq_connection_members_index"),
        sa.UniqueConstraint("connection_id", "point_a_member", name="uq_connection_members_a"),
        sa.UniqueConstraint("connection_id", "point_b_member", name="uq_connection_members_b"),
    )
    op.create_index("ix_connection_members_connection_id", "connection_members", ["connection_id"])
    op.create_index("ix_connection_members_a_member", "connection_members", ["point_a_member"])
    op.create_index("ix_connection_members_b_member", "connection_members", ["point_b_member"])


def downgrade() -> None:
    op.drop_table("connection_members")
    op.drop_table("connections")
    op.drop_table("connection_points")
    op.drop_table("physical_objects")

