"""Scope module places to the configuration or the owning installation."""
import sqlalchemy as sa
from alembic import op

revision = "mod02a_nested_installations"
down_revision = "catd05_split_mount_types"
branch_labels = None
depends_on = None


def upgrade():
    table = "module_installations"
    op.add_column(table, sa.Column("parent_installation_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint("uq_module_installations_id_configuration", table, ["id", "configuration_id"])
    op.create_foreign_key("fk_module_installations_parent_configuration", table, table,
                          ["parent_installation_id", "configuration_id"], ["id", "configuration_id"])
    op.create_unique_constraint("uq_module_installations_child_place", table, ["parent_installation_id", "bay_key"])
    op.create_index("uq_module_installations_root_place", table, ["configuration_id", "bay_key"],
                    unique=True, postgresql_where=sa.text("parent_installation_id IS NULL"))
    op.create_check_constraint(op.f("ck_module_installations_distinct_parent"), table, "parent_installation_id <> id")
    op.drop_constraint("uq_module_installations_configuration_id", table, type_="unique")
    # Parent links are immutable. Check new links against all rows in the
    # statement, including multi-row INSERTs in which every FK could resolve.
    op.execute("""
        CREATE FUNCTION check_module_installation_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF (NEW.id, NEW.configuration_id, NEW.parent_installation_id)
                    IS DISTINCT FROM (OLD.id, OLD.configuration_id, OLD.parent_installation_id) THEN
                    RAISE EXCEPTION 'Module installation ownership is immutable' USING ERRCODE = '23514';
                END IF;
            ELSIF NEW.parent_installation_id IS NOT NULL AND EXISTS (
                WITH RECURSIVE ancestors(id, parent_installation_id) AS (
                    SELECT id, parent_installation_id FROM module_installations WHERE id = NEW.parent_installation_id
                    UNION
                    SELECT i.id, i.parent_installation_id FROM module_installations i
                    JOIN ancestors a ON i.id = a.parent_installation_id
                )
                SELECT 1 FROM ancestors WHERE id = NEW.id
            ) THEN
                RAISE EXCEPTION 'Module installation hierarchy contains a cycle' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END
        $$;
        CREATE TRIGGER module_installation_hierarchy
        AFTER INSERT OR UPDATE OF id, configuration_id, parent_installation_id ON module_installations
        FOR EACH ROW EXECUTE FUNCTION check_module_installation_hierarchy();
    """)


def downgrade():
    table = "module_installations"
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM module_installations WHERE parent_installation_id IS NOT NULL) THEN
                RAISE EXCEPTION 'Remove nested module installations before downgrading';
            END IF;
        END
        $$;
        DROP TRIGGER module_installation_hierarchy ON module_installations;
        DROP FUNCTION check_module_installation_hierarchy();
    """)
    op.create_unique_constraint("uq_module_installations_configuration_id", table, ["configuration_id", "bay_key"])
    op.drop_constraint(op.f("ck_module_installations_distinct_parent"), table, type_="check")
    op.drop_index("uq_module_installations_root_place", table_name=table)
    op.drop_constraint("uq_module_installations_child_place", table, type_="unique")
    op.drop_constraint("fk_module_installations_parent_configuration", table, type_="foreignkey")
    op.drop_constraint("uq_module_installations_id_configuration", table, type_="unique")
    op.drop_column(table, "parent_installation_id")
