"""BaseTemplate multichannel definitions; existing definitions remain 1:1."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "ccap0101_multichannel"
down_revision = "pt02_port_type_assignment"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("built_in_endpoint_definitions", sa.Column("cardinality", sa.Integer(), nullable=False, server_default="1"))
    op.create_check_constraint("endpoint_cardinality", "built_in_endpoint_definitions", "cardinality >= 1 AND (kind <> 'NETWORK_PORT' OR cardinality = 1)")
    op.add_column("base_internal_links", sa.Column("member_mappings", JSONB(), nullable=False, server_default='[{"from_member_index":1,"to_member_index":1}]'))


def downgrade():
    op.drop_column("base_internal_links", "member_mappings")
    op.drop_constraint("endpoint_cardinality", "built_in_endpoint_definitions", type_="check")
    op.drop_column("built_in_endpoint_definitions", "cardinality")
