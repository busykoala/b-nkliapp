"""Surveyed paving must retain its actual extent, material facts and old contracts."""
import json,struct
import numpy as np
import pytest
from shapely.geometry import Point,box
from benchly.context.paving import sitg_paved_surfaces
from benchly.panorama.binary import decode_geometry,encode_geometry
from benchly.panorama.datasets import SemanticIndex,WGS84_TO_LV95
from benchly.panorama.material import MATERIAL_SEMANTIC_IDS
from benchly.panorama.models import GeometryIdentity,PanoramaConfig,SemanticClass,TerrainRay,TerrainSample
from benchly.panorama.visibility import build_panorama_geometry


def ring(x=2_500_000,y=1_100_000,size=10):
    return [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]


def feature(identity=1,finish='Béton',level=0,rings=None):
    return {'attributes':{'ID_SURFACE':identity,'OBJECTID':44,'REVETEMENT':finish,'NIVEAU':level,'DATEDT':None},'geometry':{'rings':rings or [ring()]}}


def page(*features):
    return {'spatialReference':{'wkid':2056},'geometryType':'esriGeometryPolygon','features':list(features)}


def test_only_explicit_paving_and_ground_level_qualify():
    finishes=['Béton','Béton bitumineux','Pavés','Gazon','Graviers','Grille gazon','Arbustes','Prairie','Terre','Autre',None]
    values=[feature(i+1,f)for i,f in enumerate(finishes)]
    values += [feature(100+i,'Béton',level)for i,level in enumerate([-2,-1,1,2,None,False,'0'])]
    result=sitg_paved_surfaces(page(*values))
    assert [r.finish for r in result]==finishes[:3]
    assert all(r.updated_milliseconds is None for r in result)


def test_holes_and_disconnected_islands_are_preserved_without_repair():
    r=sitg_paved_surfaces(page(feature(rings=[ring(size=20),ring(2_500_005,1_100_005,10),ring(2_500_008,1_100_008,2),ring(2_500_030,1_100_000,5)])))[0]
    assert r.geometry.contains(Point(2_500_001,1_100_001))
    assert not r.geometry.contains(Point(2_500_006,1_100_006))
    assert r.geometry.contains(Point(2_500_009,1_100_009))
    assert r.geometry.contains(Point(2_500_032,1_100_002))
    assert r.geometry.area==329


def test_parent_surface_can_have_multiple_finish_components_with_stable_identities():
    a,b=feature(7),feature(7,'Pavés',rings=[ring(2_500_020)])
    first=sitg_paved_surfaces(page(a,b));a['attributes']['OBJECTID']=999
    a['geometry']['rings'][0]=list(reversed(a['geometry']['rings'][0]))
    second=sitg_paved_surfaces(page(b,a))
    assert {r.source_id for r in first}=={r.source_id for r in second}
    assert len({r.source_id for r in first})==2
    assert {r.parent_surface_id for r in first}=={'7'}
    with pytest.raises(ValueError,match='repeats'):sitg_paved_surfaces(page(a,a))


@pytest.mark.parametrize('change',[lambda p:p.update(spatialReference={'wkid':4326}),lambda p:p.update(exceededTransferLimit=True),lambda p:p.update(geometryType='esriGeometryPolyline')])
def test_wrong_crs_incomplete_queries_and_lines_are_rejected(change):
    p=page(feature());change(p)
    with pytest.raises(ValueError):sitg_paved_surfaces(p)


@pytest.mark.parametrize('rings',[[ring()[:-1]],[[[0,0],[1,0],[1,1],[0,0]]],[[[2_500_000,1_100_000],[float('nan'),1_100_001],[2_500_002,1_100_002],[2_500_000,1_100_000]]],[ring(),ring(2_500_005,1_100_005)],[[[2_500_000,1_100_000,10],[2_500_010,1_100_000,10],[2_500_010,1_100_010,10],[2_500_000,1_100_000,10]]]])
def test_invalid_source_geometry_is_rejected_instead_of_buffered_or_healed(rings):
    with pytest.raises(ValueError):sitg_paved_surfaces(page(feature(rings=rings)))


def geometry(semantic):
    config=PanoramaConfig(angular_resolution_degrees=90,maximum_distance_meters=1000)
    identity=GeometryIdentity(latitude=47,longitude=8,ground_elevation_meters=0,terrain_version='dem',semantic_version='paving',building_version='buildings',angular_resolution_degrees=90)
    rays=[TerrainRay(azimuth_degrees=a,samples=tuple(TerrainSample(distance_meters=d,elevation_meters=0,semantic=semantic,surface_normal=(0,0,1))for d in[2,10,100,1000]))for a in[0,90,180,270]]
    return build_panorama_geometry(identity,rays,config=config)


def change_schema(raw,schema):
    n,m=struct.unpack('<II',raw[8:16]);header=json.loads(raw[16:16+n]);header['schema']=schema;encoded=json.dumps(header,sort_keys=True,separators=(',',':')).encode();return raw[:8]+struct.pack('<II',len(encoded),m)+encoded+raw[16+n:]


