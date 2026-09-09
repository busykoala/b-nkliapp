"""Official Lr noise rasters: keep road/rail and day/night separate, with units and versions."""
from __future__ import annotations
import json
import math
from pathlib import Path
from contextlib import ExitStack
from benchly.context.geometry import WGS84_TO_LV95
from benchly.knowledge.models import NoiseExposure
from benchly.knowledge.repository import record_evidence, upsert
from benchly.runtime import now_iso
from benchly.sources.artifacts import refresh_sonbase

LAYERS = {
    ("road", "day"): "strassenlaerm_tag", ("road", "night"): "strassenlaerm_nacht",
    ("rail", "day"): "bahnlaerm_tag", ("rail", "night"): "bahnlaerm_nacht",
}
METHOD = "sonbase-point-1"


def refresh_noise(directory: Path):
    return {f"{mode}_{period}": refresh_sonbase(directory / ("sonbase-day.tif" if (mode, period) == ("road", "day") else f"sonbase-{mode}-{period}.tif"),
        f"https://data.geo.admin.ch/ch.bafu.laerm-{layer}/laerm-{layer}/laerm-{layer}_2056.tif")
        for (mode, period), layer in LAYERS.items()}


class NoiseRasters:
    def __init__(self, directory):
        import rasterio
        self.stack = ExitStack()
        self.datasets = {}
        if not directory:
            return
        for (mode, period), layer in LAYERS.items():
            path = Path(directory) / f"sonbase-{mode}-{period}.tif"
            if not path.exists() and (mode, period) == ("road", "day"):
                path = Path(directory) / "sonbase-day.tif"  # existing installations
            if not path.exists():
                continue
            dataset = self.stack.enter_context(rasterio.open(path))
            if dataset.crs is None or dataset.crs.to_epsg() != 2056 or dataset.count != 1:
                self.close()
                raise ValueError(f"Expected one-band LV95 noise raster: {path}")
            state_path = path.with_suffix(path.suffix + ".json")
            state = json.loads(state_path.read_text()) if state_path.exists() else {}
            version = state.get("etag") or state.get("last_modified")
            if not version:
                # A local fixture/operator-supplied raster can identify its dataset in GDAL tags.
                version = dataset.tags().get("dataset_version")
            if version:
                self.datasets[(mode, period)] = (dataset, version, layer)

    def close(self):
        self.stack.close()

    def enrich(self, database, bench):
        x, y = WGS84_TO_LV95.transform(bench["longitude"], bench["latitude"])
        for (mode, period), (dataset, version, layer) in self.datasets.items():
            value = None
            if dataset.bounds.left <= x < dataset.bounds.right and dataset.bounds.bottom < y <= dataset.bounds.top:
                raw = next(dataset.sample([(x, y)], masked=True))[0]
                if not getattr(raw, "mask", False):
                    measurement = float(raw) * dataset.scales[0] + dataset.offsets[0]
                    if math.isfinite(measurement) and 0 <= measurement <= 150:
                        value = measurement
            upsert(database, NoiseExposure, dict(bench_row_id=bench["row_id"], mode=mode, period=period, value=value,
                unit="dB(A) Lr", source=f"ch.bafu.laerm-{layer}", dataset_version=str(version), method_version=METHOD,
                computed_at=now_iso()), ["bench_row_id", "mode", "period"])
            record_evidence(database, bench["row_id"], f"{mode}_{period}_noise", value, "official", f"sonbase:{mode}:{period}",
                confidence=.85, method=METHOD, metadata={"unit": "dB(A) Lr", "dataset_version": str(version),
                "latitude": bench["latitude"], "longitude": bench["longitude"], "resolution_meters": list(dataset.res)})
