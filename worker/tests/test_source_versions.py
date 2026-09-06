from pathlib import Path
from benchly.db import open_database
from benchly.sources.models import SourceProbe
from benchly.sources.repository import prepare_source_status, save_probe


def test_source_probe_upsert_is_typed_and_replaces_version(tmp_path: Path):
    path = tmp_path / "source-status.sqlite"
    database = open_database(path)
    prepare_source_status(database)
    first = SourceProbe(
        source_id="sonbase",
        url="https://example.test/sonbase",
        checked_at="2026-01-01T00:00:00Z",
        status_code=200,
        fingerprint="a" * 64,
    )
    second = first.model_copy(update={"checked_at": "2026-02-01T00:00:00Z", "fingerprint": "b" * 64})
    save_probe(database, first)
    save_probe(database, second)

    row = database.execute("SELECT checked_at, fingerprint FROM external_source_versions WHERE source_id=?", ("sonbase",)).fetchone()
    database.close()
    assert row["checked_at"] == second.checked_at
    assert row["fingerprint"] == second.fingerprint
