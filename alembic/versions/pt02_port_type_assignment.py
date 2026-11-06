"""Require catalog port types on hardware endpoint definitions."""

from alembic import op
import sqlalchemy as sa

revision = "pt02_port_type_assignment"
down_revision = "pt01_initial"
branch_labels = None
depends_on = None

ENDPOINT_TABLES = ("built_in_endpoint_definitions", "module_endpoint_definitions")


def upgrade() -> None:
    # PT-01 JSON definitions have no type assignments. Reject them before a
    # schema upgrade can leave pre-PT-02 snapshots in an unreadable state.
    for prefix, section in (("base", "slots"), ("module", "endpoints")):
        for state in ("drafts", "candidates"):
            op.execute(f"""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM {prefix}_template_{state}
                               WHERE jsonb_array_length(definition->'{section}') > 0) THEN
                        RAISE EXCEPTION 'Recreate the development database for PT-02';
                    END IF;
                END $$;
            """)
    for table in ENDPOINT_TABLES:
        op.add_column(table, sa.Column("port_type_id", sa.UUID(), nullable=False))
        op.create_foreign_key(
            op.f(f"fk_{table}_port_type_id_port_types"), table, "port_types",
            ["port_type_id"], ["id"], ondelete="RESTRICT",
        )
        op.create_index(op.f(f"ix_{table}_port_type_id"), table, ["port_type_id"])


def downgrade() -> None:
    for table in ENDPOINT_TABLES:
        op.drop_index(op.f(f"ix_{table}_port_type_id"), table_name=table)
        op.drop_constraint(op.f(f"fk_{table}_port_type_id_port_types"), table, type_="foreignkey")
        op.drop_column("port_type_id", table)
