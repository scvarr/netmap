"""Location presentation from canonical hierarchy, with explicit content-aware growth."""
PADDING = 20
HEADER = 40


def layout_location_frames(parents, saved, names=None):
    children = {key: [] for key in parents}
    roots = []
    for key, parent in parents.items():
        (children[parent] if parent in parents else roots).append(key)
    for values in [roots, *children.values()]:
        values.sort(key=str)
    result = {}

    def shift(key, dy):
        result[key]["y"] += dy
        for child in children[key]:
            shift(child, dy)

    def new_subtree(key):
        return key not in saved or any(new_subtree(child) for child in children[key])

    def place(key, x, y):
        g = dict(saved[key]) if key in saved else dict(x=x, y=y, width=max(140, min(360, 80 + len((names or {}).get(key, "")) * 7)), height=64, edge="right", offset=.5)
        result[key] = g
        cursor = max([g["y"] + HEADER, *(saved[c]["y"] + saved[c]["height"] + PADDING for c in children[key] if c in saved)])
        placed = []
        for child in children[key]:
            place(child, g["x"] + PADDING, cursor)
            c = result[child]
            if new_subtree(key):
                while True:
                    conflicts = [result[other] for other in placed if
                                 c["x"] < result[other]["x"] + result[other]["width"] + PADDING and
                                 c["x"] + c["width"] + PADDING > result[other]["x"] and
                                 c["y"] < result[other]["y"] + result[other]["height"] + PADDING and
                                 c["y"] + c["height"] + PADDING > result[other]["y"]]
                    if not conflicts:
                        break
                    shift(child, max(o["y"] + o["height"] + PADDING for o in conflicts) - c["y"])
            placed.append(child)
            cursor = max(cursor, c["y"] + c["height"] + PADDING)
            g["width"] = max(g["width"], c["x"] + c["width"] + PADDING - g["x"])
            g["height"] = max(g["height"], c["y"] + c["height"] + PADDING - g["y"])
    cursor = max([0, *(saved[r]["x"] + saved[r]["width"] + 40 for r in roots if r in saved)])
    for root in roots:
        place(root, cursor, 0)
        cursor = max(cursor, result[root]["x"] + result[root]["width"] + 40)
    return result


def contains(parent, child):
    return (child["x"] >= parent["x"] + PADDING - 1e-7 and
            child["y"] >= parent["y"] + HEADER - 1e-7 and
            child["x"] + child["width"] <= parent["x"] + parent["width"] - PADDING + 1e-7 and
            child["y"] + child["height"] <= parent["y"] + parent["height"] - PADDING + 1e-7)


def overlaps(a, b):
    return (a["x"] < b["x"] + b["width"] and a["x"] + a["width"] > b["x"] and
            a["y"] < b["y"] + b["height"] and a["y"] + a["height"] > b["y"])


def expand_location_frames(parents, frames, contents=None, *, protected=None, translations=None):
    """Grow ancestors without shrinking; push conflicting sibling containers down."""
    from app.errors import ValidationError
    from app.schemas import MapLocationGeometry
    from pydantic import ValidationError as SchemaValidationError
    result = {key: dict(g) for key, g in frames.items()}
    content = {key: [dict(g) for g in values] for key, values in (contents or {}).items()}
    children = {key: [] for key in parents}
    groups = {}
    for key, parent in parents.items():
        if parent in children:
            children[parent].append(key)
        groups.setdefault(parent, []).append(key)
    protected = set(protected or [])
    translations = translations if translations is not None else {}

    def expand(key):
        for child in children[key]:
            expand(child)
        g = result[key]
        for c in [*(result[child] for child in children[key]), *content.get(key, [])]:
            right = max(g["x"] + g["width"], c["x"] + c["width"] + PADDING)
            bottom = max(g["y"] + g["height"], c["y"] + c["height"] + PADDING)
            g["x"] = min(g["x"], c["x"] - PADDING)
            g["y"] = min(g["y"], c["y"] - HEADER)
            g["width"], g["height"] = right - g["x"], bottom - g["y"]
        try:
            MapLocationGeometry.model_validate(g)
        except SchemaValidationError as error:
            raise ValidationError("Expanded Location geometry must remain finite", {}) from error

    def shift(key, dy):
        result[key]["y"] += dy
        for g in content.get(key, []):
            g["y"] += dy
        dx0, dy0 = translations.get(key, (0, 0))
        translations[key] = (dx0, dy0 + dy)
        for child in children[key]:
            shift(child, dy)

    for _ in range(max(1, len(parents) ** 2 + 1)):
        for key, parent in parents.items():
            if parent not in parents:
                expand(key)
        conflict = None
        for siblings in groups.values():
            ordered = sorted(siblings, key=lambda key: (result[key]["y"], str(key)))
            for index, key in enumerate(ordered):
                for other in ordered[index + 1:]:
                    if overlaps(result[key], result[other]):
                        victim, obstacle = (key, other) if other in protected else (other, key)
                        if victim in protected:
                            raise ValidationError("Location geometry conflicts with a sibling", {"location_id": str(victim)})
                        conflict = victim, obstacle
                        break
                if conflict:
                    break
            if conflict:
                break
        if not conflict:
            return result
        victim, obstacle = conflict
        shift(victim, result[obstacle]["y"] + result[obstacle]["height"] + PADDING - result[victim]["y"])
    raise ValidationError("Location sibling expansion cannot be resolved safely", {})
