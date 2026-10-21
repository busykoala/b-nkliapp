"""Repainting must notice changed artwork while retaining extracted geography."""
from pathlib import Path
import shutil

import pytest

from benchly.panorama import builder, identity


@pytest.mark.parametrize("changed", ["assets/foliage-masses-pigment.png", "facades.py"])
def test_changed_paint_input_invalidates_images_but_keeps_geometry(tmp_path, monkeypatch, changed):
    source = tmp_path / "source"
    shutil.copytree(Path(identity.__file__).parent, source,
                    ignore=shutil.ignore_patterns("__pycache__"))
    monkeypatch.setattr(identity, "__file__", str(source / "identity.py"))
    root = tmp_path / "generation"
    state = builder._open_state(root)
    state.execute("""INSERT INTO artifacts VALUES(
        'fixture','bench','cell','image','image.webp','old-image',10,20,'ready','2026-01-01')""")
    state.execute("""INSERT INTO extractions(
        bench_id,bench_row_id,latitude,longitude,input_key,status)
        VALUES('bench',1,47,8,'geographic-source','ready')""")
    state.commit()
    previous_key = state.execute("SELECT value FROM metadata WHERE key='artifact_implementation'").fetchone()[0]
    state.close()

    # Hashing is independent of image decoding; mutate only the temporary copy.
    path = source / changed
    path.write_bytes(path.read_bytes() + b"different reviewed paint input")
    state = builder._open_state(root)
    try:
        assert state.execute("SELECT value FROM metadata WHERE key='artifact_implementation'").fetchone()[0] != previous_key
        assert state.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 0
        assert state.execute("SELECT input_key FROM extractions WHERE bench_id='bench'").fetchone()[0] == "geographic-source"
    finally:
        state.close()
