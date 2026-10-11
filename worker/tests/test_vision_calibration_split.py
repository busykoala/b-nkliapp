import json
from pathlib import Path

from benchly.imagery.calibration import LABELS, evaluate_predictions, split_groups


def reviewed_records():
    path = Path(__file__).resolve().parents[1] / "evaluation" / "benchly-100.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def test_reviewed_fixture_supports_every_calibrated_label():
    records = reviewed_records()
    partitions = split_groups(records)
    calibration = [row for row, part in zip(records, partitions) if part == "calibration"]
    test = [row for row, part in zip(records, partitions) if part == "test"]
    assert len(calibration) >= 30
    assert len(calibration) <= len(test)
    assert len(test) >= 30
    for label in LABELS:
        assert sum(row["expected"][label] for row in calibration) >= 5
        assert sum(not row["expected"][label] for row in calibration) >= 5
        assert any(row["expected"][label] for row in test)
        assert any(not row["expected"][label] for row in test)
    predictions = {
        row["id"]: {("relevance_probability" if label == "relevant" else f"{label}_probability"):
                    .9 if row["expected"][label] else .1 for label in LABELS}
        for row in records
    }
    assert evaluate_predictions(records, predictions)["calibration_ready"]


def test_stratified_split_keeps_shared_images_together_and_is_order_independent():
    records = reviewed_records()
    records.append({**records[0], "id": "shared-photograph", "bench_id": "other-bench",
                    "latitude": 47.5, "longitude": 9.5})
    assignments = dict(zip((row["id"] for row in records), split_groups(records)))
    reversed_rows = records[::-1]
    reverse_assignments = dict(zip((row["id"] for row in reversed_rows), split_groups(reversed_rows)))
    assert assignments == reverse_assignments
    assert assignments[records[0]["id"]] == assignments["shared-photograph"]


def test_unsupported_label_still_cannot_be_calibrated():
    records = reviewed_records()
    for record in records:
        record["expected"]["lake_view"] = False
    predictions = {row["id"]: {("relevance_probability" if label == "relevant" else f"{label}_probability"):
                              .5 for label in LABELS} for row in records}
    report = evaluate_predictions(records, predictions)
    assert not report["calibration_ready"]
    assert report["labels"]["lake_view"]["calibration_parameters"] is None
