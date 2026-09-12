"""Pure circular-probability primitives used by direction enrichment."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from typing import Iterable, Sequence

import numpy as np

from benchly.geo import circular_difference

DIRECTIONS = tuple(range(0, 360, 45))
METHOD_VERSION = "bench-direction-3"


def _normalize(values: Sequence[float]) -> tuple[float, ...]:
    clean = np.asarray([max(1e-9, float(value)) for value in values], dtype=float)
    clean /= clean.sum()
    return tuple(float(value) for value in clean)


def circular_distribution(direction: float, concentration: float = 2.0) -> tuple[float, ...]:
    """A small von-Mises distribution sampled at Benchly's eight UI bearings."""
    radians = np.radians(np.asarray(DIRECTIONS, dtype=float) - float(direction))
    return _normalize(np.exp(max(0.0, concentration) * np.cos(radians)))


def mixture(*components: tuple[Sequence[float], float]) -> tuple[float, ...]:
    values = np.zeros(len(DIRECTIONS), dtype=float)
    for probabilities, weight in components:
        values += np.asarray(probabilities, dtype=float) * max(0.0, float(weight))
    return _normalize(values if values.sum() else np.ones(len(DIRECTIONS)))


def axis_distribution(axis_degrees: float, concentration: float = 3.0) -> tuple[float, ...]:
    """A bench's long axis implies two equally plausible perpendicular views."""
    return mixture(
        (circular_distribution(axis_degrees + 90, concentration), 1),
        (circular_distribution(axis_degrees + 270, concentration), 1),
    )


@dataclass(frozen=True)
class DirectionSignal:
    name: str
    probabilities: tuple[float, ...]
    weight: float
    details: dict[str, object]

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "weight": self.weight,
            "probabilities": {str(direction): probability for direction, probability in zip(DIRECTIONS, self.probabilities)},
            "details": self.details,
        }


@dataclass(frozen=True)
class DirectionEstimate:
    direction_degrees: int
    top_probability: float
    entropy: float
    probabilities: tuple[float, ...]
    signal_count: int

    def probabilities_json(self) -> str:
        return json.dumps({str(direction): round(value, 8) for direction, value in zip(DIRECTIONS, self.probabilities)}, separators=(",", ":"))


def fuse_signals(signals: Iterable[DirectionSignal], weights: dict[str, float] | None = None,
                 temperature: float = 1.0) -> DirectionEstimate | None:
    signals = list(signals)
    if not signals:
        return None
    logits = np.zeros(len(DIRECTIONS), dtype=float)
    for signal in signals:
        multiplier = (weights or {}).get(signal.name, 1.0)
        logits += max(0.0, signal.weight * multiplier) * np.log(np.maximum(signal.probabilities, 1e-9))
    temperature = max(0.2, min(5.0, float(temperature)))
    logits = (logits - logits.max()) / temperature
    probabilities = _normalize(np.exp(logits))
    winner = int(np.argmax(probabilities))
    entropy = -sum(value * math.log(value) for value in probabilities if value > 0) / math.log(len(DIRECTIONS))
    return DirectionEstimate(
        direction_degrees=DIRECTIONS[winner],
        top_probability=probabilities[winner],
        entropy=entropy,
        probabilities=probabilities,
        signal_count=len(signals),
    )


def accuracy_bucket(predicted: float, observed: float) -> tuple[bool, bool, bool, bool]:
    error = circular_difference(predicted, observed)
    axis_error = min(error, circular_difference((predicted + 180) % 360, observed))
    return error <= 22.5, error <= 45, error <= 90, axis_error <= 22.5
