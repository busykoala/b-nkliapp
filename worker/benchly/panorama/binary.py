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
FORMAT_SCHEMA = 1
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
BUILDING_SAMPLE_DTYPE = np.dtype([
    ("building", "<u2"), ("azimuth", "<f2"), ("lower", "<f4"),
    ("eaves", "<f4"), ("upper", "<f4"), ("distance", "<f4"),
])


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
    arrays = (skyline, spans, edges, building_samples)
    offset = 0
    descriptors: dict[str, object] = {}
    payload_parts: list[bytes] = []
    for name, array in zip(("skyline", "spans", "edges", "building_samples"), arrays):
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
        "config": geometry.config.model_dump(mode="json"),
        "sources": [item.model_dump(mode="json") for item in geometry.sources],
        "complete": geometry.complete,
        "warnings": list(geometry.warnings),
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
    if header.get("format") != FORMAT or header.get("schema") != FORMAT_SCHEMA:
        raise ValueError("unsupported view capsule")
    payload = zlib.decompress(data[16 + header_size:])
    arrays = header["arrays"]
    skyline = _read_array(payload, arrays["skyline"], np.dtype("<f2"))
    spans = _read_array(payload, arrays["spans"], SPAN_DTYPE)
    edges = _read_array(payload, arrays["edges"], EDGE_DTYPE)
    building_samples = _read_array(payload, arrays["building_samples"], BUILDING_SAMPLE_DTYPE)
    spans_by_column: list[list[VisibleSpan]] = [[] for _ in skyline]
    for row in spans:
        spans_by_column[int(row["column"])].append(VisibleSpan(
            lower_angle_degrees=float(row["lower"]), upper_angle_degrees=float(row["upper"]),
            distance_meters=float(row["distance"]), semantic=SEMANTICS[int(row["semantic"])],
            source="view-capsule", terrain_source="view-capsule", confidence=float(row["confidence"]) / 255,
        ))
    edges_by_column: list[list[TerrainEdge]] = [[] for _ in skyline]
    for row in edges:
        slope, relief = float(row["slope"]), float(row["relief"])
        edges_by_column[int(row["column"])].append(TerrainEdge(
            elevation_angle_degrees=float(row["angle"]), distance_meters=float(row["distance"]),
            terrain_elevation_meters=float(row["elevation"]), semantic=SEMANTICS[int(row["semantic"])],
            kind="skyline" if int(row["kind"]) else "inner-ridge", source="view-capsule",
            terrain_source="view-capsule", confidence=float(row["confidence"]) / 255,
            slope_degrees=None if np.isnan(slope) else slope, relief_meters=None if np.isnan(relief) else relief,
        ))
    resolution = float(header["config"]["angular_resolution_degrees"])
    columns = tuple(PanoramaColumn(
        azimuth_degrees=index * resolution, skyline_angle_degrees=float(value),
        spans=tuple(spans_by_column[index]), terrain_edges=tuple(edges_by_column[index]),
    ) for index, value in enumerate(skyline))
    sample_groups: list[list[BuildingProjectionSample]] = [[] for _ in header["buildings"]]
    for row in building_samples:
        sample_groups[int(row["building"])].append(BuildingProjectionSample(
            # float16 rounds bearings immediately below 360 to 360. Normalise
            # after decoding so the circular value remains valid.
            azimuth_degrees=float(row["azimuth"]) % 360, lower_angle_degrees=float(row["lower"]),
            eaves_angle_degrees=float(row["eaves"]), upper_angle_degrees=float(row["upper"]),
            distance_meters=float(row["distance"]),
        ))
    buildings = tuple(ProjectedBuilding(**metadata, samples=tuple(sample_groups[index]))
                      for index, metadata in enumerate(header["buildings"]))
    return PanoramaGeometry(
        version=header["version"], identity_key=header["identity_key"], latitude=header["latitude"],
        longitude=header["longitude"], ground_elevation_meters=header["ground_elevation_meters"],
        eye_elevation_meters=header["eye_elevation_meters"], config=PanoramaConfig(**header["config"]),
        columns=columns, buildings=buildings,
        sources=tuple(SourceEvidence(**item) for item in header["sources"]),
        complete=bool(header["complete"]), warnings=tuple(header["warnings"]),
    )
