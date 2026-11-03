"""Bounded compare-and-set of installation presentation; caller owns transaction."""
from sqlalchemy import select, text
from app import models as m
from app.errors import ModelError, ValidationError
from app.module_layout import validate_layout


def save_layout(session, object_id, installation_id, query):
    session.execute(text("SET LOCAL lock_timeout = '5s'"))
    obj = session.scalar(select(m.PhysicalObject).where(m.PhysicalObject.id == object_id).with_for_update())
    if obj is None:
        raise ValidationError("PhysicalObject was not found")
    config = session.scalar(select(m.ObjectConfiguration).where(m.ObjectConfiguration.physical_object_id == object_id).with_for_update())
    installation = session.scalar(select(m.ModuleInstallation).where(m.ModuleInstallation.id == installation_id,
        m.ModuleInstallation.configuration_id == config.id).with_for_update()) if config else None
    if installation is None:
        raise ValidationError("Установка не принадлежит конфигурации объекта")
    for reason, actual, expected in (
        ("CONFIGURATION_CHANGED", (config.id, config.base_revision_id), (query.configuration_id, query.base_revision_id)),
        ("MODULE_REVISION_CHANGED", installation.module_revision_id, query.module_revision_id),
        ("MODULE_BAY_CHANGED", (installation.bay_key, installation.orientation), (query.bay_key, query.orientation)),
        ("MODULE_LAYOUT_CHANGED", installation.layout, query.expected_layout.model_dump()),
    ):
        if actual != expected:
            raise ModelError("Конфигурация или компоновка изменена другой сессией. Отмените правки и обновите объект.", {"reason": reason})
    bay = session.scalar(select(m.ModuleBay).where(m.ModuleBay.base_revision_id == config.base_revision_id, m.ModuleBay.bay_key == installation.bay_key))
    layout = query.layout.model_dump()
    try:
        validate_layout(layout, bay.panel_key)
    except ValueError as error:
        raise ValidationError(str(error)) from error
    if installation.layout != layout:
        installation.layout = layout
        session.flush()
