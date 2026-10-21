"""Paired painter timings on identical capsules, dimensions and hardware."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import statistics
import subprocess
import sys
import time
import types

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "worker"))
from benchly.panorama.binary import decode_geometry
from benchly.panorama.watercolor import render_panorama_webp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--numbers", type=int, nargs="+", default=[2, 5, 7, 14, 15, 18])
    parser.add_argument("--geometry-root", type=Path, default=ROOT / "data/panorama-artist-review/geography")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Preserving existing benchmark; choose a new output")
    catalogue = json.loads((ROOT / "config/panorama-artist-review.json").read_text())
    source = "worker/benchly/panorama/watercolor.py"
    original = subprocess.check_output(["git", "show", f"HEAD:{source}"], cwd=ROOT)
    baseline = types.ModuleType("benchly.panorama._review_baseline_watercolor")
    baseline.__file__ = str(ROOT / source)
    sys.modules[baseline.__name__] = baseline
    # Only trusted checked-in project code is executed; its asset paths remain
    # the original ones. Both painters see the same current geometry contract.
    exec(compile(original, baseline.__file__, "exec"), baseline.__dict__)
    root = args.geometry_root.resolve()
    connection = sqlite3.connect(f"file:{root / 'progress.sqlite'}?mode=ro", uri=True)
    geometries = []
    geometry_diagnostics = []
    for bench in catalogue["benches"]:
        if bench["number"] not in args.numbers:
            continue
        relative = connection.execute("SELECT relative_path FROM extractions WHERE bench_id=? AND status='ready'", (bench["id"],)).fetchone()[0]
        raw = (root / relative).read_bytes()
        start = time.perf_counter()
        geometry = decode_geometry(raw)
        checksum = hashlib.sha256(raw).hexdigest()
        geometries.append((bench["number"], checksum, geometry))
        geometry_diagnostics.append({"number": bench["number"], "capsuleSha256": checksum,
            "bytes": len(raw), "decodeMs": (time.perf_counter() - start) * 1000,
            "spanCount": sum(len(column.spans) for column in geometry.columns)})
    connection.close()
    painters = {"baseline": baseline.render_panorama_webp, "current": render_panorama_webp}
    rows = []
    # Warm image decode/cache paths before measurement; alternate ordering to
    # reduce bias from changing background load and thermal state.
    for painter in painters.values():
        geometry = geometries[0][2]
        painter(geometry, 4096, round(4096 * (geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle) / 360), "summer")
    for turn in range(args.rounds):
        for number, checksum, geometry in geometries:
            height = round(4096 * (geometry.config.maximum_elevation_angle - geometry.config.minimum_elevation_angle) / 360)
            order = list(painters) if (turn + number) % 2 else list(reversed(painters))
            for name in order:
                wall, cpu = time.perf_counter(), time.process_time()
                image = painters[name](geometry, 4096, height, "summer")
                row = {"number": number, "round": turn, "painter": name, "capsuleSha256": checksum,
                       "width": 4096, "height": height, "cpuMs": (time.process_time() - cpu) * 1000,
                       "wallMs": (time.perf_counter() - wall) * 1000, "bytes": len(image)}
                rows.append(row)
                print(json.dumps(row), flush=True)
    summary = {name: {"medianCpuMs": statistics.median(row["cpuMs"] for row in rows if row["painter"] == name),
                      "medianWallMs": statistics.median(row["wallMs"] for row in rows if row["painter"] == name)} for name in painters}
    result = {"format": "benchly-paired-painter-benchmark", "platform": platform.platform(), "cpuCount": os.cpu_count(),
              "baselineCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "baselinePainterSha256": hashlib.sha256(original).hexdigest(),
              "currentPainterSha256": hashlib.sha256((ROOT / source).read_bytes()).hexdigest(),
              "geometryRoot": str(root), "geometries": geometry_diagnostics,
              "scope": "Painting only; geometry decode, network and browser excluded. CPU time is reported separately from wall time.",
              "summary": summary, "rows": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
