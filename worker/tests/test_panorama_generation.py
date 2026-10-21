from __future__ import annotations

import io
import json
import math
import struct
import sqlite3
import hashlib
from argparse import Namespace

import numpy as np
import pytest
from PIL import Image
from capsule_fixtures import legacy_building_body

from benchly.panorama.binary import MAGIC, decode_geometry, encode_geometry
from benchly.panorama.builder import _recommended_pvc, _same_bench_position, _terminate_executor, _build_one, _manifest, _open_state
from benchly.panorama.models import (
    BuildingProjectionSample,
    BuildingGeometry,
    GeometryIdentity,
    PanoramaConfig,
    ProjectedBuilding,
    SemanticClass,
    TerrainRay,
    TerrainSample,
    TerrainEdge,
    VisibleSpan,
)
from benchly.panorama.visibility import build_panorama_geometry, _building_columns, _measured_roof_angle, _measured_roof_projection
from benchly.panorama.material import MATERIAL_SEMANTIC_IDS
from benchly.panorama.watercolor import render_material_webp, render_panorama_webp
from benchly.panorama.material import unpack_material_transport
from benchly.panorama.watercolor import _painted_skyline, _paint_forest_details, _paint_rock_details, _paint_edges, _paint_buildings, _surface_masks, _wrap_blur


def test_extraction_opens_source_snapshot_read_only_before_loading_terrain(tmp_path, monkeypatch):
    from benchly.panorama import builder

    source = tmp_path / "source #1.sqlite"
    connect = sqlite3.connect
    with connect(source) as database:
        database.execute("CREATE TABLE reference(value TEXT)")
    before = source.read_bytes()
    connections = []

    def observe_connection(*args, **kwargs):
        connection = connect(*args, **kwargs)
        connections.append(connection)
        return connection

    class ReachedTerrain(Exception):
        pass

    def inspect_source(_path):
        connection = connections[0]
        connection.execute("BEGIN")
        # The transaction is rolled back even when a regression allows this
        # write. Inspect the actual job's connection, not a separate helper.
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute("CREATE TABLE forbidden(value TEXT)")
        raise ReachedTerrain

    monkeypatch.setattr(builder.sqlite3, "connect", observe_connection)
    monkeypatch.setattr(builder, "RasterCollection", inspect_source)
    try:
        with pytest.raises(ReachedTerrain):
            builder.panorama_extract_job(Namespace(root=tmp_path / "output",
                terrain_dir=tmp_path / "terrain", terrain_pyramid_dir=None,
                database=source, border_terrain_dir=None))
    finally:
        for connection in connections:
            connection.rollback()
            connection.close()
    assert source.read_bytes() == before


def fixture_geometry():
    identity = GeometryIdentity(
        latitude=46.69, longitude=7.67, ground_elevation_meters=628,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture",
        angular_resolution_degrees=90,
    )
    config = PanoramaConfig(angular_resolution_degrees=90)
    rays = [TerrainRay(azimuth_degrees=azimuth, samples=(
        TerrainSample(distance_meters=80, elevation_meters=625, semantic=SemanticClass.OPEN_GRASSLAND,
                      terrain_source="swissALTI3D-local"),
        TerrainSample(distance_meters=3_000, elevation_meters=1_240 + azimuth, semantic=SemanticClass.ROCK,
                      terrain_source="regional-terrain"),
    )) for azimuth in (0, 90, 180, 270)]
    return build_panorama_geometry(identity, rays, config=config)


def test_measured_roof_projects_its_real_distance_and_asymmetric_ridge():
    building = BuildingGeometry(source_id="roof", footprint=((10, -10), (30, -10), (30, 10), (10, 10)),
        ground_elevation_meters=0, eaves_elevation_meters=5, roof_elevation_meters=12, source="measured", confidence=1,
        roof_faces=(((10, -10, 5), (10, 10, 5), (28, 0, 12)),
                    ((10, 10, 5), (30, 10, 5), (28, 0, 12)),
                    ((30, 10, 5), (30, -10, 5), (28, 0, 12)),
                    ((30, -10, 5), (10, -10, 5), (28, 0, 12))))
    # At 90 degrees the near eaves at 10m are higher on screen than the
    # measured ridge at 28m. A facade-height generic gable would be ~50deg.
    config = PanoramaConfig(angular_resolution_degrees=1)
    assert _measured_roof_angle(building, 90, 0, config) == pytest.approx(26.565, abs=.001)
    assert _measured_roof_angle(building, 270, 0, config) is None


