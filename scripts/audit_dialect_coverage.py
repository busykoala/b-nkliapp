#!/usr/bin/env python3
"""Audit a bench snapshot against the committed dialect geography."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import shapely
from shapely.geometry import shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
GEOGRAPHY = ROOT / "config/dialects/areas.generated.json"


def matches(points, features):
    geometries = [shape(feature["geometry"]) for feature in features]
    tree = STRtree(geometries)
    result: dict[int, list[int]] = defaultdict(list)
    pairs = tree.query(points, predicate="within")
    for point_index, geometry_index in zip(pairs[0].tolist(), pairs[1].tolist()):
        result[point_index].append(geometry_index)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=ROOT / "data/benchly.sqlite")
    args = parser.parse_args()
    artifact = json.loads(GEOGRAPHY.read_text())
    connection = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    benches = connection.execute("select id,latitude,longitude from benches where active=1").fetchall()
    connection.close()
    points = shapely.points([row[2] for row in benches], [row[1] for row in benches])
    inside = shapely.contains(shape(artifact["territory"]), points)
    area_matches = matches(points, artifact["features"])
    language_matches = matches(points, artifact["languageAreas"])
    language_fallback_matches = matches(points, artifact["languageAreaFallbacks"])

    match_types = Counter()
    areas = Counter()
    languages = Counter()
    contacts = 0
    unknown_examples = []
    for index, bench in enumerate(benches):
        if not inside[index]:
            match_types["outside-switzerland"] += 1
            continue
        matched_areas = area_matches.get(index, [])
        matched_languages = language_matches.get(index, [])
        language_features = artifact["languageAreas"]
        if not matched_languages:
            matched_languages = language_fallback_matches.get(index, [])
            language_features = artifact["languageAreaFallbacks"]
        if not matched_languages:
            point = points[index]
            nearest_index, nearest_distance = min(
                ((candidate, point.distance(shape(feature["geometry"]))) for candidate, feature in enumerate(artifact["languageAreas"])),
                key=lambda item: item[1],
            )
            if nearest_distance <= 0.0005:
                matched_languages = [nearest_index]
                language_features = artifact["languageAreas"]
        if matched_areas:
            match_types["linguistic-polygon"] += 1
            area_ids = [artifact["features"][match]["properties"]["areaId"] for match in matched_areas]
            areas.update(area_ids)
            contacts += int(len(area_ids) > 1)
        elif matched_languages:
            match_types["language-area"] += 1
        else:
            match_types["unknown"] += 1
            if len(unknown_examples) < 20:
                unknown_examples.append({"id": bench[0], "latitude": bench[1], "longitude": bench[2]})
        languages.update(language_features[match]["properties"]["language"] for match in matched_languages)

    report = {
        "snapshot": str(args.database),
        "activeBenches": len(benches),
        "geographyVersion": artifact["metadata"]["generatedFrom"],
        "languageAreaVersion": "sprg20220501",
        "matchTypes": dict(match_types.most_common()),
        "languageAreas": dict(languages.most_common()),
        "contactOrOverlapCases": contacts,
        "topDialectAreas": dict(areas.most_common(30)),
        "unknownExamples": unknown_examples,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
