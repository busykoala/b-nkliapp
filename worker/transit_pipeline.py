"""Small, independently implemented Swiss stop/transfer index; no journey histories."""
import csv
import datetime as dt
import io
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import urllib.parse
import urllib.request
import urllib.error
import zipfile

GTFS_DOWNLOAD_HOSTS = frozenset({
    "data.opentransportdata.swiss",
    # The official catalogue redirects ZIPs through Datopian to this R2 account.
    "proxy-server-omd.datopian.com",
    "83025b28472d6aa2bf5ae59f3724aa78.eu.r2.cloudflarestorage.com",
})


def validate_download_url(url, redirect=False):
    parsed = urllib.parse.urlparse(url)
    hosts = GTFS_DOWNLOAD_HOSTS if redirect else {"data.opentransportdata.swiss"}
    if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Unexpected GTFS download host or protocol")


class GTFSRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Check each hop BEFORE contacting it, including signed object-store URLs.
        validate_download_url(newurl, redirect=True)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def public_catalogue(folder):
    """The public CKAN HTML remains available where /api/ access is restricted."""
    base = "https://data.opentransportdata.swiss"
    page = Path(folder) / "datasets.html"
    download(base + "/dataset/?q=gtfs2020", page, 4_000_000)
    parser = Links()
    parser.feed(page.read_text())
    names = sorted({match.group(1) for href in parser.links if (match := re.search(r"/dataset/(timetable-\d{4}-gtfs2020)(?:$|[/?#])", href))}, reverse=True)
    packages = []
    for name in names[:6]:
        download(base + "/dataset/" + name, page, 4_000_000)
        parser = Links()
        parser.feed(page.read_text())
        urls = {urllib.parse.urljoin(base, href) for href in parser.links if urllib.parse.urlparse(href).path.lower().endswith(".zip")}
        packages.append({"name": name, "metadata_modified": name, "resources": [{"url": url, "created": Path(urllib.parse.urlparse(url).path).name} for url in urls]})
    return packages


def download(url, target, limit=300_000_000):
    validate_download_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "Benchly-transit/1.0"})
    with urllib.request.build_opener(GTFSRedirectHandler).open(request, timeout=60) as response, open(target, "wb") as output:
        validate_download_url(response.url, redirect=True)
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise ValueError("GTFS download exceeds size budget")
            output.write(chunk)


def rows(archive, name):
    member = archive.getinfo(name)
    if member.file_size > 250_000_000:
        raise ValueError("GTFS member exceeds size budget")
    with archive.open(member) as source:
        yield from csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig", newline=""))


def import_archive(archive_path, destination, today=None):
    today = today or dt.date.today()
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Build on the same filesystem so a verified index can be published atomically.
    with tempfile.TemporaryDirectory(prefix="transit-import-", dir=destination.parent) as folder:
        stage = Path(folder) / "transit.sqlite"
        with zipfile.ZipFile(archive_path) as archive:
            info = next(rows(archive, "feed_info.txt"))
            start, end = info.get("feed_start_date", ""), info.get("feed_end_date", "")
            if not start or not end or not start <= today.strftime("%Y%m%d") <= end:
                raise ValueError("GTFS feed does not cover today")
            with sqlite3.connect(stage) as db:
                db.executescript("""
                  CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                  CREATE TABLE stops(id TEXT PRIMARY KEY,public_id TEXT,parent TEXT,platform TEXT,name TEXT,lat REAL,lon REAL);
                  CREATE INDEX stops_public ON stops(public_id);
                  CREATE TABLE transfers(from_stop TEXT,to_stop TEXT,type INTEGER,minimum INTEGER,from_route TEXT,to_route TEXT,from_trip TEXT,to_trip TEXT);
                  CREATE INDEX transfers_pair ON transfers(from_stop,to_stop);
                """)
                for row in rows(archive, "stops.txt"):
                    ident = row["stop_id"]
                    # Since June 2026 IDs can be SLOIDs. Use the explicit public
                    # Didok column; only older numeric IDs have a safe fallback.
                    legacy = re.fullmatch(r"(?:Parent)?(\d{1,12})(?::.*)?", ident)
                    public = (row.get("didok") or (legacy.group(1) if legacy else "")).lstrip("0")
                    if not re.fullmatch(r"\d{1,12}", public):
                        public = ""  # Never invent an ID mapping from a name.
                    db.execute("INSERT INTO stops VALUES(?,?,?,?,?,?,?)", (ident, public, row.get("parent_station", ""), row.get("platform_code", ""), row["stop_name"], float(row["stop_lat"]) if row.get("stop_lat") else None, float(row["stop_lon"]) if row.get("stop_lon") else None))
                for row in rows(archive, "transfers.txt"):
                    minimum = int(row["min_transfer_time"]) if row.get("min_transfer_time") else None
                    if minimum is not None and minimum < 0:
                        raise ValueError("Negative transfer duration")
                    db.execute("INSERT INTO transfers VALUES(?,?,?,?,?,?,?,?)", (row["from_stop_id"], row["to_stop_id"], int(row.get("transfer_type") or 0), minimum, row.get("from_route_id", ""), row.get("to_route_id", ""), row.get("from_trip_id", ""), row.get("to_trip_id", "")))
                count = db.execute("SELECT count(*) FROM stops").fetchone()[0]
                if count == 0 or db.execute("SELECT count(*) FROM transfers").fetchone()[0] == 0:
                    raise ValueError("Empty GTFS index")
                metadata = {"updated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "valid_from": start, "valid_until": end, "source": "opentransportdata.swiss", "stop_count": str(count)}
                db.executemany("INSERT INTO metadata VALUES(?,?)", metadata.items())
                if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Invalid transit database")
        os.replace(stage, destination)


def refresh(args):
    destination = Path(args.transit_database)
    if args.gtfs_zip:
        import_archive(args.gtfs_zip, destination)
        return
    with tempfile.TemporaryDirectory(prefix="benchly-gtfs-") as folder:
        catalogue = Path(folder) / "catalogue.json"
        query = urllib.parse.urlencode({"q": "name:timetable-* AND name:*gtfs2020*", "rows": "12"})
        try:
            download("https://data.opentransportdata.swiss/api/3/action/package_search?" + query, catalogue, 4_000_000)
            packages = json.loads(catalogue.read_text())["result"]["results"]
        except urllib.error.HTTPError as error:
            if error.code not in (403, 404):
                raise
            packages = public_catalogue(folder)
        candidates = sorted(packages, key=lambda p: p.get("metadata_modified", ""), reverse=True)
        for package in candidates:
            for resource in sorted(package.get("resources", []), key=lambda r: r.get("last_modified") or r.get("created") or "", reverse=True)[:2]:
                url = resource.get("url", "")
                if not urllib.parse.urlparse(url).path.endswith(".zip"):
                    continue
                archive = Path(folder) / "feed.zip"
                download(url, archive)
                try:
                    import_archive(archive, destination)
                    print(json.dumps({"event": "transit-refreshed", "dataset": package["name"]}))
                    return
                except ValueError:
                    continue  # Skip a future/expired feed without replacing the valid index.
        raise ValueError("No valid Swiss GTFS feed found; previous index retained")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Refresh Benchly's separate Swiss transit index (Python standard library only)")
    parser.add_argument("--transit-database", default="data/transit.sqlite")
    parser.add_argument("--gtfs-zip", default=None, help="Import an already downloaded official feed")
    refresh(parser.parse_args())