def test_paving_uses_new_schema_and_discrete_id_while_schema11_remains_readable():
    g=geometry(SemanticClass.PAVED_GROUND);raw=encode_geometry(g);restored=decode_geometry(raw)
    assert {s.semantic for c in restored.columns for s in c.spans}=={SemanticClass.PAVED_GROUND}
    assert MATERIAL_SEMANTIC_IDS[SemanticClass.PAVED_GROUND]==10
    assert MATERIAL_SEMANTIC_IDS[SemanticClass.UNKNOWN_TERRAIN]==9
    with pytest.raises(ValueError,match='semantic'):decode_geometry(change_schema(raw,11))
    old=geometry(SemanticClass.UNKNOWN_TERRAIN);decoded=decode_geometry(change_schema(encode_geometry(old),11))
    assert {s.semantic for c in decoded.columns for s in c.spans}=={SemanticClass.UNKNOWN_TERRAIN}


def test_paving_overrides_broad_forest_but_never_known_water():
    east,north=WGS84_TO_LV95.transform(8,47);area=box(east-10,north-10,east+10,north+10)
    records=[(area,SemanticClass.FOREST,.9,'swissTLM3D'),(area,SemanticClass.PAVED_GROUND,.9,'SITG-paved-ground')]
    classify=lambda r:SemanticIndex(r).classify(np.array([8.]),np.array([47.]))[0][0]
    assert classify(records)==classify(list(reversed(records)))==SemanticClass.PAVED_GROUND
    records.append((area,SemanticClass.WATER,.98,'swissTLM3D'))
    assert classify(records)==classify(list(reversed(records)))==SemanticClass.WATER


def test_legacy_false_colour_categories_do_not_shift_when_new_semantics_are_added():
    from benchly.panorama.diagnostics import LEGACY_IDS
    assert len(LEGACY_IDS)==10
    assert LEGACY_IDS[255]==SemanticClass.UNKNOWN_TERRAIN
    assert LEGACY_IDS[round(4/10*255)]==SemanticClass.FOREST
    assert SemanticClass.PAVED_GROUND not in LEGACY_IDS.values()


def test_qualified_paving_source_version_invalidates_semantics_independently_of_buildings():
    import sqlite3
    from types import SimpleNamespace
    from benchly.panorama.builder import _extraction_source_versions
    db=sqlite3.connect(':memory:');db.executescript('CREATE TABLE official_context_sources(source TEXT,version TEXT); CREATE TABLE pipeline_runs(id INTEGER,kind TEXT,status TEXT,source_version TEXT,pipeline_version TEXT,finished_at TEXT);')
    raster=SimpleNamespace(datasets=[])
    before=_extraction_source_versions(db,raster,raster,raster)
    db.execute("INSERT INTO official_context_sources VALUES('SITG-paved-ground','first')")
    first=_extraction_source_versions(db,raster,raster,raster)
    db.execute("UPDATE official_context_sources SET version='second'")
    second=_extraction_source_versions(db,raster,raster,raster)
    assert len({before['semantic'],first['semantic'],second['semantic']})==3
    assert before['building']==first['building']==second['building']
    assert before['terrain']==first['terrain']==second['terrain']
    db.close()


def test_undisplaced_wash_keeps_a_thin_surveyed_strip_inside_its_coverage():
    from PIL import Image
    from benchly.panorama.watercolor import _paint_wash
    mask = Image.new('L', (25, 20))
    mask.paste(255, (12, 2, 13, 18))
    pigment = Image.new('L', mask.size, 255)
    original = Image.new('RGB', mask.size, (60, 110, 65))
    stable, displaced = original.copy(), original.copy()
    _paint_wash(stable, mask, (150, 149, 140), 1.16, (pigment,), displace=False)
    _paint_wash(displaced, mask, (150, 149, 140), 1.16, (pigment,))
    changed = np.any(np.array(stable) != np.array(original), axis=2)
    assert np.array_equal(changed, np.array(mask) > 0)
    # The default broad-material registrations really would shift this
    # one-pixel route outside its surveyed footprint.
    assert np.any(np.any(np.array(displaced) != np.array(original), axis=2) & (np.array(mask) == 0))


def test_late_natural_glazes_cannot_erase_the_paved_surface_wash(monkeypatch):
    import io
    from PIL import Image
    from benchly.panorama import watercolor
    from benchly.panorama.material import unpack_material_transport
    g = geometry(SemanticClass.PAVED_GROUND)
    # A conspicuous diagnostic glaze makes the order observable in pixels:
    # paving should retain its neutral wash; untouched sky keeps the marker.
    monkeypatch.setattr(watercolor, '_paint_distant_atmosphere',
        lambda base, *args: base.paste((255, 0, 0), (0, 0, *base.size)))
    image = np.array(Image.open(io.BytesIO(watercolor.render_panorama_webp(g, 360, 240, 'autumn'))).convert('RGB'), dtype=np.int16)
    material = unpack_material_transport(np.array(Image.open(io.BytesIO(watercolor.render_material_webp(g, 360, 240))).convert('RGBA')))
    paved = (material[..., 1] == 10) & (material[..., 3] == 255)
    sky = material[..., 1] == 0
    assert paved.sum() > 1000
    redness = image[..., 0] - image[..., 1]
    # The translucent pigment need not erase its underpainting, but it must
    # substantially suppress the diagnostic glaze on the actual paved class.
    assert np.percentile(redness[paved], 95) < .7 * np.median(redness[sky])
    assert np.median(redness[sky]) > 200
