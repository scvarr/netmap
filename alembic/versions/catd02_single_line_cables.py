"""Require a catalog type for each independently documented Cable."""

import sqlalchemy as sa
from alembic import op


revision = "catd02_single_line_cables"
down_revision = "catd01_physical_catalogs"

COLUMNS = (
    ("cable_type_id", "cable_types", False),
    ("connector_a_type_id", "connector_types", True),
    ("connector_b_type_id", "connector_types", True),
)


def upgrade():
    bind = op.get_bind()
    bind.execute(sa.text("LOCK TABLE cables IN ACCESS EXCLUSIVE MODE"))
    if bind.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM cables)")):
        raise RuntimeError("CAT-D-02 requires an empty cables table: existing untyped cables cannot be migrated")

    for column, target, nullable in COLUMNS:
        op.add_column("cables", sa.Column(column, sa.Uuid(), nullable=nullable))
        op.create_foreign_key(op.f(f"fk_cables_{column}_{target}"), "cables", target, [column], ["id"], ondelete="RESTRICT")
        op.create_index(op.f(f"ix_cables_{column}"), "cables", [column])


def downgrade():
    for column, target, _ in reversed(COLUMNS):
        op.drop_index(op.f(f"ix_cables_{column}"), table_name="cables")
        op.drop_constraint(op.f(f"fk_cables_{column}_{target}"), "cables", type_="foreignkey")
        op.drop_column("cables", column)
