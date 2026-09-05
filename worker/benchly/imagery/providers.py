"""Provider-specific discovery and mapping for temporary image evidence."""

from __future__ import annotations

import math
import os
import urllib.parse
from collections.abc import Callable
from typing import Optional

from pydantic.dataclasses import dataclass

from benchly.catalog import load_catalog
from benchly.geo import distance_meters

_PROVIDERS = load_catalog().providers


@dataclass(frozen=True)
class DiscoveredImage:
    provider: str
    provider_image_id: str
    capture_group_id: str
    source_url: str
    fetch_url: str
    latitude: float
    longitude: float
    heading: Optional[float] = None
    captured_at: Optional[str] = None
    author: Optional[str] = None
    license: Optional[str] = None


class ProviderDelay(RuntimeError):
    def __init__(self, message: str, seconds: int = 3600):
        super().__init__(message)
        self.seconds = seconds


def optional_float(value: object) -> Optional[float]:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def search_panoramax(bounds: tuple[float, float, float, float], request_json: Callable[..., object]) -> list[DiscoveredImage]:
    endpoint = os.environ.get("PANORAMAX_API", str(_PROVIDERS.panoramaxSearchUrl))
    url = endpoint + "?" + urllib.parse.urlencode({"bbox": ",".join(map(str, bounds)), "limit": "100"})
    payload = request_json(url)
    features = payload.get("features", []) if isinstance(payload, dict) else []
    results: list[DiscoveredImage] = []
    for feature in features:
        properties = feature.get("properties", {})
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        image_id = str(properties.get("id") or feature.get("id") or "")
        if not image_id or len(coordinates) < 2:
            continue
        assets = properties.get("assets") or feature.get("assets") or {}
        fetch_url = next((asset.get("href") for key in ("sd", "thumb", "hd", "original") if isinstance((asset := assets.get(key)), dict) and asset.get("href")), None)
        if not fetch_url:
            fetch_url = f"{endpoint.rsplit('/api/', 1)[0]}/api/pictures/{urllib.parse.quote(image_id)}/sd.jpg"
        sequence = properties.get("sequence") or properties.get("sequence_id") or feature.get("collection") or image_id
        results.append(DiscoveredImage(
            provider="Panoramax", provider_image_id=image_id,
            capture_group_id=f"panoramax:{sequence}",
            source_url=str(properties.get("view_url") or f"{str(_PROVIDERS.panoramaxViewerUrl)}#focus=pic&pic={urllib.parse.quote(image_id)}"),
            fetch_url=str(fetch_url), latitude=float(coordinates[1]), longitude=float(coordinates[0]),
            heading=optional_float(properties.get("heading") or properties.get("compass_angle") or properties.get("view:azimuth")),
            captured_at=properties.get("datetime"), author=properties.get("author") or properties.get("geovisio:producer"),
            license=properties.get("license") or "CC-BY-SA-4.0",
        ))
    return results


def search_commons(bounds: tuple[float, float, float, float], request_json: Callable[..., object]) -> list[DiscoveredImage]:
    west, south, east, north = bounds
    latitude, longitude = (south + north) / 2, (west + east) / 2
    radius = min(10_000, max(300, int(distance_meters(south, west, north, east) / 2)))
    parameters = {
        "action": "query", "format": "json", "generator": "geosearch", "ggsnamespace": "6",
        "ggscoord": f"{latitude}|{longitude}", "ggsradius": str(radius), "ggslimit": "100",
        "prop": "coordinates|imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": "1280",
    }
    payload = request_json(f"{str(_PROVIDERS.commonsApiUrl)}?{urllib.parse.urlencode(parameters)}")
    pages = payload.get("query", {}).get("pages", {}).values() if isinstance(payload, dict) else []
    results: list[DiscoveredImage] = []
    for page in pages:
        coordinates = (page.get("coordinates") or [{}])[0]
        info = (page.get("imageinfo") or [{}])[0]
        latitude_value, longitude_value = optional_float(coordinates.get("lat")), optional_float(coordinates.get("lon"))
        image_id = str(page.get("pageid") or "")
        fetch_url = info.get("thumburl") or info.get("url")
        if latitude_value is None or longitude_value is None or not image_id or not fetch_url:
            continue
        metadata = info.get("extmetadata") or {}
        metadata_value = lambda key: (metadata.get(key) or {}).get("value")
        captured_at = metadata_value("DateTimeOriginal") or metadata_value("DateTime")
        group_day = str(captured_at or "unknown")[:10]
        group_location = f"{round(latitude_value, 4)}:{round(longitude_value, 4)}"
        results.append(DiscoveredImage(
            provider="Wikimedia Commons", provider_image_id=image_id,
            capture_group_id=f"commons:{group_location}:{group_day}",
            source_url=str(info.get("descriptionurl") or f"https://commons.wikimedia.org/?curid={image_id}"),
            fetch_url=str(fetch_url), latitude=latitude_value, longitude=longitude_value,
            captured_at=str(captured_at) if captured_at else None,
            author=metadata_value("Artist"), license=metadata_value("LicenseShortName"),
        ))
    return results


