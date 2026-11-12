"""Presentation layout from canonical parent IDs, never equipment bounds."""
PADDING = 20
HEADER = 40


def layout_location_frames(parents, saved):
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
        g = dict(saved[key]) if key in saved else dict(x=x, y=y, width=300, height=200, edge="right", offset=.5)
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
