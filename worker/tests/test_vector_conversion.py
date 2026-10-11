import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from unittest.mock import patch

import pytest

from benchly.context.importer import import_swissbuildings_gdb


@pytest.mark.skipif(shutil.which("ogr2ogr") is None, reason="GDAL integration runs in the worker test container")
def test_building_tin_keeps_footprint_and_heights(tmp_path):
    source = tmp_path / "mesh.csv"
    source.write_text('WKT,name\n"TIN Z (((8 47 500,8.001 47 500,8.001 47.001 510,8 47 500)),\n'
                      '((8 47 500,8.001 47.001 510,8 47.001 510,8 47 500)))",building\n')
    geopackage = tmp_path / "buildings.gpkg"
    subprocess.run(["ogr2ogr", "-f", "GPKG", str(geopackage), str(source),
                    "-a_srs", "EPSG:4326", "-nln", "Building_solid"], check=True, capture_output=True)
    imported = []
    database = sqlite3.connect(":memory:")
    try:
        with patch("benchly.context.importer.upsert_environment_features", side_effect=lambda _, batch: imported.extend(batch)):
            stats = import_swissbuildings_gdb(database, geopackage, "fixture", "today")
        assert stats == {"building": 1, "skipped": 0}
        assert len(imported) == 1
        assert imported[0]["geometry_wkb"]
        assert imported[0]["height_meters"] == 10
        assert imported[0]["ground_elevation_meters"] == 500
        assert imported[0]["roof_elevation_meters"] == 510
    finally:
        database.close()


def test_noisy_conversion_cannot_fill_a_stderr_pipe(tmp_path):
    converter = tmp_path / "ogr2ogr"
    converter.write_text('#!/usr/bin/env python3\nimport sys\n'
                         'sys.stderr.write("warning\\n" * 200000)\n'
                         'print(\'{"geometry":null,"properties":{}}\')\n')
    converter.chmod(0o755)
    environment = {**os.environ, "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"],
                   "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    result = subprocess.run([
        sys.executable, "-c", "from pathlib import Path; from benchly.context.geometry import iter_layer_features; "
        "import json; print(json.dumps(list(iter_layer_features(Path('fixture.gdb'), 'Building_solid'))))",
    ], cwd=tmp_path, env=environment, capture_output=True, text=True, check=True, timeout=10)
    assert json.loads(result.stdout) == [{"id": None, "geometry": None, "properties": {}}]
