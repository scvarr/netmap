"""Add panel faces and variant-specific L1 face settings."""

import sqlalchemy as sa
from alembic import op

revision = "faceview01_faces"
down_revision = "routeux01_drop_cable_routes"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("presentation_panels", "face", "face_valid", "face IN ('FRONT', 'REAR')"),
    ("map_presentation_variants", "default_face", "default_face_valid", "default_face IN ('FRONT', 'REAR')"),
    ("map_location_states", "face_override", "face_override_valid", "face_override IN ('FRONT', 'REAR')"),
    ("map_view_positions", "face_override", "face_override_valid",
     "face_override IS NULL OR (view_key = 'L1/PHYSICAL_OBJECT' AND face_override IN ('FRONT', 'REAR'))"),
)


def upgrade() -> None:
    for table, column, constraint, condition in _COLUMNS:
        default = column == "default_face"
        op.add_column(table, sa.Column(column, sa.String(5), nullable=not default,
                                       server_default="FRONT" if default else None))
        op.create_check_constraint(constraint, table, condition)


def downgrade() -> None:
    for table, column, constraint, _ in reversed(_COLUMNS):
        op.drop_constraint(constraint, table, type_="check")
        op.drop_column(table, column)
