#!/usr/bin/env python3
"""Hunt for amusing correlations in the local Benchly dataset.

This is intentionally exploratory. It checks many nonsensical hypotheses, so the
result is evidence of multiple-comparison mischief rather than causality.
"""

from __future__ import annotations

import math
import json
import sqlite3
import statistics
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "benchly.sqlite"


@dataclass(frozen=True)
class Result:
    correlation: float
    sample_size: int
    hypothesis: str
    level: str


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3:
        return None
    mean_x = statistics.fmean(xs)
    mean_y = statistics.fmean(ys)
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denominator = math.sqrt(
        sum((x - mean_x) ** 2 for x in xs)
        * sum((y - mean_y) ** 2 for y in ys)
    )
    return numerator / denominator if denominator else None


def digit_sum(value: int) -> int:
    return sum(int(character) for character in str(abs(value)))


def text_score(value: str | None) -> int | None:
    if not value:
        return None
    return sum(ord(character.casefold()) for character in value if character.isalpha())


def main() -> None:
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT
            b.osm_id,
            b.name,
            b.description,
            b.operator,
            b.material,
            b.dedication,
            b.direction_degrees,
            b.seats,
            b.latitude,
            b.longitude,
            b.location_canton,
            b.backrest,
            b.covered,
            b.waste_basket_nearby,
            b.fireplace_nearby,
            e.elevation_meters,
            e.canopy_percent,
            e.distance_forest_meters,
            e.distance_water_meters,
            e.distance_path_meters,
            e.distance_major_road_meters,
            e.sun_minutes_summer,
            e.sun_minutes_winter,
            e.sun_minutes_spring,
            e.sun_minutes_autumn,
            e.view_score,
            e.building_obstruction_percent,
            e.vegetation_obstruction_percent,
            e.distance_building_meters,
            e.building_count_100m,
            e.canopy_share_3m,
            e.canopy_share_10m,
            e.canopy_share_25m,
            e.vegetation_median_height,
            e.vegetation_max_height
        FROM benches b
        JOIN bench_enrichments e ON e.bench_row_id = b.row_id
        WHERE b.active = 1
        """
    ).fetchall()

    physical = [
        "elevation_meters",
        "canopy_percent",
        "distance_forest_meters",
        "distance_water_meters",
        "distance_path_meters",
        "distance_major_road_meters",
        "sun_minutes_summer",
        "sun_minutes_winter",
        "sun_minutes_spring",
        "sun_minutes_autumn",
        "view_score",
        "building_obstruction_percent",
        "vegetation_obstruction_percent",
        "distance_building_meters",
        "building_count_100m",
        "canopy_share_3m",
        "canopy_share_10m",
        "canopy_share_25m",
        "vegetation_median_height",
        "vegetation_max_height",
    ]
    predictors = {
        "OSM ID digit sum": lambda row: digit_sum(row["osm_id"]),
        "OSM ID last digit": lambda row: row["osm_id"] % 10,
        "OSM ID last two digits": lambda row: row["osm_id"] % 100,
        "OSM ID last three digits": lambda row: row["osm_id"] % 1_000,
        "OSM ID first digit": lambda row: int(str(abs(row["osm_id"]))[0]),
        "OSM ID length": lambda row: len(str(abs(row["osm_id"]))),
        "reversed OSM ID": lambda row: int(str(abs(row["osm_id"]))[::-1]),
        "name length": lambda row: len(row["name"]) if row["name"] else None,
        "name letter score": lambda row: text_score(row["name"]),
        "description length": lambda row: len(row["description"]) if row["description"] else None,
        "description letter score": lambda row: text_score(row["description"]),
        "operator length": lambda row: len(row["operator"]) if row["operator"] else None,
        "material word length": lambda row: len(row["material"]) if row["material"] else None,
        "dedication length": lambda row: len(row["dedication"]) if row["dedication"] else None,
    }

    results: list[Result] = []
    tested = 0
    for predictor_name, predictor in predictors.items():
        for outcome in physical:
            pairs = [
                (x, float(row[outcome]))
                for row in rows
                if (x := predictor(row)) is not None and row[outcome] is not None
            ]
            if len(pairs) < 250:
                continue
            tested += 1
            correlation = pearson(
                [float(pair[0]) for pair in pairs],
                [pair[1] for pair in pairs],
            )
            if correlation is not None:
                results.append(
                    Result(correlation, len(pairs), f"{predictor_name} vs {outcome}", "bench")
                )

    # Group-average correlations are especially fertile p-hacking territory.
    groupers = {
        "last OSM digit": lambda row: row["osm_id"] % 10,
        "last two OSM digits": lambda row: row["osm_id"] % 100,
        "OSM digit sum": lambda row: digit_sum(row["osm_id"]),
        "OSM ID length": lambda row: len(str(abs(row["osm_id"]))),
        "name length": lambda row: len(row["name"]) if row["name"] else None,
        "description length": lambda row: len(row["description"]) if row["description"] else None,
        "material-name length": lambda row: len(row["material"]) if row["material"] else None,
    }
    for grouper_name, grouper in groupers.items():
        for outcome in physical:
            groups: dict[int, list[float]] = defaultdict(list)
            for row in rows:
                group = grouper(row)
                value = row[outcome]
                if group is not None and value is not None:
                    groups[int(group)].append(float(value))
            group_means = [
                (float(group), statistics.fmean(values))
                for group, values in groups.items()
                if len(values) >= 30
            ]
            if len(group_means) < 6:
                continue
            group_means.sort()
            tested += 1
            correlation = pearson(
                [pair[0] for pair in group_means], [pair[1] for pair in group_means]
            )
            if correlation is not None:
                results.append(
                    Result(
                        correlation,
                        len(group_means),
                        f"{grouper_name} vs mean {outcome}",
                        "group averages",
                    )
                )

    results.sort(key=lambda result: abs(result.correlation), reverse=True)
    print(f"Rows: {len(rows):,}; hypotheses tested: {tested:,}\n")
    print("Top 40 correlations (ranked by |r|):")
    for result in results[:40]:
        print(
            f"{result.correlation:+.4f}  n={result.sample_size:>6,}  "
            f"{result.level:<14}  {result.hypothesis}"
        )

    print("\nTop 25 bench-level correlations:")
    bench_results = [result for result in results if result.level == "bench"]
    for result in bench_results[:25]:
        print(
            f"{result.correlation:+.4f}  n={result.sample_size:>6,}  {result.hypothesis}"
        )

    canton_names = {
        "Zürich": "1", "Bern": "2", "Luzern": "3", "Uri": "4", "Schwyz": "5",
        "Obwalden": "6", "Nidwalden": "7", "Glarus": "8", "Zug": "9", "Fribourg": "10",
        "Solothurn": "11", "Basel-Stadt": "12", "Basel-Landschaft": "13", "Schaffhausen": "14",
        "Appenzell Ausserrhoden": "15", "Appenzell Innerrhoden": "16", "St. Gallen": "17",
        "Graubünden": "18", "Aargau": "19", "Thurgau": "20", "Ticino": "21", "Vaud": "22",
        "Valais": "23", "Neuchâtel": "24", "Genève": "25", "Jura": "26",
    }
    ranges = [
        (1, 299), (301, 999), (1001, 1199), (1201, 1299), (1301, 1399), (1401, 1499),
        (1501, 1599), (1601, 1699), (1701, 1799), (2001, 2399), (2401, 2699),
        (2701, 2759), (2760, 2899), (2900, 2999), (3000, 3099), (3100, 3199),
        (3200, 3499), (3500, 3999), (4000, 4399), (4400, 4999), (5000, 5399),
        (5400, 5999), (6000, 6399), (6400, 6599), (6600, 6699), (6700, 6999),
    ]
    with (ROOT / "src/features/statistics/municipality-population.json").open() as file:
        municipality_population = json.load(file)["population"]
    population = {
        str(index + 1): sum(
            value for municipality, value in municipality_population.items()
            if lower <= int(municipality) <= upper
        )
        for index, (lower, upper) in enumerate(ranges)
    }
    with (ROOT / "src/features/statistics/external-by-canton.json").open() as file:
        external_snapshot = json.load(file)

    canton_rows: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        code = canton_names.get(row["location_canton"])
        if code:
            canton_rows[code].append(row)

    def known_share(canton: list[sqlite3.Row], field: str) -> float | None:
        known = [row[field] for row in canton if row[field] is not None]
        return statistics.fmean(float(value) for value in known) if known else None

    def present_share(canton: list[sqlite3.Row], field: str) -> float:
        return sum(bool(row[field]) for row in canton) / len(canton)

    bench_metrics: dict[str, dict[str, float | None]] = defaultdict(dict)
    for code, canton in canton_rows.items():
        bench_metrics["known bench count"][code] = float(len(canton))
        bench_metrics["known benches per 100k residents"][code] = len(canton) / population[code] * 100_000
        bench_metrics["share of benches with names"][code] = present_share(canton, "name") * 100
        bench_metrics["share with descriptions"][code] = present_share(canton, "description") * 100
        bench_metrics["share with backrests"][code] = known_share(canton, "backrest")
        bench_metrics["share under cover"][code] = known_share(canton, "covered")
        bench_metrics["share near waste baskets"][code] = known_share(canton, "waste_basket_nearby")
        bench_metrics["share near fireplaces"][code] = known_share(canton, "fireplace_nearby")
        bench_metrics["mean tagged seat count"][code] = known_share(canton, "seats")
        for field in ("elevation_meters", "view_score", "sun_minutes_winter", "canopy_percent"):
            bench_metrics[f"mean bench {field}"][code] = known_share(canton, field)

    external_results: list[Result] = []
    for series_key, series in external_snapshot["series"].items():
        forms = ("raw",) if series_key in {"greenVotes", "populationGrowth"} else ("raw", "per 100k residents")
        for form in forms:
            external_values = {
                code: float(value) if form == "raw" else float(value) / population[code] * 100_000
                for code, value in series["byCanton"].items() if value is not None
            }
            for metric_name, metric_values in bench_metrics.items():
                codes = [
                    code for code in canton_names.values()
                    if metric_values.get(code) is not None and code in external_values
                ]
                if len(codes) < 12:
                    continue
                value = pearson(
                    [float(metric_values[code]) for code in codes],
                    [external_values[code] for code in codes],
                )
                if value is not None:
                    external_results.append(Result(
                        value,
                        len(codes),
                        f"{metric_name} vs {series_key} ({series['label']}, {form})",
                        "cantons",
                    ))
    external_results.sort(key=lambda result: abs(result.correlation), reverse=True)
    print(f"\nTop cross-dataset canton coincidences ({len(external_results):,} hypotheses):")
    for result in external_results[:50]:
        print(f"{result.correlation:+.4f}  n={result.sample_size:>3}  {result.hypothesis}")
    print("\nBest coincidence for each external series:")
    for series_key in external_snapshot["series"]:
        result = next(result for result in external_results if f"vs {series_key} (" in result.hypothesis)
        print(f"{result.correlation:+.4f}  n={result.sample_size:>3}  {result.hypothesis}")


if __name__ == "__main__":
    main()
