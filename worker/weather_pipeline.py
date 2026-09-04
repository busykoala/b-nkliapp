"""Fetch compact, current MeteoSwiss weather rasters for Benchly."""

from __future__ import annotations

import json
import math
import os
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import numpy as np
from pyproj import Transformer

TARGET_EASTING = 2_480_000.0
TARGET_NORTHING = 1_070_000.0
TARGET_RESOLUTION = 1_000.0
TARGET_WIDTH = 361
TARGET_HEIGHT = 241
ICON_COLLECTION = "ogd-forecasting-icon-ch1"
ICON_PARAMETERS = {
    "CLCT": "P0DT0H", "CLCL": "P0DT0H", "CLCM": "P0DT0H", "CLCH": "P0DT0H",
    "T_2M": "P0DT0H", "SNOWLMT": "P0DT0H", "SNOWC": "P0DT0H", "H_SNOW": "P0DT0H",
    "RAIN_GSP": "P0DT1H", "SNOW_GSP": "P0DT1H",
}
ICON_COLLECTION_STAC = "ch.meteoschweiz.ogd-forecasting-icon-ch1"
ICON_HORIZONTAL_CONSTANTS = "horizontal_constants_icon-ch1-eps.grib2"


def _iso(value: object) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat()
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    text = str(value).replace(" ", "T")
    return text if text.endswith("Z") or "+" in text[10:] else f"{text}Z"


def _ensure_table(connection) -> None:
    connection.execute("""
      CREATE TABLE IF NOT EXISTS weather_snapshots (
        source TEXT NOT NULL, parameter TEXT NOT NULL, reference_at TEXT NOT NULL, valid_at TEXT NOT NULL,
        origin_easting REAL NOT NULL, origin_northing REAL NOT NULL, resolution_meters REAL NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, values_blob BLOB NOT NULL, nodata_value REAL,
        imported_at TEXT NOT NULL, PRIMARY KEY(source, parameter)
      )
    """)
    connection.commit()


def _store(connection, source: str, parameter: str, values: np.ndarray, reference_at: str, valid_at: str) -> None:
    normalized = np.asarray(values, dtype="<f4").reshape(TARGET_HEIGHT, TARGET_WIDTH)
    connection.execute("""
      INSERT INTO weather_snapshots(source,parameter,reference_at,valid_at,origin_easting,origin_northing,
        resolution_meters,width,height,values_blob,nodata_value,imported_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source,parameter) DO UPDATE SET reference_at=excluded.reference_at,valid_at=excluded.valid_at,
        origin_easting=excluded.origin_easting,origin_northing=excluded.origin_northing,
        resolution_meters=excluded.resolution_meters,width=excluded.width,height=excluded.height,
        values_blob=excluded.values_blob,nodata_value=excluded.nodata_value,imported_at=excluded.imported_at
    """, (source, parameter, reference_at, valid_at, TARGET_EASTING, TARGET_NORTHING,
          TARGET_RESOLUTION, TARGET_WIDTH, TARGET_HEIGHT, normalized.tobytes(), math.nan,
          datetime.now(timezone.utc).isoformat()))
    connection.commit()


def _coordinate(data, names: tuple[str, ...]) -> Optional[np.ndarray]:
    for name in names:
        if name in data.coords:
            values = np.asarray(data.coords[name].values, dtype=float).reshape(-1)
            if np.nanmax(np.abs(values)) <= math.pi * 2 + .1:
                values = np.degrees(values)
            return values
    return None


def _icon_to_target(data) -> np.ndarray:
    from scipy.spatial import cKDTree

    if hasattr(data, "data_vars"):
        data = data[next(iter(data.data_vars))]
    data = data.squeeze(drop=True)
    latitudes = _coordinate(data, ("latitude", "lat", "clat", "CLAT"))
    longitudes = _coordinate(data, ("longitude", "lon", "clon", "CLON"))
    if latitudes is None or longitudes is None:
        raise RuntimeError(f"ICON field has no horizontal coordinates: {list(data.coords)}")
    values = np.asarray(data.values, dtype=float).reshape(-1)
    if values.size != latitudes.size or values.size != longitudes.size:
        raise RuntimeError(f"ICON coordinate/value mismatch: {values.size}/{latitudes.size}/{longitudes.size}")
    transformer = Transformer.from_crs(4326, 2056, always_xy=True)
    source_easting, source_northing = transformer.transform(longitudes, latitudes)
    valid = np.isfinite(values) & np.isfinite(source_easting) & np.isfinite(source_northing)
    tree = cKDTree(np.column_stack((source_easting[valid], source_northing[valid])))
    target_easting = TARGET_EASTING + np.arange(TARGET_WIDTH) * TARGET_RESOLUTION
    target_northing = TARGET_NORTHING + np.arange(TARGET_HEIGHT) * TARGET_RESOLUTION
    east, north = np.meshgrid(target_easting, target_northing)
    distances, indices = tree.query(np.column_stack((east.reshape(-1), north.reshape(-1))), workers=-1)
    output = values[valid][indices].astype(float)
    output[distances > 3_000] = np.nan
    return output.reshape(TARGET_HEIGHT, TARGET_WIDTH)


