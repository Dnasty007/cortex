"""Turn the head and antennas toward a speaker direction.

Degrees, with 0 straight ahead. The lean is capped so the motion stays small.
The same targets are what a later 4-mic array can send.
"""

from __future__ import annotations

import math
import random


HEAD_MAX_DEG = 25.0
ANTENNA_EXTRA_DEG = 15.0
ANTENNA_LIMIT = 3.05
RANDOM_SPAN_DEG = 20.0
SHAKE_DEG = (12.0, -12.0, 0.0)


def resolve_doa(given: float | None, rng: random.Random | None = None) -> float:
    """Use the given degrees, or a small random angle in [-20, 20]."""
    if given is None:
        source = rng or random.Random()
        return float(source.uniform(-RANDOM_SPAN_DEG, RANDOM_SPAN_DEG))
    degrees = float(given)
    if degrees < -180.0 or degrees > 180.0:
        raise ValueError("doa must be from -180 to 180 degrees.")
    return degrees


def head_yaw_deg(doa_deg: float) -> float:
    """Head yaw in degrees, clamped to ±25."""
    return max(-HEAD_MAX_DEG, min(HEAD_MAX_DEG, float(doa_deg)))


def antenna_extra_deg(doa_deg: float) -> float:
    """Extra antenna lean in degrees, clamped to ±15."""
    return max(-ANTENNA_EXTRA_DEG, min(ANTENNA_EXTRA_DEG, float(doa_deg)))


def attention_targets(
    doa_deg: float,
    base: tuple[float, float],
) -> tuple[float, tuple[float, float]]:
    """Return body-yaw radians and both antenna joints leaned toward doa.

    Antenna order is the SDK order, right then left. Both get the same extra.
    """
    extra = math.radians(antenna_extra_deg(doa_deg))
    leaned = tuple(
        max(-ANTENNA_LIMIT, min(ANTENNA_LIMIT, angle + extra)) for angle in base
    )
    return math.radians(head_yaw_deg(doa_deg)), (leaned[0], leaned[1])


def shake_yaws() -> tuple[float, float, float]:
    """One head shake in radians: right, left, center. No antenna lean."""
    return tuple(math.radians(degrees) for degrees in SHAKE_DEG)
