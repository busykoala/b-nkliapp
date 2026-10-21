"""Cadastral road extents improve ground structure without fabricating finish."""
import json
import struct

import numpy as np
import pytest
from shapely.geometry import Point, Polygon, box

from benchly.context.ground_cover import MOPUBE_SOURCE, mopube_ground_surfaces
from benchly.panorama.binary import decode_geometry, encode_geometry
from benchly.panorama.datasets import SemanticIndex, WGS84_TO_LV95
from benchly.panorama.material import MATERIAL_SEMANTIC_IDS
from benchly.panorama.models import GeometryIdentity, PanoramaConfig, SemanticClass, TerrainRay, TerrainSample
from benchly.panorama.paving import paving_boundary_distances
from benchly.panorama.visibility import build_panorama_geometry


def record(code=1, label='Strasse, Weg', identity='301_123', geometry=None):
    shape = geometry if geometry is not None else box(2_500_000,1_100_000,2_500_010,1_100_010)
    return dict(bbfid=identity,art=code,bbartt_bez_de=label,qualitaet=0,
        qualit_bez_de='AV93',guelteintr=None,geometry_wkb=shape.wkb_hex)


def geometry(semantic):
    config = PanoramaConfig(angular_resolution_degrees=90,maximum_distance_meters=1000)
    identity = GeometryIdentity(latitude=47,longitude=8,ground_elevation_meters=0,
        terrain_version='dem',semantic_version='cover',building_version='buildings',angular_resolution_degrees=90)
    rays = [TerrainRay(azimuth_degrees=a,samples=tuple(TerrainSample(distance_meters=d,
        elevation_meters=0,semantic=semantic,surface_normal=(0,0,1)) for d in [2,10,100,1000]))
        for a in [0,90,180,270]]
    return build_panorama_geometry(identity,rays,config=config)


def schema(raw, version):
    size,compressed = struct.unpack('<II',raw[8:16])
    header = json.loads(raw[16:16+size]);header['schema'] = version
    encoded = json.dumps(header,sort_keys=True,separators=(',',':')).encode()
    return raw[:8]+struct.pack('<II',len(encoded),compressed)+encoded+raw[16+size:]


def test_roads_hard_ground_and_fields_never_establish_a_paved_finish():
    values = [record(1,'Strasse, Weg','a'),record(2,'Trottoir','b'),
        record(7,'übrige befestigte','c'),record(8,'Acker, Wiese, Weide','d')]
    # Garden, island, building and water labels have no adoption here.
    values += [record(c,label,str(c)) for c,label in [(0,'Gebäude'),(3,'Verkehrsinsel'),
        (11,'Gartenanlage'),(14,'stehendes Gewässer')]]
    surfaces = mopube_ground_surfaces(values)
    assert [s.semantic for s in surfaces] == ['surfaced_ground']*3+['open_grassland']
    assert not any(s.semantic == SemanticClass.PAVED_GROUND for s in surfaces)
    assert all(s.updated_at is None for s in surfaces)


def test_holes_islands_and_source_identity_are_preserved():
    polygon = Polygon([(2_500_000,1_100_000),(2_500_020,1_100_000),
        (2_500_020,1_100_020),(2_500_000,1_100_020)],
        [[(2_500_005,1_100_005),(2_500_015,1_100_005),
          (2_500_015,1_100_015),(2_500_005,1_100_015)]])
    raw = record(geometry=polygon)
    surface, = mopube_ground_surfaces([raw])
    assert surface.source_id == raw['bbfid']
    assert surface.geometry.wkb == polygon.wkb
    assert surface.geometry.contains(Point(2_500_002,1_100_002))
    assert not surface.geometry.contains(Point(2_500_010,1_100_010))
    with pytest.raises(ValueError,match='unique'):
        mopube_ground_surfaces([raw,raw])


@pytest.mark.parametrize('update',[{'bbartt_bez_de':'asphalt'}, {'geometry_wkb':'bad'},
    {'geometry_wkb':Point(2_500_000,1_100_000).wkb_hex},
    {'geometry_wkb':box(7,46,8,47).wkb_hex}, {'guelteintr':'yesterday'}])
def test_invalid_source_is_rejected_without_repair(update):
    with pytest.raises(ValueError):
        mopube_ground_surfaces([{**record(),**update}])


@pytest.mark.parametrize('quality',[1,2,None,False,'0'])
def test_unqualified_survey_quality_is_not_adopted(quality):
    assert not mopube_ground_surfaces([{**record(),'qualitaet':quality}])


