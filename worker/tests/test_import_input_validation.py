"""Regressions for geometry-less official features and mislabelled image bodies."""

from email.message import Message
import json
from io import BytesIO, StringIO
from pathlib import Path
import sqlite3
from types import SimpleNamespace
from unittest.mock import Mock, patch

from PIL import Image
from pydantic import ValidationError
import pytest

from benchly.context.contracts import VectorFeature
from benchly.context.geometry import iter_layer_features
from benchly.context.importer import import_swissbuildings_gdb
from benchly.imagery.client import MAX_IMAGE_BYTES, download_image


def test_building_stream_counts_null_geometry_and_continues_importing():
    features = '\n'.join([
        '{"type":"Feature","id":"empty","geometry":null,"properties":{}}',
        '{"type":"Feature","id":"building","geometry":{"type":"Polygon",'
        '"coordinates":[[[8,47,500],[8.001,47,510],[8.001,47.001,510],'
        '[8,47.001,500],[8,47,500]]]},"properties":{}}',
    ])
    process = SimpleNamespace(stdout=StringIO(features), wait=lambda: 0, poll=lambda: 0)
    connection = sqlite3.connect(":memory:")
    imported = []
    with connection, patch("benchly.context.importer.geopackage_layers", return_value=["Building_solid"]), \
            patch("benchly.context.geometry.subprocess.Popen", return_value=process), \
            patch("benchly.context.importer.upsert_environment_features", side_effect=lambda _, batch: imported.extend(batch)):
        stats = import_swissbuildings_gdb(connection, Path("fixture.gdb"), "current", "today")
        assert stats == {"building": 1, "skipped": 1}
        # The real iterator and geometry conversion must reach the importer writer.
        assert len(imported) == 1
        assert imported[0]["source_id"] == "archive:Building_solid:building"
        assert imported[0]["height_meters"] == 10
        assert imported[0]["geometry_wkb"]
    connection.close()


def test_building_import_preserves_roof_z_and_uses_terrain_above_basement():
    # A solid floor at 490 must not replace the measured ground at 500.
    floor = [[8, 47, 490], [8.001, 47, 490], [8, 47.001, 490], [8, 47, 490]]
    roof = [[8, 47, 506], [8.001, 47, 510], [8, 47.001, 506], [8, 47, 506]]
    features = [{"id": "house", "geometry": {"type": "MultiPolygon", "coordinates": [[floor], [roof]]},
                 "properties": {"GELAENDEPUNKT": 500, "DACH_MIN": 506, "DACH_MAX": 510}}]
    imported = []
    with sqlite3.connect(":memory:") as connection, \
            patch("benchly.context.importer.geopackage_layers", return_value=["Building_solid"]), \
            patch("benchly.context.importer.iter_layer_features", return_value=features) as reader, \
            patch("benchly.context.importer.upsert_environment_features", side_effect=lambda _, batch: imported.extend(batch)):
        import_swissbuildings_gdb(connection, Path("fixture.gdb"), "current", "today")
    assert reader.call_args.kwargs["geometry_type"] == "MULTIPOLYGON"
    assert imported[0]["ground_elevation_meters"] == 500
    assert imported[0]["height_meters"] == 10
    mesh = json.loads(imported[0]["raw_tags"])["benchly:roof_mesh"]
    assert mesh["crs"] == 2056
    assert len(mesh["faces"]) == 1
    assert {point[2] for point in mesh["faces"][0]} == {506, 510}


@pytest.mark.parametrize("geometry", ["invalid", [], 42])
def test_malformed_geometry_is_still_rejected(geometry):
    with pytest.raises(ValidationError):
        VectorFeature.model_validate({"geometry": geometry})


def test_failed_geometry_conversion_is_still_reported():
    process = SimpleNamespace(stdout=StringIO(""), wait=lambda: 1, poll=lambda: 1)
    def fail_conversion(*args, **kwargs):
        kwargs["stderr"].write(b"conversion failed")
        return process
    with patch("benchly.context.geometry.subprocess.Popen", side_effect=fail_conversion):
        with pytest.raises(RuntimeError, match="conversion failed"):
            list(iter_layer_features(Path("fixture.gdb"), "Building_solid"))


def image_response(payload, declared_type):
    response = BytesIO(payload)
    response.headers = Message()
    response.headers["Content-Type"] = declared_type
    return response


@pytest.mark.parametrize("image_format,mime", [("JPEG", "image/jpeg"), ("PNG", "image/png")])
@pytest.mark.parametrize("declared_type", ["binary/octet-stream", "application/octet-stream", "image/png"])
def test_download_validates_bytes_and_uses_actual_image_type(image_format, mime, declared_type):
    payload = BytesIO()
    Image.new("RGB", (2, 2), "green").save(payload, format=image_format)
    data = payload.getvalue()
    with patch("benchly.imagery.client.urllib.request.urlopen", return_value=image_response(data, declared_type)):
        assert download_image("https://provider.example/photo") == (data, mime)


@pytest.mark.parametrize("payload", [b"", b"<html>upstream error</html>", b"\x89PNG\r\n\x1a\ncorrupt"])
def test_download_rejects_invalid_bodies_even_with_image_header(payload):
    with patch("benchly.imagery.client.urllib.request.urlopen", return_value=image_response(payload, "image/jpeg")):
        with pytest.raises(ValueError, match="not a valid image"):
            download_image("https://provider.example/photo")


def test_download_keeps_the_body_size_limit():
    response = image_response(b"x" * (MAX_IMAGE_BYTES + 2), "binary/octet-stream")
    response.read = Mock(wraps=response.read)
    with patch("benchly.imagery.client.urllib.request.urlopen", return_value=response):
        with pytest.raises(ValueError, match="exceeds 8 MB"):
            download_image("https://provider.example/photo")
        response.read.assert_called_once_with(MAX_IMAGE_BYTES + 1)
