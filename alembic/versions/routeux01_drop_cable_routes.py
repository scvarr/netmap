"""Remove per-Cable presentation routes."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "routeux01_drop_cable_routes"
down_revision = "autoloc01_layout"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("map_cable_routes")


def downgrade() -> None:
    # Restore the old schema only. Deleted route data cannot be recovered.
    op.create_table('map_cable_routes',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('map_id', sa.UUID(), nullable=False),
        sa.Column('variant_id', sa.UUID(), nullable=False),
        sa.Column('cable_id', sa.UUID(), nullable=False),
        sa.Column('view_key', sa.String(length=32), nullable=False),
        sa.Column('waypoints', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint("view_key = 'L1/PHYSICAL_OBJECT'", name=op.f('ck_map_cable_routes_map_cable_routes_view_key_physical_only')),
        sa.ForeignKeyConstraint(['cable_id'], ['cables.id'], name=op.f('fk_map_cable_routes_cable_id_cables'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['map_id'], ['saved_maps.id'], name=op.f('fk_map_cable_routes_map_id_saved_maps'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['variant_id'], ['map_presentation_variants.id'], name=op.f('fk_map_cable_routes_variant_id_map_presentation_variants'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_map_cable_routes')),
        sa.UniqueConstraint('variant_id', 'cable_id', 'view_key', name='uq_map_cable_routes_variant_cable_view')
    )
    op.create_index('ix_map_cable_routes_cable_id', 'map_cable_routes', ['cable_id'], unique=False)
