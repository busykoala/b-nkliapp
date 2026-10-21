"""Compact, deterministic view-capsule codec.

The hot geometry is stored as quantised typed arrays, never as JSON embedded
in NPZ.  A small canonical JSON header only describes array offsets and source
provenance; the payload is a zlib-compressed sequence of native-independent
little-endian arrays.
"""

from __future__ import annotations

import json
import struct
import zlib

import numpy as np

from benchly.panorama.models import (
    BuildingProjectionSample,
    PanoramaColumn,
    PanoramaConfig,
    PanoramaGeometry,
    ProjectedBuilding,
    SemanticClass,
    SourceEvidence,
    TerrainEdge,
    VisibleSpan,
)

MAGIC = b"BNKPC\0\0\1"
FORMAT = "benchly-view-capsule"
FORMAT_SCHEMA = 13
SEMANTICS = tuple(SemanticClass)
SEMANTIC_TO_ID = {value: index for index, value in enumerate(SEMANTICS)}
SPAN_DTYPE = np.dtype([
    ("column", "<u2"), ("lower", "<f4"), ("upper", "<f4"),
    ("distance", "<f4"), ("semantic", "u1"), ("confidence", "u1"),
])
EDGE_DTYPE = np.dtype([
    ("column", "<u2"), ("angle", "<f2"), ("distance", "<f4"),
    ("elevation", "<f4"), ("semantic", "u1"), ("kind", "u1"),
    ("confidence", "u1"), ("slope", "<f2"), ("relief", "<f2"),
])
LEGACY_BUILDING_SAMPLE_DTYPE = np.dtype([
    ("building", "<u2"), ("azimuth", "<f2"), ("lower", "<f4"),
    ("eaves", "<f4"), ("upper", "<f4"), ("distance", "<f4"),
])
BUILDING_SAMPLE_DTYPE = np.dtype([
    ("building", "<u2"), ("azimuth", "<f4"), ("lower", "<f4"),
    ("eaves", "<f4"), ("upper", "<f4"), ("distance", "<f4"),
])
BUILDING_FACE_DTYPE = np.dtype([("index", "<i4"), ("normal", "<f4")])
BUILDING_ROOF_DTYPE = np.dtype([("sample", "<u4"), ("lower", "<f4"), ("upper", "<f4")])


def _array_descriptor(offset: int, array: np.ndarray) -> dict[str, object]:
    return {"offset": offset, "bytes": array.nbytes, "dtype": array.dtype.descr or array.dtype.str,
            "shape": list(array.shape)}


