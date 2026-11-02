"""Routing rules for the first Reachy simulation decision engine."""

import pytest

from reachy_sim.decision_engine import DecisionEngine


def decide(local: bool, rtt: float, ethernet: bool) -> str:
    return DecisionEngine().decide(
        {
            "utterance": "hello",
            "local_skill_match": local,
            "network_rtt_ms": rtt,
            "ethernet_up": ethernet,
        }
    )


def test_local_skill_stays_local_on_a_good_link() -> None:
    assert decide(True, 40, True) == "local"
    assert decide(True, 150, False) == "local"
    assert decide(True, 400, True) == "local"


def test_slow_unplugged_local_skill_goes_to_grok_bot() -> None:
    assert decide(True, 151, False) == "grok_bot"
    assert decide(True, 320, False) == "grok_bot"


def test_missing_local_skill_goes_to_hermes() -> None:
    assert decide(False, 20, True) == "hermes"
    assert decide(False, 400, False) == "hermes"


def test_decide_requires_the_routing_keys() -> None:
    with pytest.raises(KeyError):
        DecisionEngine().decide({"utterance": "hello"})
