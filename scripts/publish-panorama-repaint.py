"""Resume the checked-in panorama repaint's LAN-safe, forward-only publication.

Run manually on the builder Mac, outside release CI. Nothing is uploaded or
changed in production without --apply. Both the local painter and remote
worker revalidate the same source hash, artifact hashes, IDs and coordinates.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import shlex
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))

from benchly.panorama import refresh  # noqa: E402

TARGET = "busykoala@api.blizzard.busykoala.io"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", TARGET]


def _run(argv: list[str], *, timeout: int = 180) -> str:
    result = subprocess.run(argv, capture_output=True, text=True, check=True, timeout=timeout)
    return result.stdout.strip()


def _groups(index: Path) -> dict[int, int]:
    counts: dict[int, int] = {}
    with index.open(encoding="utf-8") as handle:
        for line in handle:
            row = int(line.rstrip("\n").split("\t")[1])
            group = row // 512
            counts[group] = counts.get(group, 0) + 1
    return counts


def _pod() -> str:
    payload = json.loads(_run([*SSH, "sudo -n k0s kubectl -n benchly get pods -o json"], timeout=30))
    ready = [item["metadata"]["name"] for item in payload["items"]
             if item["metadata"]["name"].startswith("benchly-panorama-")
             and not item["metadata"]["name"].startswith("benchly-panorama-reconcile-")
             and item.get("status", {}).get("phase") == "Running"
             and item.get("status", {}).get("containerStatuses")
             and all(status.get("ready") for status in item["status"]["containerStatuses"])]
    if len(ready) != 1:
        raise RuntimeError(f"expected exactly one ready panorama worker; found {ready}")
    return ready[0]


def _remote_worker(pod: str, chunk_id: str, *, apply: bool) -> str:
    argv = ("sudo -n k0s kubectl -n benchly exec " + shlex.quote(pod)
            + " -- python3 /worker/benchly_worker.py panorama-repaint-activate"
            + " --database /data/benchly.sqlite --server-root /panorama"
            + " --artifact-root /panorama --chunk-id " + shlex.quote(chunk_id)
            + " --capacity-gib 80" + (" --apply" if apply else ""))
    return _run([*SSH, argv], timeout=180)


def _remote_applied(pod: str, chunk_id: str, expected: int) -> bool:
    # A directory alone is insufficient: power loss between rename and DB
    # commit can leave an unbound active artifact. Count actual DB bindings.
    code = ("import sqlite3; from pathlib import Path; "
            "d=sqlite3.connect('/data/benchly.sqlite'); "
            f"p='/panorama/active/render-chunks/{chunk_id}'; "
            "print(int(Path(p,'manifest.json').is_file()), "
            "d.execute('select count(*) from bench_panorama_renders where artifact_path like ?',"
            "(p+'/%',)).fetchone()[0])")
    remote = ("sudo -n k0s kubectl -n benchly exec " + shlex.quote(pod)
              + " -- python3 -c " + shlex.quote(code))
    manifest, bound = map(int, _run([*SSH, remote], timeout=30).split())
    if bound not in (0, expected):
        raise RuntimeError(f"partial production binding for {chunk_id}: {bound}/{expected}")
    if bool(manifest) != bool(bound):
        raise RuntimeError(f"production image/DB mismatch for {chunk_id}")
    return bool(manifest and bound == expected)


def _ready(progress: sqlite3.Connection, group: int, painter: str, expected: int) -> bool:
    count = progress.execute("""SELECT count(*) FROM painted
      WHERE bench_row_id>=? AND bench_row_id<? AND painter_key=?""",
                             (group * 512, (group + 1) * 512, painter)).fetchone()[0]
    return count == expected


def publish(root: Path, index: Path, capsule_root: Path, *, apply: bool, follow: bool,
            interval: int) -> None:
    refresh._require_upload_target(TARGET)
    root.mkdir(parents=True, exist_ok=True)
    groups = _groups(index)
    painter = refresh._painter_key()
    print(json.dumps({"groups": len(groups), "benches": sum(groups.values()),
                      "painter_key": painter, "apply": apply, "follow": follow}), flush=True)
    with (root / ".paint-publisher.lock").open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        with sqlite3.connect(root / "paint-progress.sqlite", timeout=30) as progress, \
             refresh.publication_ledger(root) as ledger:
            while True:
                if refresh._painter_key() != painter:
                    raise RuntimeError("checked-in painter changed during publication; restart with new source")
                complete = 0
                pending = 0
                for group, expected in sorted(groups.items()):
                    if not _ready(progress, group, painter, expected):
                        pending += 1
                        continue
                    folder = root / "chunks" / str(group)
                    manifest_path = folder / "manifest.json"
                    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
                    if manifest is None or manifest.get("painter_key") != painter:
                        if not apply:
                            print(json.dumps({"ready_group": group, "benches": expected}), flush=True)
                            pending += 1
                            continue
                        refresh.seal_repaint_job(argparse.Namespace(
                            root=str(root), bench_index=str(index), capsule_root=str(capsule_root), group=group))
                        manifest = json.loads(manifest_path.read_text())
                    chunk_id = manifest["chunk_id"]
                    saved = ledger.execute("SELECT chunk_id,status FROM published WHERE group_id=?", (group,)).fetchone()
                    if saved == (chunk_id, "applied"):
                        complete += 1
                        continue
                    if not apply:
                        print(json.dumps({"ready_group": group, "chunk_id": chunk_id,
                                          "benches": len(manifest["records"])}), flush=True)
                        pending += 1
                        continue
                    try:
                        pod = _pod()
                        if _remote_applied(pod, chunk_id, expected):
                            refresh.publication_mark(ledger, group, chunk_id, "applied")
                            complete += 1
                            continue
                        if saved != (chunk_id, "uploaded"):
                            refresh.upload_repaint_job(argparse.Namespace(
                                chunk=str(folder), target=TARGET, capacity_gib=80))
                            refresh.publication_mark(ledger, group, chunk_id, "uploaded")
                        preview = _remote_worker(pod, chunk_id, apply=False)
                        if "Another Benchly worker owns" in preview:
                            pending += 1
                            continue
                        if json.loads(preview.splitlines()[-1]).get("benches") != expected:
                            raise RuntimeError(f"unexpected production diff for group {group}: {preview}")
                        result = _remote_worker(pod, chunk_id, apply=True)
                        if "Another Benchly worker owns" in result:
                            pending += 1
                            continue
                        if json.loads(result.splitlines()[-1]).get("activated_chunk") != chunk_id:
                            raise RuntimeError(f"activation did not confirm group {group}: {result}")
                        if not _remote_applied(pod, chunk_id, expected):
                            raise RuntimeError(f"activated group {group} is not fully bound")
                        refresh.publication_mark(ledger, group, chunk_id, "applied")
                        complete += 1
                        print(json.dumps({"published_group": group, "chunk_id": chunk_id,
                                          "benches": expected}), flush=True)
                    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired,
                            RuntimeError, ValueError) as error:
                        pending += 1
                        print(json.dumps({"retry_group": group, "error": str(error)}),
                              file=sys.stderr, flush=True)
                print(json.dumps({"published_groups": complete, "total_groups": len(groups),
                                  "pending_groups": pending}), flush=True)
                if not follow or complete == len(groups):
                    return
                time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT / "data/panorama-repaint")
    parser.add_argument("--bench-index", type=Path, default=ROOT / "data/panorama-repaint/current-index.tsv")
    parser.add_argument("--capsule-root", type=Path, default=ROOT / "data/panorama-builder/generation/capsules")
    parser.add_argument("--apply", action="store_true", help="Explicitly allow uploads and production activation")
    parser.add_argument("--follow", action="store_true", help="Keep publishing new completed groups")
    parser.add_argument("--interval", type=int, default=30)
    args = parser.parse_args()
    if not 10 <= args.interval <= 3600:
        parser.error("--interval must be between 10 and 3600 seconds")
    publish(args.root.resolve(), args.bench_index.resolve(), args.capsule_root.resolve(),
            apply=args.apply, follow=args.follow, interval=args.interval)


if __name__ == "__main__":
    main()