def encode_geometry(geometry: PanoramaGeometry) -> bytes:
    skyline = np.asarray([column.skyline_angle_degrees for column in geometry.columns], dtype="<f2")
    spans = np.asarray([
        (column_index, span.lower_angle_degrees, span.upper_angle_degrees, span.distance_meters,
         SEMANTIC_TO_ID[span.semantic], round(span.confidence * 255))
        for column_index, column in enumerate(geometry.columns) for span in column.spans
    ], dtype=SPAN_DTYPE)
    span_normals = np.asarray([span.surface_normal or (np.nan, np.nan, np.nan)
        for column in geometry.columns for span in column.spans], dtype="<f2").reshape(-1, 3)
    edges = np.asarray([
        (column_index, edge.elevation_angle_degrees, edge.distance_meters, edge.terrain_elevation_meters,
         SEMANTIC_TO_ID[edge.semantic], edge.kind == "skyline", round(edge.confidence * 255),
         np.nan if edge.slope_degrees is None else edge.slope_degrees,
         np.nan if edge.relief_meters is None else edge.relief_meters)
        for column_index, column in enumerate(geometry.columns) for edge in column.terrain_edges
    ], dtype=EDGE_DTYPE)
    building_samples = np.asarray([
        (index, sample.azimuth_degrees, sample.lower_angle_degrees, sample.eaves_angle_degrees,
         sample.upper_angle_degrees, sample.distance_meters)
        for index, building in enumerate(geometry.buildings) for sample in building.samples
    ], dtype=BUILDING_SAMPLE_DTYPE)
    building_faces = np.asarray([
        (-1 if sample.facade_index is None else sample.facade_index,
         np.nan if sample.facade_normal_degrees is None else sample.facade_normal_degrees)
        for building in geometry.buildings for sample in building.samples
    ], dtype=BUILDING_FACE_DTYPE)
    profiles = [sample for building in geometry.buildings for sample in building.samples]
    building_roof_known = np.asarray([sample.roof_intervals is not None for sample in profiles], dtype="u1")
    building_roofs = np.asarray([(index, lower, upper) for index, sample in enumerate(profiles)
                                for lower, upper in sample.roof_intervals or ()], dtype=BUILDING_ROOF_DTYPE)
    building_part_indices = np.asarray([-1 if sample.facade_part_index is None else sample.facade_part_index
                                       for sample in profiles], dtype="<i4")
    terrain_sources = sorted({
        span.terrain_source or "unknown"
        for column in geometry.columns for span in column.spans
    } | {
        edge.terrain_source or "unknown"
        for column in geometry.columns for edge in column.terrain_edges
    })
    source_ids = {source: index for index, source in enumerate(terrain_sources)}
    if len(terrain_sources) > 255:
        raise ValueError("view capsule has too many terrain sources")
    span_sources = np.asarray([
        source_ids[span.terrain_source or "unknown"]
        for column in geometry.columns for span in column.spans
    ], dtype="u1")
    edge_sources = np.asarray([
        source_ids[edge.terrain_source or "unknown"]
        for column in geometry.columns for edge in column.terrain_edges
    ], dtype="u1")
    arrays = (skyline, spans, edges, building_samples, span_sources, edge_sources, building_faces, building_roof_known, building_roofs, building_part_indices, span_normals)
    offset = 0
    descriptors: dict[str, object] = {}
    payload_parts: list[bytes] = []
    for name, array in zip(("skyline", "spans", "edges", "building_samples", "span_sources", "edge_sources", "building_faces", "building_roof_known", "building_roofs", "building_part_indices", "span_normals"), arrays):
        descriptors[name] = _array_descriptor(offset, array)
        raw = array.tobytes(order="C")
        payload_parts.append(raw)
        offset += len(raw)
    header = {
        "format": FORMAT,
        "schema": FORMAT_SCHEMA,
        "identity_key": geometry.identity_key,
        "version": geometry.version,
        "latitude": geometry.latitude,
        "longitude": geometry.longitude,
        "ground_elevation_meters": geometry.ground_elevation_meters,
        "eye_elevation_meters": geometry.eye_elevation_meters,
        "display_elevation_meters": geometry.display_elevation_meters,
        "terrain_ground_elevation_meters": geometry.terrain_ground_elevation_meters,
        "ground_elevation_provenance": geometry.ground_elevation_provenance,
        "ground_elevation_confidence": geometry.ground_elevation_confidence,
        "ground_elevation_disagreement_meters": geometry.ground_elevation_disagreement_meters,
        "config": geometry.config.model_dump(mode="json"),
        "sources": [item.model_dump(mode="json") for item in geometry.sources],
        "complete": geometry.complete,
        "warnings": list(geometry.warnings),
        "terrain_sources": terrain_sources,
        "arrays": descriptors,
        "buildings": [building.model_dump(mode="json", exclude={"samples"}) for building in geometry.buildings],
    }
    header_bytes = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    body = zlib.compress(b"".join(payload_parts), level=6)
    return MAGIC + struct.pack("<II", len(header_bytes), len(body)) + header_bytes + body