def test_front_gable_uses_local_mesh_instead_of_lower_annex_eaves():
    building = BuildingGeometry(source_id="complex-roof", source="measured", confidence=1,
        footprint=((10, -10), (30, -10), (30, 10), (10, 10)),
        ground_elevation_meters=0, eaves_elevation_meters=2, roof_elevation_meters=12,
        roof_faces=(((10, -10, 8), (10, 0, 12), (30, 0, 12)),
                    ((10, 0, 12), (10, 10, 8), (30, 0, 12))))
    profiles = _building_columns(building, PanoramaConfig(angular_resolution_degrees=1), 0)
    profile = next(profile for _index, _span, profile in profiles if profile.azimuth_degrees == 90)
    assert profile.eaves_angle_degrees == pytest.approx(50.194, abs=.001)
    assert profile.upper_angle_degrees == pytest.approx(profile.eaves_angle_degrees)


def test_separate_roof_wings_preserve_the_intervening_setback_wall():
    import math
    faces = (((10, -10, 2), (20, -10, 6), (20, 10, 6)),
             ((10, -10, 2), (20, 10, 6), (10, 10, 2)),
             ((40, -10, 20), (45, -10, 27), (45, 10, 27)),
             ((40, -10, 20), (45, 10, 27), (40, 10, 20)))
    building = BuildingGeometry(source_id="stepped-roofs", source="measured", confidence=1,
        footprint=((10,-10),(45,-10),(45,10),(10,10)), ground_elevation_meters=0,
        eaves_elevation_meters=2, roof_elevation_meters=27, roof_faces=faces)
    top, front, intervals = _measured_roof_projection(building, 90, 0, PanoramaConfig())
    assert len(intervals) == 2
    assert front == pytest.approx(math.degrees(math.atan2(2,10)), abs=.001)
    assert top == pytest.approx(math.degrees(math.atan2(27,45)), abs=.001)
    assert intervals[0] == pytest.approx((front, math.degrees(math.atan2(6,20))), abs=.001)
    assert intervals[1] == pytest.approx((math.degrees(math.atan2(20,40)), top), abs=.001)
    assert intervals[1][0] - intervals[0][1] > 9  # Actual wall, never roof fill.


def test_front_walls_occlude_flat_roofs_of_both_near_and_rear_wings():
    building = BuildingGeometry(source_id="flat-wings", source="measured", confidence=1,
        footprint=((10,-10),(45,-10),(45,10),(10,10)), ground_elevation_meters=0,
        eaves_elevation_meters=2, roof_elevation_meters=20,
        roof_faces=(((10,-10,2),(20,-10,2),(20,10,2)), ((10,-10,2),(20,10,2),(10,10,2)),
                    ((40,-10,20),(45,-10,20),(45,10,20)), ((40,-10,20),(45,10,20),(40,10,20))))
    top, front, intervals = _measured_roof_projection(building, 90, 0, PanoramaConfig())
    assert top > front and intervals == ()


def test_flat_roof_is_visible_when_the_observer_is_above_its_front_edge():
    import math
    building = BuildingGeometry(source_id="flat", source="measured", confidence=1,
        footprint=((10,-10),(30,-10),(30,10),(10,10)), ground_elevation_meters=0,
        eaves_elevation_meters=5, roof_elevation_meters=5,
        roof_faces=(((10,-10,5),(30,-10,5),(30,10,5)),((10,-10,5),(30,10,5),(10,10,5))))
    top, front, intervals = _measured_roof_projection(building, 90, 10, PanoramaConfig())
    assert front == pytest.approx(math.degrees(math.atan2(-5,10)), abs=.001)
    assert top == pytest.approx(math.degrees(math.atan2(-5,30)), abs=.001)
    assert len(intervals) == 1 and intervals[0] == pytest.approx((front,top),abs=.001)


