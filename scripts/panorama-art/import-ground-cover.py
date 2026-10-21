"""Import verified Bern BBF cover into a NEW local review database only."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import argparse
import hashlib
import json
import sqlite3
import sys

from pyproj import Transformer
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'worker'))
from benchly.context.ground_cover import MOPUBE_SOURCE, mopube_ground_surfaces


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--output-database', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source, original, output = args.source.resolve(), args.database.resolve(), args.output_database.resolve()
    if original == output or output.exists():
        parser.error('Choose a new output database; preserve the input and existing outputs')
    proof = json.loads((source/'extraction.json').read_text())
    if (proof['layer'] != 'MOPUBE_BBF' or proof['crs'] != 2056 or
            proof['source'] != 'https://geofiles.be.ch/geoportal/pub/download/MOPUBE/mopube_bbf.parquet'):
        raise ValueError('Expected the existing Bern BBF ground-cover layer in LV95')
    raw_path, selected = source/'mopube_bbf.parquet', source/'selected-records.json'
    if sha256(raw_path) != proof['sourceSha256'] or sha256(selected) != proof['selectedRecordsSha256']:
        raise ValueError('Ground-cover source checksum mismatch')
    surfaces = mopube_ground_surfaces(json.loads(selected.read_text()))
    if not surfaces:
        raise ValueError('No qualified cover in source extract')
    version = hashlib.sha256((proof['sourceSha256']+'\0'+proof['selectedRecordsSha256']).encode()).hexdigest()
    stamp = datetime.now(timezone.utc).isoformat()
    project = Transformer.from_crs(2056, 4326, always_xy=True).transform
    input_hash = sha256(original)
    output.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f'file:{original}?mode=ro', uri=True) as baseline, sqlite3.connect(output) as target:
        baseline.backup(target)
        if target.execute('SELECT 1 FROM official_context_sources WHERE source=?', (MOPUBE_SOURCE,)).fetchone():
            raise ValueError('Input already contains this source; choose a fresh baseline')
        with target:
            for surface in surfaces:
                x0,y0,x1,y1 = transform(project,surface.geometry).bounds
                cursor = target.execute('INSERT INTO land_cover_features(source,source_id,class,geometry_wkb,geometry_crs,min_latitude,max_latitude,min_longitude,max_longitude,source_version,source_updated_at,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                    (MOPUBE_SOURCE,surface.source_id,surface.semantic,surface.geometry.wkb,2056,y0,y1,x0,x1,version,surface.updated_at,stamp))
                # Normal review snapshots maintain the RTree by trigger;
                # replace the same row explicitly for older snapshots too.
                target.execute('INSERT OR REPLACE INTO land_cover_spatial_index(row_id,min_longitude,max_longitude,min_latitude,max_latitude) VALUES(?,?,?,?,?)',
                    (cursor.lastrowid,x0,x1,y0,y1))
            target.execute('INSERT INTO official_context_sources(source,version,asset_url,asset_checksum,imported_at,stats) VALUES(?,?,?,?,?,?)',
                (MOPUBE_SOURCE,version,proof['source'],proof['sourceSha256'],stamp,json.dumps(dict(layer=proof['layer'],count=len(surfaces),classes=dict(Counter(s.semantic for s in surfaces))))))
    assert sha256(original) == input_hash, 'Input database changed'
    result = dict(status='imported into new local review database',source=MOPUBE_SOURCE,version=version,
        inputDatabase=str(original),inputDatabaseSha256=input_hash,outputDatabase=str(output),
        outputDatabaseSha256=sha256(output),sourceSha256=proof['sourceSha256'],
        selectedRecordsSha256=proof['selectedRecordsSha256'],count=len(surfaces),
        classes=dict(Counter(s.semantic for s in surfaces)),attribution=proof['attribution'],
        boundsLV95=proof['boundsLV95'],importedAt=stamp,
        surfaces=[dict(id=s.source_id,sourceClass=s.source_label,classCode=s.class_code,
            semantic=s.semantic,geometrySha256=hashlib.sha256(s.geometry.wkb).hexdigest(),
            updatedAt=s.updated_at) for s in surfaces],
        limits=['Road/path/other hard ground finish remains unknown; no paving claim',
                'Only quality AV93 BBF cover, exact polygons and holes; no projected cover',
                'Existing terrain elevation hosts the two-dimensional survey; no bridge-height claim',
                'Gardens, islands, vegetation, buildings and water are not reclassified',
                'Original download and cluster/review databases are preserved; no production write'])
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'ground-cover-import.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='surfaces'},ensure_ascii=False))


if __name__ == '__main__':
    main()
