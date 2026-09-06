from __future__ import annotations

import hashlib
import urllib.error
import urllib.request
from pathlib import Path

from benchly.catalog import DataSource, load_catalog
from benchly.db import open_database
from benchly.runtime import now_iso
from benchly.sources.models import SourceProbe
from benchly.sources.repository import prepare_source_status, save_probe


def _probe(source: DataSource, timeout_seconds: float) -> SourceProbe:
    url = str(source.checkUrl or source.url)
    if not url.startswith("https://"):
        raise ValueError(f"Source {source.id} has no HTTPS check URL")
    request = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "BenchlySourceCheck/1.0 (+https://benchly.ch/danke)"},
    )
    try:
        response = urllib.request.urlopen(request, timeout=timeout_seconds)
    except urllib.error.HTTPError as error:
        if error.code not in {403, 405}:
            raise
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "BenchlySourceCheck/1.0 (+https://benchly.ch/danke)",
                "Range": "bytes=0-0",
            },
        )
        response = urllib.request.urlopen(request, timeout=timeout_seconds)
    with response:
        headers = response.headers
        content_length = headers.get("Content-Length")
        signature = "\n".join(
            filter(
                None,
                [
                    source.id,
                    response.geturl(),
                    headers.get("ETag"),
                    headers.get("Last-Modified"),
                    content_length,
                ],
            )
        )
        return SourceProbe(
            source_id=source.id,
            url=response.geturl(),
            checked_at=now_iso(),
            status_code=response.status,
            etag=headers.get("ETag"),
            last_modified=headers.get("Last-Modified"),
            content_length=int(content_length) if content_length and content_length.isdigit() else None,
            fingerprint=hashlib.sha256(signature.encode()).hexdigest(),
        )


def check_source_versions(database_path: Path, source_ids: list[str], timeout_seconds: float = 20) -> dict[str, object]:
    catalog = load_catalog()
    sources = {source.id: source for source in catalog.sources}
    unknown = sorted(set(source_ids) - sources.keys())
    if unknown:
        raise ValueError(f"Unknown catalog sources: {', '.join(unknown)}")

    checked: list[dict[str, object]] = []
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with open_database(database_path) as database:
        prepare_source_status(database)
        for source_id in source_ids:
            probe = _probe(sources[source_id], timeout_seconds)
            save_probe(database, probe)
            checked.append({
                "source_id": probe.source_id,
                "status_code": probe.status_code,
                "fingerprint": probe.fingerprint,
            })
    return {"checked": checked, "count": len(checked)}


def run_check_source_versions(args) -> None:
    import json

    result = check_source_versions(Path(args.database).resolve(), args.sources, args.timeout_seconds)
    print(json.dumps(result, indent=2))

