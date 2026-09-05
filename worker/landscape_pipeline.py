"""Resumable offline path-environment index. Never invoked by a web request.

Only existing local geometries/raster files are read. Missing height coverage is
NULL evidence, not a fabricated flat horizon. Published SQLite snapshots are atomic.
"""
import json
import fcntl
import math
import os
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import tempfile
from functools import lru_cache

from pyproj import Transformer
from shapely import wkb
from shapely.geometry import Point
from shapely.ops import transform

TO_SWISS = Transformer.from_crs(4326, 2056, always_xy=True).transform
TO_WGS = Transformer.from_crs(2056, 4326, always_xy=True).transform


def metric_geometry(row):
    return projected_geometry(row["geometry_wkb"], row["geometry_crs"])


@lru_cache(maxsize=32)
def projected_geometry(blob, crs):
    """Nearby cells repeatedly inspect the same forest/lake polygon."""
    geometry = wkb.loads(blob)
    if crs != 2056:
        geometry = transform(Transformer.from_crs(crs, 2056, always_xy=True).transform, geometry)
    return geometry


def horizon_at(point, terrain, surface=None):
    """Standing pedestrian, 72 rays. Any missing ray means unknown coverage.

    Rasters must be supplied in LV95 metres. Coarse 2km terrain horizon and near
    surface obstruction are separate from the seasonal canopy proxy.
    """
    if terrain is None:
        return None
    def height(dataset, x, y):
        sample = next(dataset.sample([(x, y)], masked=True))[0]
        if getattr(sample, "mask", False) or not math.isfinite(float(sample)):
            raise ValueError("Missing raster coverage")
        return float(sample)
    try:
        eye = height(terrain, point.x, point.y) + 1.6
        horizon = []
        for angle in range(0, 360, 5):
            bearing = math.radians(angle)
            highest = 0.0
            for distance in (25, 50, 100, 200, 400, 800, 1200, 2000):
                x, y = point.x + math.sin(bearing) * distance, point.y + math.cos(bearing) * distance
                z = height(surface if surface and distance <= 200 else terrain, x, y)
                highest = max(highest, math.degrees(math.atan2(z - eye, distance)))
            horizon.append(round(highest, 2))
        # Without a surface model we cannot claim buildings are accounted for.
        return horizon if surface else None
    except (ValueError, IndexError):
        return None


def cell_evidence(connection, latitude, longitude, terrain=None, surface=None):
    point = Point(*TO_SWISS(longitude, latitude))
    rows = connection.execute("""SELECT f.* FROM environment_spatial_index s
        CROSS JOIN environment_features f ON f.row_id=s.row_id
        WHERE s.min_longitude<=? AND s.max_longitude>=? AND s.min_latitude<=? AND s.max_latitude>=?
        AND f.kind IN ('forest','tree','water','major_road') AND f.geometry_wkb IS NOT NULL""",
        (longitude + .003, longitude - .003, latitude + .002, latitude - .002)).fetchall()
    quiet = 1.0
    nature = water = canopy = 0.0
    for row in rows:
        try:
            geometry = metric_geometry(row)
            distance = point.distance(geometry)
        except Exception:
            continue
        if row["kind"] == "major_road":
            tags = json.loads(row["raw_tags"] or "{}")
            raw_speed = str(tags.get("maxspeed", ""))
            speed = float(raw_speed) if raw_speed.isdigit() else None
            influence = 200 if speed and speed >= 80 else 150 if row["subtype"] in ("primary", "trunk", "motorway") else 100
            quiet = min(quiet, min(1, distance / influence))
        elif row["kind"] == "forest" and distance <= 5:
            nature, canopy = 1.0, .85
        elif row["kind"] == "tree" and distance <= 10:
            canopy = max(canopy, .65)
            nature = max(nature, .5)
        elif row["kind"] == "water":
            water = max(water, max(0, 1 - distance / 75))
    # Reuse exact official land cover as well as OSM trees/forest. A park is not
    # necessarily wooded, and should not be turned into shade evidence.
    cover = connection.execute("""SELECT f.* FROM land_cover_spatial_index s
        CROSS JOIN land_cover_features f ON f.row_id=s.row_id WHERE
        s.min_longitude<=? AND s.max_longitude>=? AND s.min_latitude<=? AND s.max_latitude>=?""",
        (longitude, longitude, latitude, latitude)).fetchall()
    for row in cover:
        if any(token in row["class"].lower() for token in ("park", "gruen", "green", "wiese", "meadow", "grass")):
            try:
                if metric_geometry(row).covers(point):
                    nature = max(nature, .8)
            except (ValueError, TypeError):
                continue
    horizon = horizon_at(point, terrain, surface)
    view = sum(max(0, 1 - value / 45) for value in horizon) / 72 if horizon else None
    return (quiet, nature, water, view, canopy, json.dumps(horizon) if horizon else None)


