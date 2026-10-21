from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageFilter
import pytest
from shapely import to_wkb
from shapely.geometry import box

from benchly.panorama.binary import MAGIC, decode_geometry, encode_geometry
from benchly.panorama.datasets import BuildingIndex, WGS84_TO_LV95, buildings_for_viewpoint
from benchly.panorama.facades import _mark_mask, facade_coordinates, paint_referenced_facades
from benchly.panorama.models import (
    BuildingGeometry, FacadeMark, FacadeReference, GeometryIdentity, PanoramaConfig,
    TerrainRay, TerrainSample,
)
from benchly.panorama.visibility import build_panorama_geometry

spec = importlib.util.spec_from_file_location("facade_reference_import", Path(__file__).parents[2] / "scripts/panorama-art/facade-references.py")
curation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(curation)


def reference(**changes):
    return FacadeReference(reference_id="north-face", source_url="https://example.org/dated-photo",
        photo_sha256="a" * 64, observed_at="2021-05-26", confidence="medium", description="Observed central opening",
        wall_tone="chalk", start=(-10,20,500,508), end=(10,20,500,508),
        marks=(FacadeMark(kind="opening", bounds=(.44,.3,.56,.7)),)).model_copy(update=changes)


def scene():
    config = PanoramaConfig(angular_resolution_degrees=1, maximum_distance_meters=1000)
    identity = GeometryIdentity(latitude=46.9, longitude=8.2, ground_elevation_meters=500,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture", angular_resolution_degrees=1)
    rays = [TerrainRay(azimuth_degrees=angle, samples=tuple(TerrainSample(distance_meters=d, elevation_meters=500)
            for d in (2,20,100))) for angle in range(360)]
    house = BuildingGeometry(source_id="house", source="measured", confidence=1,
        footprint=((-10,20),(10,20),(10,25),(-10,25)), ground_elevation_meters=500,
        eaves_elevation_meters=508, roof_elevation_meters=508, facade_references=(reference(),))
    return build_panorama_geometry(identity, rays, [house], config=config)


@pytest.mark.parametrize("shape", ["rectangle", "ellipse", "round-arch"])
def test_reference_projection_wraps_and_never_paints_outside_visible_wall(shape):
    geometry = scene()
    geometry = geometry.model_copy(update={"buildings": tuple(b.model_copy(update={
        "facade_references": (reference(marks=(FacadeMark(kind="opening", bounds=(.44,.3,.56,.7), shape=shape),)),)
    }) for b in geometry.buildings)})
    building = geometry.buildings[0]
    xs, u, v, visible = facade_coordinates(reference(), geometry, building, 720, 360)
    original = Image.new("RGB", (720,360), (160,160,140))
    painted = original.copy()
    paint_referenced_facades(painted, geometry, Image.new("L", original.size,128))
    rgb = np.array(painted)
    changed = np.any(rgb != np.array(original), axis=-1)
    allowed = np.zeros((360,720), dtype=bool); allowed[:,xs] = visible
    assert changed.any() and not (changed & ~allowed).any()
    # A central north opening crosses both ends; it must not turn into two
    # displaced half-windows or a bright strip at the panorama seam.
    closed = geometry.model_copy(update={"buildings": tuple(b.model_copy(update={
        "facade_references": tuple(r.model_copy(update={"marks": ()}) for r in b.facade_references)
    }) for b in geometry.buildings)})
    plaster = original.copy()
    paint_referenced_facades(plaster, closed, Image.new("L", original.size, 128))
    # Contrast is against the same plaster wash, not an absolute darkness that
    # would force a transparent watercolor opening back into an opaque stamp.
    dark = (np.asarray(plaster, dtype=float) - rgb).mean(axis=-1) > 20
    assert dark[:,0].any() and dark[:,-1].any()
    # Adjacent bearings may have a small wash gradient; there is no phase reset.
    assert np.abs(rgb[:,0].astype(int) - rgb[:,-1].astype(int)).max() <= 1
    # Same surveyed UV at both sides of the middle is symmetric in this face.
    assert abs(u[0] - .5) < .02 and abs(u[-1] - .5) < .02


def test_reference_rejects_back_face_and_same_solid_foreground_annex():
    geometry = scene(); building = geometry.buildings[0]
    assert facade_coordinates(reference(start=(10,20,500,508),end=(-10,20,500,508)), geometry, building,720,360) is None
    nearer = building.model_copy(update={"samples":tuple(s.model_copy(update={"distance_meters":s.distance_meters-5}) for s in building.samples)})
    assert facade_coordinates(reference(), geometry, nearer,720,360) is None


def test_brush_deposit_varies_only_the_observed_marks_and_keeps_wall_ownership():
    geometry = scene()
    encoded = encode_geometry(geometry)
    size = (720, 360)
    paper = Image.new("L", size, 128)
    uniform = Image.new("RGB", size, (160, 160, 140))
    varied = uniform.copy()
    # A circular, asymmetric load crosses north without splitting the opening.
    xs = np.arange(size[0])
    load = np.rint(128 + 110 * np.sin(2 * np.pi * xs / size[0])).astype(np.uint8)
    brush = Image.fromarray(np.broadcast_to(load, (size[1], size[0])).copy(), "L")
    paint_referenced_facades(uniform, geometry, paper, paper)
    paint_referenced_facades(varied, geometry, paper, brush)
    changed = np.any(np.asarray(varied) != np.asarray(uniform), axis=-1)
    columns, u, v, visible = facade_coordinates(reference(), geometry, geometry.buildings[0], *size)
    frame = _mark_mask(reference(), reference().marks[0], u, v, .007) & visible
    field = np.zeros((size[1], size[0]), dtype=np.uint8)
    field[:, columns] = frame * 255
    # The wet edge can soften by a few pixels; the surveyed wall remains a hard
    # ownership limit. A changed brush must not recolour the rest of the plaster.
    wrapped = np.concatenate((field[:, -3:], field, field[:, :3]), axis=1)
    allowed = np.asarray(Image.fromarray(wrapped).filter(ImageFilter.MaxFilter(7)))[:, 3:-3] > 0
    wall = np.zeros_like(allowed); wall[:, columns] = visible
    assert changed.any() and not (changed & ~(allowed & wall)).any()
    assert encode_geometry(geometry) == encoded


def test_visible_roof_and_occluded_ground_never_receive_reference_marks():
    geometry = scene(); building = geometry.buildings[0]
    clipped = building.model_copy(update={"samples":tuple(s.model_copy(update={
        "lower_angle_degrees": 5, "eaves_angle_degrees":max(5,s.eaves_angle_degrees),
        "roof_intervals":((8,s.upper_angle_degrees),) if s.upper_angle_degrees>8 else (),
    }) for s in building.samples)})
    xs, _, _, visible = facade_coordinates(reference(),geometry,clipped,720,360)
    angles = 58 - (np.arange(360) + .5) / 360 * 90
    assert visible.any()
    assert not visible[angles<5].any() and not visible[angles>=8].any()


def test_reference_metadata_roundtrips_and_schema_seven_remains_readable():
    geometry = scene(); encoded = encode_geometry(geometry)
    decoded = decode_geometry(encoded)
    assert decoded.buildings[0].facade_references == (reference(),)
    size, body_size = struct.unpack("<II", encoded[8:16]); header=json.loads(encoded[16:16+size])
    header["schema"]=7
    for building in header["buildings"]: building.pop("facade_references")
    raw = json.dumps(header).encode(); body=encoded[16+size:16+size+body_size]
    legacy = decode_geometry(MAGIC+struct.pack("<II",len(raw),len(body))+raw+body)
    assert not legacy.buildings[0].facade_references
    base=Image.new("RGB",(720,360),(160,160,140)); before=base.tobytes()
    paint_referenced_facades(base,legacy,Image.new("L",base.size,128))
    assert base.tobytes()==before  # No photo means no invented openings.


def test_schema_nine_defaults_missing_observed_shapes_to_rectangles():
    encoded = encode_geometry(scene())
    size, body_size = struct.unpack("<II", encoded[8:16])
    header = json.loads(encoded[16:16+size]); header["schema"] = 9
    for building in header["buildings"]:
        for face in building.get("facade_references", []):
            for mark in face["marks"]:
                mark.pop("shape")
    raw = json.dumps(header).encode(); body = encoded[16+size:16+size+body_size]
    legacy = decode_geometry(MAGIC+struct.pack("<II",len(raw),len(body))+raw+body)
    assert legacy.buildings[0].facade_references == (reference(),)


def test_schema_eleven_preserves_unknown_date_and_reads_dated_schema_ten():
    geometry = scene()
    building = geometry.buildings[0]
    unknown = reference(observed_at=None)
    geometry = geometry.model_copy(update={"buildings": (building.model_copy(update={"facade_references": (unknown,)}),)})
    encoded = encode_geometry(geometry)
    assert decode_geometry(encoded).buildings[0].facade_references[0].observed_at is None
    # Older dated capsules retain the same known date and geometry contract.
    dated = encode_geometry(scene())
    size, body_size = struct.unpack("<II", dated[8:16])
    header = json.loads(dated[16:16+size]); header["schema"] = 10
    raw = json.dumps(header).encode(); body = dated[16+size:16+size+body_size]
    decoded = decode_geometry(MAGIC+struct.pack("<II",len(raw),len(body))+raw+body)
    assert decoded.buildings[0].facade_references == (reference(),)
    missing = unknown.model_dump(); missing.pop("observed_at")
    with pytest.raises(ValueError): FacadeReference.model_validate(missing)


def test_observed_shapes_keep_opening_corners_clear_and_arch_sides_straight():
    u = np.array([.21,.5,.79])
    v = np.array([[.11]*3,[.5]*3,[.89]*3])
    ellipse = FacadeMark(kind="opening", bounds=(.2,.1,.8,.9), shape="ellipse")
    arch = ellipse.model_copy(update={"shape":"round-arch"})
    face = reference(start=(-5,20,500,508),end=(5,20,500,508))
    circle = _mark_mask(face,ellipse,u,v)
    rounded = _mark_mask(face,arch,u,v)
    np.testing.assert_array_equal(circle,[[False,True,False],[True,True,True],[False,True,False]])
    np.testing.assert_array_equal(rounded,[[True,True,True],[True,True,True],[False,True,False]])
    # The conservative frame follows the observed shape too; it must not
    # reinstate a rectangular stone block around a circular opening.
    assert not _mark_mask(face,ellipse,u,v,.007)[0,0]


def test_observed_arched_shapes_survive_capsule_encoding():
    geometry = scene(); building = geometry.buildings[0]
    observed = reference(marks=(FacadeMark(kind="entrance",bounds=(.4,0,.6,.7),shape="round-arch"),
                                FacadeMark(kind="opening",bounds=(.1,.4,.2,.6),shape="ellipse")))
    geometry = geometry.model_copy(update={"buildings":(building.model_copy(update={"facade_references":(observed,)}),)})
    assert decode_geometry(encode_geometry(geometry)).buildings[0].facade_references == (observed,)


@pytest.mark.parametrize("bounds", [(0,0,0,1),(-.1,0,.5,1),(0,0,1,1.01),(0,float('nan'),1,1)])
def test_reference_bounds_reject_unbounded_or_empty_rectangles(bounds):
    with pytest.raises(ValueError): FacadeMark(kind="opening",bounds=bounds)


def test_curation_checks_photo_source_building_and_measured_anchor(tmp_path):
    cache=tmp_path/"data/panorama-artist-review/facade-references"; cache.mkdir(parents=True)
    photo=cache/"photo.jpg"; photo.write_bytes(b"test photo")
    import hashlib
    checksum=hashlib.sha256(photo.read_bytes()).hexdigest()
    ref=reference(photo_sha256=checksum)
    photo.with_name("photo.jpg.source.json").write_text(json.dumps({"sha256":checksum,"sourcePage":ref.source_url,
        "metadata":{"DateTimeOriginal":{"value":"2021-05-26 11:48:45"}}}))
    row={"source":"swissBUILDINGS3D","source_id":"house","source_version":"fixture",
         "geometry_wkb":to_wkb(box(-10,20,10,25)),"raw_tags":json.dumps({"benchly:roof_mesh":{"faces":[[[-10,20,508],[10,20,508],[0,25,510]]]}})}
    entry={"face":ref.model_dump(mode="json"),"photoPath":str(photo.relative_to(tmp_path)),
           "buildingSha256":curation.source_identity(row),"attribution":"Photographer","licenseUrl":"https://example.org/license",
           "bindingEvidence":["verified face"],"groundEvidence":[500,500],"limitations":["approximate openings"]}
    assert curation.validate_face(entry,row,tmp_path)==ref
    changed={**row,"source_version":"changed"}
    with pytest.raises(ValueError,match="identity changed"): curation.validate_face(entry,changed,tmp_path)
    wrong={**entry,"face":ref.model_copy(update={"start":(-10,20,500,509)}).model_dump(mode="json")}
    with pytest.raises(ValueError,match="roof vertex"): curation.validate_face(wrong,row,tmp_path)
    wrong={**entry,"photoPath":"../../unrelated.jpg"}
    with pytest.raises(ValueError,match="isolated reference cache"): curation.validate_face(wrong,row,tmp_path)
    photo.write_bytes(b"changed photo")
    with pytest.raises(ValueError,match="checksum"): curation.validate_face(entry,row,tmp_path)


def test_source_parser_keeps_true_bearings_and_ignores_unrelated_faces():
    latitude,longitude=46.9,8.2; east,north=WGS84_TO_LV95.transform(longitude,latitude)
    ref=reference(start=(east-10,north+20,500,508),end=(east+10,north+20,500,508))
    row={"source":"swissBUILDINGS3D","source_id":"house","source_version":"fixture",
        "geometry_wkb":to_wkb(box(east-10,north+20,east+10,north+25)),"center_latitude":latitude+.0002,
        "center_longitude":longitude,"ground_elevation_meters":500,"eaves_elevation_meters":508,"roof_elevation_meters":508,
        "height_meters":8,"raw_tags":json.dumps({"benchly:facade_references":{"version":1,"crs":2056,"faces":[ref.model_dump(mode="json")]}})}
    class Terrain:
        @staticmethod
        def sample_many(locations): return [500.] * len(locations)
    result=buildings_for_viewpoint(BuildingIndex([row]),latitude,longitude,Terrain(),1000)[0]
    assert len(result.facade_references)==1
    assert np.linalg.norm(np.array(result.facade_references[0].start[:2])-[-10,20]) < .3
    assert result.facade_references[0].start[2:]==(500,508)
    row["raw_tags"]=json.dumps({"benchly:facade_references":{"version":1,"crs":2056,"faces":[
        ref.model_copy(update={"start":(east+200,north+20,500,508)}).model_dump(mode="json")]}})
    assert not buildings_for_viewpoint(BuildingIndex([row]),latitude,longitude,Terrain(),1000)[0].facade_references


def test_curation_binds_undated_link_only_photo_to_interpolated_source_edge(tmp_path):
    import hashlib
    cache = tmp_path / "data/panorama-artist-review/facade-references"; cache.mkdir(parents=True)
    photo = cache / "guide-crop.png"; photo.write_bytes(b"local reference crop")
    checksum = hashlib.sha256(photo.read_bytes()).hexdigest()
    ref = reference(observed_at=None, photo_sha256=checksum, start=(-5,20,500,508), end=(5,20,500,508))
    meta = {"sha256":checksum, "sourcePage":ref.source_url, "captureDateStatus":"unknown", "redistributionAllowed":False}
    metadata = photo.with_name(photo.name + ".source.json")
    metadata.write_text(json.dumps(meta))
    row = {"source":"swissBUILDINGS3D", "source_id":"house", "source_version":"fixture",
           "geometry_wkb":to_wkb(box(-10,20,10,25)),
           "raw_tags":json.dumps({"benchly:roof_mesh":{"faces":[[[-10,20,508],[10,20,508],[0,25,510]]]}})}
    entry = {"face":ref.model_dump(mode="json"), "photoPath":str(photo.relative_to(tmp_path)),
             "buildingSha256":curation.source_identity(row), "attribution":"Municipal photographer",
             "reuse":"link-only", "redistributionAllowed":False, "bindingEvidence":["address and frontage"],
             "groundEvidence":[500,500], "limitations":["unknown date and approximate proportions"]}
    assert curation.validate_face(entry,row,tmp_path) == ref
    for changes, message in [({"captureDateStatus":None}, "explicit unknown"),
                             ({"metadata":{"DateTimeOriginal":{"value":"2020-01-01"}}}, "conflicting"),
                             ({"redistributionAllowed":True}, "prohibit redistribution")]:
        metadata.write_text(json.dumps({**meta, **changes}))
        with pytest.raises(ValueError,match=message): curation.validate_face(entry,row,tmp_path)
    metadata.write_text(json.dumps(meta))
    for changes in ({"redistributionAllowed":True}, {"reuse":"licensed-copy"}, {"reuse":"unverified"}):
        with pytest.raises(ValueError): curation.validate_face({**entry, **changes},row,tmp_path)
    for start in [(-5,20,500,508.1), (-5,20.1,500,508), (-5,21,500,508), (-11,20,500,508)]:
        wrong = {**entry,"face":ref.model_copy(update={"start":start}).model_dump(mode="json")}
        with pytest.raises(ValueError): curation.validate_face(wrong,row,tmp_path)


def test_interpolated_eaves_use_source_edge_height_and_reject_roof_interior():
    faces = [[[-10,20,508],[10,20,510],[10,25,512],[-10,25,510]]]
    assert curation.on_roof_edge((0,20,500,509),faces)
    assert not curation.on_roof_edge((0,20,500,508),faces)
    assert not curation.on_roof_edge((0,22,500,509.8),faces)
    assert not curation.on_roof_edge((11,20,500,510),faces)
