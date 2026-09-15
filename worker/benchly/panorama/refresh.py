"""Forward-only repaint from existing view capsules, with sealed small SSH chunks."""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
from argparse import Namespace
from datetime import UTC, datetime
from pathlib import Path

from benchly.panorama.binary import decode_geometry
from benchly.panorama.builder import MINIMUM_FREE_BYTES, SERVER_ROOT, _require_upload_target, _rsync_command
from benchly.panorama.identity import implementation_key
from benchly.panorama.repository import publish_repaint_chunk
from benchly.panorama.watercolor import render_panorama_webp

FORMAT = "benchly-panorama-paint-chunk"
SCHEMA = 1
_REMOTE_CAPSULE = re.compile(r"^/panorama/(active/[a-zA-Z0-9_-]+/capsules/([0-9a-f]{2})/([0-9a-f]{64})\.bpc)$")


def _digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def _logical_used_bytes(root: Path) -> int:
    """Measure allocated bytes of a local PV even when its host disk is larger."""
    total = 0
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in (*folders, *files):
            path = Path(directory) / name
            if not path.is_symlink():
                total += path.stat().st_blocks * 512
    return total


def _require_logical_headroom(used: int, incoming: int, capacity_gib: int) -> None:
    if capacity_gib <= 0 or capacity_gib * 1024**3 - used - incoming < MINIMUM_FREE_BYTES:
        raise RuntimeError("repaint stopped before writing: less than 20 GiB logical panorama PV headroom")


def _atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.part")
    try:
        temporary.write_bytes(payload)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _painter_key() -> str:
    # The checked-in implementation, not a hand-maintained build version,
    # decides whether a saved repaint can be reused.
    return implementation_key("binary.py", "models.py", "watercolor.py", "assets/watercolor-pigment.png")


def _progress(root: Path) -> sqlite3.Connection:
    root.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(root / "paint-progress.sqlite", timeout=60)
    database.execute("PRAGMA journal_mode=WAL")
    database.execute("PRAGMA synchronous=FULL")
    database.execute("""CREATE TABLE IF NOT EXISTS painted(
      bench_row_id INTEGER PRIMARY KEY,bench_id TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,
      geometry_key TEXT NOT NULL,source_size INTEGER NOT NULL,source_mtime_ns INTEGER NOT NULL,
      painter_key TEXT NOT NULL,season TEXT NOT NULL,relative_path TEXT NOT NULL,sha256 TEXT NOT NULL,artifact_bytes INTEGER NOT NULL,
      finished_at TEXT NOT NULL)""")
    return database


def _index(path: Path, capsule_root: Path):
    seen: set[int] = set()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            key, raw_row, bench_id, raw_lat, raw_lon = line.rstrip("\n").split("\t")
            row = int(raw_row)
            if row in seen or len(key) != 64 or any(char not in "0123456789abcdef" for char in key):
                raise ValueError(f"invalid or duplicate bench index row {row}")
            seen.add(row)
            source = capsule_root / key[:2] / f"{key}.bpc"
            yield (row, bench_id, float(raw_lat), float(raw_lon), key, source)


def _remote_capsule_path(path: str, key: str) -> str:
    match = _REMOTE_CAPSULE.fullmatch(path)
    if not match or match[2] != key[:2] or match[3] != key:
        raise ValueError("production capsule path does not match its geometry key")
    return match[1]


