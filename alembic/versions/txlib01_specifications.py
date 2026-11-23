"""Store transceiver specifications on immutable module revisions."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "txlib01_specifications"
down_revision = "mod02a_nested_installations"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("module_template_revisions", sa.Column("transceiver", JSONB(), nullable=True))


def downgrade():
    if op.get_bind().scalar(sa.text("""
        SELECT EXISTS (SELECT 1 FROM module_template_revisions WHERE transceiver IS NOT NULL)
            OR EXISTS (SELECT 1 FROM module_template_drafts WHERE definition ->> 'transceiver' IS NOT NULL)
            OR EXISTS (SELECT 1 FROM module_template_candidates WHERE definition ->> 'transceiver' IS NOT NULL)
    """)):
        raise RuntimeError("Downgrade would discard transceiver definitions")
    op.drop_column("module_template_revisions", "transceiver")
