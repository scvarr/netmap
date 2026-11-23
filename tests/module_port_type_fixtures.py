"""Catalog references for hardware authoring fixtures."""
from sqlalchemy import select

from app.database import SessionLocal
from app.models import ModuleBayType, ModulePortType


def ensure_module_port_type_id(name="OCP3"):
    return _ensure_mount_type_id(ModulePortType, name)


def ensure_module_bay_type_id(name="OCP3"):
    return _ensure_mount_type_id(ModuleBayType, name)


def _ensure_mount_type_id(model, name):
    with SessionLocal.begin() as session:
        item = session.scalar(select(model).where(model.name == name))
        if item is None:
            item = model(name=name, is_active=True)
            session.add(item)
            session.flush()
        return str(item.id)
