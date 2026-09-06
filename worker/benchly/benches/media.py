"""Fetch reusable nearby Wikimedia Commons media for benches."""

from __future__ import annotations

import json
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from typing import Optional

from pydantic import ValidationError

from benchly.benches.media_contracts import CommonsPage, CommonsResponse
from benchly.benches.repository import add_media, remove_nearby_media
from benchly.catalog import load_catalog
from benchly.geo import distance_meters
from benchly.runtime import now_iso

COMMONS_API_URL = str(load_catalog().providers.commonsApiUrl)

def commons_metadata(connection: sqlite3.Connection, limit: int) -> int:
    benches = connection.execute("""
        SELECT b.row_id,b.latitude,b.longitude FROM benches b
        WHERE b.active=1 AND NOT EXISTS(
          SELECT 1 FROM media m WHERE m.bench_row_id=b.row_id AND m.provider='Wikimedia Commons'
            AND m.relation='nearby' AND datetime(m.fetched_at) >= datetime('now','-30 days')
        )
        ORDER BY b.row_id LIMIT ?
    """, (limit,)).fetchall()
    inserted = 0
    for index, bench in enumerate(benches):
        remove_nearby_media(connection, bench["row_id"], "Wikimedia Commons")
        parameters = {
            "action": "query", "format": "json", "generator": "geosearch", "ggsprimary": "all",
            "ggsnamespace": "6", "ggsradius": "300", "ggslimit": "6",
            "ggscoord": f"{bench['latitude']}|{bench['longitude']}", "prop": "coordinates|imageinfo",
            "iiprop": "url|extmetadata", "iiurlwidth": "640",
        }
        url = f"{COMMONS_API_URL}?{urllib.parse.urlencode(parameters)}"
        request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (nearby-photo metadata)"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                pages = CommonsResponse.model_validate(json.load(response)).query.pages
            for raw_page in pages.values():
                try:
                    page = CommonsPage.model_validate(raw_page)
                except ValidationError:
                    continue
                info = page.imageinfo[0] if page.imageinfo else None
                if info is None or (info.thumburl is None and info.url is None):
                    continue
                metadata = info.extmetadata
                coordinates = page.coordinates[0] if page.coordinates else None
                photo_latitude = coordinates.lat if coordinates else None
                photo_longitude = coordinates.lon if coordinates else None
                photo_distance = distance_meters(bench["latitude"], bench["longitude"], photo_latitude, photo_longitude) if photo_latitude is not None and photo_longitude is not None else None
                add_media(connection, [{
                    "bench_row_id": bench["row_id"],
                    "relation": "nearby",
                    "provider": "Wikimedia Commons",
                    "external_id": str(page.pageid),
                    "source_url": str(info.descriptionurl or "https://commons.wikimedia.org"),
                    "thumbnail_url": str(info.thumburl or info.url),
                    "author": strip_html(metadata.get("Artist").value if metadata.get("Artist") else None),
                    "license": metadata.get("LicenseShortName").value if metadata.get("LicenseShortName") else None,
                    "latitude": photo_latitude,
                    "longitude": photo_longitude,
                    "distance_meters": photo_distance,
                    "title": page.title.removeprefix("File:"),
                    "fetched_at": now_iso(),
                }])
                inserted += 1
            connection.commit()
        except Exception as error:
            print(f"Commons lookup failed for bench {bench['row_id']}: {error}", file=sys.stderr)
        if index and index % 10 == 0:
            time.sleep(1)
    return inserted


def strip_html(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    output, inside = [], False
    for character in value:
        if character == "<": inside = True
        elif character == ">": inside = False
        elif not inside: output.append(character)
    return "".join(output).strip()[:200]