def _points_to_target(values: np.ndarray, latitudes: np.ndarray, longitudes: np.ndarray) -> np.ndarray:
    from scipy.spatial import cKDTree

    values = np.asarray(values, dtype=float).reshape(-1)
    latitudes = np.asarray(latitudes, dtype=float).reshape(-1)
    longitudes = np.asarray(longitudes, dtype=float).reshape(-1)
    if np.nanmax(np.abs(latitudes)) <= math.pi + .1:
        latitudes = np.degrees(latitudes)
    if np.nanmax(np.abs(longitudes)) <= math.pi * 2 + .1:
        longitudes = np.degrees(longitudes)
    transformer = Transformer.from_crs(4326, 2056, always_xy=True)
    source_easting, source_northing = transformer.transform(longitudes, latitudes)
    valid = np.isfinite(values) & np.isfinite(source_easting) & np.isfinite(source_northing)
    tree = cKDTree(np.column_stack((source_easting[valid], source_northing[valid])))
    target_easting = TARGET_EASTING + np.arange(TARGET_WIDTH) * TARGET_RESOLUTION
    target_northing = TARGET_NORTHING + np.arange(TARGET_HEIGHT) * TARGET_RESOLUTION
    east, north = np.meshgrid(target_easting, target_northing)
    distances, indices = tree.query(np.column_stack((east.reshape(-1), north.reshape(-1))), workers=-1)
    output = values[valid][indices].astype(float)
    output[distances > 3_000] = np.nan
    return output.reshape(TARGET_HEIGHT, TARGET_WIDTH)


def _refresh_icon_surface_height(connection) -> str:
    existing = connection.execute(
        "SELECT imported_at FROM weather_snapshots WHERE source='ICON-CH1-STATIC' AND parameter='HSURF'"
    ).fetchone()
    if existing:
        try:
            imported = datetime.fromisoformat(str(existing[0]).replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - imported < timedelta(days=30):
                return "current"
        except ValueError:
            pass

    from eccodes import codes_get, codes_get_array, codes_grib_new_from_file, codes_release
    from meteodatalab import ogd_api

    url = ogd_api.get_collection_asset_url(ICON_COLLECTION_STAC, ICON_HORIZONTAL_CONSTANTS)
    request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (ICON surface height)"})
    with tempfile.TemporaryDirectory(prefix="benchly-icon-surface-") as directory:
        path = Path(directory) / ICON_HORIZONTAL_CONSTANTS
        with urllib.request.urlopen(request, timeout=120) as response, path.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)

        values = latitudes = longitudes = None
        with path.open("rb") as handle:
            while message := codes_grib_new_from_file(handle):
                try:
                    short_name = str(codes_get(message, "shortName")).upper()
                    parameter_name = str(codes_get(message, "parameterName")).upper()
                    if short_name == "HSURF" or "EARTH'S SURFACE" in parameter_name:
                        values = np.asarray(codes_get_array(message, "values"), dtype=float)
                        latitudes = np.asarray(codes_get_array(message, "latitudes"), dtype=float)
                        longitudes = np.asarray(codes_get_array(message, "longitudes"), dtype=float)
                        break
                finally:
                    codes_release(message)
        if values is None or latitudes is None or longitudes is None:
            raise RuntimeError("ICON horizontal constants contain no HSURF field")
        now = datetime.now(timezone.utc).isoformat()
        _store(connection, "ICON-CH1-STATIC", "HSURF", _points_to_target(values, latitudes, longitudes), now, now)
    return "updated"


