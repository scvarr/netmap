import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.errors import ModelError, ValidationError
from app.models import BlueprintPortBlockInstance, PortBlock, PortBlockPort, PortBlockVersion


@dataclass(frozen=True)
class CreatedPortBlock:
    port_block_id: uuid.UUID
    version_id: uuid.UUID


@dataclass(frozen=True)
class PortBlockListItem:
    port_block_id: uuid.UUID
    name: str
    version_id: uuid.UUID
    version_number: int
    port_count: int
    connection_point_count: int
    network_port_count: int
    version_count: int


@dataclass(frozen=True)
class PortBlockVersionDetail:
    port_block_id: uuid.UUID
    name: str
    version_id: uuid.UUID
    version_number: int
    ports: tuple[PortBlockPort, ...]

@dataclass(frozen=True)
class PortBlockVersionSummary:
    port_block_id: uuid.UUID; version_id: uuid.UUID; version_number: int; port_count: int


class PortBlockCatalog:
    """Library-only immutable Port Block snapshots; no topology materialization."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_initial_version(self, query: object) -> CreatedPortBlock:
        port_block = PortBlock(name=query.name)
        self.session.add(port_block)
        self.session.flush()
        version = self._create_version(port_block.id, 1, query)
        return CreatedPortBlock(port_block.id, version.id)

    def create_next_version(self, port_block_id: uuid.UUID, query: object) -> CreatedPortBlock:
        port_block = self.session.scalar(
            select(PortBlock).where(PortBlock.id == port_block_id).with_for_update()
        )
        if port_block is None:
            raise ValidationError("PortBlock was not found", {"port_block_id": str(port_block_id)})
        if query.port_block_name is not None:
            port_block.name = query.port_block_name
        current = self.session.scalar(
            select(func.max(PortBlockVersion.version_number)).where(
                PortBlockVersion.port_block_id == port_block_id
            )
        )
        version = self._create_version(port_block_id, (current or 0) + 1, query)
        return CreatedPortBlock(port_block_id, version.id)

    def list_port_blocks(self) -> tuple[PortBlockListItem, ...]:
        port_blocks = tuple(self.session.scalars(select(PortBlock).order_by(PortBlock.name, PortBlock.id)))
        items: list[PortBlockListItem] = []
        for port_block in port_blocks:
            version = self.session.scalar(
                select(PortBlockVersion)
                .where(PortBlockVersion.port_block_id == port_block.id)
                .order_by(PortBlockVersion.version_number.desc())
                .limit(1)
            )
            if version is None:
                continue
            counts_by_kind = dict(self.session.execute(
                select(PortBlockPort.kind, func.count())
                .where(PortBlockPort.port_block_version_id == version.id)
                .group_by(PortBlockPort.kind)
            ).all())
            items.append(PortBlockListItem(
                port_block_id=port_block.id,
                name=port_block.name,
                version_id=version.id,
                version_number=version.version_number,
                port_count=sum(counts_by_kind.values()),
                connection_point_count=counts_by_kind.get("CONNECTION_POINT", 0),
                network_port_count=counts_by_kind.get("NETWORK_PORT", 0),
                version_count=self.session.scalar(
                    select(func.count()).select_from(PortBlockVersion).where(
                        PortBlockVersion.port_block_id == port_block.id
                    )
                ) or 0,
            ))
        return tuple(items)

    def get_version_detail(self, port_block_id: uuid.UUID, version_id: uuid.UUID) -> PortBlockVersionDetail:
        port_block = self.session.get(PortBlock, port_block_id)
        version = self.session.get(PortBlockVersion, version_id)
        if port_block is None:
            raise ValidationError("PortBlock was not found", {"port_block_id": str(port_block_id)})
        if version is None or version.port_block_id != port_block_id:
            raise ValidationError(
                "PortBlockVersion does not belong to PortBlock",
                {"port_block_id": str(port_block_id), "version_id": str(version_id)},
            )
        ports = tuple(self.session.scalars(
            select(PortBlockPort)
            .where(PortBlockPort.port_block_version_id == version.id)
            .order_by(PortBlockPort.layout_order)
        ))
        return PortBlockVersionDetail(port_block.id, port_block.name, version.id, version.version_number, ports)

    def list_versions(self, port_block_id: uuid.UUID) -> tuple[PortBlockVersionSummary, ...]:
        if self.session.get(PortBlock, port_block_id) is None: raise ValidationError("PortBlock was not found", {"port_block_id": str(port_block_id)})
        return tuple(PortBlockVersionSummary(port_block_id, version.id, version.version_number, self.session.scalar(select(func.count()).select_from(PortBlockPort).where(PortBlockPort.port_block_version_id == version.id)) or 0) for version in self.session.scalars(select(PortBlockVersion).where(PortBlockVersion.port_block_id == port_block_id).order_by(PortBlockVersion.version_number)))

    def delete(self, port_block_id: uuid.UUID) -> None:
        port_block = self.session.scalar(
            select(PortBlock).where(PortBlock.id == port_block_id).with_for_update()
        )
        if port_block is None:
            raise ValidationError("PortBlock was not found", {"port_block_id": str(port_block_id)})
        version_ids = tuple(self.session.scalars(
            select(PortBlockVersion.id).where(PortBlockVersion.port_block_id == port_block.id)
        ))
        if version_ids and self.session.scalar(
            select(BlueprintPortBlockInstance.id)
            .where(BlueprintPortBlockInstance.port_block_version_id.in_(version_ids))
            .limit(1)
        ) is not None:
            raise ModelError(
                "PortBlock cannot be deleted because it is used by an ObjectBlueprint",
                {"reason": "PORT_BLOCK_IN_USE_BY_OBJECT_BLUEPRINT", "port_block_id": str(port_block_id)},
            )
        if version_ids:
            self.session.execute(delete(PortBlockPort).where(
                PortBlockPort.port_block_version_id.in_(version_ids)
            ))
            self.session.execute(delete(PortBlockVersion).where(
                PortBlockVersion.id.in_(version_ids)
            ))
        self.session.delete(port_block)

    def _create_version(self, port_block_id: uuid.UUID, version_number: int, query: object) -> PortBlockVersion:
        version = PortBlockVersion(port_block_id=port_block_id, version_number=version_number)
        self.session.add(version)
        self.session.flush()
        self.session.add_all(
            PortBlockPort(
                port_block_version_id=version.id,
                local_id=port.local_id,
                display_label=port.display_label,
                kind=port.kind,
                row=port.row,
                layout_column=port.column,
                layout_order=port.layout_order,
            )
            for port in query.ports
        )
        self.session.flush()
        return version
