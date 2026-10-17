# Workspace 09.6-C archive

`workspace_09_6_c_v5.json` is actual, unmodified JSON from the exporter at
main commit `1e73331921e08ca6992a9c1bff3a6a7e7f8f4726`, schema `0002`.
It contains synthetic test data only. Generated on 2026-10-17 in the isolated
Docker project `netmap-c-archive-fixture`, using an archive of that commit;
the working branch and user database were not switched or reset.

Generation inside the baseline backend container, after normal Alembic startup:

```python
import json
from pathlib import Path
from tests.test_workspace_portability import create_graph, snapshot
from tests.test_base_template_review import open_draft, save, check

create_graph()
template_id = snapshot()["authoring"]["BaseTemplate"][0]["id"]
draft = open_draft(template_id)
saved = save(template_id, draft, {
    **draft["definition"],
    "name": "09.6-C saved draft, not the published name",
})
check(template_id, saved)
Path("/tmp/workspace_09_6_c_v5.json").write_text(
    json.dumps(snapshot(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
)
```

The saved draft/candidate name deliberately differs from the published root
name. Tests must recover the revision name from its BaseTemplate, while
preserving those immutable review snapshots, canonical IDs, ObjectConfiguration,
connected Cable, SavedMap, placements/routes/annotation and settings exactly.
Do not regenerate this fixture with the current exporter or simulate it by
removing fields from a D1 package.
