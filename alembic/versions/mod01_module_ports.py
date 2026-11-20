"""Store module port definitions in immutable ModuleTemplate revisions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "mod01_module_ports"
down_revision = "catd02_single_line_cables"


def upgrade():
    op.add_column("module_template_revisions", sa.Column(
        "module_ports", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb"),
    ))


def downgrade():
    op.drop_column("module_template_revisions", "module_ports")
