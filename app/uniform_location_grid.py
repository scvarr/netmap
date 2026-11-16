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
