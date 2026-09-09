"""Conservative, reversible fusion of source-linked photographs and geodata."""

import json

from benchly.benches.domain import score_view
from benchly.imagery.photo_prediction import BenchPhotoPrediction

PHOTO_RULE_VERSION = "bank-photo-fusion-v5"
PROJECTED_FIELDS = ("land_context", "view_labels", "view_components", "view_score", "view_confidence")


def photo_signals(observations, *, location_conflicts=None, view_reviews=None):
    """Keep positive outlook evidence; absence is not evidence of no view.

    Multiple pictures can face different directions. A place-wide disagreement
    therefore leaves the geometric land/water classification in charge.
    Source tags can corroborate the seating view, but never create it alone.
    """
    land, water = set(), set()
    long_view = mountain = False
    refs = []
    excluded = {}
    reviewed = {}
    for observation in observations:
        image_hash = dict(observation).get("image_sha256")
        if location_conflicts and image_hash in location_conflicts:
            excluded[image_hash] = location_conflicts[image_hash]
            continue
        prediction = BenchPhotoPrediction.model_validate_json(observation["prediction"])
        if not prediction.usable or prediction.perspective == "closeup":
            continue
        metadata = json.loads(observation["source_metadata"])
        sight = set(metadata.get("sight") or [])
        outlook = prediction.perspective == "outlook"
        refs.append({"source_id": observation["source_id"], "image_id": observation["image_id"]})
        if prediction.land_confidence >= .85 and prediction.land_context != "unknown":
            land.add(prediction.land_context)
        review = (view_reviews or {}).get(image_hash)
        if review and review["exclude_view"]:
            reviewed[image_hash] = review
            continue
        if prediction.water_type in {"lake", "river"}:
            if (outlook and prediction.water_confidence >= .95) or ("WATER" in sight and prediction.water_confidence >= .85):
                water.add(prediction.water_type)
        # A reviewed tree-gap scene received 0.9 for long view and 0.95 for
        # mountains. Source tags also claimed LONG/BROAD, so corroboration alone
        # did not reject it. Keep weaker observations without promoting them.
        if prediction.long_view_probability >= .95 and prediction.limited_view_probability < .3:
            long_view |= outlook or bool(sight & {"LONG", "BROAD", "PANORAMA"})
        if prediction.mountain_probability >= .98:
            mountain |= outlook
    return {
        "land_context": next(iter(land)) if len(land) == 1 else None,
        "water_type": next(iter(water)) if len(water) == 1 else None,
        "long_view": long_view, "mountain": mountain, "photos": refs,
        "land_conflict": len(land) > 1, "water_conflict": len(water) > 1,
        "location_conflicts": [excluded[key] for key in sorted(excluded)],
        "view_reviews": [reviewed[key] for key in sorted(reviewed)],
    }


def project_photo_signals(base, signals, *, measured_water_type=None):
    """Return a small update; exact forest membership and sun remain measured."""
    result = dict(base)
    land = signals.get("land_context")
    if result.get("land_context") in {None, "unknown", "mixed"} and land in {"park", "open", "urban"}:
        result["land_context"] = land
    labels = json.loads(result.get("view_labels") or "[]")
    components = json.loads(result.get("view_components") or "{}")
    positive = False
    # A source may describe an outlook several kilometres away. The photograph
    # supplies visible evidence; proximity is not silently promoted to a view.
    water = signals.get("water_type")
    # A narrow photograph can confuse a lake with a river. Fresh, typed official
    # geometry keeps its water classification when the model disagrees.
    if measured_water_type and water != measured_water_type:
        water = None
    if water:
        labels = [label for label in labels if label not in {"Seeblick", "Wasserblick"}]
        labels.append("Seeblick" if water == "lake" else "Wasserblick")
        components["water"] = max(.9, components.get("water", 0))
        positive = True
    if signals.get("long_view"):
        labels.append("Weitsicht")
        components["openness"] = max(.75, components.get("openness", 0))
        positive = True
    confirmed_mountain = signals.get("mountain") and (
        components.get("relief", 0) >= 1 / 3 or "Bergblick" in labels
    )
    if confirmed_mountain:
        labels = [label for label in labels if label != "Hügelblick"]
        labels.append("Bergblick")
        components["relief"] = max(.65, components.get("relief", 0))
        positive = True
    if positive:
        placeholders = {"Keine besondere Aussicht", "Keine Daten"}
        if signals.get("long_view") or confirmed_mountain:
            placeholders.add("Eingeschränkte Aussicht")
        result["view_labels"] = json.dumps(list(dict.fromkeys(label for label in labels if label not in placeholders)), ensure_ascii=False)
        result["view_components"] = json.dumps(components)
        # A score requires all five components. A photograph does not establish
        # remoteness or the missing geometric measurements.
        if {"openness", "relief", "water", "naturalness", "remoteness"} <= components.keys():
            result["view_score"] = score_view(**{key: components[key] for key in (
                "openness", "relief", "water", "naturalness", "remoteness")})
        result["view_confidence"] = "mittel"
    return result


def retract_previous_projection(current, previous_base, previous_applied):
    result = dict(current)
    for field in PROJECTED_FIELDS:
        if field in previous_applied and current.get(field) == previous_applied[field]:
            result[field] = previous_base.get(field)
    return result
