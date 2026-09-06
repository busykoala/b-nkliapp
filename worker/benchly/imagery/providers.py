"""Provider-specific discovery and mapping for temporary image evidence."""

from __future__ import annotations

import math
import os
import urllib.parse
from collections.abc import Callable
from typing import Optional

from pydantic.dataclasses import dataclass
from pydantic import ValidationError

from benchly.catalog import load_catalog
from benchly.geo import distance_meters
from benchly.benches.media_contracts import CommonsPage, CommonsResponse
from benchly.imagery.contracts import (
    KartaViewPhoto,
    KartaViewResponse,
    PanoramaxFeature,
    PanoramaxResponse,
)

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
    features = PanoramaxResponse.model_validate(request_json(url)).features
    results: list[DiscoveredImage] = []
    for raw_feature in features:
        try:
            feature = PanoramaxFeature.model_validate(raw_feature)
        except ValidationError:
            continue
        properties = feature.properties
        coordinates = feature.geometry.coordinates
        image_id = str(properties.id or feature.id or "")
        if not image_id or len(coordinates) < 2:
            continue
        assets = properties.assets or feature.assets
        fetch_url = next((str(asset.href) for key in ("sd", "thumb", "hd", "original") if (asset := assets.get(key))), None)
        if not fetch_url:
            fetch_url = f"{endpoint.rsplit('/api/', 1)[0]}/api/pictures/{urllib.parse.quote(image_id)}/sd.jpg"
        sequence = properties.sequence or properties.sequence_id or feature.collection or image_id
        results.append(DiscoveredImage(
            provider="Panoramax", provider_image_id=image_id,
            capture_group_id=f"panoramax:{sequence}",
            source_url=str(properties.view_url or f"{str(_PROVIDERS.panoramaxViewerUrl)}#focus=pic&pic={urllib.parse.quote(image_id)}"),
            fetch_url=str(fetch_url), latitude=float(coordinates[1]), longitude=float(coordinates[0]),
            heading=optional_float(properties.heading or properties.compass_angle or properties.view_azimuth),
            captured_at=properties.datetime, author=properties.author or properties.producer,
            license=properties.license or "CC-BY-SA-4.0",
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
    pages = CommonsResponse.model_validate(
        request_json(f"{str(_PROVIDERS.commonsApiUrl)}?{urllib.parse.urlencode(parameters)}")
    ).query.pages.values()
    results: list[DiscoveredImage] = []
    for raw_page in pages:
        try:
            page = CommonsPage.model_validate(raw_page)
        except ValidationError:
            continue
        coordinates = page.coordinates[0] if page.coordinates else None
        info = page.imageinfo[0] if page.imageinfo else None
        latitude_value = optional_float(coordinates.lat) if coordinates else None
        longitude_value = optional_float(coordinates.lon) if coordinates else None
        image_id = str(page.pageid)
        fetch_url = str(info.thumburl or info.url) if info and (info.thumburl or info.url) else None
        if latitude_value is None or longitude_value is None or not image_id or not fetch_url:
            continue
        metadata = info.extmetadata if info else {}
        metadata_value = lambda key: metadata.get(key).value if metadata.get(key) else None
        captured_at = metadata_value("DateTimeOriginal") or metadata_value("DateTime")
        group_day = str(captured_at or "unknown")[:10]
        group_location = f"{round(latitude_value, 4)}:{round(longitude_value, 4)}"
        results.append(DiscoveredImage(
            provider="Wikimedia Commons", provider_image_id=image_id,
            capture_group_id=f"commons:{group_location}:{group_day}",
            source_url=str(info.descriptionurl or f"https://commons.wikimedia.org/?curid={image_id}"),
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
    data = KartaViewResponse.model_validate(
        request_json(endpoint, data=form, headers={"Content-Type": "application/x-www-form-urlencoded"})
    ).currentPageItems
    results: list[DiscoveredImage] = []
    for raw_photo in data:
        try:
            photo = KartaViewPhoto.model_validate(raw_photo)
        except ValidationError:
            continue
        image_id = str(photo.id)
        photo_latitude, photo_longitude = optional_float(photo.lat), optional_float(photo.lng or photo.lon)
        image_path = str(photo.lth_name or photo.th_name or photo.name or "").lstrip("/")
        storage, _, remainder = image_path.partition("/")
        fetch_url = f"https://{storage}.openstreetcam.org/{remainder}" if storage and remainder else None
        if not image_id or photo_latitude is None or photo_longitude is None or not fetch_url:
            continue
        sequence = photo.sequence_id or image_id
        results.append(DiscoveredImage(
            provider="KartaView", provider_image_id=image_id, capture_group_id=f"kartaview:{sequence}",
            source_url=f"{str(_PROVIDERS.kartaViewViewerUrl)}details/{sequence}/{photo.sequence_index}/track-info",
            fetch_url=str(fetch_url), latitude=photo_latitude, longitude=photo_longitude,
            heading=optional_float(photo.heading or photo.headers), captured_at=photo.shot_date or photo.date_added,
            author=photo.username, license="CC-BY-SA-4.0",
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