def fetch_repaint_capsules_job(args: Namespace) -> None:
    """Resume only missing current production BPCs into the local paint cache."""
    _require_upload_target(args.target)
    capsule_root = Path(args.capsule_root).resolve()
    index = Path(args.bench_index).resolve()
    output = Path(args.output).resolve()
    rows: dict[int, tuple[str, str, float, float]] = {}
    missing: dict[int, tuple[str, str, float, float]] = {}
    for line in index.read_text(encoding="utf-8").splitlines():
        key, raw_row, bench_id, raw_lat, raw_lon = line.split("\t")
        row = int(raw_row)
        if row in rows or not bench_id or (key and (len(key) != 64 or any(c not in "0123456789abcdef" for c in key))):
            raise ValueError("invalid or duplicate production bench index row")
        if not key:
            continue  # New bench without ready geography; the worker will prepare it.
        binding = (key, bench_id, float(raw_lat), float(raw_lon))
        rows[row] = binding
        source = capsule_root / key[:2] / f"{key}.bpc"
        if not source.is_file():
            missing[row] = binding
    cache = capsule_root.parent / "production-downloads"
    cache.mkdir(parents=True, exist_ok=True)
    paths: dict[int, str] = {}
    for start in range(0, len(missing), 400):
        batch = list(missing)[start:start + 400]
        query = ("SELECT b.row_id,b.id,b.latitude,b.longitude,pg.geometry_key,pg.artifact_path "
                 "FROM benches b JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id "
                 "WHERE b.active=1 AND pg.status='ready' AND pg.bench_id=b.id "
                 "AND abs(pg.bench_latitude-b.latitude)<=1e-9 "
                 "AND abs(pg.bench_longitude-b.longitude)<=1e-9 "
                 f"AND b.row_id IN ({','.join(str(row) for row in batch)});")
        remote = f"sqlite3 -separator {shlex.quote(chr(9))} {shlex.quote(args.remote_database)} {shlex.quote(query)}"
        result = subprocess.run(["ssh", args.target, remote], check=True, capture_output=True, text=True)
        for line in result.stdout.splitlines():
            raw_row, bench_id, raw_lat, raw_lon, key, path = line.split("\t")
            row = int(raw_row)
            expected = missing.get(row)
            if expected is None or expected[0] != key or expected[1] != bench_id or abs(expected[2] - float(raw_lat)) > 1e-9 or abs(expected[3] - float(raw_lon)) > 1e-9:
                raise ValueError("production capsule binding changed during download")
            paths[row] = _remote_capsule_path(path, key)
    if len(paths) != len(missing):
        raise ValueError("production capsule index changed during download")
    if paths:
        files = cache / "files-from.txt"
        _atomic(files, ("\n".join(sorted(set(paths.values()))) + "\n").encode())
        rsync = _rsync_command()
        subprocess.run([rsync, "-a", "--partial", "--append-verify", "--files-from", str(files),
                        "-e", "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
                        f"{args.target}:{SERVER_ROOT}/", f"{cache}/"], check=True)
    for row, relative in paths.items():
        key, _bench_id, lat, lon = missing[row]
        downloaded = cache / relative
        geometry = decode_geometry(downloaded.read_bytes())
        if geometry.identity_key != key or abs(geometry.latitude - lat) > 1e-7 or abs(geometry.longitude - lon) > 1e-7:
            raise ValueError("downloaded production capsule failed identity or coordinate verification")
        target = capsule_root / key[:2] / f"{key}.bpc"
        if not target.is_file():
            _atomic(target, downloaded.read_bytes())
    content = "".join(f"{key}\t{row}\t{bench_id}\t{lat:.10f}\t{lon:.10f}\n"
                      for row, (key, bench_id, lat, lon) in sorted(rows.items()))
    _atomic(output, content.encode())
    print(json.dumps({"ready": len(rows), "downloaded": len(paths), "output": str(output)}))


