"""Add immutable module geometry, preserving historical review definitions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("module_template_revisions", sa.Column("geometry", JSONB(), nullable=True))
    # Freeze the historical extension algorithm in this migration.
    connection = op.get_bind()
    def geometry(keys):
        return {"width": 240.0, "height": 80.0, "fill_color": "#64748b", "endpoints": {
            key: {"x": (i + 1) / (len(keys) + 1), "y": 0.5} for i, key in enumerate(keys)}}
    revisions = sa.table("module_template_revisions", sa.column("id", sa.UUID()), sa.column("geometry", JSONB()))
    for revision_id in connection.execute(sa.text("SELECT id FROM module_template_revisions")).scalars():
        keys = list(connection.execute(sa.text("SELECT definition_key FROM module_endpoint_definitions WHERE module_revision_id = :id ORDER BY order_index"), {"id": revision_id}).scalars())
        connection.execute(revisions.update().where(revisions.c.id == revision_id).values(geometry=geometry(keys)))
    for name in ("module_template_drafts", "module_template_candidates"):
        table = sa.table(name, sa.column("id", sa.UUID()), sa.column("definition", JSONB()))
        for row in connection.execute(sa.select(table)).mappings():
            definition = dict(row["definition"])
            definition["geometry"] = geometry([e["key"] for e in definition["endpoints"]])
            connection.execute(table.update().where(table.c.id == row["id"]).values(definition=definition))
    op.alter_column("module_template_revisions", "geometry", nullable=False)


def downgrade():
    raise RuntimeError("Module geometry cannot be removed without losing immutable history")