def test_schema13_roundtrip_and_schema12_do_not_confuse_road_finish():
    road = encode_geometry(geometry(SemanticClass.SURFACED_GROUND))
    restored = decode_geometry(road)
    assert {s.semantic for c in restored.columns for s in c.spans} == {SemanticClass.SURFACED_GROUND}
    assert MATERIAL_SEMANTIC_IDS[SemanticClass.SURFACED_GROUND] == 11
    assert MATERIAL_SEMANTIC_IDS[SemanticClass.PAVED_GROUND] == 10
    with pytest.raises(ValueError,match='semantic'):
        decode_geometry(schema(road,12))
    paving = decode_geometry(schema(encode_geometry(geometry(SemanticClass.PAVED_GROUND)),12))
    assert {s.semantic for c in paving.columns for s in c.spans} == {SemanticClass.PAVED_GROUND}
    old = decode_geometry(schema(encode_geometry(geometry(SemanticClass.UNKNOWN_TERRAIN)),11))
    assert {s.semantic for c in old.columns for s in c.spans} == {SemanticClass.UNKNOWN_TERRAIN}


def test_cadastral_road_wins_broad_cover_but_not_explicit_paving_or_water():
    east,north = WGS84_TO_LV95.transform(8,47)
    area = box(east-10,north-10,east+10,north+10)
    rows = [(area,SemanticClass.FOREST,.9,'swissTLM3D'),
            (area,SemanticClass.SURFACED_GROUND,.9,MOPUBE_SOURCE)]
    def classify(records):
        return SemanticIndex(records).classify(np.array([8.]),np.array([47.]))[0][0]
    for extra,expected in [(None,SemanticClass.SURFACED_GROUND),
            (SemanticClass.PAVED_GROUND,SemanticClass.PAVED_GROUND),
            (SemanticClass.WATER,SemanticClass.WATER)]:
        records = rows+([(area,extra,.98,'qualified')] if extra else [])
        assert classify(records) == classify(list(reversed(records))) == expected


def test_mapped_road_edges_receive_true_ray_samples_without_widening():
    latitude,longitude = 47.,8.
    east,north = WGS84_TO_LV95.transform(longitude,latitude)
    # A 20 cm strip missed by the ordinary 47..62 m radial sampling.
    area = box(east-10,north+52,east+10,north+52.2)
    index = SemanticIndex([(area,SemanticClass.SURFACED_GROUND,.9,MOPUBE_SOURCE)])
    rays = [TerrainRay(azimuth_degrees=0,samples=tuple(TerrainSample(
        distance_meters=d,elevation_meters=0) for d in [2,47,62,100]))]
    distances = paving_boundary_distances(rays,latitude,longitude,index,100)[0]
    assert len(distances) == 4
    assert 51.8 < min(distances) < 52.2 < max(distances) < 52.5
    # An arbitrary unqualified road label must not trigger geographic edits.
    unqualified = SemanticIndex([(area,SemanticClass.SURFACED_GROUND,.9,'guess')])
    assert paving_boundary_distances(rays,latitude,longitude,unqualified,100) == {}


def test_road_material_renders_exact_categorical_id_and_continuous_coverage():
    from io import BytesIO
    from PIL import Image
    from benchly.panorama.material import unpack_material_transport
    from benchly.panorama.watercolor import render_material_webp,render_panorama_webp
    g = geometry(SemanticClass.SURFACED_GROUND)
    material = unpack_material_transport(np.array(Image.open(BytesIO(render_material_webp(g,360,240))).convert('RGBA')))
    assert set(np.unique(material[...,1])) == {0,11}
    assert np.any((material[...,3] > 0) & (material[...,3] < 255))
    for season in ['spring','summer','autumn','winter']:
        image = Image.open(BytesIO(render_panorama_webp(g,360,240,season)))
        assert image.size == (360,240)


def test_ground_cover_version_invalidates_geometry_without_changing_buildings():
    import sqlite3
    from types import SimpleNamespace
    from benchly.panorama.builder import _extraction_source_versions
    with sqlite3.connect(':memory:') as database:
        database.executescript('CREATE TABLE official_context_sources(source TEXT,version TEXT); CREATE TABLE pipeline_runs(id INTEGER,kind TEXT,status TEXT,source_version TEXT,pipeline_version TEXT,finished_at TEXT);')
        raster = SimpleNamespace(datasets=[])
        before = _extraction_source_versions(database,raster,raster,raster)
        database.execute('INSERT INTO official_context_sources VALUES(?,?)',(MOPUBE_SOURCE,'first'))
        first = _extraction_source_versions(database,raster,raster,raster)
        database.execute('UPDATE official_context_sources SET version=?',('second',))
        second = _extraction_source_versions(database,raster,raster,raster)
        assert len({before['semantic'],first['semantic'],second['semantic']}) == 3
        for key in ['building','terrain','border']:
            assert before[key] == first[key] == second[key]
