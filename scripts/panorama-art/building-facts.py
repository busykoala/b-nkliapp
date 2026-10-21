"""Cache public GWR records near the fixed review benches.

The records can establish storey counts and identity, never facade openings.
Uses the documented GeoAdmin identify API, sequentially, in a bounded area.
Run --fetch once; subsequent runs verify and summarize the saved responses.
Optional --apply imports matched facts only into the isolated review database.
"""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import Point
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
LAYER = "ch.bfs.gebaeude_wohnungs_register"
ENDPOINT = "https://api3.geo.admin.ch/rest/services/ech/MapServer/identify"
DOCUMENTATION = "https://docs.geo.admin.ch/access-data/identify-features.html"


def match_facts(rows, records):
    """Require a unique contained registry point and consistent source identity.

    A storey count is not safely transferable to every annex sharing an EGID.
    Ambiguous points, multiple building records, inconsistent EGIDs and implausible
    storey heights remain unresolved instead of acquiring guessed structure.
    """
    shapes = [from_wkb(bytes(row["geometry_wkb"])) for row in rows]
    tree = STRtree(shapes)
    candidates = {}
    rejected = []
    for egid, fact in sorted(records.items()):
        a = fact["attributes"]
        levels = a.get("gastw")
        if not isinstance(levels, int) or isinstance(levels, bool) or not 1 <= levels <= 99:
            continue
        try:
            point = Point(float(a["gkode"]), float(a["gkodn"]))
        except (KeyError, TypeError, ValueError):
            continue
        hits = tree.query(point, predicate="within")
        if len(hits) != 1:
            if len(hits): rejected.append({"egid": egid, "reason": "registry point belongs to multiple source solids"})
            continue
        index = int(hits[0])
        row = rows[index]
        tags = json.loads(row["raw_tags"] or "{}")
        known_egid = tags.get("EGID")
        if known_egid and str(known_egid) != egid:
            rejected.append({"egid": egid, "sourceId": row["source_id"], "reason": "source EGID conflicts with registry"})
            continue
        height = (row["eaves_elevation_meters"] or row["roof_elevation_meters"] or 0) - (row["ground_elevation_meters"] or 0)
        if not 1.8 <= height / levels <= 6:
            rejected.append({"egid": egid, "sourceId": row["source_id"], "reason": "storey count and source wall height are inconsistent"})
            continue
        candidates.setdefault(index, []).append({"egid": egid, "storeys": levels,
            "source": "BFS-GWR", "featureId": fact["featureId"], "exportDate": a.get("gexpdat"),
            "url": f"https://api3.geo.admin.ch/rest/services/ech/MapServer/{LAYER}/{fact['featureId']}",
            "responseSha256": fact["responseSha256"], "positionLV95": [point.x, point.y],
            "match": "unique-contained-registry-point-and-consistent-EGID" if known_egid else "unique-contained-registry-point"})
    matches = []
    for index, facts in sorted(candidates.items()):
        if len(facts) != 1:
            rejected.append({"sourceId": rows[index]["source_id"], "reason": "multiple registered buildings inside one source solid"})
            continue
        matches.append({"rowId": rows[index]["row_id"], "sourceId": rows[index]["source_id"], "reference": facts[0]})
    return matches, rejected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--radius", type=int, choices=range(50, 501), default=250)
    parser.add_argument("--numbers", nargs="+", type=int)
    parser.add_argument("--match", action="store_true", help="Match cached registry points to unique official footprints")
    parser.add_argument("--apply", action="store_true", help="Store verified facts only in the isolated local review database")
    parser.add_argument("--output", type=Path, default=ROOT / "data/panorama-artist-review/building-facts/gwr-v1")
    args = parser.parse_args()
    if args.apply and args.numbers:
        parser.error("--apply requires the complete fixed sample; omit --numbers")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    scenarios = json.loads((ROOT / "data/panorama-artist-review/scenarios.json").read_text())
    benches = [b for b in scenarios["benches"] if not args.numbers or b["number"] in args.numbers]
    project = Transformer.from_crs(4326, 2056, always_xy=True)
    summary = []
    all_records = {}
    for bench in benches:
        east, north = project.transform(bench["longitude"], bench["latitude"])
        records, pages = {}, []
        for offset in range(0, 2000, 200):
            query = {"geometryType": "esriGeometryEnvelope",
                     "geometry": f"{east-args.radius},{north-args.radius},{east+args.radius},{north+args.radius}",
                     "sr": 2056, "tolerance": 0, "layers": f"all:{LAYER}",
                     "returnGeometry": "false", "limit": 200, "offset": offset, "lang": "de"}
            url = ENDPOINT + "?" + urlencode(query)
            stem = f"{bench['number']:02}-r{args.radius}-{offset}"
            path, meta_path = output / f"{stem}.json", output / f"{stem}.source.json"
            if not path.exists():
                if not args.fetch:
                    raise ValueError(f"Missing cache {path}; use --fetch for a sequential public-data request")
                request = Request(url, headers={"User-Agent": "Benchly-local-artist-review/1.0", "Accept": "application/json"})
                with urlopen(request, timeout=45) as response:
                    raw = response.read(16 * 1024 * 1024 + 1)
                    if len(raw) > 16 * 1024 * 1024:
                        raise ValueError("Unexpectedly large reference response")
                payload = json.loads(raw)
                if not isinstance(payload.get("results"), list):
                    raise ValueError("Reference response lacks results")
                meta = {"url": url, "documentation": DOCUMENTATION,
                        "retrievedAt": datetime.now(UTC).isoformat(), "sha256": hashlib.sha256(raw).hexdigest(),
                        "number": bench["number"], "id": bench["id"], "radiusMeters": args.radius}
                # An incomplete pair fails verification on rerun instead of
                # silently treating an interrupted download as trusted input.
                path.write_bytes(raw)
                meta_path.write_text(json.dumps(meta, indent=2) + "\n")
                time.sleep(1)
            raw, meta = path.read_bytes(), json.loads(meta_path.read_text())
            if meta["url"] != url or hashlib.sha256(raw).hexdigest() != meta["sha256"]:
                raise ValueError(f"Reference identity/checksum mismatch: {path}")
            payload = json.loads(raw)
            pages.append({"path": path.name, "sha256": meta["sha256"], "count": len(payload["results"])})
            for record in payload["results"]:
                if record.get("layerBodId") != LAYER:
                    raise ValueError("Unexpected reference layer")
                records[str(record["featureId"])] = record
                egid = str(record["attributes"]["egid"])
                candidate = {**record, "responseSha256": meta["sha256"]}
                previous = all_records.get(egid)
                if previous and previous["attributes"].get("gastw") != record["attributes"].get("gastw"):
                    raise ValueError(f"Conflicting storey counts for EGID {egid}")
                all_records.setdefault(egid, candidate)
            if len(payload["results"]) < 200:
                break
        else:
            raise ValueError("Bounded reference area exceeds 2000 records; use a smaller radius")
        facts = [record["attributes"] for record in records.values()]
        summary.append({"number": bench["number"], "id": bench["id"], "pages": pages,
                        "uniqueRecords": len(facts), "knownStoreys": sum(isinstance(a.get("gastw"), int) and a["gastw"] > 0 for a in facts)})
        print(json.dumps(summary[-1]), flush=True)
    (output / "manifest.json").write_text(json.dumps({"format": "benchly-public-building-facts", "layer": LAYER,
        "documentation": DOCUMENTATION, "radiusMeters": args.radius, "locations": summary,
        "limits": ["Storey counts do not establish openings or facade appearance", "No application or schema changes; optional --apply writes only isolated review facts"]}, indent=2) + "\n")
    if args.match or args.apply:
        database_path = ROOT / "data/panorama-artist-review/review.sqlite"
        with sqlite3.connect(f"file:{database_path}?mode=ro", uri=True) as database:
            database.row_factory = sqlite3.Row
            rows = database.execute("SELECT row_id,source_id,raw_tags,geometry_wkb,ground_elevation_meters,eaves_elevation_meters,roof_elevation_meters FROM environment_features WHERE source='swissBUILDINGS3D' AND geometry_wkb IS NOT NULL").fetchall()
        matches, rejected = match_facts(rows, all_records)
        result = {"format": "benchly-verified-building-facts", "matches": matches, "rejected": rejected,
                  "limits": ["Registered storeys only; openings and floor elevations remain unverified"]}
        raw = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
        (output / "matches.json").write_bytes(raw)
        checksum = hashlib.sha256(raw).hexdigest()
        if args.apply:
            # This command deliberately offers no arbitrary DB destination.
            # The downloaded cluster snapshot and ordinary app DB stay intact.
            with sqlite3.connect(database_path) as database:
                for row in rows:
                    tags = json.loads(row["raw_tags"] or "{}")
                    old = tags.get("benchly:building_reference", {})
                    if isinstance(old, dict) and old.get("source") == "BFS-GWR":
                        tags.pop("benchly:building_reference")
                        database.execute("UPDATE environment_features SET raw_tags=? WHERE row_id=?", (json.dumps(tags, separators=(",", ":")), row["row_id"]))
                for match in matches:
                    tags = json.loads(database.execute("SELECT raw_tags FROM environment_features WHERE row_id=?", (match["rowId"],)).fetchone()[0] or "{}")
                    tags["benchly:building_reference"] = match["reference"]
                    database.execute("UPDATE environment_features SET raw_tags=? WHERE row_id=?", (json.dumps(tags, separators=(",", ":")), match["rowId"]))
                database.execute("INSERT INTO official_context_sources(source,version,asset_url,asset_checksum,imported_at,stats) VALUES(?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET version=excluded.version,asset_url=excluded.asset_url,asset_checksum=excluded.asset_checksum,imported_at=excluded.imported_at,stats=excluded.stats",
                    ("BFS-GWR", checksum, DOCUMENTATION, checksum, datetime.now(UTC).isoformat(), json.dumps({"matched": len(matches), "rejected": len(rejected)})))
        print(json.dumps({"matched": len(matches), "rejected": len(rejected), "appliedToIsolatedDatabase": args.apply, "sha256": checksum}))


if __name__ == "__main__":
    main()
