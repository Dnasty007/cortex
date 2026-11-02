"""Antenna poses for the six Reachy Mini face states.

Angles are radians in SDK order (right antenna, left antenna). The sleep
pose in the vendored SDK is about -3.05 and 3.05, and every pose here stays
inside that span.
"""

from __future__ import annotations


ANGLES: dict[str, tuple[float, float]] = {
    "IDLE": (0.0, 0.0),
    "LISTENING": (-0.9, 0.9),
    "THINKING": (0.6, -1.1),
    "SPEAKING": (-0.4, 0.4),
    "HANDOFF": (1.2, 1.2),
    "ERROR": (-2.4, 2.4),
}


class AntennaState:
    """Map a named state to a pair of antenna targets."""

    def __init__(self) -> None:
        self._state = "IDLE"

    def set_state(self, state: str) -> None:
        if state not in ANGLES:
            known = ", ".join(ANGLES)
            raise ValueError(f"Unknown antenna state: {state}. Known states: {known}")
        self._state = state

    def get_target_angles(self) -> tuple[float, float]:
        return ANGLES[self._state]
