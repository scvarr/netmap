from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import uuid
from dataclasses import asdict, dataclass

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import Base, SessionLocal
from app.models import (BlueprintEndpointSlot, BlueprintInstance, BlueprintInstanceSlot,
    BlueprintInternalLink, Connection, ConnectionMember, ConnectionPoint, EntityMetadata,
    MapPlacement, MapViewKey, MapViewPosition, ObjectBlueprint, ObjectBlueprintVersion,
    PhysicalObject, SavedMap)
from perf.safety import require_confirmed_perf_database

NAMESPACE = uuid.UUID("703fcd59-f55a-4ddc-8593-902761a8f1a2")

@dataclass(frozen=True)
class Profile:
    objects: int
    ports: int
    connections: int
    maps: int

PROFILES = {"small": Profile(100, 800, 150, 2), "medium": Profile(500, 4000, 700, 3),
            "port_heavy": Profile(500, 20000, 1500, 2), "large": Profile(1000, 40000, 3000, 4)}

def stable_id(seed: int, *parts: object) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, ":".join(map(str, (seed, *parts))))

def port_plan(profile: Profile) -> list[int]:
    """Exact target CP count using 0/4/24/48 blueprint instance shapes."""
    # Keep 24-port shapes first so the first deterministic objects can become
    # patch panels without changing the requested total.
    recipes = {(100, 800): (0, 20, 80), (500, 4000): (0, 100, 400),
               (500, 20000): (400, 25, 50), (1000, 40000): (783, 100, 3)}
    switches48, ports24, ports4 = recipes[(profile.objects, profile.ports)]
    return [24] * ports24 + [48] * switches48 + [4] * ports4 + [0] * (profile.objects - switches48 - ports24 - ports4)

def reset(session: Session) -> None:
    require_confirmed_perf_database()
    # Migrations are applied by compose; TRUNCATE is deliberately guarded above.
    session.execute(text("TRUNCATE TABLE " + ", ".join(table.name for table in reversed(Base.metadata.sorted_tables)) + " RESTART IDENTITY CASCADE"))

def create_blueprint(session: Session, seed: int, ports: int, patch: bool = False) -> tuple[ObjectBlueprintVersion, list[BlueprintEndpointSlot]]:
    name = ("patch-panel" if patch else "switch") + f"-{ports}" if ports else "blank-0"
    blueprint = ObjectBlueprint(id=stable_id(seed, "blueprint", name), name=name)
    version = ObjectBlueprintVersion(id=stable_id(seed, "version", name), blueprint_id=blueprint.id, version_number=1,
        default_physical_object_class="patch_panel" if patch else "switch", body_kind="RECTANGLE", width=212, height=144, fill_color="#365B8C", authoring_recipe={"perf": True})
    session.add_all([blueprint, version])
    session.flush()
    slots = [BlueprintEndpointSlot(id=stable_id(seed, "slot", name, i), blueprint_version_id=version.id,
        slot_key=f"port:{i:02d}", display_name=f"{i:02d}", kind="CONNECTION_POINT" if patch else "NETWORK_PORT",
        anchor_side="LEFT" if i % 2 else "RIGHT", anchor_offset=(i + 1) / (ports + 1)) for i in range(ports)]
    session.add_all(slots); session.flush()
    if patch:
        session.add_all(BlueprintInternalLink(id=stable_id(seed, "internal", name, i), blueprint_version_id=version.id, slot_a_id=slots[i].id, slot_b_id=slots[i + 1].id) for i in range(0, ports, 2))
    return version, slots