def refresh_icon(connection) -> dict[str, object]:
    # eccodes-cosmo-resources 0.4 can retain its wheel build-time path. Resolve
    # the installed share directory ourselves; these definitions also preserve
    # the uppercase MeteoSwiss field names expected by meteodata-lab.
    import eccodes
    import eccodes_cosmo_resources
    package = Path(eccodes_cosmo_resources.__file__).resolve()
    cosmo_definitions = package.parents[4] / "share" / "eccodes-cosmo-resources" / "definitions"
    definitions = f"{cosmo_definitions}:{eccodes.codes_definition_path()}" if cosmo_definitions.exists() else eccodes.codes_definition_path()
    os.environ["ECCODES_DEFINITION_PATH"] = definitions
    eccodes.codes_set_definitions_path(definitions)
    from meteodatalab import ogd_api

    updated: list[str] = []
    failed: dict[str, str] = {}
    try:
        surface_height = _refresh_icon_surface_height(connection)
    except Exception as error:
        surface_height = "failed"
        failed["HSURF"] = str(error)[:300]
    for parameter, horizon in ICON_PARAMETERS.items():
        try:
            request = ogd_api.Request(
                collection=ICON_COLLECTION,
                variable=parameter,
                reference_datetime="latest",
                perturbed=False,
                horizon=horizon,
            )
            field = ogd_api.get_from_ogd(request)
            attributes = getattr(field, "attrs", {})
            reference_at = _iso(attributes.get("forecast_reference_time") or attributes.get("reference_time"))
            valid_at = _iso(attributes.get("valid_time") or attributes.get("time"))
            _store(connection, "ICON-CH1", parameter, _icon_to_target(field), reference_at, valid_at)
            updated.append(parameter)
        except Exception as error:  # A partial model publication must not discard the last good fields.
            failed[parameter] = str(error)[:300]
    return {"updated": updated, "surface_height": surface_height, "failed": failed}


def _attribute(group, name: str, default=None):
    value = group.attrs.get(name, default)
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def _latest_radar_asset() -> tuple[str, str]:
    base = "https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-precip/items"
    candidates: list[tuple[str, str]] = []
    today = datetime.now(timezone.utc)
    for delta in (0, -1):
        timestamp = today.timestamp() + delta * 86_400
        item_id = datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y%m%d-ch")
        try:
            with urllib.request.urlopen(f"{base}/{item_id}", timeout=30) as response:
                item = json.load(response)
        except Exception:
            continue
        for name, asset in (item.get("assets") or {}).items():
            if name.lower().startswith("rzc") and str(asset.get("href", "")).endswith(".h5"):
                candidates.append((name, str(asset["href"])))
    if not candidates:
        raise RuntimeError("No current MeteoSwiss PRECIP asset found")
    return max(candidates)


def _radar_to_target(path: Path) -> np.ndarray:
    import h5py

    with h5py.File(path) as handle:
        where = handle["where"]
        data_group = handle["dataset1/data1"]
        raw = np.asarray(data_group["data"], dtype=float)
        what = data_group["what"]
        gain = float(_attribute(what, "gain", 1.0))
        offset = float(_attribute(what, "offset", 0.0))
        nodata = float(_attribute(what, "nodata", 255.0))
        undetect = float(_attribute(what, "undetect", 0.0))
        values = raw * gain + offset
        values[raw == undetect] = 0
        values[raw == nodata] = np.nan
        lower_lon = float(_attribute(where, "LL_lon"))
        lower_lat = float(_attribute(where, "LL_lat"))
        xscale = float(_attribute(where, "xscale"))
        yscale = float(_attribute(where, "yscale"))
    origin_easting, origin_northing = Transformer.from_crs(4326, 2056, always_xy=True).transform(lower_lon, lower_lat)
    values = np.flipud(values)
    target_easting = TARGET_EASTING + np.arange(TARGET_WIDTH) * TARGET_RESOLUTION
    target_northing = TARGET_NORTHING + np.arange(TARGET_HEIGHT) * TARGET_RESOLUTION
    columns = np.rint((target_easting - origin_easting) / xscale).astype(int)
    lines = np.rint((target_northing - origin_northing) / yscale).astype(int)
    output = np.full((TARGET_HEIGHT, TARGET_WIDTH), np.nan, dtype=float)
    valid_columns = (columns >= 0) & (columns < values.shape[1])
    valid_lines = (lines >= 0) & (lines < values.shape[0])
    output[np.ix_(valid_lines, valid_columns)] = values[np.ix_(lines[valid_lines], columns[valid_columns])]
    return output


def refresh_radar(connection) -> dict[str, object]:
    name, url = _latest_radar_asset()
    valid_at = datetime.now(timezone.utc).isoformat()
    existing = connection.execute("SELECT reference_at FROM weather_snapshots WHERE source='PRECIP' AND parameter='RZC'").fetchone()
    if existing and existing[0] == name:
        return {"status": "unchanged", "asset": name}
    with tempfile.TemporaryDirectory(prefix="benchly-radar-") as directory:
        path = Path(directory) / name
        request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (weather raster)"})
        with urllib.request.urlopen(request, timeout=60) as response, path.open("wb") as output:
            output.write(response.read())
        _store(connection, "PRECIP", "RZC", _radar_to_target(path), name, valid_at)
    return {"status": "updated", "asset": name}


def refresh_weather(connection, icon: bool = True, radar: bool = True) -> dict[str, object]:
    _ensure_table(connection)
    result: dict[str, object] = {}
    if radar:
        result["radar"] = refresh_radar(connection)
    if icon:
        result["icon"] = refresh_icon(connection)
    return result
