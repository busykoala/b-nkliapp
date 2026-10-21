"""Verify and archive an offline review, preserving the previous panorama ZIP."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
from urllib.parse import unquote, urlparse
import zipfile


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []

    def handle_starttag(self, _tag, attrs):
        self.targets.extend(value for name, value in attrs if name in {"src", "href"} and value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--archive", type=Path, default=Path("panoramas.zip"))
    args = parser.parse_args()
    root, archive = args.input.resolve(), args.archive.resolve()
    if not (root / "report.html").is_file() or archive.is_relative_to(root):
        parser.error("Input must contain report.html and archive must be outside it")
    links_checked = 0
    for page in root.rglob("*.html"):
        links = Links()
        links.feed(page.read_text())
        for target in links.targets:
            parsed = urlparse(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            destination = (page.parent / unquote(parsed.path)).resolve()
            if not destination.is_relative_to(root) or not destination.exists():
                raise ValueError(f"Broken or escaping offline reference: {page.relative_to(root)} -> {target}")
            links_checked += 1
    checksums = {str(path.relative_to(root)): sha256(path) for path in sorted(root.rglob("*"))
                 if path.is_file() and path.name != "checksums.json"}
    (root / "checksums.json").write_text(json.dumps({"algorithm": "sha256", "files": checksums,
        "htmlReferencesVerified": links_checked}, indent=2) + "\n")
    staged = archive.with_name(archive.name + ".partial")
    if staged.exists():
        parser.error(f"Preserving an existing partial archive: {staged}")
    with zipfile.ZipFile(staged, "x", allowZip64=True) as bundle:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                compression = zipfile.ZIP_STORED if path.suffix.lower() in {".png", ".webp", ".jpg", ".zip"} else zipfile.ZIP_DEFLATED
                bundle.write(path, path.relative_to(root), compress_type=compression)
    with zipfile.ZipFile(staged) as bundle:
        bad = bundle.testzip()
        if bad:
            raise ValueError(f"ZIP CRC failed: {bad}")
        if set(bundle.namelist()) != {*checksums, "checksums.json"}:
            raise ValueError("ZIP file list differs from the verified report tree")
    previous = None
    if archive.exists():
        previous = root.parent / f"panoramas-before-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.zip"
        shutil.copy2(archive, previous)
        if sha256(previous) != sha256(archive):
            raise ValueError("Previous archive backup checksum mismatch")
    staged.replace(archive)
    result = {"archive": str(archive), "bytes": archive.stat().st_size, "sha256": sha256(archive),
              "files": len(checksums) + 1, "htmlReferencesVerified": links_checked,
              "previousArchive": str(previous) if previous else None}
    (root.parent / f"{root.name}-archive.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
