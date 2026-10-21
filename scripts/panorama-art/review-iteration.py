"""Capture a fixed local artwork stage with one frozen viewer implementation."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

from source import ROOT, snapshot, sources

CONDITIONS = "dawn,sunrise,morning,noon-clear,clouds-light,clouds-broken,overcast,rain-light,rain-heavy,snowfall,snow-cover,mixed,sunset,dusk,stars,moon-full,moon-crescent,night-clouds,night-overcast".split(",")
SEASONS = ("spring", "summer", "autumn", "winter")
PILOTS = (2, 5, 7, 14, 15, 18)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--sample", type=Path, default=ROOT / "test-results/panorama-review/selection.json")
    parser.add_argument("--full", action="store_true", help="Also capture all20 full-range panoramas before the weather matrix")
    args = parser.parse_args()
    output = args.output.resolve()
    if not args.stage.replace("-", "").replace("_", "").isalnum() or not output.is_relative_to(ROOT / "test-results"):
        parser.error("Stage must be a simple identifier; output must be beneath test-results")
    if output.exists():
        parser.error(f"Preserving existing evidence: {output}")
    binding = snapshot(output)
    artwork = json.loads((ROOT / f"test-results/panorama-artist-review/{args.stage}/source.json").read_text())
    runs = []

    def run(name, command):
        if sources() != binding["files"]:
            raise RuntimeError("Source changed before capture; preserving evidence")
        started = datetime.now(timezone.utc).isoformat()
        with (output / f"{name}.log").open("w") as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        row = {"name": name, "started": started, "finished": datetime.now(timezone.utc).isoformat(), "exitCode": result.returncode}
        runs.append(row)
        (output / "capture-run.json").write_text(json.dumps({"stage": args.stage, "artworkSourceSnapshotSha256": artwork["sha256"],
            "viewerSourceSnapshotSha256": binding["sha256"], "runs": runs}, indent=2) + "\n")
        print(name, result.returncode, flush=True)
        if result.returncode or sources() != binding["files"]:
            raise RuntimeError(f"Capture failed or source changed during {name}; inspect its retained log")

    if args.full:
        full = output / "full-autumn"
        run("full-autumn", ["node", "--import=tsx", "scripts/review-full-panorama.ts", "--origin", "http://127.0.0.1:3002",
            "--sample", str(args.sample.resolve()), "--output", str(full), "--timeout", "60000", "--url-template",
            f"/dev/panorama-review?bench={{id}}&stage={args.stage}&season=autumn&condition=noon-clear"])
        manifest = json.loads((full / "manifest.json").read_text())
        if manifest["status"] != "complete" or len({row["bench"]["id"] for row in manifest["captures"]}) != 20:
            raise RuntimeError("Full sample is incomplete")
        if any(row["errors"] or row["failures"] or row.get("clippedViewport") or
               not row["coverage"]["wrapVerified"] or not row["coverage"]["endpointsVerified"] for row in manifest["captures"]):
            raise RuntimeError("Full sample coverage/diagnostics failed")

    observed = set()
    for season in SEASONS:
        directory = output / f"matrix-{season}"
        run(f"matrix-{season}", ["node", "--import=tsx", "scripts/panorama-art/capture.ts", "--stage", args.stage,
            "--season", season, "--numbers", ",".join(map(str, PILOTS)), "--conditions", ",".join(CONDITIONS),
            "--widths", "1440,390", "--output", str(directory)])
        manifest = json.loads((directory / "manifest.json").read_text())
        if manifest["viewerSourceSnapshotSha256"] != binding["sha256"]:
            raise RuntimeError("Weather matrix viewer binding differs")
        for row in manifest["results"]:
            key = (row["season"], row["number"], row["condition"], row["width"])
            if key in observed or row.get("error") or row["errors"] or row["failedRequests"]:
                raise RuntimeError(f"Duplicate/failed weather case: {key}")
            observed.add(key)
            for kind in ("original", "clean"):
                if not (directory / f"{row['stem']}-{kind}.png").is_file():
                    raise RuntimeError(f"Missing {kind} screenshot: {key}")
    expected = {(season, number, condition, width) for season in SEASONS for number in PILOTS for condition in CONDITIONS for width in (1440, 390)}
    if observed != expected:
        raise RuntimeError("Weather matrix differs from the required912 distinct cases")
    (output / "matrix-validation.json").write_text(json.dumps({"stage": args.stage, "expected": len(expected),
        "distinctCases": len(observed), "failures": [], "viewerSourceSnapshotSha256": binding["sha256"],
        "scope": "All4seasons x6pilots x19conditions x2widths; both original/clean files present and one unchanged viewer source snapshot.",
        "manualReview": "Pending; automated completion does not establish artistic acceptance."}, indent=2) + "\n")


if __name__ == "__main__":
    main()
