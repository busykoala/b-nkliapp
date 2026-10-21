"""Snapshot review code/assets, including untracked work, without local data/secrets."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DIRECTORIES = ("worker/benchly", "worker/tests", "src", "scripts/panorama-art", "scripts/panorama-review", "config", "public/ui-art/panorama")
SUFFIXES = {".py", ".ts", ".tsx", ".mjs", ".js", ".json", ".css", ".png", ".webp"}
LOCKS = ("package.json", "package-lock.json", "pyproject.toml", "uv.lock", "scripts/review-full-panorama.ts")


def sources():
    paths = [ROOT / path for path in LOCKS]
    for directory in DIRECTORIES:
        paths += [path for path in (ROOT / directory).rglob("*") if path.is_file() and
                  path.suffix in SUFFIXES and "__pycache__" not in path.parts]
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


def snapshot(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    manifest = sources()
    with zipfile.ZipFile(output / "source.zip", "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative, checksum in manifest.items():
            payload = (ROOT / relative).read_bytes()
            if hashlib.sha256(payload).hexdigest() != checksum:
                raise RuntimeError("Source changed while taking its snapshot")
            archive.writestr(relative, payload)
    result = {"gitCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "files": manifest, "sha256": hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()}
    (output / "source.json").write_text(json.dumps(result, indent=2) + "\n")
    diff = subprocess.check_output(["git", "diff", "HEAD", "--", *DIRECTORIES, *LOCKS], cwd=ROOT)
    (output / "source.patch").write_bytes(diff)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    result = snapshot(parser.parse_args().output)
    print(json.dumps({"gitCommit": result["gitCommit"], "sha256": result["sha256"], "files": len(result["files"])}))
