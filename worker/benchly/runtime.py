"""Small process-level primitives shared by import commands."""

from __future__ import annotations

import fcntl
import hashlib
import math
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@contextmanager
def exclusive_worker_lock(database: Path, *, timeout_seconds: float = 0):
    """Prevent independent CronJobs from writing the shared SQLite file together."""
    if not math.isfinite(timeout_seconds) or timeout_seconds < 0:
        raise ValueError("Worker lock timeout must be finite and non-negative")
    lock_path = database.with_name(".benchly-worker.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as handle:
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    yield False
                    return
                time.sleep(min(0.1, remaining))
        try:
            handle.seek(0)
            handle.truncate()
            handle.write(f"{os.getpid()} {now_iso()}\n")
            handle.flush()
            yield True
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
