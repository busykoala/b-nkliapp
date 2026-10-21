"""Install downloaded public geographic inputs into the isolated art-review DB."""
import base64
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[2] / "data/panorama-artist-review"
source = root / "cluster/context.json.gz"
payload = source.read_bytes()
records = json.loads(gzip.decompress(payload))
database = sqlite3.connect(root / "review.sqlite")
database.execute("PRAGMA foreign_keys=ON")
counts = {}
with database:
    for table in ("land_cover_features", "environment_features", "official_context_sources", "pipeline_runs"):
        allowed = {row[1] for row in database.execute(f"PRAGMA table_info({table})")}
        rows = records[table]
        if not rows:
            counts[table] = 0
            continue
        fields = [field for field in rows[0] if field in allowed]
        quoted = ",".join(f'"{field}"' for field in fields)
        placeholders = ",".join("?" for _ in fields)
        query = f"INSERT OR REPLACE INTO {table} ({quoted}) VALUES ({placeholders})"
        def values(row):
            return tuple(base64.b64decode(row[field]["base64"]) if isinstance(row[field], dict) else row[field] for field in fields)
        database.executemany(query, (values(row) for row in rows))
        counts[table] = len(rows)
database.close()
manifest = {"contextSha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload), "counts": counts}
(root / "cluster/context-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest))
