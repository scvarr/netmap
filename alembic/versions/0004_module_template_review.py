"""Persist module template drafts and frozen review candidates."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("module_template_drafts", "module_template_candidates"):
        columns = [
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("template_id", sa.UUID(), sa.ForeignKey("module_templates.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_revision_id", sa.UUID(), sa.ForeignKey("module_template_revisions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("definition", postgresql.JSONB(), nullable=False),
        ]
        if name == "module_template_drafts":
            columns.extend([sa.Column("generation", sa.Integer(), nullable=False), sa.UniqueConstraint("template_id")])
        else:
            columns.extend([
                sa.Column("draft_generation", sa.Integer(), nullable=False),
                sa.Column("result", postgresql.JSONB(), nullable=False),
                sa.Column("input_fingerprint", sa.String(64), nullable=False),
                sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            ])
        op.create_table(name, *columns)


def downgrade():
    op.drop_table("module_template_candidates")
    op.drop_table("module_template_drafts")