def test_painted_material_marks_preserve_unmapped_surfaces_and_sky():
    from PIL import ImageDraw
    base = Image.new("RGB", (360, 180), (130, 140, 110))
    forest, rock = Image.new("L", base.size), Image.new("L", base.size)
    ImageDraw.Draw(forest).rectangle((20, 80, 160, 179), fill=255)
    ImageDraw.Draw(rock).rectangle((200, 80, 340, 179), fill=255)
    masks = {(SemanticClass.FOREST, 0): forest, (SemanticClass.ROCK, 0): rock}
    before = np.asarray(base).copy()
    _paint_forest_details(base, masks, Image.new("L", base.size))
    _paint_rock_details(base, masks, Image.new("L", base.size))
    changed = np.any(np.asarray(base) != before, axis=2)
    assert not changed[:80].any()
    assert not changed[:, 161:200].any()
    assert changed[80:, 20:161].mean() > .8
    assert changed[80:, 200:341].mean() > .8


def test_natural_ridge_ink_cannot_cross_into_water_or_buildings():
    from PIL import ImageDraw
    base = Image.new("RGB", (360, 180), (130, 140, 160))
    natural_land = Image.new("L", base.size)
    ImageDraw.Draw(natural_land).rectangle((0, 0, 179, 179), fill=255)
    before = np.asarray(base).copy()
    config = PanoramaConfig(angular_resolution_degrees=1)
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=500,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture", angular_resolution_degrees=1)
    rays = [TerrainRay(azimuth_degrees=angle, samples=(TerrainSample(distance_meters=1000,
        elevation_meters=600, semantic=SemanticClass.ROCK),)) for angle in range(360)]
    _paint_edges(base, build_panorama_geometry(identity, rays, config=config), natural_land)
    assert not np.any(np.asarray(base)[:, 180:] != before[:, 180:])
    assert np.any(np.asarray(base)[:, :180] != before[:, :180])


def test_adjacent_depth_layers_do_not_leave_an_internal_water_seam():
    from PIL import ImageDraw, ImageOps
    left = Image.new("L", (360, 180))
    ImageDraw.Draw(left).rectangle((0, 0, 179, 179), fill=255)
    right = ImageOps.invert(left)
    surfaces = _surface_masks({(SemanticClass.WATER, 0): _wrap_blur(left, 2),
                              (SemanticClass.WATER, 1): _wrap_blur(right, 2)})
    water = np.asarray(surfaces[SemanticClass.WATER])
    assert water.min() >= 252
    assert np.ptp(water[90].astype(np.int16)) <= 2