def repaint_index_job(args: Namespace) -> None:
    """Derive the exact capsule mapping from the sealed local activation manifest.

    A separately downloaded production index can refer to an older generation
    and must not be mixed with the current capsule files.
    """
    manifest = json.loads(Path(args.manifest).resolve().read_text())
    if manifest.get("format") != "benchly-panorama-generation" or manifest.get("schema") != 1:
        raise ValueError("invalid sealed panorama manifest")
    rows: dict[int, tuple[str, str, float, float]] = {}
    for record in manifest["artifacts"]:
        if record["kind"] != "capsule":
            continue
        row = int(record["bench_row_id"])
        if row in rows:
            raise ValueError(f"duplicate capsule binding {row}")
        rows[row] = (str(record["geometry_key"]), str(record["bench_id"]),
                     float(record["bench_latitude"]), float(record["bench_longitude"]))
    if len(rows) * 3 != int(manifest["artifact_count"]):
        raise ValueError("sealed manifest is missing a capsule, render, or material")
    output = Path(args.output).resolve()
    content = "".join(f"{key}\t{row}\t{bench}\t{lat:.10f}\t{lon:.10f}\n"
                      for row, (key, bench, lat, lon) in sorted(rows.items()))
    _atomic(output, content.encode())
    print(json.dumps({"indexed": len(rows), "path": str(output), "sha256": _digest(output)}))


