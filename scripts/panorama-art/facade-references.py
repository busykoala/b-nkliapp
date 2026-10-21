"""Validate curated photographic faces; optionally apply to isolated review DB.

This command does not fetch, guess openings or accept another database path.
It refuses changed photographs, measured solids, roof anchors or attribution.
"""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import sys

from shapely import from_wkb
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "worker"))
from benchly.panorama.models import FacadeReference  # noqa: E402

SOURCE = "benchly-facade-references"


def source_identity(row):
    tags = json.loads(row["raw_tags"] or "{}")
    payload = {"source": row["source"], "sourceId": row["source_id"], "version": row["source_version"],
               "footprint": bytes(row["geometry_wkb"]).hex(), "mesh": tags.get("benchly:roof_mesh")}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def on_roof_edge(anchor, faces):
    """Accept measured vertices and interpolated positions on actual roof edges.

    XY alone is insufficient: the eaves elevation must follow the same 3-D
    source edge. Do not accept arbitrary points inside a roof polygon.
    """
    for face in faces:
        for start, end in zip(face, face[1:] + face[:1]):
            dx, dy = end[0] - start[0], end[1] - start[1]
            length2 = dx * dx + dy * dy
            if length2 == 0:
                continue
            fraction = ((anchor[0] - start[0]) * dx + (anchor[1] - start[1]) * dy) / length2
            fraction = max(0., min(1., fraction))
            x, y, z = (start[i] + fraction * (end[i] - start[i]) for i in range(3))
            if math.hypot(anchor[0] - x, anchor[1] - y) < .02 and abs(anchor[3] - z) < .02:
                return True
    return False


def validate_face(entry, row, root=ROOT):
    reference = FacadeReference.model_validate(entry["face"])
    if row["source"] != "swissBUILDINGS3D" or source_identity(row) != entry["buildingSha256"]:
        raise ValueError("Measured building identity changed; review the facade binding")
    photo = (root / entry["photoPath"]).resolve()
    if not photo.is_relative_to((root / "data/panorama-artist-review/facade-references").resolve()):
        raise ValueError("Photo must be inside the isolated reference cache")
    meta = json.loads(photo.with_name(photo.name + ".source.json").read_text())
    if hashlib.sha256(photo.read_bytes()).hexdigest() != reference.photo_sha256 or meta["sha256"] != reference.photo_sha256:
        raise ValueError("Photographic reference checksum changed")
    if meta["sourcePage"] != reference.source_url or not entry.get("attribution"):
        raise ValueError("Photographic source/attribution is missing or inconsistent")
    reuse = entry.get("reuse", "licensed-copy")
    if reuse == "link-only":
        if entry.get("redistributionAllowed") is not False or meta.get("redistributionAllowed") is not False:
            raise ValueError("Link-only photographic source must prohibit redistribution explicitly")
    elif reuse != "licensed-copy" or not entry.get("licenseUrl"):
        raise ValueError("Photographic reuse requires a licence or explicit link-only mode")
    photo_date = meta.get("metadata", {}).get("DateTimeOriginal", {}).get("value", "")[:10]
    if reference.observed_at is None:
        if photo_date or meta.get("captureDateStatus") != "unknown":
            raise ValueError("Unknown photograph date requires explicit unknown metadata and no conflicting observation date")
    elif photo_date != reference.observed_at:
        raise ValueError("Photograph observation date differs from curation")
    geometry = from_wkb(bytes(row["geometry_wkb"]))
    tags = json.loads(row["raw_tags"] or "{}")
    faces = tags.get("benchly:roof_mesh", {}).get("faces", [])
    for anchor in (reference.start, reference.end):
        if geometry.exterior.distance(Point(*anchor[:2])) > .35:
            raise ValueError("Facade anchor is not on the measured exterior")
        if not on_roof_edge(anchor, faces):
            raise ValueError("Facade eaves anchor is not a source roof vertex or interpolated edge")
    if geometry.exterior.distance(Point((reference.start[0] + reference.end[0]) / 2,
                                        (reference.start[1] + reference.end[1]) / 2)) > .35:
        raise ValueError("Facade plane crosses an unmapped setback")
    if not entry.get("bindingEvidence") or not entry.get("groundEvidence") or not entry.get("limitations"):
        raise ValueError("Face binding, ground evidence and limits are required")
    return reference


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    path = ROOT / "config/panorama-facade-references.json"
    payload = json.loads(path.read_text())
    if payload.get("version") != 1 or payload.get("crs") != 2056:
        raise ValueError("Unexpected curation format")
    entries = payload["references"]
    database_path = ROOT / "data/panorama-artist-review/review.sqlite"
    validated = []
    with sqlite3.connect(f"file:{database_path}?mode=ro", uri=True) as database:
        database.row_factory = sqlite3.Row
        for entry in entries:
            row = database.execute("SELECT row_id,source,source_id,source_version,raw_tags,geometry_wkb FROM environment_features WHERE source=? AND source_id=?",
                                   (entry["buildingSource"], entry["buildingSourceId"])).fetchone()
            if row is None:
                raise ValueError("Curated measured building is missing")
            reference = validate_face(entry, row)
            validated.append((row["row_id"], reference.model_dump(mode="json")))
    if len({face["reference_id"] for _, face in validated}) != len(validated):
        raise ValueError("Duplicate facade reference ID")
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    if args.apply:
        # Only now open the local review copy for writes. Revalidation above
        # and the single transaction keep interrupted/failed imports atomic.
        with sqlite3.connect(database_path) as database:
            groups = {}
            for row_id, face in validated:
                groups.setdefault(row_id, []).append(face)
            for row_id, raw in database.execute("SELECT row_id,raw_tags FROM environment_features WHERE raw_tags LIKE '%benchly:facade_references%'").fetchall():
                tags = json.loads(raw)
                tags.pop("benchly:facade_references", None)
                database.execute("UPDATE environment_features SET raw_tags=? WHERE row_id=?", (json.dumps(tags), row_id))
            for row_id, faces in groups.items():
                tags = json.loads(database.execute("SELECT raw_tags FROM environment_features WHERE row_id=?", (row_id,)).fetchone()[0])
                tags["benchly:facade_references"] = {"version": 1, "crs": 2056, "faces": faces}
                database.execute("UPDATE environment_features SET raw_tags=? WHERE row_id=?", (json.dumps(tags), row_id))
            database.execute("INSERT INTO official_context_sources(source,version,asset_url,asset_checksum,imported_at,stats) VALUES(?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET version=excluded.version,asset_url=excluded.asset_url,asset_checksum=excluded.asset_checksum,imported_at=excluded.imported_at,stats=excluded.stats",
                             (SOURCE, checksum, "local-curation:config/panorama-facade-references.json", checksum,
                              datetime.now(UTC).isoformat(), json.dumps({"faces": len(validated), "buildings": len(groups)})))
    print(json.dumps({"faces": len(validated), "sha256": checksum, "appliedToIsolatedDatabase": args.apply}))


if __name__ == "__main__":
    main()
