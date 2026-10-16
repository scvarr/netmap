"""Publish frozen base candidates without changing existing objects."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("base_template_revisions", sa.Column("name", sa.String(255), nullable=True))
    op.execute("UPDATE base_template_revisions r SET name = t.name FROM base_templates t WHERE r.template_id = t.id")
    op.alter_column("base_template_revisions", "name", nullable=False)
    op.create_table(
        "base_template_publications",
        sa.Column("id", sa.UUID(), sa.ForeignKey("base_template_candidates.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision_id", sa.UUID(), sa.ForeignKey("base_template_revisions.id", ondelete="CASCADE"), nullable=False, unique=True),
    )


def downgrade():
    op.drop_table("base_template_publications")
    op.drop_column("base_template_revisions", "name")
