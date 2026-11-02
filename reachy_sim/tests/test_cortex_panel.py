"""Cortex panel text for one loaded pack and one decision."""

from pathlib import Path

from reachy_sim.cortex_loader import CortexLoader
from reachy_sim.cortex_panel import CortexPanel
from reachy_sim.decision_engine import DecisionEngine
from reachy_sim.tests.test_cortex_loader import _manifest, _write


def test_panel_shows_the_matched_skill_and_the_decision(tmp_path: Path) -> None:
    pack = tmp_path / "pack"
    lease = "Philadelphia rental license renewal.\n"
    files = [
        {
            "path": "skills/lease/SKILL.md",
            "sha256": _write(pack, "skills/lease/SKILL.md", lease),
            "skill": "lease",
        }
    ]
    _manifest(pack, files)
    loader = CortexLoader(pack)
    utterance = "ask about the rental license"
    matched = loader.best_match(utterance)
    assert matched == "lease"
    choice = DecisionEngine().decide(
        {
            "utterance": utterance,
            "local_skill_match": True,
            "network_rtt_ms": 20,
            "ethernet_up": True,
        }
    )
    assert choice == "local"
    panel = CortexPanel(loader.list_loaded_skills())
    panel.note_decision(choice, utterance, 20, matched)
    panel.set_antenna("THINKING", (0.6, -1.1))
    text = panel.text()
    assert "lease" in text
    assert "decision local" in text
    assert "thinking" in text
    assert "rtt 20 ms" in text