def test_inner_ridge_selection_jump_does_not_draw_a_vertical_ink_connector():
    base = Image.new("RGB", (720, 360), (130, 140, 110))
    config = PanoramaConfig(angular_resolution_degrees=1)
    identity = GeometryIdentity(latitude=47, longitude=8, ground_elevation_meters=500,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture", angular_resolution_degrees=1)
    # Forest at the skyline suppresses its separate graphite pass so this
    # measures only the selected inner-ridge connector, below that skyline.
    rays = [TerrainRay(azimuth_degrees=angle, samples=(TerrainSample(distance_meters=1000,
        elevation_meters=1200, semantic=SemanticClass.FOREST),)) for angle in range(360)]
    geometry = build_panorama_geometry(identity, rays, config=config)
    columns = tuple(column.model_copy(update={"spans": (
        VisibleSpan(lower_angle_degrees=config.minimum_elevation_angle,
                    upper_angle_degrees=0 if column.azimuth_degrees < 180 else 5,
                    distance_meters=3000, semantic=SemanticClass.ROCK,
                    source="fixture", confidence=1),
        VisibleSpan(lower_angle_degrees=0 if column.azimuth_degrees < 180 else 5,
                    upper_angle_degrees=35, distance_meters=10000,
                    semantic=SemanticClass.FOREST, source="fixture", confidence=1),
    )}) for column in geometry.columns)
    geometry = geometry.model_copy(update={"columns": columns})
    before = np.asarray(base).copy()
    _paint_edges(base, geometry, Image.new("L", base.size, 255))
    changed = np.any(np.asarray(base) != before, axis=2)
    # The discontinuity is at x=360. Its middle must remain uninked; the
    # separate horizontal ridge passages should still have selective accents.
    scale = base.height / (config.maximum_elevation_angle - config.minimum_elevation_angle)
    middle = round((config.maximum_elevation_angle - 2.5) * scale)
    assert not changed[middle - 2:middle + 3, 350:371].any()
    assert changed.any()


def test_painting_preserves_mapped_clearing_and_narrow_water_surface():
    from PIL import ImageDraw, ImageOps
    forest = Image.new("L", (1440, 480), 255)
    ImageDraw.Draw(forest).rectangle((690, 0, 749, 479), fill=0)
    grass = ImageOps.invert(forest)
    water = Image.new("L", forest.size)
    # A narrow water view is still a real source-backed surface. Its depth
    # crosses the old 25%-of-image heuristic, which produced vertical stripes.
    ImageDraw.Draw(water).rectangle((300, 350, 319, 479), fill=255)
    surfaces = _surface_masks({(SemanticClass.FOREST, 0): forest,
        (SemanticClass.OPEN_GRASSLAND, 0): grass, (SemanticClass.WATER, 0): water})
    assert surfaces[SemanticClass.FOREST].getpixel((720, 240)) < 5
    assert surfaces[SemanticClass.OPEN_GRASSLAND].getpixel((720, 240)) > 250
    # A wet edge can soften this 5-degree patch, but cannot fade its body
    # down to the old 2%-16% opacity just because the patch is narrow.
    assert surfaces[SemanticClass.WATER].getpixel((310, 420)) > 220


def test_sealed_builder_manifest_keeps_extended_projection_and_actual_dimensions(tmp_path):
    geometry = fixture_geometry()
    geometry = geometry.model_copy(update={"config": geometry.config.model_copy(update={"maximum_elevation_angle": 88})})
    source = tmp_path / "source.bpc"
    source.write_bytes(encode_geometry(geometry))
    root = tmp_path / "builder"
    built = _build_one(str(source), str(root / "generation"), "summer")
    state = _open_state(root)
    state.execute("""INSERT INTO extractions(bench_id,bench_row_id,latitude,longitude,input_key,geometry_key,status)
        VALUES('osm-node-1',1,46.69,7.67,'input',?,'ready')""", (geometry.identity_key,))
    for kind, relative, size in built.artifacts:
        payload = (root / "generation" / relative).read_bytes()
        state.execute("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?)", (kind, geometry.identity_key, built.cell_id, kind,
            relative, hashlib.sha256(payload).hexdigest(), size, source.stat().st_size, "ready", "today"))
    state.commit(); state.close()
    database = tmp_path / "app.sqlite"
    with sqlite3.connect(database) as connection:
        connection.executescript("""CREATE TABLE benches(row_id INTEGER,id TEXT,latitude REAL,longitude REAL,active INTEGER);
            CREATE TABLE bench_panorama_geometry(geometry_key TEXT,bench_row_id INTEGER,bench_id TEXT,bench_latitude REAL,bench_longitude REAL);
            INSERT INTO benches VALUES(1,'osm-node-1',46.69,7.67,1);""")
    _, manifest = _manifest(root, database)
    capsule = next(record for record in manifest["artifacts"] if record["kind"] == "capsule")
    picture = next(record for record in manifest["artifacts"] if record["kind"] == "render")
    assert capsule["projection"] == {"minimum_elevation_angle": -32, "maximum_elevation_angle": 88}
    assert (picture["width"], picture["height"]) == (4096, 1365)


def test_view_capsule_is_deterministic_binary_and_roundtrips_quantized_geometry():
    geometry = fixture_geometry().model_copy(update={
        "display_elevation_meters": 628,
        "terrain_ground_elevation_meters": 627.4,
        "ground_elevation_provenance": "stored-measurement",
        "ground_elevation_confidence": "measured",
        "ground_elevation_disagreement_meters": .6,
    })
    first = encode_geometry(geometry)
    assert first == encode_geometry(geometry)
    assert first.startswith(MAGIC)
    assert b"manifest.npy" not in first
    restored = decode_geometry(first)
    assert restored.identity_key == geometry.identity_key
    assert restored.display_elevation_meters == 628
    assert restored.terrain_ground_elevation_meters == pytest.approx(627.4)
    assert restored.ground_elevation_provenance == "stored-measurement"
    assert restored.ground_elevation_confidence == "measured"
    assert restored.ground_elevation_disagreement_meters == pytest.approx(.6)
    assert {span.terrain_source for column in restored.columns for span in column.spans} == {
        "swissALTI3D-local", "regional-terrain",
    }
    assert len(restored.columns) == 4
    assert abs(restored.columns[0].skyline_angle_degrees - geometry.columns[0].skyline_angle_degrees) < .05
    with pytest.raises(ValueError, match="truncated"):
        decode_geometry(first[:-4])


def test_view_capsule_decoder_remains_compatible_with_schema_one_sources():
    current = encode_geometry(fixture_geometry())
    header_size, body_size = struct.unpack("<II", current[8:16])
    header = json.loads(current[16:16 + header_size])
    header["schema"] = 1
    header.pop("terrain_sources")
    header["arrays"].pop("span_sources")
    header["arrays"].pop("edge_sources")
    body = legacy_building_body(header, current[16 + header_size:16 + header_size + body_size])
    legacy_header = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    legacy = MAGIC + struct.pack("<II", len(legacy_header), len(body)) + legacy_header + body
    restored = decode_geometry(legacy)
    assert {span.terrain_source for column in restored.columns for span in column.spans} == {"view-capsule"}


def test_view_capsule_keeps_precise_full_circle_bearing_and_reads_legacy_rounding():
    geometry = fixture_geometry()
    sample = BuildingProjectionSample(
        azimuth_degrees=359.999, lower_angle_degrees=-2, eaves_angle_degrees=3,
        upper_angle_degrees=5, distance_meters=20,
    )
    building = ProjectedBuilding(
        object_id="building", source="fixture", confidence=1, samples=(sample,),
    )
    encoded = encode_geometry(geometry.model_copy(update={"buildings": (building,)}))
    restored = decode_geometry(encoded)
    assert restored.buildings[0].samples[0].azimuth_degrees == pytest.approx(359.999, abs=.00002)
    size, _ = struct.unpack("<II", encoded[8:16])
    header = json.loads(encoded[16:16 + size]); header["schema"] = 6
    body = legacy_building_body(header, encoded[16 + size:])
    raw_header = json.dumps(header).encode()
    legacy = decode_geometry(MAGIC + struct.pack("<II",len(raw_header),len(body)) + raw_header + body)
    assert legacy.buildings[0].samples[0].azimuth_degrees == 0


def test_capsule_preserves_adjacent_building_rays_in_the_western_quadrant():
    bearings = (310.2,310.3,310.4)
    samples = tuple(BuildingProjectionSample(azimuth_degrees=angle, lower_angle_degrees=-2,
        eaves_angle_degrees=3, upper_angle_degrees=5, distance_meters=20) for angle in bearings)
    building = ProjectedBuilding(object_id="wall",source="fixture",confidence=1,samples=samples)
    restored = decode_geometry(encode_geometry(fixture_geometry().model_copy(update={"buildings":(building,)})))
    measured = [s.azimuth_degrees for s in restored.buildings[0].samples]
    assert len(set(measured)) == 3  # Float16 collapsed 310.2 and 310.3 to the same position.
    np.testing.assert_allclose(measured,bearings,atol=.00002,rtol=0)


@pytest.mark.parametrize("roof_intervals", [None, (), ((12,13),(14,15))])
def test_capsule_preserves_source_facades_roof_and_levels_and_reads_schema_two(roof_intervals):
    geometry = fixture_geometry()
    sample = BuildingProjectionSample(azimuth_degrees=40, lower_angle_degrees=-3,
                                      eaves_angle_degrees=12, upper_angle_degrees=15,
                                      distance_meters=30, facade_index=7, facade_normal_degrees=315.2,
                                      roof_intervals=roof_intervals)
    building = ProjectedBuilding(object_id="source-house", source="OpenStreetMap", confidence=.8,
                                 roof_kind="known-pitched", levels=3, levels_source="OpenStreetMap:way-1:building:levels",
                                 registered_storeys=4, registered_storeys_source="BFS-GWR:123@2026-10-15#fixture", samples=(sample,))
    encoded = encode_geometry(geometry.model_copy(update={"buildings": (building,)}))
    restored = decode_geometry(encoded).buildings[0]
    assert restored.roof_kind == "known-pitched" and restored.levels == 3
    assert restored.levels_source == building.levels_source
    assert restored.registered_storeys == 4 and restored.registered_storeys_source == building.registered_storeys_source
    assert restored.samples[0].facade_index == 7
    assert restored.samples[0].facade_normal_degrees == pytest.approx(315.2, abs=.001)
    assert restored.samples[0].roof_intervals == roof_intervals
    header_size, body_size = struct.unpack("<II", encoded[8:16])
    header = json.loads(encoded[16:16 + header_size])
    # Schema 3 predates per-fact provenance but retains facade arrays.
    schema_three = json.loads(json.dumps(header))
    schema_three["schema"] = 3
    for entry in schema_three["buildings"]:
        entry.pop("levels_source")
        entry.pop("registered_storeys")
        entry.pop("registered_storeys_source")
    body = legacy_building_body(schema_three, encoded[16 + header_size:16 + header_size + body_size])
    old_three = json.dumps(schema_three, sort_keys=True, separators=(",", ":")).encode()
    restored_three = decode_geometry(MAGIC + struct.pack("<II", len(old_three), len(body)) + old_three + body).buildings[0]
    assert restored_three.levels == 3 and restored_three.levels_source is None
    assert restored_three.registered_storeys is None
    assert restored_three.samples[0].roof_intervals is None
    header["schema"] = 2
    header["arrays"].pop("building_faces")
    for entry in header["buildings"]:
        entry.pop("roof_kind")
        entry.pop("levels")
        entry.pop("levels_source")
        entry.pop("registered_storeys")
        entry.pop("registered_storeys_source")
    body = legacy_building_body(header, encoded[16 + header_size:16 + header_size + body_size])
    old_header = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    legacy = decode_geometry(MAGIC + struct.pack("<II", len(old_header), len(body)) + old_header + body).buildings[0]
    assert legacy.levels is None and legacy.roof_kind == "flat-or-unknown"
    assert legacy.samples[0].facade_index is None and legacy.samples[0].facade_normal_degrees is None


def test_painter_leaves_a_measured_roof_gap_in_the_wall_wash(monkeypatch):
    geometry = fixture_geometry()
    samples = tuple(BuildingProjectionSample(azimuth_degrees=angle, lower_angle_degrees=-3,
        eaves_angle_degrees=5, upper_angle_degrees=30, distance_meters=30,
        facade_index=0, facade_normal_degrees=315, roof_intervals=((5,10),(25,30))) for angle in (20,160))
    building = ProjectedBuilding(object_id="stepped-house", source="fixture", confidence=1, samples=samples)
    base = Image.new("RGB", (720,360), (130,140,110))
    geometry = geometry.model_copy(update={"buildings":(building,)})
    baseline = base.copy()
    with monkeypatch.context() as patch:
        patch.setattr("benchly.panorama.watercolor._paint_architecture_planes", lambda *args: None)
        _paint_buildings(baseline, geometry, 123, Image.new("L",base.size,128))
    _paint_buildings(base, geometry, 123, Image.new("L",base.size,128))
    scale = base.height / (geometry.config.maximum_elevation_angle-geometry.config.minimum_elevation_angle)
    pixel = lambda angle: base.getpixel((180,round((geometry.config.maximum_elevation_angle-angle)*scale)))
    before = lambda angle: baseline.getpixel((180,round((geometry.config.maximum_elevation_angle-angle)*scale)))
    assert before(18) == before(0)  # The underlying gap is plaster, not roof.
    assert pixel(18) != before(18) and pixel(0) != before(0)  # Exercise the new glaze.
    assert pixel(7) == pixel(27)
    assert pixel(7) == before(7) and pixel(27) == before(27)
    assert pixel(18) != pixel(27)
    # Both measured roof interiors stay byte-exact; a directional wall wash
    # may legitimately differ between heights 18° and 0°.
    for lower, upper in ((5,10),(25,30)):
        top = math.ceil((geometry.config.maximum_elevation_angle-upper)*scale)+2
        bottom = math.floor((geometry.config.maximum_elevation_angle-lower)*scale)-2
        np.testing.assert_array_equal(np.asarray(base)[top:bottom,42:318],
                                      np.asarray(baseline)[top:bottom,42:318])


def test_registry_total_does_not_invent_above_ground_facade_divisions():
    geometry = fixture_geometry()
    samples = tuple(BuildingProjectionSample(azimuth_degrees=azimuth, lower_angle_degrees=-3,
        eaves_angle_degrees=12, upper_angle_degrees=15, distance_meters=30,
        facade_index=0, facade_normal_degrees=315) for azimuth in (20, 160))
    building = ProjectedBuilding(object_id="house", source="fixture", confidence=1, samples=samples)
    # Include a loaded brush passage: low-pigment passages intentionally lose
    # their floor accents in the watercolor painter. Metadata is still tested
    # independently of whether a particular brush passage deposits any ink.
    pigment = Image.fromarray(np.tile(np.linspace(80, 220, 720).astype(np.uint8), (360, 1)))
    images = []
    for metadata in ({}, {"registered_storeys": 4, "registered_storeys_source": "BFS-GWR:123"},
                     {"levels": 4, "levels_source": "BFS-GWR:123"},
                     {"levels": 4, "levels_source": "OpenStreetMap:way-1:building:levels"}):
        base = Image.new("RGB", pigment.size, (130, 140, 110))
        _paint_buildings(base, geometry.model_copy(update={"buildings": (building.model_copy(update=metadata),)}), 123, pigment)
        images.append(np.asarray(base))
    assert np.array_equal(images[0], images[1])
    assert np.array_equal(images[0], images[2])  # Earlier experimental review capsule.
    assert not np.array_equal(images[0], images[3])


def test_building_facade_base_follows_sampled_footprint_grade():
    from benchly.panorama.models import BuildingGeometry
    from benchly.panorama.visibility import _building_columns
    import math

    building = BuildingGeometry(source_id="sloped-foundation", source="fixture", confidence=1,
        footprint=((30, 10), (40, 10), (40, 30), (30, 30)),
        footprint_ground_elevations=(500, 500, 510, 510), ground_elevation_meters=505,
        eaves_elevation_meters=525, roof_elevation_meters=525)
    profiles = _building_columns(building, PanoramaConfig(angular_resolution_degrees=1), 501.1)
    profile = next(sample for _, _, sample in profiles if sample.azimuth_degrees == 60)
    north = 30 / math.tan(math.radians(60))
    expected_ground = 500 + (north - 10) / 20 * 10
    assert profile.lower_angle_degrees == pytest.approx(math.degrees(math.atan2(expected_ground - 501.1, profile.distance_meters)), abs=.001)
    assert profile.facade_index == 3
    assert profile.facade_normal_degrees == pytest.approx(270)


def test_material_mask_and_paint_are_wrap_continuous():
    geometry = fixture_geometry()
    for material, payload in ((True, render_material_webp(geometry, 720, 240)), (False, render_panorama_webp(geometry, 720, 240))):
        pixels = np.asarray(Image.open(io.BytesIO(payload)).convert("RGBA"))
        if material:
            pixels = unpack_material_transport(pixels)
        pixels = pixels.astype(np.int16)
        # Lossy WebP may move the final block by a few values even though the
        # pre-encode texture is identical at the boundary; this is visually
        # continuous and comfortably below an edge contrast.
        contrast = np.abs(pixels[:, 0] - pixels[:, -1])
        assert contrast.max() <= 16
        assert np.percentile(contrast, 95) <= 5


def test_material_contract_keeps_categories_discrete_and_coverage_separate():
    identity = GeometryIdentity(
        latitude=46.69, longitude=7.67, ground_elevation_meters=628,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture",
        angular_resolution_degrees=180,
    )
    config = PanoramaConfig(angular_resolution_degrees=180)
    geometry = build_panorama_geometry(identity, [
        TerrainRay(azimuth_degrees=0, samples=(TerrainSample(
            distance_meters=80, elevation_meters=628, semantic=SemanticClass.FOREST,
        ),)),
        TerrainRay(azimuth_degrees=180, samples=(TerrainSample(
            distance_meters=80, elevation_meters=628, semantic=SemanticClass.BUILDING,
        ),)),
    ], config=config)
    pixels = unpack_material_transport(np.asarray(Image.open(io.BytesIO(render_material_webp(geometry, 32, 16))).convert("RGBA")))
    semantic_values = set(np.unique(pixels[..., 1]).tolist())
    assert semantic_values <= {
        MATERIAL_SEMANTIC_IDS[SemanticClass.SKY],
        MATERIAL_SEMANTIC_IDS[SemanticClass.FOREST],
        MATERIAL_SEMANTIC_IDS[SemanticClass.BUILDING],
    }
    assert MATERIAL_SEMANTIC_IDS[SemanticClass.SNOW_OR_GLACIER] not in semantic_values
    assert set(np.unique(pixels[..., 3]).tolist()) - {0, 255}


def test_painted_contour_and_material_coverage_share_angular_positions():
    geometry = fixture_geometry()
    # Keep the source terrain angles but make every column a single continuous
    # natural surface so accumulated alpha measures the exact visible height.
    columns = tuple(column.model_copy(update={"spans": (VisibleSpan(
        lower_angle_degrees=-32, upper_angle_degrees=column.skyline_angle_degrees,
        semantic=SemanticClass.FOREST, distance_meters=100, source="fixture", confidence=1,
    ),)}) for column in geometry.columns)
    geometry = geometry.model_copy(update={"columns": columns})
    width, height = 720, 240
    contour = _painted_skyline(geometry, width, height)
    facts = unpack_material_transport(np.asarray(Image.open(io.BytesIO(render_material_webp(geometry, width, height))).convert("RGBA")))
    measured = height - facts[..., 3].sum(axis=0) / 255
    # The repeated final column is an intentional exact circular boundary.
    np.testing.assert_allclose(measured[:-1], contour[:-1], atol=.008)
    assert np.array_equal(facts[:, 0], facts[:, -1])


def test_shared_contour_preserves_sharp_architectural_silhouette():
    geometry = fixture_geometry()
    columns = list(geometry.columns)
    building = VisibleSpan(lower_angle_degrees=-5, upper_angle_degrees=45,
                           distance_meters=10, semantic=SemanticClass.BUILDING, source="fixture", confidence=1)
    columns[1] = columns[1].model_copy(update={"skyline_angle_degrees": 45, "spans": (building,)})
    geometry = geometry.model_copy(update={"columns": tuple(columns)})
    contour = _painted_skyline(geometry, 720, 240)
    # The projected wall retains its measured top; it is never rounded into a hill.
    assert contour[200] == pytest.approx((58 - 45) / 90 * 240)


def test_storage_gate_keeps_80_gib_until_68_gib_peak_then_rounds_with_headroom():
    gib = 1024**3
    assert _recommended_pvc(68 * gib) == 80
    assert _recommended_pvc(69 * gib) == 96
    assert _recommended_pvc(81 * gib) == 112


def test_activation_allows_serialization_drift_but_rejects_moved_benches():
    expected = (270468, 46.5547639035754, 8.0058085268719)
    assert _same_bench_position((270468, 46.55476390357538, 8.005808526871903), expected)
    assert not _same_bench_position((270468, 46.554765, 8.005808526871903), expected)
    assert not _same_bench_position((270469, 46.55476390357538, 8.005808526871903), expected)
    assert not _same_bench_position(None, expected)


def test_interrupted_extraction_terminates_live_children():
    class Process:
        terminated = False

        def is_alive(self):
            return True

        def terminate(self):
            self.terminated = True

    class Executor:
        _processes = {1: Process(), 2: Process()}

    executor = Executor()
    _terminate_executor(executor)
    assert all(process.terminated for process in executor._processes.values())