def _read_array(payload: bytes, descriptor: dict[str, object], dtype: np.dtype) -> np.ndarray:
    offset, size = int(descriptor["offset"]), int(descriptor["bytes"])
    shape = tuple(int(value) for value in descriptor["shape"])
    if offset < 0 or size < 0 or offset + size > len(payload):
        raise ValueError("view capsule array is outside its payload")
    return np.frombuffer(payload[offset:offset + size], dtype=dtype).reshape(shape)


def decode_geometry(data: bytes) -> PanoramaGeometry:
    if len(data) < 16 or data[:8] != MAGIC:
        raise ValueError("not a Benchly view capsule")
    header_size, body_size = struct.unpack("<II", data[8:16])
    if len(data) != 16 + header_size + body_size:
        raise ValueError("truncated view capsule")
    header = json.loads(data[16:16 + header_size])
    schema = int(header.get("schema", 0))
    if header.get("format") != FORMAT or schema not in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, FORMAT_SCHEMA):
        raise ValueError("unsupported view capsule")
    payload = zlib.decompress(data[16 + header_size:])
    arrays = header["arrays"]
    skyline = _read_array(payload, arrays["skyline"], np.dtype("<f2"))
    spans = _read_array(payload, arrays["spans"], SPAN_DTYPE)
    normals = _read_array(payload, arrays["span_normals"], np.dtype("<f2")) if schema >= 9 else np.full((len(spans), 3), np.nan)
    if normals.shape != (len(spans), 3):
        raise ValueError("view capsule normals do not match terrain spans")
    edges = _read_array(payload, arrays["edges"], EDGE_DTYPE)
    semantic_count = len(SEMANTICS) if schema >= 13 else 11 if schema == 12 else 10
    if np.any(spans["semantic"] >= semantic_count) or np.any(edges["semantic"] >= semantic_count):
        raise ValueError("view capsule semantic is not supported by its schema")
    building_samples = _read_array(payload, arrays["building_samples"],
                                   BUILDING_SAMPLE_DTYPE if schema >= 7 else LEGACY_BUILDING_SAMPLE_DTYPE)
    building_faces = _read_array(payload, arrays["building_faces"], BUILDING_FACE_DTYPE) if schema >= 3 else None
    if building_faces is not None and len(building_faces) != len(building_samples):
        raise ValueError("view capsule facade array does not match building samples")
    roof_known = _read_array(payload, arrays["building_roof_known"], np.dtype("u1")) if schema >= 5 else None
    roofs_by_sample = [[] for _ in building_samples]
    part_indices = _read_array(payload, arrays["building_part_indices"], np.dtype("<i4")) if schema >= 6 else None
    if part_indices is not None and len(part_indices) != len(building_samples):
        raise ValueError("view capsule part indices do not match building samples")
    if roof_known is not None:
        if len(roof_known) != len(building_samples) or np.any(roof_known > 1):
            raise ValueError("view capsule roof flags do not match building samples")
        for roof in _read_array(payload, arrays["building_roofs"], BUILDING_ROOF_DTYPE):
            index = int(roof["sample"])
            if index >= len(building_samples) or not roof_known[index]:
                raise ValueError("view capsule roof interval lacks a measured sample")
            roofs_by_sample[index].append((float(roof["lower"]), float(roof["upper"])))
    terrain_sources = header.get("terrain_sources", ["view-capsule"])
    span_sources = (_read_array(payload, arrays["span_sources"], np.dtype("u1"))
                    if schema >= 2 else np.zeros(len(spans), dtype="u1"))
    edge_sources = (_read_array(payload, arrays["edge_sources"], np.dtype("u1"))
                    if schema >= 2 else np.zeros(len(edges), dtype="u1"))
    spans_by_column: list[list[VisibleSpan]] = [[] for _ in skyline]
    for source_index, row, normal in zip(span_sources, spans, normals, strict=True):
        spans_by_column[int(row["column"])].append(VisibleSpan(
            lower_angle_degrees=float(row["lower"]), upper_angle_degrees=float(row["upper"]),
            distance_meters=float(row["distance"]), semantic=SEMANTICS[int(row["semantic"])],
            source="view-capsule", terrain_source=str(terrain_sources[int(source_index)]), confidence=float(row["confidence"]) / 255,
            surface_normal=None if np.isnan(normal).all() else tuple(float(value) for value in normal),
        ))
    edges_by_column: list[list[TerrainEdge]] = [[] for _ in skyline]
    for source_index, row in zip(edge_sources, edges):
        slope, relief = float(row["slope"]), float(row["relief"])
        edges_by_column[int(row["column"])].append(TerrainEdge(
            elevation_angle_degrees=float(row["angle"]), distance_meters=float(row["distance"]),
            terrain_elevation_meters=float(row["elevation"]), semantic=SEMANTICS[int(row["semantic"])],
            kind="skyline" if int(row["kind"]) else "inner-ridge", source="view-capsule",
            terrain_source=str(terrain_sources[int(source_index)]), confidence=float(row["confidence"]) / 255,
            slope_degrees=None if np.isnan(slope) else slope, relief_meters=None if np.isnan(relief) else relief,
        ))
    resolution = float(header["config"]["angular_resolution_degrees"])
    columns = tuple(PanoramaColumn(
        azimuth_degrees=index * resolution, skyline_angle_degrees=float(value),
        spans=tuple(spans_by_column[index]), terrain_edges=tuple(edges_by_column[index]),
    ) for index, value in enumerate(skyline))
    sample_groups: list[list[BuildingProjectionSample]] = [[] for _ in header["buildings"]]
    for index, row in enumerate(building_samples):
        face = building_faces[index] if building_faces is not None else None
        part_index = int(part_indices[index]) if part_indices is not None else -1
        if part_index < -1 or part_index >= len(header["buildings"][int(row["building"])].get("facade_parts", [])):
            raise ValueError("view capsule facade part index lacks source metadata")
        sample_groups[int(row["building"])].append(BuildingProjectionSample(
            # float16 rounds bearings immediately below 360 to 360. Normalise
            # after decoding so the circular value remains valid.
            azimuth_degrees=float(row["azimuth"]) % 360, lower_angle_degrees=float(row["lower"]),
            eaves_angle_degrees=float(row["eaves"]), upper_angle_degrees=float(row["upper"]),
            distance_meters=float(row["distance"]),
            facade_index=int(face["index"]) if face is not None and face["index"] >= 0 else None,
            facade_normal_degrees=float(face["normal"]) % 360 if face is not None and np.isfinite(face["normal"]) else None,
            roof_intervals=tuple(roofs_by_sample[index]) if roof_known is not None and roof_known[index] else None,
            facade_part_index=part_index if part_index >= 0 else None,
        ))
    buildings = tuple(ProjectedBuilding(**metadata, samples=tuple(sample_groups[index]))
                      for index, metadata in enumerate(header["buildings"]))
    return PanoramaGeometry(
        version=header["version"], identity_key=header["identity_key"], latitude=header["latitude"],
        longitude=header["longitude"], ground_elevation_meters=header["ground_elevation_meters"],
        eye_elevation_meters=header["eye_elevation_meters"],
        display_elevation_meters=header.get("display_elevation_meters"),
        terrain_ground_elevation_meters=header.get("terrain_ground_elevation_meters"),
        ground_elevation_provenance=header.get("ground_elevation_provenance", "unavailable"),
        ground_elevation_confidence=header.get("ground_elevation_confidence", "unavailable"),
        ground_elevation_disagreement_meters=header.get("ground_elevation_disagreement_meters"),
        config=PanoramaConfig(**header["config"]),
        columns=columns, buildings=buildings,
        sources=tuple(SourceEvidence(**item) for item in header["sources"]),
        complete=bool(header["complete"]), warnings=tuple(header["warnings"]),
    )