def refresh(args):
    target = Path(args.landscape_database)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Serialize only this artifact, without blocking the app's weather/GTFS jobs.
    with open(str(target) + ".lock", "a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return build_snapshot(args)


def build_snapshot(args):
    target = Path(args.landscape_database)
    target.parent.mkdir(parents=True, exist_ok=True)
    state_path = target.with_suffix(".working.sqlite")
    source = sqlite3.connect(f"file:{Path(args.database).resolve()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    state = sqlite3.connect(state_path)
    state.executescript("""CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS cells(x INTEGER,y INTEGER,latitude REAL,longitude REAL,
          quiet REAL,nature REAL,water REAL,view REAL,canopy REAL,horizon TEXT,updated_at TEXT,PRIMARY KEY(x,y));""")
    terrain = surface = None
    try:
        if args.terrain_raster or args.surface_raster:
            import rasterio
            terrain = rasterio.open(args.terrain_raster) if args.terrain_raster else None
            surface = rasterio.open(args.surface_raster) if args.surface_raster else None
            if any(dataset and dataset.crs.to_epsg() != 2056 for dataset in (terrain, surface)):
                raise ValueError("Landscape rasters must use EPSG:2056")
        bounds = getattr(args, "bounds", None)
        if bounds and not (5.7 <= bounds[0] < bounds[2] <= 10.7 and 45.7 <= bounds[1] < bounds[3] <= 47.9):
            raise ValueError("Invalid Swiss pilot bounds")
        checkpoint_key = "last_path" if not bounds else "last_path:" + json.dumps(bounds)
        checkpoint = state.execute("SELECT value FROM metadata WHERE key=?", (checkpoint_key,)).fetchone()
        last = int(checkpoint[0]) if checkpoint else 0
        if args.limit < 1 or args.limit > 10000:
            raise ValueError("Path batch must be between 1 and 10000")
        condition = " AND max_longitude>=? AND min_longitude<=? AND max_latitude>=? AND min_latitude<=?" if bounds else ""
        parameters = [last] + ([bounds[0], bounds[2], bounds[1], bounds[3]] if bounds else []) + [args.limit]
        paths = source.execute("SELECT * FROM environment_features WHERE kind IN ('path','major_road') AND geometry_wkb IS NOT NULL AND row_id>?" + condition + " ORDER BY row_id LIMIT ?", parameters).fetchall()
        now = datetime.now(timezone.utc).isoformat()
        cells = 0
        visited = set()
        for row in paths:
            try:
                line = metric_geometry(row)
                if line.geom_type not in ("LineString", "MultiLineString"):
                    continue
                lines = list(line.geoms) if line.geom_type == "MultiLineString" else [line]
                for part in lines:
                    for step in range(max(1, math.ceil(part.length / 15)) + 1):
                        p = part.interpolate(min(part.length, step * 15))
                        lon, lat = TO_WGS(p.x, p.y)
                        x, y = round(lon * 4000), round(lat * 4000)
                        # Evaluate neighbouring cells explicitly: route simplification
                        # and grid rounding must not create gaps beside known paths.
                        # These are fresh spatial measurements, not copied evidence.
                        for dx in (-1, 0, 1):
                            for dy in (-1, 0, 1):
                                cx, cy = x + dx, y + dy
                                if (cx, cy) in visited:
                                    continue
                                visited.add((cx, cy))
                                if state.execute("SELECT 1 FROM cells WHERE x=? AND y=? AND updated_at>=?", (cx, cy, now[:10])).fetchone():
                                    continue
                                lat, lon = cy / 4000, cx / 4000
                                evidence = cell_evidence(source, lat, lon, terrain, surface)
                                # Preserve source age rather than claiming fresh observations.
                                updated = row["imported_at"] or now
                                state.execute("INSERT OR REPLACE INTO cells VALUES (?,?,?,?,?,?,?,?,?,?,?)", (cx, cy, lat, lon, *evidence, updated))
                                cells += 1
            except (ValueError, TypeError):
                continue
        state.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)", (checkpoint_key, str(paths[-1]["row_id"] if paths else 0)))
        state.execute("INSERT OR REPLACE INTO metadata VALUES ('updated_at',?)", (now,))
        state.execute("INSERT OR REPLACE INTO metadata VALUES ('version','landscape-v1')")
        state.commit()
        if not state.execute("SELECT count(*) FROM cells").fetchone()[0]:
            raise ValueError("No landscape cells; keeping previous artifact")
        fd, temporary = tempfile.mkstemp(prefix="landscape-", suffix=".sqlite", dir=target.parent)
        os.close(fd)
        try:
            snapshot = sqlite3.connect(temporary)
            try:
                state.backup(snapshot)
                if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Invalid landscape snapshot")
            finally:
                snapshot.close()
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print(json.dumps({"pipeline": "landscape", "paths": len(paths), "cells": cells, "updated_at": now}))
    finally:
        projected_geometry.cache_clear()
        state.close()
        source.close()
        if terrain:
            terrain.close()
        if surface:
            surface.close()
