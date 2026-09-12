"""CLI adapters for direction analysis and publication."""

from __future__ import annotations

import json

from .analysis import analyze, import_reviews, prepare_review
from .publish import publish, remove_published_run


def analyze_directions_job(args) -> None:
    print(json.dumps(analyze(args), indent=2, ensure_ascii=False))


def publish_direction_estimates_job(args) -> None:
    print(json.dumps(publish(args), indent=2, ensure_ascii=False))


def prepare_direction_review_job(args) -> None:
    print(json.dumps(prepare_review(args), indent=2, ensure_ascii=False))


def remove_direction_estimates_job(args) -> None:
    print(json.dumps(remove_published_run(args), indent=2, ensure_ascii=False))


def import_direction_reviews_job(args) -> None:
    print(json.dumps(import_reviews(args), indent=2, ensure_ascii=False))
