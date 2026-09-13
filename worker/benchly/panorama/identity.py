"""Content identities for panorama algorithms.

Git owns software releases.  Runtime cache keys only need to know whether the
implementation that produces an artifact changed, so they are derived from
the checked-in source bytes instead of hand-maintained release numbers.
"""

from __future__ import annotations

import hashlib
from pathlib import Path


def implementation_key(*module_names: str) -> str:
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for name in sorted(module_names):
        payload = (root / name).read_bytes()
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
    return digest.hexdigest()
