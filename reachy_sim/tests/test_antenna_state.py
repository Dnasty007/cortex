"""Antenna state machine poses."""

import pytest

from reachy_sim.antenna_state import AntennaState


EXPECT = {
    "IDLE": (0.0, 0.0),
    "LISTENING": (-0.9, 0.9),
    "THINKING": (0.6, -1.1),
    "SPEAKING": (-0.4, 0.4),
    "HANDOFF": (1.2, 1.2),
    "ERROR": (-2.4, 2.4),
}


def test_each_state_has_its_own_angles() -> None:
    machine = AntennaState()
    assert machine.get_target_angles() == EXPECT["IDLE"]
    seen = set()
    for state, angles in EXPECT.items():
        machine.set_state(state)
        got = machine.get_target_angles()
        assert got == angles
        assert all(-3.05 <= value <= 3.05 for value in got)
        seen.add(got)
    assert len(seen) == 6


def test_unknown_state_is_refused() -> None:
    machine = AntennaState()
    with pytest.raises(ValueError, match="SLEEP"):
        machine.set_state("SLEEP")
    assert machine.get_target_angles() == EXPECT["IDLE"]
