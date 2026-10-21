"""Import official building references into the isolated review DB.

Uses the worker's existing STAC discovery/importer. On Macs without ogr2ogr,
the equivalent GDAL VectorTranslate utility API is supplied by pyogrio's
bundled GDAL library (`uv sync --group art`). No system package, Docker image,
service or production connection is required. All source archives remain cached.
"""
from __future__ import annotations

import argparse
import ctypes as C
import hashlib
import json
from pathlib import Path
import sys
import uuid

import pyogrio

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "worker"))


class VectorReader:
    def __init__(self):
        package = Path(pyogrio.__file__).parent
        libraries = [*package.joinpath(".dylibs").glob("libgdal*.dylib"),
                     *package.parent.joinpath("pyogrio.libs").glob("libgdal*.so*")]
        if len(libraries) != 1:
            raise RuntimeError("Expected one GDAL library bundled with pyogrio")
        self.library = C.CDLL(str(libraries[0]))
        def api(name, result, *args):
            function = getattr(self.library, name)
            function.restype, function.argtypes = result, list(args)
            return function
        pointer, string, integer = C.c_void_p, C.c_char_p, C.c_int
        self.register = api("GDALAllRegister", None)
        self.open = api("GDALOpenEx", pointer, string, C.c_uint, pointer, pointer, pointer)
        self.close = api("GDALClose", None, pointer)
        self.count = api("GDALDatasetGetLayerCount", integer, pointer)
        self.layer = api("GDALDatasetGetLayer", pointer, pointer, integer)
        self.name = api("OGR_L_GetName", string, pointer)
        self.driver = api("GDALGetDriverByName", pointer, string)
        self.options = api("GDALVectorTranslateOptionsNew", pointer, C.POINTER(string), pointer)
        self.free_options = api("GDALVectorTranslateOptionsFree", None, pointer)
        self.translate = api("GDALVectorTranslate", pointer, string, pointer, integer, C.POINTER(pointer), pointer, C.POINTER(integer))
        self.memory = api("VSIGetMemFileBuffer", pointer, string, C.POINTER(C.c_ulonglong), integer)
        self.unlink = api("VSIUnlink", integer, string)
        self.last_error = api("CPLGetLastErrorMsg", string)
        self.register()
        if not self.driver(b"OpenFileGDB"):
            raise RuntimeError("The installed GDAL lacks the OpenFileGDB reader")

    def source(self, path):
        source = self.open(str(path).encode(), 4, None, None, None)  # GDAL_OF_VECTOR, read-only
        if not source:
            raise RuntimeError(self.last_error().decode())
        return source

    def layers(self, path):
        source = self.source(path)
        try:
            return [self.name(self.layer(source, index)).decode() for index in range(self.count(source))]
        finally:
            self.close(source)

    def features(self, path, layer, geometry_type=None):
        destination = f"/vsimem/benchly-review-{uuid.uuid4().hex}.geojsonseq".encode()
        arguments = ["-f", "GeoJSONSeq", "-t_srs", "EPSG:4326", "-mapFieldType", "DateTime=String"]
        if geometry_type:
            arguments += ["-nlt", geometry_type]
        arguments += [layer]
        argv = (C.c_char_p * (len(arguments) + 1))(*(argument.encode() for argument in arguments), None)
        source = self.source(path)
        options = self.options(argv, None)
        if not options:
            self.close(source)
            raise RuntimeError(self.last_error().decode())
        try:
            inputs = (C.c_void_p * 1)(source)
            error = C.c_int()
            output = self.translate(destination, None, 1, inputs, options, C.byref(error))
            if not output or error.value:
                raise RuntimeError(self.last_error().decode())
            self.close(output)
            length = C.c_ulonglong()
            pointer = self.memory(destination, C.byref(length), 0)
            if not pointer:
                raise RuntimeError("GDAL did not produce a feature stream")
            payload = C.string_at(pointer, length.value)
        finally:
            self.free_options(options)
            self.close(source)
            self.unlink(destination)
        for line in payload.splitlines():
            line = line.lstrip(b"\x1e \t")
            if line:
                yield json.loads(line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-cells", type=int, default=20)
    parser.add_argument("--check", action="store_true", help="Only verify the native GDAL capabilities")
    parser.add_argument("--reimport-cached", action="store_true", help="Re-read existing downloaded assets with the current importer; no network")
    parser.add_argument("--resume-after", help="Adopt assets through this ID from a verified completed import prefix")
    args = parser.parse_args()
    reader = VectorReader()
    if args.check:
        print(json.dumps({"gdal": pyogrio.__gdal_version_string__, "OpenFileGDB": True, "VectorTranslate": True}))
        return
    from benchly.context import importer
    from benchly.cli import main as worker_main
    importer.geopackage_layers = reader.layers
    importer.iter_layer_features = reader.features
    if args.reimport_cached:
        import sqlite3
        from benchly.runtime import now_iso
        database = sqlite3.connect(ROOT / "data/panorama-artist-review/review.sqlite")
        database.row_factory = sqlite3.Row
        assets = database.execute("SELECT * FROM building_source_assets ORDER BY asset_id").fetchall()
        progress_path = ROOT / "data/panorama-artist-review/building-references/cached-reimport-progress.json"
        signature = hashlib.sha256((ROOT / "worker/benchly/context/importer.py").read_bytes() +
                                   (ROOT / "worker/benchly/context/geometry.py").read_bytes()).hexdigest()
        progress = json.loads(progress_path.read_text()) if progress_path.exists() else {"signature": signature, "completed": {}}
        if progress["signature"] != signature:
            progress = {"signature": signature, "completed": {}}
        if args.resume_after:
            if not any(asset["asset_id"] == args.resume_after for asset in assets):
                raise ValueError("Resume prefix is not a downloaded source asset")
            progress["completed"].update({asset["asset_id"]: asset["source_version"] for asset in assets if asset["asset_id"] <= args.resume_after})
        total = 0
        for asset in assets:
            if progress["completed"].get(asset["asset_id"]) == asset["source_version"]:
                continue
            directory = ROOT / "data/panorama-artist-review/building-references" / hashlib.sha256(asset["asset_id"].encode()).hexdigest()[:16]
            sources = sorted((directory / "extracted").glob("*.gdb"))
            if not sources:
                raise RuntimeError(f"Missing cached source for {asset['asset_id']}")
            for source in sources:
                stats = importer.import_swissbuildings_gdb(database, source, asset["source_version"], now_iso(), source_prefix=asset["asset_id"])
                total += stats["building"]
            progress["completed"][asset["asset_id"]] = asset["source_version"]
            temporary = progress_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(progress, indent=2) + "\n")
            temporary.replace(progress_path)
            print(json.dumps({"asset": asset["asset_id"], "totalBuildings": total}), flush=True)
        database.close()
        print(json.dumps({"assets": len(assets), "building": total, "network": False}))
        return
    status = worker_main(["import-swissbuildings3d", "--database", str(ROOT / "data/panorama-artist-review/review.sqlite"),
        "--work-dir", str(ROOT / "data/panorama-artist-review/building-references"), "--max-cells", str(args.max_cells)])
    if status:
        raise SystemExit(status)


if __name__ == "__main__":
    main()
