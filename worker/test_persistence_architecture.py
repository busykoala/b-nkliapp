"""Keep handwritten SQL writes out of worker orchestration code."""

from pathlib import Path
import ast
import re
import unittest

from pydantic import ValidationError

from benchly.weather.models import WeatherSnapshot


class PersistenceArchitectureTests(unittest.TestCase):
    def test_production_writes_use_sqlmodel_repositories(self):
        worker = Path(__file__).parent
        forbidden = re.compile(r"\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+\w+|CREATE\s+TABLE)\b", re.I)
        offenders = []
        for path in worker.rglob("*.py"):
            if path.name.startswith("test_"):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            strings = (
                node.value for node in ast.walk(tree)
                if isinstance(node, ast.Constant) and isinstance(node.value, str)
            )
            if any(forbidden.search(value) for value in strings):
                offenders.append(str(path.relative_to(worker)))
        self.assertEqual(offenders, [], f"Use a feature repository and SQLModel table: {offenders}")

    def test_worker_models_reject_unknown_input_fields(self):
        with self.assertRaises(ValidationError):
            WeatherSnapshot.model_validate({
                "source": "test", "parameter": "cloud", "reference_at": "now", "valid_at": "now",
                "origin_easting": 0, "origin_northing": 0, "resolution_meters": 1,
                "width": 1, "height": 1, "values_blob": b"data", "imported_at": "now",
                "typo_field": True,
            })


if __name__ == "__main__":
    unittest.main()
