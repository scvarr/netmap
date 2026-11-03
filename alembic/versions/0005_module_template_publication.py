"""Publish frozen module candidates without changing existing objects."""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("module_template_revisions", sa.Column("name", sa.String(255), nullable=True))
    op.execute("UPDATE module_template_revisions r SET name = t.name FROM module_templates t WHERE r.template_id = t.id")
    op.alter_column("module_template_revisions", "name", nullable=False)
    op.create_table(
        "module_template_publications",
        sa.Column("id", sa.UUID(), sa.ForeignKey("module_template_candidates.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision_id", sa.UUID(), sa.ForeignKey("module_template_revisions.id", ondelete="CASCADE"), nullable=False, unique=True),
    )


def downgrade():
    op.drop_table("module_template_publications")
    op.drop_column("module_template_revisions", "name")
