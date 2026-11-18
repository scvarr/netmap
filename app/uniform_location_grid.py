"""Presentation tables reference only canonical direct children."""
def validate_grid(settings, parents):
    seen = set()
    for parent, rows in settings["tables"].items():
        if parent != "root" and parent not in parents:
            raise ValueError("Unknown grid parent")
        for row in rows:
            for child in row:
                if child is None:
                    continue
                if child in seen or parents.get(child) != parent:
                    raise ValueError("Duplicate or foreign grid Location")
                seen.add(child)
                ancestors = {child}
                current = parent
                while current != "root":
                    if current in ancestors:
                        raise ValueError("Cyclic grid hierarchy")
                    ancestors.add(current)
                    current = parents[current]


def reconcile_grid(settings, parents):
    """Keep surviving cell addresses; reconcile only after canonical writes.

    User writes still go through validate_grid without this normalization.
    """
    from copy import deepcopy
    result = deepcopy(settings)
    tables = {}
    for parent in ["root", *sorted(parents)]:
        seen = set()
        rows = []
        for row in settings["tables"].get(parent, []):
            cells = []
            for child in row:
                if child is not None and parents.get(child) == parent and child not in seen:
                    seen.add(child)
                    cells.append(child)
                else:
                    cells.append(None)
            rows.append(cells)
        for child in sorted(parents):
            if parents[child] != parent or child in seen:
                continue
            for row in rows:
                if None in row:
                    row[row.index(None)] = child
                    break
            else:
                rows.append([child])
        tables[parent] = rows
    result["tables"] = tables
    if "object_sequences" in result:
        result["object_sequences"] = {
            parent: entry for parent, entry in result["object_sequences"].items()
            if parent == "root" or parent in parents
        }
        if not result["object_sequences"]:
            del result["object_sequences"]
    return result


def validate_object_sequences(settings, parents, assignments):
    for parent, entry in settings.get("object_sequences", {}).items():
        if parent != "root" and parent not in parents:
            raise ValueError("Unknown grid object container")
        order = entry["order"]
        if len(order) != len(set(order)) or any(assignments.get(key) != parent for key in order):
            raise ValueError("Duplicate or foreign grid PhysicalObject")


def reconcile_object_sequences(settings, assignments):
    direct = {}
    for key, parent in sorted(assignments.items()):
        direct.setdefault(parent, []).append(key)
    saved = settings.get("object_sequences", {})
    sequences = {}
    for parent in sorted(saved.keys() | direct.keys()):
        entry = saved.get(parent, {"direction": "VERTICAL", "order": []})
        remaining = dict.fromkeys(direct.get(parent, []))
        order = []
        for key in entry["order"]:
            if key in remaining:
                order.append(key)
                del remaining[key]
        sequences[parent] = {"direction": entry["direction"], "order": order + list(remaining)}
    return {**settings, "object_sequences": sequences} if sequences else settings
