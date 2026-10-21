"""Resume bounded painting/material updates using geometry already on the server."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path

from benchly.panorama import refresh
from benchly.runtime import exclusive_worker_lock


def prepare(database: Path, artifact_root: Path, work: Path, requested: list[int]) -> Path:
    if not requested or len(set(requested)) != len(requested) or any(type(row) is not int or row <= 0 for row in requested):
        raise ValueError("An explicit list of distinct positive bench row IDs is required")
    index = work / "index.tsv"
    if index.exists():
        actual = {int(line.split("\t")[1]) for line in index.read_text().splitlines()}
        if actual != set(requested):
            raise ValueError("Existing in-place checkpoint has a different selection")
        return index
    work.mkdir(parents=True, exist_ok=True)
    records = []
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        for start in range(0, len(requested), 400):
            batch = requested[start:start + 400]
            records.extend(connection.execute("""SELECT b.row_id,b.id,b.latitude,b.longitude,pg.geometry_key,
                pg.artifact_path,pg.artifact_sha256 FROM benches b
                JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id
                WHERE b.active=1 AND pg.status='ready' AND pg.bench_id=b.id
                AND abs(pg.bench_latitude-b.latitude)<=1e-7 AND abs(pg.bench_longitude-b.longitude)<=1e-7
                AND pg.generation_id=(SELECT id FROM panorama_generations WHERE state='active')
                AND b.row_id IN (""" + ",".join("?" for _ in batch) + ")", batch).fetchall())
    if {row[0] for row in records} != set(requested):
        raise ValueError("Some requested benches no longer have current production geography")
    lines = []
    for row, bench, latitude, longitude, key, path, checksum in sorted(records):
        source = Path(path).resolve()
        if not source.is_relative_to(artifact_root) or not source.is_file() or source.name != key + ".bpc":
            raise ValueError("In-place capsule is outside the artifact volume or has the wrong identity")
        if checksum and refresh._digest(source) != checksum:
            raise ValueError("In-place capsule checksum mismatch")
        target = work / "capsules" / key[:2] / (key + ".bpc")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.symlink_to(source)
        lines.append(f"{key}\t{row}\t{bench}\t{latitude:.10f}\t{longitude:.10f}\n")
    refresh._atomic(index, "".join(lines).encode())
    return index


def bound_count(database: Path, prefix: Path, painter: str) -> int:
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        return connection.execute("""SELECT count(*) FROM bench_panorama_renders
            WHERE artifact_path LIKE ? AND material_path LIKE ? AND style_version=? AND status='ready'""",
            (str(prefix) + "/%", str(prefix) + "/%", painter)).fetchone()[0]


def run(args: argparse.Namespace) -> None:
    database, root, work = Path(args.database).resolve(), Path(args.artifact_root).resolve(), Path(args.work_dir).resolve()
    if not work.is_relative_to(root / "working"):
        raise ValueError("In-place work must remain inside the artifact volume's working directory")
    requested = json.loads(Path(args.row_ids).read_text())
    if not isinstance(requested, list):
        raise ValueError("Row selection must be a JSON list")
    if not args.apply:
        print(json.dumps({"preview": True, "requested": len(requested), "geometry_export": False}))
        return
    index = prepare(database, root, work, requested)
    groups: dict[int, int] = {}
    for line in index.read_text().splitlines():
        group = int(line.split("\t")[1]) // 512
        groups[group] = groups.get(group, 0) + 1
    painter = refresh._painter_key()
    ledger = refresh.publication_ledger(work)
    try:
        for group, expected in sorted(groups.items()):
            if refresh._painter_key() != painter:
                raise RuntimeError("Painter changed during in-place repaint")
            saved = ledger.execute("SELECT chunk_id,status FROM published WHERE group_id=?", (group,)).fetchone()
            if saved:
                active = root / "active" / "render-chunks" / saved[0]
                count = bound_count(database, active, painter)
                if count == expected:
                    refresh.publication_mark(ledger, group, saved[0], "applied")
                    continue
                if count or saved[1] == "applied":
                    raise RuntimeError("Previously published in-place bindings changed")
                chunk_id = saved[0]
            else:
                refresh._require_logical_headroom(refresh._logical_used_bytes(root), 512 * 1024**2, args.capacity_gib)
                paint = argparse.Namespace(root=str(work), capsule_root=str(work / "capsules"), bench_index=str(index),
                    season="summer", cpu_workers=args.cpu_workers, limit=0, group=group)
                refresh.repaint_job(paint)
                refresh.seal_repaint_job(paint)
                folder = work / "chunks" / str(group)
                manifest = json.loads((folder / "manifest.json").read_text())
                refresh._verify_chunk(folder, manifest, strict=True)
                chunk_id = manifest["chunk_id"]
                incoming = root / "incoming" / "paint" / chunk_id
                incoming.parent.mkdir(parents=True, exist_ok=True)
                if incoming.exists():
                    raise RuntimeError("Uncheckpointed incoming paint chunk needs inspection")
                os.replace(folder, incoming)
                refresh.publication_mark(ledger, group, chunk_id, "uploaded")
            with exclusive_worker_lock(database, timeout_seconds=60) as locked:
                if not locked:
                    raise RuntimeError("Another worker owns the publication lock; rerun to resume")
                refresh.activate_repaint_job(argparse.Namespace(server_root=str(root), artifact_root=str(root),
                    database=str(database), chunk_id=chunk_id, capacity_gib=args.capacity_gib, apply=True))
            if bound_count(database, root / "active" / "render-chunks" / chunk_id, painter) != expected:
                raise RuntimeError("In-place publication did not bind every painting and material")
            refresh.publication_mark(ledger, group, chunk_id, "applied")
            print(json.dumps({"published_group": group, "benches": expected}), flush=True)
    finally:
        ledger.close()
    print(json.dumps({"complete": True, "benches": len(requested), "geometry_export": False}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="/data/benchly.sqlite")
    parser.add_argument("--artifact-root", default="/panorama")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--row-ids", required=True)
    parser.add_argument("--cpu-workers", type=int, choices=range(1, 5), default=2)
    parser.add_argument("--capacity-gib", type=int, default=80)
    parser.add_argument("--apply", action="store_true")
    run(parser.parse_args())


if __name__ == "__main__":
    main()
