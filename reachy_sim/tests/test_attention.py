"""Direction-of-arrival lean for one decision."""

import math
import random
from pathlib import Path

import pytest

from reachy_sim.antenna_state import ANGLES
from reachy_sim.attention import attention_targets, head_yaw_deg, resolve_doa
from reachy_sim.cortex_loader import CortexLoadError, CortexLoader
from reachy_sim.cortex_panel import CortexPanel
from reachy_sim.growth_note import maybe_write_growth_note
from reachy_sim.tests.test_cortex_loader import _good_pack


def test_doa_40_clamps_the_head_and_shows_on_the_panel() -> None:
    yaw, leaned = attention_targets(40, ANGLES["THINKING"])
    assert head_yaw_deg(40) == 25
    assert math.isclose(math.degrees(yaw), 25.0, abs_tol=0.01)
    extra = math.radians(15)
    assert math.isclose(leaned[0], ANGLES["THINKING"][0] + extra, abs_tol=1e-6)
    assert math.isclose(leaned[1], ANGLES["THINKING"][1] + extra, abs_tol=1e-6)
    panel = CortexPanel(["lease"])
    panel.set_doa(40)
    panel.set_antenna("THINKING", leaned)
    assert "doa 40" in panel.text()


def test_doa_outside_the_range_is_refused() -> None:
    from reachy_sim.sim_runner import main

    assert main(["--doa", "200"]) == 1


def test_missing_doa_still_turns_the_head() -> None:
    doa = resolve_doa(None, random.Random(1))
    assert -20.0 <= doa <= 20.0
    yaw, _ = attention_targets(doa, ANGLES["IDLE"])
    assert abs(math.degrees(yaw)) > 0.5
    panel = CortexPanel([])
    panel.set_doa(doa)
    panel.set_antenna("IDLE", ANGLES["IDLE"])
    assert "doa " in panel.text()


def test_birth_check_and_growth_notes_stay_the_same(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    utterance = "send the contractor the work order for the boiler"
    note = maybe_write_growth_note(pack, loader, utterance)
    assert note is not None
    assert note.read_text(encoding="utf-8").splitlines()[0] == "From: reachy-sim"
    assert maybe_write_growth_note(pack, loader, utterance) is None
    skill = pack / "skills" / "walk" / "SKILL.md"
    skill.write_text("Tampered gait text.\n", encoding="utf-8", newline="\n")
    with pytest.raises(CortexLoadError, match="skills/walk/SKILL.md"):
        CortexLoader(pack)
