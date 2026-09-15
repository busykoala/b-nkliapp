#!/usr/bin/env python3
"""Preview or quarantine old, unreferenced files in one active panorama generation.

Only the active generation's capsules, renders and materials are considered.
Manifest records and every current database artifact binding are protected.
Quarantine lives beside, never inside, the panorama PV and is recoverable.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import time
from collections import Counter
from pathlib import Path


KINDS = ("capsules", "renders", "materials")


def paths(database: sqlite3.Connection, root: Path, active: Path, generation_id: str) -> set[Path]:
    protected = {
        (active / relative).resolve()
        for (relative,) in database.execute(
            "SELECT relative_path FROM panorama_generation_artifacts WHERE generation_id=?",
            (generation_id,),
        )
    }
    for table in ("bench_panorama_geometry", "bench_panorama_renders", "bench_panorama_lightmaps"):
        for (raw,) in database.execute(f"SELECT artifact_path FROM {table} WHERE artifact_path IS NOT NULL"):
            value = Path(raw)
            try:
                relative = value.relative_to("/panorama")
            except ValueError:
                continue
            target = (root / relative).resolve()
            if target.is_relative_to(active):
                protected.add(target)
    return protected


def candidates(active: Path, protected: set[Path], cutoff: float):
    for kind in KINDS:
        folder = active / kind
        if not folder.is_dir():
            continue
        for first in folder.iterdir():
            if not first.is_dir() or len(first.name) != 2:
                continue
            for file in first.iterdir():
                if not file.is_file() or file.is_symlink():
                    continue
                resolved = file.resolve()
                if not resolved.is_relative_to(folder) or resolved in protected:
                    continue
                stat = file.stat()
                if stat.st_mtime >= cutoff:
                    continue
                yield file, stat


def run(root: Path, database_path: Path, quarantine: Path, age_hours: int, apply: bool) -> dict:
    root = root.resolve()
    quarantine = quarantine.resolve()
    if root.name != "panorama" or quarantine.parent != root.parent or not quarantine.name.startswith("panorama-orphan-quarantine"):
        raise ValueError("confined panorama root and sibling quarantine are required")
    if not database_path.is_file() or not root.is_dir() or age_hours < 1:
        raise ValueError("existing production database, panorama root and positive minimum age required")
    database = sqlite3.connect(database_path, timeout=60)
    try:
        database.execute("BEGIN IMMEDIATE" if apply else "BEGIN")
        current = database.execute("SELECT id FROM panorama_generations WHERE state='active' ORDER BY activated_at DESC LIMIT 1").fetchone()
        if not current:
            raise ValueError("no active panorama generation")
        generation_id = current[0]
        active = (root / "active" / generation_id).resolve()
        if not active.is_dir() or not active.is_relative_to(root / "active"):
            raise ValueError("active panorama generation is not on the expected volume")
        protected = paths(database, root, active, generation_id)
        cutoff = time.time() - age_hours * 3600
        counts = Counter()
        bytes_freed = 0
        allocated_freed = 0
        moved = []
        for file, stat in candidates(active, protected, cutoff):
            relative = file.relative_to(active)
            counts[relative.parts[0]] += 1
            bytes_freed += stat.st_size
            allocated_freed += stat.st_blocks * 512
            if apply:
                target = quarantine / generation_id / relative
                if target.exists():
                    raise FileExistsError(f"quarantine target already exists: {target}")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(file, target)
                moved.append({"path": str(relative), "bytes": stat.st_size})
        if apply:
            manifest = quarantine / generation_id / "quarantined.json"
            temporary = manifest.with_suffix(".part")
            temporary.write_text(json.dumps({"generation": generation_id, "files": moved}, sort_keys=True) + "\n")
            os.replace(temporary, manifest)
        database.commit()
        return {"generation": generation_id, "apply": apply, "minimum_age_hours": age_hours,
                "counts": dict(counts), "apparent_bytes": bytes_freed,
                "allocated_bytes": allocated_freed, "quarantine": str(quarantine) if apply else None}
    except Exception:
        database.rollback()
        raise
    finally:
        database.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/srv/data/benchly/panorama"))
    parser.add_argument("--database", type=Path, default=Path("/srv/data/benchly/data/benchly.sqlite"))
    parser.add_argument("--quarantine", type=Path, default=Path("/srv/data/benchly/panorama-orphan-quarantine"))
    parser.add_argument("--minimum-age-hours", type=int, default=24)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.root, args.database, args.quarantine, args.minimum_age_hours, args.apply), sort_keys=True))