def search_kartaview(bounds: tuple[float, float, float, float], request_json: Callable[..., object]) -> list[DiscoveredImage]:
    west, south, east, north = bounds
    latitude, longitude = (south + north) / 2, (west + east) / 2
    radius = min(1000, max(300, int(distance_meters(south, west, north, east) / 2)))
    endpoint = os.environ.get("KARTAVIEW_API", str(_PROVIDERS.kartaViewNearbyUrl))
    form = urllib.parse.urlencode({"lat": latitude, "lng": longitude, "radius": radius}).encode()
    payload = request_json(endpoint, data=form, headers={"Content-Type": "application/x-www-form-urlencoded"})
    data = payload.get("currentPageItems", []) if isinstance(payload, dict) else []
    results: list[DiscoveredImage] = []
    for photo in data if isinstance(data, list) else []:
        image_id = str(photo.get("id") or "")
        photo_latitude, photo_longitude = optional_float(photo.get("lat")), optional_float(photo.get("lng") or photo.get("lon"))
        image_path = str(photo.get("lth_name") or photo.get("th_name") or photo.get("name") or "").lstrip("/")
        storage, _, remainder = image_path.partition("/")
        fetch_url = f"https://{storage}.openstreetcam.org/{remainder}" if storage and remainder else None
        if not image_id or photo_latitude is None or photo_longitude is None or not fetch_url:
            continue
        sequence = photo.get("sequence_id") or image_id
        results.append(DiscoveredImage(
            provider="KartaView", provider_image_id=image_id, capture_group_id=f"kartaview:{sequence}",
            source_url=f"{str(_PROVIDERS.kartaViewViewerUrl)}details/{sequence}/{photo.get('sequence_index', 0)}/track-info",
            fetch_url=str(fetch_url), latitude=photo_latitude, longitude=photo_longitude,
            heading=optional_float(photo.get("heading") or photo.get("headers")), captured_at=photo.get("shot_date") or photo.get("date_added"),
            author=photo.get("username"), license="CC-BY-SA-4.0",
        ))
    return results


def swissimage_at(latitude: float, longitude: float) -> DiscoveredImage:
    crop = .0018
    parameters = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0",
        "LAYERS": _PROVIDERS.swissImageLayer, "CRS": "EPSG:4326",
        "BBOX": f"{latitude - crop},{longitude - crop},{latitude + crop},{longitude + crop}",
        "WIDTH": "1280", "HEIGHT": "1280", "FORMAT": "image/jpeg", "STYLES": "",
    }
    cell = f"{round(latitude, 4)}:{round(longitude, 4)}"
    return DiscoveredImage(
        provider="SWISSIMAGE", provider_image_id=f"swissimage:{cell}", capture_group_id=f"swissimage:{cell}",
        source_url=f"{str(_PROVIDERS.swissImageMapUrl)}#/map?lang=de&center={longitude},{latitude}&z=10&bgLayer={_PROVIDERS.swissImageLayer}",
        fetch_url=f"{str(_PROVIDERS.swissImageWmsUrl)}?{urllib.parse.urlencode(parameters)}", latitude=latitude, longitude=longitude,
        license="swisstopo OGD",
    )


def search_swissimage(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    west, south, east, north = bounds
    return [swissimage_at((south + north) / 2, (west + east) / 2)]