def generate(profile_name: str, seed: int) -> dict[str, int]:
    require_confirmed_perf_database()
    profile = PROFILES[profile_name]; random.Random(seed)  # explicit seed contract; IDs/order never depend on process randomness.
    with SessionLocal.begin() as session:
        reset(session)
        blueprints = {0: create_blueprint(session, seed, 0), 4: create_blueprint(session, seed, 4), 24: create_blueprint(session, seed, 24), 48: create_blueprint(session, seed, 48)}
        # A deterministic subset uses real patch panels with materialized internal pairs.
        plan = port_plan(profile)
        patch_count = min(profile.connections // 12, plan.count(24))
        patch_version, patch_slots = create_blueprint(session, seed, 24, patch=True)
        objects: list[PhysicalObject] = []; cps: list[ConnectionPoint] = []; connections: list[Connection] = []
        available: list[ConnectionPoint] = []
        for index, port_count in enumerate(plan):
            obj = PhysicalObject(id=stable_id(seed, "object", index)); objects.append(obj)
            session.add(obj)
            session.flush()
            session.add(EntityMetadata(id=stable_id(seed, "metadata", index), physical_object_id=obj.id, key="alias.display", value=f"PERF-{index:04d}"))
            version, slots = (patch_version, patch_slots) if index < patch_count else blueprints[port_count]
            instance = BlueprintInstance(id=stable_id(seed, "instance", index), blueprint_version_id=version.id, physical_object_id=obj.id)
            session.add(instance)
            session.flush()
            local_cps = []
            for port_index, slot in enumerate(slots):
                cp = ConnectionPoint(id=stable_id(seed, "cp", index, port_index), physical_object_id=obj.id, cardinality=1)
                cps.append(cp); local_cps.append(cp); available.append(cp)
                session.add(cp)
            session.flush()
            session.add_all(BlueprintInstanceSlot(id=stable_id(seed, "instance-slot", index, port_index), blueprint_instance_id=instance.id, blueprint_slot_id=slot.id, connection_point_id=cp.id) for port_index, (slot, cp) in enumerate(zip(slots, local_cps)))
            if index < patch_count:
                for pair in range(0, len(local_cps), 2):
                    conn = Connection(id=stable_id(seed, "connection", "internal", index, pair), point_a_id=local_cps[pair].id, point_b_id=local_cps[pair+1].id, cardinality=1)
                    connections.append(conn); session.add_all([conn, ConnectionMember(id=stable_id(seed, "member", "internal", index, pair), connection_id=conn.id, index=1, point_a_member=1, point_b_member=1)])
        # Ring then deterministic stars; separate CP pairs make the topology stable and canonical.
        external = profile.connections - len(connections)
        candidates = available[patch_count * 24:]
        for index in range(external):
            left = candidates[(index * 2) % len(candidates)]; right = candidates[(index * 2 + 1 + (index % 11 == 0)) % len(candidates)]
            if left.id == right.id: right = candidates[(index * 2 + 2) % len(candidates)]
            conn = Connection(id=stable_id(seed, "connection", "external", index), point_a_id=left.id, point_b_id=right.id, cardinality=1)
            connections.append(conn); session.add_all([conn, ConnectionMember(id=stable_id(seed, "member", "external", index), connection_id=conn.id, index=1, point_a_member=1, point_b_member=1)])
        maps = []
        for map_index in range(profile.maps):
            saved = SavedMap(id=stable_id(seed, "map", map_index), name=f"PERF {profile_name} {map_index + 1}"); maps.append(saved); session.add(saved)
            for object_index, obj in enumerate(objects):
                if object_index % profile.maps != map_index: continue
                placement = MapPlacement(id=stable_id(seed, "placement", map_index, object_index), map_id=saved.id, physical_object_id=obj.id)
                session.add_all([placement, MapViewPosition(id=stable_id(seed, "pos", map_index, object_index, "l1"), placement_id=placement.id, view_key=MapViewKey.PHYSICAL, x=float((object_index % 20) * 300), y=float((object_index // 20) * 220), locked=False), MapViewPosition(id=stable_id(seed, "pos", map_index, object_index, "l2"), placement_id=placement.id, view_key=MapViewKey.LOGICAL, x=float((object_index % 20) * 300), y=float((object_index // 20) * 220), locked=False)])
    with SessionLocal() as session:
        result = {"physical_objects": session.scalar(select(func.count()).select_from(PhysicalObject)) or 0, "connection_points": session.scalar(select(func.count()).select_from(ConnectionPoint)) or 0, "connections": session.scalar(select(func.count()).select_from(Connection)) or 0, "saved_maps": session.scalar(select(func.count()).select_from(SavedMap)) or 0, "map_memberships": session.scalar(select(func.count()).select_from(MapPlacement)) or 0}
        if result["physical_objects"] != profile.objects or result["connection_points"] != profile.ports or result["connections"] != profile.connections: raise RuntimeError(f"canonical invariant/count failure: {result}")
        return result

def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("profile", choices=PROFILES); parser.add_argument("--seed", type=int, default=20260826); args = parser.parse_args()
    print(json.dumps({"profile": args.profile, "seed": args.seed, "counts": generate(args.profile, args.seed)}, indent=2))

if __name__ == "__main__": main()
