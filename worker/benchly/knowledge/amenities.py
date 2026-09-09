"""RTree-bounded nearest geometry queries; absence in OSM is not evidence of absence on site."""
import json
from shapely.geometry import Point
from benchly.context.geometry import WGS84_TO_LV95
from benchly.knowledge.geography import geometry
from benchly.knowledge.models import Amenity
from benchly.knowledge.repository import record_evidence, upsert
from benchly.runtime import now_iso

CATEGORIES = ("toilets", "drinking_water", "fountain", "shelter", "picnic_table", "playground", "waste_basket", "fireplace")
METHOD = "nearby-amenities-2"


def source_object_id(row):
    """Unify pyosmium's area callback with its original way/relation object."""
    source_id = row["source_id"]
    if row["source"] == "OpenStreetMap" and source_id.startswith("area-") and source_id[5:].isdigit():
        area_id = int(source_id[5:])
        return f"{'relation' if area_id % 2 else 'way'}-{area_id // 2}"
    return source_id


def amenity_categories(row):
    # A toilet or shelter can also be a building; the primary geometry kind must not hide it.
    tags = json.loads(row["raw_tags"] or "{}")
    categories = {row["kind"]} & set(CATEGORIES)
    if tags.get("amenity") in CATEGORIES:
        categories.add(tags["amenity"])
    if tags.get("leisure") in {"picnic_table", "playground"}:
        categories.add(tags["leisure"])
    if tags.get("leisure") == "firepit":
        categories.add("fireplace")
    if tags.get("drinking_water") == "yes" and "fountain" in categories:
        categories.add("drinking_water")
    return categories


def nearby_context(database, bench, radius=500):
    lon, lat = bench["longitude"], bench["latitude"]
    dlat, dlon = radius / 110000, radius / 74000
    return database.execute("""SELECT f.* FROM environment_spatial_index s JOIN environment_features f ON f.row_id=s.row_id
      WHERE s.min_longitude<=? AND s.max_longitude>=? AND s.min_latitude<=? AND s.max_latitude>=?""",
      (lon + dlon, lon - dlon, lat + dlat, lat - dlat)).fetchall()


def enrich_amenities(database, bench, context):
    point = Point(*WGS84_TO_LV95.transform(bench["longitude"], bench["latitude"]))
    categorized = [(row, amenity_categories(row)) for row in context]
    results = []
    for category in CATEGORIES:
        objects = {}
        for row, categories in categorized:
            if category not in categories or not row["geometry_wkb"]:
                continue
            distance = geometry(row["geometry_wkb"]).distance(point)
            if distance <= 500:
                key = (row["source"], source_object_id(row))
                if key not in objects or distance < objects[key][0]:
                    objects[key] = (distance, row)
        candidates = list(objects.values())
        candidates.sort(key=lambda pair: (pair[0], pair[1]["source_id"]))
        nearest = candidates[0] if candidates else None
        values = dict(bench_row_id=bench["row_id"], category=category,
            nearest_source_id=source_object_id(nearest[1]) if nearest else None,
            distance_meters=round(nearest[0], 1) if nearest else None,
            # Counts describe mapped objects only; null if the category has not been imported/observed here.
            count_100m=sum(distance <= 100 for distance, _ in candidates) if candidates else None,
            count_250m=sum(distance <= 250 for distance, _ in candidates) if candidates else None,
            count_500m=len(candidates) if candidates else None,
            source=nearest[1]["source"] if nearest else "OpenStreetMap",
            source_version=nearest[1]["source_version"] if nearest else None, method_version=METHOD, computed_at=now_iso())
        upsert(database, Amenity, values, ["bench_row_id", "category"])
        if nearest:
            record_evidence(database, bench["row_id"], category, values["distance_meters"], "gis", f"nearest:{category}",
                source_updated_at=nearest[1]["source_updated_at"], confidence=.75, method=METHOD,
                metadata={"source_id": values["nearest_source_id"], "geometry_source_id": nearest[1]["source_id"], "unit": "m", "distance_type": "straight_line", "radius_meters": 500,
                          "latitude": bench["latitude"], "longitude": bench["longitude"]})
        results.append(values)
    return results