def _render(task: tuple[int, str, float, float, str, Path, str, Path]) -> dict[str, object]:
    row, bench_id, lat, lon, key, source, season, root = task
    stat = source.stat()
    geometry = decode_geometry(source.read_bytes())
    if geometry.identity_key != key or abs(geometry.latitude - lat) > 1e-7 or abs(geometry.longitude - lon) > 1e-7:
        raise ValueError(f"capsule identity or coordinates changed for {bench_id}")
    image = render_panorama_webp(geometry, 4096, 1024, season)
    digest = hashlib.sha256(image).hexdigest()
    relative = Path("chunks") / str(row // 512) / "renders" / f"{row}-{digest}.webp"
    _atomic(root / relative, image)
    return {"bench_row_id": row, "bench_id": bench_id, "latitude": lat, "longitude": lon,
            "geometry_key": key, "source_size": stat.st_size, "source_mtime_ns": stat.st_mtime_ns, "season": season,
            "relative_path": str(relative), "sha256": digest, "artifact_bytes": len(image),
            "finished_at": datetime.now(UTC).isoformat()}


def repaint_job(args: Namespace) -> None:
    root = Path(args.root).resolve()
    capsule_root = Path(args.capsule_root).resolve()
    painter = _painter_key()
    progress = _progress(root)
    group = getattr(args, "group", None)
    rows = [row for row in _index(Path(args.bench_index).resolve(), capsule_root)
            if (group is None or row[0] // 512 == group) and
            (getattr(args, "bench_id", None) is None or row[1] == args.bench_id)]
    if (group is not None or getattr(args, "bench_id", None) is not None) and not rows:
        raise ValueError("no current production benches match the requested paint selection")
    pending = []
    for row, bench_id, lat, lon, key, source in rows:
        stat = source.stat()
        previous = progress.execute("SELECT geometry_key,source_size,source_mtime_ns,painter_key,season,relative_path,sha256,artifact_bytes FROM painted WHERE bench_row_id=?", (row,)).fetchone()
        if previous and previous[:5] == (key, stat.st_size, stat.st_mtime_ns, painter, args.season):
            file = root / previous[5]
            if file.is_file() and file.stat().st_size == previous[7]:
                continue
        pending.append((row, bench_id, lat, lon, key, source, args.season, root))
        if args.limit and len(pending) >= args.limit:
            break
    completed = 0
    # Keep only a small spatial batch in flight. An interrupt must not leave
    # thousands of finished-but-uncheckpointed pool.map results behind.
    batch_size = max(1, args.cpu_workers * 4)
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.cpu_workers) as pool:
        for start in range(0, len(pending), batch_size):
            futures = [pool.submit(_render, task) for task in pending[start:start + batch_size]]
            for future in concurrent.futures.as_completed(futures):
                record = future.result()
                progress.execute("""INSERT INTO painted VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(bench_row_id) DO UPDATE SET bench_id=excluded.bench_id,latitude=excluded.latitude,
                  longitude=excluded.longitude,geometry_key=excluded.geometry_key,source_size=excluded.source_size,
                  source_mtime_ns=excluded.source_mtime_ns,painter_key=excluded.painter_key,season=excluded.season,
                  relative_path=excluded.relative_path,sha256=excluded.sha256,
                  artifact_bytes=excluded.artifact_bytes,finished_at=excluded.finished_at""",
                  (record["bench_row_id"], record["bench_id"], record["latitude"], record["longitude"],
                   record["geometry_key"], record["source_size"], record["source_mtime_ns"], painter, record["season"],
                   record["relative_path"], record["sha256"], record["artifact_bytes"], record["finished_at"]))
                progress.commit()
                completed += 1
                if completed % 512 == 0:
                    print(json.dumps({"painted": completed, "total": len(rows)}), flush=True)
    if getattr(args, "bench_id", None) is not None:
        ready = int(progress.execute("SELECT count(*) FROM painted WHERE painter_key=? AND season=? AND bench_id=?",
                                     (painter, args.season, args.bench_id)).fetchone()[0])
    elif group is None:
        ready = int(progress.execute("SELECT count(*) FROM painted WHERE painter_key=? AND season=?", (painter, args.season)).fetchone()[0])
    else:
        ready = int(progress.execute("SELECT count(*) FROM painted WHERE painter_key=? AND season=? AND bench_row_id>=? AND bench_row_id<?",
                                     (painter, args.season, group * 512, (group + 1) * 512)).fetchone()[0])
    progress.close()
    print(json.dumps({"painted_now": completed, "ready": ready, "total": len(rows), "remaining": max(0, len(rows) - ready)}))


def seal_repaint_job(args: Namespace) -> None:
    root = Path(args.root).resolve()
    progress = _progress(root)
    painter = _painter_key()
    groups: dict[int, list[tuple]] = {}
    group_filter = getattr(args, "group", None)
    for row in _index(Path(args.bench_index).resolve(), Path(args.capsule_root).resolve()):
        if group_filter is not None and row[0] // 512 != group_filter:
            continue
        groups.setdefault(row[0] // 512, []).append(row)
    sealed = 0
    for group, group_rows in groups.items():
        records: list[dict[str, object]] = []
        group_season: str | None = None
        for row_id, bench_id, lat, lon, key, source in group_rows:
            result = progress.execute("SELECT bench_id,latitude,longitude,geometry_key,source_size,source_mtime_ns,painter_key,season,relative_path,sha256,artifact_bytes FROM painted WHERE bench_row_id=?", (row_id,)).fetchone()
            stat = source.stat()
            if not result or result[:7] != (bench_id, lat, lon, key, stat.st_size, stat.st_mtime_ns, painter):
                break
            if group_season is not None and result[7] != group_season:
                break
            group_season = result[7]
            file = root / result[8]
            if not file.is_file() or file.stat().st_size != result[10] or _digest(file) != result[9]:
                break
            records.append({"bench_row_id": row_id, "bench_id": bench_id, "latitude": lat, "longitude": lon,
                            "geometry_key": key, "relative_path": str(Path(result[8]).relative_to(Path("chunks") / str(group))),
                            "sha256": result[9], "bytes": result[10]})
        if len(records) != len(group_rows):
            continue
        content = {"format": FORMAT, "schema": SCHEMA, "painter_key": painter, "season": group_season, "group": group,
                   "records": records, "artifact_bytes": sum(int(record["bytes"]) for record in records)}
        if content["artifact_bytes"] > 512 * 1024 * 1024:
            raise RuntimeError(f"paint group {group} exceeds the 512-MiB upload bound")
        canonical = json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
        chunk_id = hashlib.sha256(canonical).hexdigest()
        manifest = {**content, "chunk_id": chunk_id}
        folder = root / "chunks" / str(group)
        _atomic(folder / "manifest.json", json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        _atomic(folder / "manifest.sha256", f"{_digest(folder / 'manifest.json')}  manifest.json\n".encode())
        sealed += 1
    progress.close()
    print(json.dumps({"sealed_chunks": sealed, "groups": len(groups)}))


def upload_repaint_job(args: Namespace) -> None:
    _require_upload_target(args.target)
    folder = Path(args.chunk).resolve()
    manifest = json.loads((folder / "manifest.json").read_text())
    _verify_chunk(folder, manifest)
    remote_folder = SERVER_ROOT / "incoming" / "paint" / manifest["chunk_id"]
    capacity = getattr(args, "capacity_gib", 80)
    allocated = int(subprocess.run(["ssh", args.target, "du", "-B1", "-s", str(SERVER_ROOT)],
                                   check=True, capture_output=True, text=True).stdout.split()[0])
    _require_logical_headroom(allocated, int(manifest["artifact_bytes"]), capacity)
    # Check free space before rsync writes anything; incoming chunks are small
    # and confirmed completed files survive a dropped SSH connection.
    free = int(subprocess.run(["ssh", args.target, "df", "-Pk", str(SERVER_ROOT)],
                              check=True, capture_output=True, text=True).stdout.splitlines()[-1].split()[3]) * 1024
    if free - int(manifest["artifact_bytes"]) < MINIMUM_FREE_BYTES:
        raise RuntimeError("repaint upload stopped before writing: less than 20 GiB free")
    subprocess.run(["ssh", args.target, "mkdir", "-p", str(remote_folder)], check=True)
    rsync = _rsync_command()
    target = f"{args.target}:{remote_folder}/"
    # The local group retains older content-addressed renders for forward
    # iteration. Transfer only the coordinates-and-hashes sealed in this
    # manifest, never every file that happens to share its renders directory.
    subprocess.run([rsync, "-a", "--partial", "--append-verify", "--files-from=-",
                    f"{folder}/", target], input=_upload_file_list(manifest), text=True, check=True)
    subprocess.run([rsync, "-a", str(folder / "manifest.json"), str(folder / "manifest.sha256"), target], check=True)
    print(json.dumps({"uploaded_chunk": manifest["chunk_id"], "benches": len(manifest["records"])}))


def _upload_file_list(manifest: dict[str, object]) -> str:
    # Do not list the parent directory: rsync treats it as a recursive source
    # on some versions and would pull every superseded image beside the 511
    # sealed files. Each explicit child creates its own parent remotely.
    return "".join(f"{record['relative_path']}\n" for record in manifest["records"])


def _verify_chunk(folder: Path, manifest: dict[str, object], *, strict: bool = False) -> None:
    if manifest.get("format") != FORMAT or manifest.get("schema") != SCHEMA:
        raise ValueError("invalid paint chunk format")
    content = {key: value for key, value in manifest.items() if key != "chunk_id"}
    expected = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if manifest.get("chunk_id") != expected or _digest(folder / "manifest.json") != (folder / "manifest.sha256").read_text().split()[0]:
        raise ValueError("paint chunk manifest checksum mismatch")
    records = manifest.get("records")
    if not isinstance(records, list) or not 0 < len(records) <= 512:
        raise ValueError("paint chunk must contain 1–512 benches")
    if not isinstance(manifest.get("artifact_bytes"), int) or manifest["artifact_bytes"] > 512 * 1024 * 1024:
        raise ValueError("paint chunk exceeds the 512-MiB bound")
    total = 0
    seen: set[int] = set()
    expected_files: set[str] = set()
    for record in records:
        row = record["bench_row_id"]
        if not isinstance(row, int) or row in seen:
            raise ValueError("duplicate or invalid bench in paint chunk")
        seen.add(row)
        relative = Path(record["relative_path"])
        if len(relative.parts) != 2 or relative.parts[0] != "renders" or relative.suffix != ".webp":
            raise ValueError("invalid paint artifact path")
        expected_files.add(relative.as_posix())
        file = (folder / record["relative_path"]).resolve()
        if not file.is_relative_to(folder) or not file.is_file() or file.stat().st_size != record["bytes"] or _digest(file) != record["sha256"]:
            raise ValueError(f"invalid paint artifact {record['relative_path']}")
        total += int(record["bytes"])
    if total != manifest["artifact_bytes"]:
        raise ValueError("paint chunk byte count mismatch")
    if strict:
        actual_files = {file.relative_to(folder).as_posix() for file in (folder / "renders").iterdir()}
        if actual_files != expected_files:
            raise ValueError("incoming paint chunk contains unsealed artifacts")


def activate_repaint_job(args: Namespace) -> None:
    root = Path(args.server_root).resolve()
    artifact_root = Path(args.artifact_root).resolve()
    incoming = root / "incoming" / "paint" / args.chunk_id
    manifest = json.loads((incoming / "manifest.json").read_text())
    _verify_chunk(incoming, manifest, strict=True)
    if manifest["chunk_id"] != args.chunk_id:
        raise ValueError("incorrect paint chunk ID")
    if manifest["painter_key"] != _painter_key():
        raise ValueError("paint chunk was created with a different checked-in painter")
    active = root / "active" / "render-chunks" / args.chunk_id
    if active.exists():
        raise ValueError("paint chunk already activated")
    _require_logical_headroom(_logical_used_bytes(root), 0, getattr(args, "capacity_gib", 80))
    if shutil.disk_usage(root).free < MINIMUM_FREE_BYTES:
        raise RuntimeError("paint activation stopped before writing: less than 20 GiB free")
    database = sqlite3.connect(Path(args.database).resolve(), timeout=60)
    old_paths: set[str] = set()
    moved = False
    committed = False
    try:
        database.execute("BEGIN IMMEDIATE")
        for record in manifest["records"]:
            current = database.execute("""SELECT b.id,b.latitude,b.longitude,pg.geometry_key,pr.artifact_path
              FROM benches b JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id
              JOIN bench_panorama_renders pr ON pr.bench_row_id=b.row_id AND pr.geometry_key=pg.geometry_key
              WHERE b.row_id=? AND b.active=1 AND pg.status='ready' AND pr.status='ready'""",
              (record["bench_row_id"],)).fetchone()
            if not current or current[:4] != (record["bench_id"], record["latitude"], record["longitude"], record["geometry_key"]):
                raise ValueError(f"bench changed since repaint: {record['bench_id']}")
            if current[4]:
                old_paths.add(current[4])
        if not args.apply:
            print(json.dumps({"preview_chunk": args.chunk_id, "benches": len(manifest["records"]),
                              "bytes": manifest["artifact_bytes"]}))
            database.rollback()
            return
        active.parent.mkdir(parents=True, exist_ok=True)
        os.replace(incoming, active)
        moved = True
        now = datetime.now(UTC).isoformat()
        prefix = str(artifact_root / "active" / "render-chunks" / args.chunk_id)
        publish_repaint_chunk(database, manifest["records"], manifest["painter_key"], prefix, now)
        database.commit()
        committed = True
        # Never retain a rollback copy. Keep a shared old image only while an
        # unrefreshed bench still points to it; geography and materials remain.
        for old in old_paths:
            try:
                if database.execute("SELECT 1 FROM bench_panorama_renders WHERE artifact_path=? LIMIT 1", (old,)).fetchone():
                    continue
                relative = Path(old).relative_to(artifact_root)
                file = root / relative
                if file.is_file() and file.is_relative_to(root / "active"):
                    file.unlink()
            except (OSError, ValueError) as error:
                print(json.dumps({"cleanup_warning": old, "error": str(error)}))
        print(json.dumps({"activated_chunk": args.chunk_id, "benches": len(manifest["records"]), "rollback": False}))
    except Exception:
        if not committed:
            database.rollback()
            if moved and active.exists() and not incoming.exists():
                os.replace(active, incoming)
        raise
    finally:
        database.close()
