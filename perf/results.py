from __future__ import annotations

import json
from pathlib import Path

IDENTITY_FIELDS = ("commit_sha", "profile", "seed", "mode", "dataset_counts")


def merge_shards(paths: list[Path]) -> dict[str, object]:
    if not paths:
        raise ValueError("at least one shard is required")
    shards = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    first = shards[0]
    for shard in shards[1:]:
        if any(shard[field] != first[field] for field in IDENTITY_FIELDS):
            raise ValueError("benchmark shard identity mismatch")
    metrics = [metric for shard in shards for metric in shard["metrics"]]
    names = [metric["metric"] for metric in metrics]
    if len(names) != len(set(names)):
        raise ValueError("duplicate benchmark metric")
    return {**{field: first[field] for field in IDENTITY_FIELDS}, "environment": first["environment"], "metrics": metrics}


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument("shards", nargs="+", type=Path); parser.add_argument("--output", required=True, type=Path); args = parser.parse_args()
    args.output.write_text(json.dumps(merge_shards(args.shards), indent=2), encoding="utf-8")


if __name__ == "__main__": main()
