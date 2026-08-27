"""Add presentation face to immutable Blueprint Port Block instances.

Revision ID: 0028_blueprint_port_block_instance_face
Revises: 0027_blueprint_port_block_composition
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_blueprint_port_block_instance_face"
down_revision: str | None = "0027_blueprint_port_block_composition"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NULL intentionally retains pre-face immutable provenance; readers use FRONT.
    op.add_column("blueprint_port_block_instances", sa.Column("face", sa.String(length=8), nullable=True))
    op.create_check_constraint(
        "ck_blueprint_port_block_instances_face_supported",
        "blueprint_port_block_instances",
        "face IN ('FRONT', 'REAR')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_blueprint_port_block_instances_face_supported", "blueprint_port_block_instances", type_="check")
    op.drop_column("blueprint_port_block_instances", "face")
