"""Keep handwritten SQL writes out of worker orchestration code."""

from pathlib import Path
import ast
import re
import unittest

from pydantic import ValidationError

from benchly.weather.models import WeatherSnapshot
from benchly.context.contracts import StacPage, VectorFeature
from benchly.imagery.contracts import InferenceResponse
from benchly.transit.models import CatalogueResponse


class PersistenceArchitectureTests(unittest.TestCase):
    def test_production_writes_use_sqlmodel_repositories(self):
        worker = Path(__file__).parent.parent
        forbidden = re.compile(r"\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+\w+|CREATE\s+TABLE)\b", re.I)
        offenders = []
        for path in worker.rglob("*.py"):
            if "tests" in path.parts or path.name.startswith("test_"):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            strings = (
                node.value for node in ast.walk(tree)
                if isinstance(node, ast.Constant) and isinstance(node.value, str)
            )
            if any(forbidden.search(value) for value in strings):
                offenders.append(str(path.relative_to(worker)))
        self.assertEqual(offenders, [], f"Use a feature repository and SQLModel table: {offenders}")

        scripts = worker.parent / "scripts"
        script_offenders = []
        for path in scripts.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            strings = (
                node.value for node in ast.walk(tree)
                if isinstance(node, ast.Constant) and isinstance(node.value, str)
            )
            if any(forbidden.search(value) for value in strings):
                script_offenders.append(path.name)
        self.assertEqual(script_offenders, [], f"Move persistence into typed worker repositories: {script_offenders}")

    def test_worker_models_reject_unknown_input_fields(self):
        with self.assertRaises(ValidationError):
            WeatherSnapshot.model_validate({
                "source": "test", "parameter": "cloud", "reference_at": "now", "valid_at": "now",
                "origin_easting": 0, "origin_northing": 0, "resolution_meters": 1,
                "width": 1, "height": 1, "values_blob": b"data", "imported_at": "now",
                "typo_field": True,
            })

    def test_external_contracts_reject_missing_required_shapes(self):
        for contract, payload in (
            (StacPage, {"features": [{"assets": {"bad": {"title": "missing href"}}}]}),
            (VectorFeature, {"properties": {}}),
            (InferenceResponse, {"choices": []}),
            (CatalogueResponse, {"result": {"results": [{"metadata_modified": "now"}]}}),
        ):
            with self.subTest(contract=contract.__name__), self.assertRaises(ValidationError):
                contract.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
