"""Catalog references for hardware authoring fixtures."""
from sqlalchemy import select

from app.database import SessionLocal
from app.models import ModulePortType


def ensure_module_port_type_id(name="OCP3"):
    with SessionLocal.begin() as session:
        item = session.scalar(select(ModulePortType).where(ModulePortType.name == name))
        if item is None:
            item = ModulePortType(name=name, is_active=True)
            session.add(item)
            session.flush()
        return str(item.id)
