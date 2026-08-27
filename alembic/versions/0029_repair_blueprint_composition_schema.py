"""Repair schema drift in Blueprint Port Block composition migrations.

Revision ID: 0029_repair_blueprint_composition_schema
Revises: 0028_blueprint_port_block_instance_face
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0029_repair_blueprint_composition_schema"
down_revision: str | None = "0028_blueprint_port_block_instance_face"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_column(table_name: str, column_name: str) -> bool:
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_primary_key(table_name: str, columns: tuple[str, ...]) -> bool:
    primary_key = _inspector().get_pk_constraint(table_name)
    return tuple(primary_key.get("constrained_columns") or ()) == columns


def _has_foreign_key(
    table_name: str,
    columns: tuple[str, ...],
    referred_table: str,
    referred_columns: tuple[str, ...],
) -> bool:
    for foreign_key in _inspector().get_foreign_keys(table_name):
        if (
            tuple(foreign_key["constrained_columns"]) == columns
            and foreign_key["referred_table"] == referred_table
            and tuple(foreign_key["referred_columns"]) == referred_columns
            and foreign_key.get("options", {}).get("ondelete", "").upper() == "RESTRICT"
        ):
            return True
    return False


def _has_unique_constraint(table_name: str, columns: tuple[str, ...]) -> bool:
    return any(
        tuple(constraint["column_names"]) == columns
        for constraint in _inspector().get_unique_constraints(table_name)
    )


def _has_check_constraint(table_name: str, *required_fragments: str) -> bool:
    return any(
        all(fragment in "".join(str(constraint.get("sqltext") or "").lower().split()) for fragment in required_fragments)
        for constraint in _inspector().get_check_constraints(table_name)
    )


def _repair_port_block_instances() -> None:
    if not _inspector().has_table("blueprint_port_block_instances"):
        op.create_table(
            "blueprint_port_block_instances",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("blueprint_version_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("port_block_version_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("instance_key", sa.String(length=255), nullable=False),
            sa.CheckConstraint("char_length(btrim(instance_key)) > 0", name="instance_key_not_blank"),
            sa.ForeignKeyConstraint(["blueprint_version_id"], ["object_blueprint_versions.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["port_block_version_id"], ["port_block_versions.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("blueprint_version_id", "instance_key", name="uq_blueprint_block_instance_key"),
        )
        return

    required_columns = (
        ("id", postgresql.UUID(as_uuid=True)),
        ("blueprint_version_id", postgresql.UUID(as_uuid=True)),
        ("port_block_version_id", postgresql.UUID(as_uuid=True)),
        ("instance_key", sa.String(length=255)),
    )
    for column_name, column_type in required_columns:
        if not _has_column("blueprint_port_block_instances", column_name):
            op.add_column("blueprint_port_block_instances", sa.Column(column_name, column_type, nullable=False))

    if not _has_primary_key("blueprint_port_block_instances", ("id",)):
        op.create_primary_key("pk_blueprint_port_block_instances", "blueprint_port_block_instances", ["id"])
    if not _has_check_constraint("blueprint_port_block_instances", "char_length", "btrim", "instance_key"):
        op.create_check_constraint("instance_key_not_blank", "blueprint_port_block_instances", "char_length(btrim(instance_key)) > 0")
    if not _has_foreign_key("blueprint_port_block_instances", ("blueprint_version_id",), "object_blueprint_versions", ("id",)):
        op.create_foreign_key(None, "blueprint_port_block_instances", "object_blueprint_versions", ["blueprint_version_id"], ["id"], ondelete="RESTRICT")
    if not _has_foreign_key("blueprint_port_block_instances", ("port_block_version_id",), "port_block_versions", ("id",)):
        op.create_foreign_key(None, "blueprint_port_block_instances", "port_block_versions", ["port_block_version_id"], ["id"], ondelete="RESTRICT")
    if not _has_unique_constraint("blueprint_port_block_instances", ("blueprint_version_id", "instance_key")):
        op.create_unique_constraint("uq_blueprint_block_instance_key", "blueprint_port_block_instances", ["blueprint_version_id", "instance_key"])


def _repair_endpoint_slots() -> None:
    if not _has_column("blueprint_endpoint_slots", "port_block_instance_id"):
        op.add_column("blueprint_endpoint_slots", sa.Column("port_block_instance_id", postgresql.UUID(as_uuid=True), nullable=True))
    if not _has_column("blueprint_endpoint_slots", "port_block_local_id"):
        op.add_column("blueprint_endpoint_slots", sa.Column("port_block_local_id", sa.String(length=255), nullable=True))
    if not _has_foreign_key("blueprint_endpoint_slots", ("port_block_instance_id",), "blueprint_port_block_instances", ("id",)):
        op.create_foreign_key("fk_blueprint_slot_block_instance", "blueprint_endpoint_slots", "blueprint_port_block_instances", ["port_block_instance_id"], ["id"], ondelete="RESTRICT")
    if not _has_unique_constraint("blueprint_endpoint_slots", ("port_block_instance_id", "port_block_local_id")):
        op.create_unique_constraint("uq_blueprint_slot_block_local_id", "blueprint_endpoint_slots", ["port_block_instance_id", "port_block_local_id"])


def _repair_face() -> None:
    if not _has_column("blueprint_port_block_instances", "face"):
        op.add_column("blueprint_port_block_instances", sa.Column("face", sa.String(length=8), nullable=True))
    if not _has_check_constraint("blueprint_port_block_instances", "face", "front", "rear"):
        op.create_check_constraint(
            "ck_blueprint_port_block_instances_face_supported",
            "blueprint_port_block_instances",
            "face IN ('FRONT', 'REAR')",
        )


def upgrade() -> None:
    """Restore only 0027/0028 objects absent from a database stamped at 0028."""
    if not _has_column("object_blueprint_versions", "composition_kind"):
        op.add_column("object_blueprint_versions", sa.Column("composition_kind", sa.String(length=32), nullable=True))
    _repair_port_block_instances()
    _repair_endpoint_slots()
    _repair_face()


def downgrade() -> None:
    # This migration only restores the already-authoritative 0027/0028 contract.
    # Downgrading must not remove that contract from a repaired database.
    pass
