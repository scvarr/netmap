"""Persist panel-local module installation presentation."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def initial_layout(bay, geometry, orientation, panel):
    width, height = geometry["width"], geometry["height"]
    if orientation == "VERTICAL":
        width, height = height, width
    scale = min(bay["width"] * panel["width"] / width, bay["height"] * panel["height"] / height)
    w, h = width * scale / panel["width"], height * scale / panel["height"]
    return {"panel_key": bay["panel_key"], "x": bay["x"] + (bay["width"] - w) / 2,
            "y": bay["y"] + (bay["height"] - h) / 2, "width": w, "height": h}


def upgrade():
    op.add_column("module_installations", sa.Column("layout", JSONB(), nullable=True))
    connection = op.get_bind()
    table = sa.table("module_installations", sa.column("id", sa.UUID()), sa.column("layout", JSONB()))
    rows = connection.execute(sa.text("""SELECT i.id, i.orientation, r.geometry, b.panel_key,
        b.x, b.y, b.width, b.height, p.width AS panel_width, p.height AS panel_height
        FROM module_installations i JOIN object_configurations c ON c.id=i.configuration_id
        JOIN module_template_revisions r ON r.id=i.module_revision_id
        JOIN module_bays b ON b.base_revision_id=c.base_revision_id AND b.bay_key=i.bay_key
        JOIN presentation_panels p ON p.base_revision_id=c.base_revision_id AND p.panel_key=b.panel_key""")).mappings().all()
    for row in rows:
        layout = initial_layout(row, row["geometry"], row["orientation"], {"width": row["panel_width"], "height": row["panel_height"]})
        connection.execute(table.update().where(table.c.id == row["id"]).values(layout=layout))
    op.alter_column("module_installations", "layout", nullable=False)


def downgrade():
    raise RuntimeError("Cannot discard saved configuration layout")
