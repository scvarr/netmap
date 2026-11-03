"""Deterministic extension of historical module definitions at storage boundaries."""
import copy


def initial_geometry(keys):
    keys = list(keys)
    return {"width": 240.0, "height": 80.0, "fill_color": "#64748b",
            "endpoints": {key: {"x": (i + 1) / (len(keys) + 1), "y": 0.5} for i, key in enumerate(keys)}}


def extend_definition(definition):
    result = copy.deepcopy(definition)
    result["geometry"] = initial_geometry(e["key"] for e in result["endpoints"])
    return result
