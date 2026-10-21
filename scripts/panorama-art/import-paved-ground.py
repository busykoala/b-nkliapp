"""Add qualified public SITG paving to a new local review DB; preserve the input."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
import argparse,hashlib,json,sqlite3,sys
from pyproj import Transformer
from shapely.ops import transform
R=Path(__file__).resolve().parents[2];sys.path.insert(0,str(R/'worker'))
from benchly.context.paving import PAVING_DATASET,PAVING_SOURCE,sitg_paved_surfaces

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--database',type=Path,required=True);p.add_argument('--output-database',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();root=a.source.resolve();out=a.output_database.resolve();original=a.database.resolve()
 if out==original or out.exists():p.error('Choose a new output database; input and existing outputs are preserved')
 requests=json.loads((root/'requests.json').read_text());filename=PAVING_DATASET+'-page-0.json';record=next(r for r in requests if r['file']==filename and 'sha256'in r);raw=(root/filename).read_bytes();assert hashlib.sha256(raw).hexdigest()==record['sha256'];url=urlparse(record['url']);assert url.scheme=='https'and url.hostname=='vector.sitg.ge.ch'and url.path==f'/arcgis/rest/services/{PAVING_DATASET}/FeatureServer/0/query'
 metadata=(root/(PAVING_DATASET+'-layer.json')).read_bytes();assert json.loads(metadata)['name']==PAVING_DATASET;surfaces=sitg_paved_surfaces(json.loads(raw));assert surfaces,'No qualified paving surfaces';version=hashlib.sha256(metadata+b'\0'+raw).hexdigest();stamp=datetime.now(timezone.utc).isoformat();project=Transformer.from_crs(2056,4326,always_xy=True).transform
 out.parent.mkdir(parents=True,exist_ok=True)
 with sqlite3.connect(f'file:{original}?mode=ro',uri=True)as source,sqlite3.connect(out)as target:
  source.backup(target)
  assert not target.execute('select 1 from land_cover_features where source=?',(PAVING_SOURCE,)).fetchone(),'Input already contains this source; choose a fresh baseline'
  with target:
   for surface in surfaces:
    bounds=transform(project,surface.geometry).bounds;updated=datetime.fromtimestamp(surface.updated_milliseconds/1000,timezone.utc).isoformat()if surface.updated_milliseconds is not None else None
    cursor=target.execute('INSERT INTO land_cover_features(source,source_id,class,geometry_wkb,geometry_crs,min_latitude,max_latitude,min_longitude,max_longitude,source_version,source_updated_at,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(PAVING_SOURCE,surface.source_id,'paved_ground',surface.geometry.wkb,2056,bounds[1],bounds[3],bounds[0],bounds[2],version,updated,stamp))
    target.execute('INSERT OR REPLACE INTO land_cover_spatial_index(row_id,min_longitude,max_longitude,min_latitude,max_latitude) VALUES(?,?,?,?,?)',(cursor.lastrowid,bounds[0],bounds[2],bounds[1],bounds[3]))
   target.execute('INSERT INTO official_context_sources(source,version,asset_url,asset_checksum,imported_at,stats) VALUES(?,?,?,?,?,?)',(PAVING_SOURCE,version,record['url'],record['sha256'],stamp,json.dumps({'dataset':PAVING_DATASET,'qualifiedSurfaces':len(surfaces),'finishes':sorted({s.finish for s in surfaces})})))
 a.output.mkdir(parents=True,exist_ok=True);proof={'status':'Imported only into a new local review DB; no production/normal review DB write','source':PAVING_SOURCE,'dataset':PAVING_DATASET,'version':version,'sourcePageSha256':record['sha256'],'sourceCatalogue':'https://sitg.ge.ch/donnees/cad-domroutier-revet-niv0','inputDatabase':str(original),'outputDatabase':str(out),'count':len(surfaces),'importedAt':stamp,'surfaces':[dict(id=s.source_id,parentSurfaceId=s.parent_surface_id,finish=s.finish,geometrySha256=hashlib.sha256(s.geometry.wkb).hexdigest(),updatedMilliseconds=s.updated_milliseconds)for s in surfaces],'limits':['Only explicit concrete,bituminous concrete,paving stones and level0 qualify','OTEMOpath/unspecifiedfinish,grass,gravel,soil,water and raised/below-ground surfaces are not imported','No invented widths; original polygons/holes are retained']};(a.output/'paving-import.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:v for k,v in proof.items()if k!='surfaces'}))
if __name__=='__main__':main()
