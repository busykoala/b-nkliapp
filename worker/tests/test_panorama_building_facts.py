from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from shapely import to_wkb
from shapely.geometry import box

spec = importlib.util.spec_from_file_location("panorama_building_facts", Path(__file__).parents[2] / "scripts/panorama-art/building-facts.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def solid(row_id=1, egid=None, bounds=(0, 0, 10, 10)):
    return {"row_id": row_id, "source_id": f"solid-{row_id}", "geometry_wkb": to_wkb(box(*bounds)),
            "raw_tags": json.dumps({"EGID": egid}), "ground_elevation_meters": 500,
            "eaves_elevation_meters": 509, "roof_elevation_meters": 512}


def fact(egid="123", levels=3, x=5, y=5):
    return {"attributes": {"gastw": levels, "gkode": x, "gkodn": y, "gexpdat": "15.10.2026"},
            "featureId": f"{egid}_0", "responseSha256": "a" * 64}


def test_registry_count_requires_unique_containment_and_keeps_provenance():
    matched, rejected = module.match_facts([solid(egid="123")], {"123": fact()})
    assert not rejected and len(matched) == 1
    reference = matched[0]["reference"]
    assert reference["storeys"] == 3 and reference["egid"] == "123"
    assert reference["responseSha256"] == "a" * 64
    assert reference["match"] == "unique-contained-registry-point-and-consistent-EGID"


def test_registry_counts_do_not_spread_to_annexes_or_ambiguous_solids():
    matched, _ = module.match_facts([solid(1, "123"), solid(2, "123", (20, 0, 30, 10))], {"123": fact()})
    assert [m["rowId"] for m in matched] == [1]
    assert not module.match_facts([solid(1), solid(2)], {"123": fact()})[0]
    assert not module.match_facts([solid()], {"123": fact(), "456": fact("456", x=7)})[0]


def test_registry_counts_reject_conflicts_unregistered_or_implausible_facts():
    assert not module.match_facts([solid(egid="456")], {"123": fact()})[0]
    assert not module.match_facts([solid()], {"123": fact(x=50)})[0]
    for levels in (None, 0, 100, 1.5):
        assert not module.match_facts([solid()], {"123": fact(levels=levels)})[0]
