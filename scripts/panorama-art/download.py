"""Read-only cluster snapshot for the fixed 20-location artist review.

Remote SQLite connections use mode=ro. No uploads, worker jobs, Kubernetes
mutations, application migrations or publication commands run on the cluster.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys
from datetime import UTC, datetime

ROOT = Path(__file__).resolve().parents[2]
TARGET = "busykoala@api.blizzard.busykoala.io"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", TARGET]


def remote_python(code: str, argument) -> list[str]:
    return [*SSH, "python3 -c " + shlex.quote(code) + " " + shlex.quote(json.dumps(argument))]


def context_snapshot(output: Path, records):
    destination = output / "context.json.gz"
    if destination.exists():
        print("Preserving existing context snapshot", flush=True)
        return
    code = '''import sqlite3,json,sys,math,gzip,base64
locations=json.loads(sys.argv[1])
d=sqlite3.connect('file:/srv/data/benchly/data/benchly.sqlite?mode=ro',uri=True);d.row_factory=sqlite3.Row;d.execute('BEGIN')
stream=gzip.GzipFile(fileobj=sys.stdout.buffer,mode='wb',compresslevel=3)
stream.write(b'{'); first_table=True
for table,spatial in [('land_cover_features','land_cover_spatial_index'),('environment_features','environment_spatial_index')]:
 ids=set()
 for lat,lon in locations:
  for radius,kind in ([(28000,None)] if table=='land_cover_features' else [(28000,"f.kind IN ('water','forest')"),(8000,"f.kind='building'")]):
   dy=radius/111320;dx=dy/max(.2,math.cos(math.radians(lat)))
   sql='SELECT f.row_id FROM '+spatial+' s CROSS JOIN '+table+' f ON f.row_id=s.row_id WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?'
   if kind:sql+=' AND '+kind+' AND f.geometry_wkb IS NOT NULL'
   ids.update(r[0] for r in d.execute(sql,(lon-dx,lon+dx,lat-dy,lat+dy)))
 ids=sorted(ids)
 if not first_table:stream.write(b',')
 first_table=False;stream.write(json.dumps(table).encode()+b':['); first_row=True
 for start in range(0,len(ids),500):
  batch=ids[start:start+500]
  for row in d.execute('SELECT * FROM '+table+' WHERE row_id IN ('+','.join('?' for _ in batch)+')',batch):
   item={k:({'base64':base64.b64encode(v).decode()} if isinstance(v,bytes) else v) for k,v in dict(row).items()}
   if not first_row:stream.write(b',')
   first_row=False;stream.write(json.dumps(item,separators=(',',':')).encode())
 stream.write(b']')
for table,query in [('official_context_sources','SELECT * FROM official_context_sources'),('pipeline_runs',"SELECT * FROM pipeline_runs WHERE kind IN ('import-osm','refresh') AND status='completed' ORDER BY id DESC LIMIT 1")]:
 stream.write(b','+json.dumps(table).encode()+b':'+json.dumps([dict(r) for r in d.execute(query)]).encode())
stream.write(b'}');stream.close();d.close()
'''
    partial = destination.with_suffix(".partial.gz")
    with partial.open("wb") as handle:
        subprocess.run(remote_python(code, [(b["latitude"], b["longitude"]) for b in records["benches"]]), stdout=handle, check=True)
    # Validate the gzip footer and JSON before making the snapshot available.
    with gzip.open(partial, "rt") as handle:
        counts = {key: len(value) for key, value in json.load(handle).items()}
    partial.rename(destination)
    print(json.dumps({"context": str(destination), "bytes": destination.stat().st_size, "counts": counts}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "data/panorama-artist-review/cluster")
    parser.add_argument("--context-only", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.context_only:
        context_snapshot(output, json.loads((output / "records.json").read_text()))
        return
    if (output / "records.json").exists():
        parser.error("Preserving an existing snapshot; choose a new --output directory")
    ids = {b["id"] for b in json.loads((ROOT / "config/panorama-artist-review.json").read_text())["benches"]}
    worker = [sys.executable, str(ROOT / "worker/benchly_worker.py")]
    subprocess.run([*worker, "panorama-fetch-index", "--output", str(output / "bench-index.tsv")], check=True, cwd=ROOT)
    lines = [line for line in (output / "bench-index.tsv").read_text().splitlines() if line.split("\t")[2] in ids]
    if len(lines) != 20 or any(len(line.split("\t")[0]) != 64 for line in lines):
        raise ValueError("Current production geometry must be available for every review bench")
    (output / "review-index.tsv").write_text("\n".join(lines) + "\n")
    subprocess.run([*worker, "panorama-repaint-fetch-capsules", "--bench-index", str(output / "review-index.tsv"),
                    "--output", str(output / "verified-index.tsv"), "--capsule-root", str(output / "capsules")], check=True, cwd=ROOT)
    code = '''import sqlite3,json,sys
ids=json.loads(sys.argv[1]);d=sqlite3.connect('file:/srv/data/benchly/data/benchly.sqlite?mode=ro',uri=True);d.row_factory=sqlite3.Row;d.execute('BEGIN')
benches=[dict(r) for r in d.execute('SELECT * FROM benches WHERE id IN ('+','.join('?' for _ in ids)+')',ids)]
for b in benches:b['created_by_user_id']=None
rows=[b['row_id'] for b in benches];tables={}
for t in ['bench_enrichments','bench_geography','bench_panorama_geometry','bench_panorama_renders']:
 tables[t]=[dict(r) for r in d.execute('SELECT * FROM '+t+' WHERE bench_row_id IN ('+','.join('?' for _ in rows)+')',rows)]
print(json.dumps({'benches':benches,**tables}))
'''
    payload = subprocess.check_output(remote_python(code, sorted(ids)))
    records = json.loads(payload)
    if len(records["benches"]) != 20: raise ValueError("Review bench inventory changed")
    (output / "records.json").write_bytes(payload)
    artifacts = []
    for record in records["bench_panorama_renders"]:
        for field in ("artifact_path", "material_path"):
            path = record.get(field)
            if not path: continue
            if not path.startswith("/panorama/") or ".." in path: raise ValueError("Unexpected remote artifact path")
            remote = path.replace("/panorama/", "/srv/data/benchly/panorama/", 1)
            content = subprocess.check_output([*SSH, "cat -- " + shlex.quote(remote)])
            destination = output / "published" / Path(path).name
            destination.parent.mkdir(exist_ok=True)
            destination.write_bytes(content)
            artifacts.append({"row": record["bench_row_id"], "remote": remote, "local": str(destination),
                              "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    (output / "download-manifest.json").write_text(json.dumps({"target": TARGET, "downloadedAt": datetime.now(UTC).isoformat(),
        "recordsSha256": hashlib.sha256(payload).hexdigest(), "artifacts": artifacts}, indent=2) + "\n")
    context_snapshot(output, records)


if __name__ == "__main__":
    main()
