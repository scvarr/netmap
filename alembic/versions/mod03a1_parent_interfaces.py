"""Persist stable hardware interface declarations and their materializations."""
import sqlalchemy as sa
from alembic import op

revision = "mod03a1_parent_interfaces"
down_revision = "txlib01_specifications"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("module_bays", sa.Column("hardware_interface_key", sa.Uuid()))
    op.create_unique_constraint("uq_base_hardware_interface_key", "module_bays",
                                ["base_revision_id", "hardware_interface_key"])
    op.create_check_constraint(op.f("ck_module_bays_hardware_interface_requires_port"), "module_bays",
                               "hardware_interface_key IS NULL OR mount_kind = 'MODULE_PORT'")
    op.create_unique_constraint("uq_interface_owner_object", "network_interface_physical_owners",
                                ["interface_id", "physical_object_id"])
    op.create_unique_constraint("uq_object_configuration_owner", "object_configurations",
                                ["id", "physical_object_id"])
    table = op.create_table(
        "hardware_interface_associations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("interface_id", sa.Uuid(), nullable=False),
        sa.Column("physical_object_id", sa.Uuid(), nullable=False),
        sa.Column("configuration_id", sa.Uuid(), nullable=False),
        sa.Column("parent_installation_id", sa.Uuid()),
        sa.Column("bay_key", sa.String(255), nullable=False),
        sa.Column("hardware_interface_key", sa.Uuid(), nullable=False),
        sa.UniqueConstraint("interface_id", name="uq_hardware_association_interface"),
        sa.ForeignKeyConstraint(
            ["interface_id", "physical_object_id"],
            ["network_interface_physical_owners.interface_id", "network_interface_physical_owners.physical_object_id"],
            name="fk_hardware_association_interface_owner",
        ),
        sa.ForeignKeyConstraint(
            ["configuration_id", "physical_object_id"],
            ["object_configurations.id", "object_configurations.physical_object_id"],
            name="fk_hardware_association_configuration_owner",
        ),
        sa.ForeignKeyConstraint(
            ["parent_installation_id", "configuration_id"],
            ["module_installations.id", "module_installations.configuration_id"],
            name="fk_hardware_association_parent_configuration",
        ),
    )
    for suffix, field in (("place", "bay_key"), ("key", "hardware_interface_key")):
        op.create_index(f"uq_hardware_association_{suffix}", table.name,
                        ["configuration_id", "parent_installation_id", field],
                        unique=True, postgresql_nulls_not_distinct=True)


def downgrade():
    checks = (
        "SELECT 1 FROM hardware_interface_associations",
        "SELECT 1 FROM module_bays WHERE hardware_interface_key IS NOT NULL",
        """SELECT 1 FROM module_template_revisions r, jsonb_array_elements(r.module_places) p
           WHERE p->>'hardware_interface_key' IS NOT NULL""",
        *(f"""SELECT 1 FROM {prefix}_template_{state} r,
              jsonb_array_elements(r.definition->'{places}') p
              WHERE p->>'hardware_interface_key' IS NOT NULL"""
          for prefix, places in (("base", "bays"), ("module", "module_places"))
          for state in ("drafts", "candidates")),
    )
    if any(op.get_bind().scalar(sa.text(query + " LIMIT 1")) for query in checks):
        raise RuntimeError("Downgrade would discard hardware interface declarations or associations")
    op.drop_table("hardware_interface_associations")
    op.drop_constraint("uq_object_configuration_owner", "object_configurations", type_="unique")
    op.drop_constraint("uq_interface_owner_object", "network_interface_physical_owners", type_="unique")
    op.drop_constraint(op.f("ck_module_bays_hardware_interface_requires_port"), "module_bays", type_="check")
    op.drop_constraint("uq_base_hardware_interface_key", "module_bays", type_="unique")
    op.drop_column("module_bays", "hardware_interface_key")
