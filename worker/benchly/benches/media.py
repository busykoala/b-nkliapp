"""Fetch reusable nearby Wikimedia Commons media for benches."""

from __future__ import annotations

import json
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from typing import Optional

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
                pages = json.load(response).get("query", {}).get("pages", {})
            for page in pages.values():
                info = (page.get("imageinfo") or [{}])[0]
                metadata = info.get("extmetadata", {})
                coordinates = (page.get("coordinates") or [{}])[0]
                photo_latitude, photo_longitude = coordinates.get("lat"), coordinates.get("lon")
                photo_distance = distance_meters(bench["latitude"], bench["longitude"], photo_latitude, photo_longitude) if photo_latitude is not None and photo_longitude is not None else None
                add_media(connection, [{
                    "bench_row_id": bench["row_id"],
                    "relation": "nearby",
                    "provider": "Wikimedia Commons",
                    "external_id": str(page.get("pageid")),
                    "source_url": info.get("descriptionurl", "https://commons.wikimedia.org"),
                    "thumbnail_url": info.get("thumburl") or info.get("url"),
                    "author": strip_html(metadata.get("Artist", {}).get("value")),
                    "license": metadata.get("LicenseShortName", {}).get("value"),
                    "latitude": photo_latitude,
                    "longitude": photo_longitude,
                    "distance_meters": photo_distance,
                    "title": page.get("title", "").removeprefix("File:"),
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
