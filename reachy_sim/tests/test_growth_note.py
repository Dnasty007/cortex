"""Growth notes for a decision that has no usable local skill."""

import re
from pathlib import Path

import pytest

from reachy_sim.cortex_loader import CortexLoadError, CortexLoader
from reachy_sim.cortex_panel import CortexPanel
from reachy_sim.growth_note import maybe_write_growth_note, pending_count
from reachy_sim.tests.test_cortex_loader import _good_pack


UTTERANCE = "send the contractor the work order for the boiler"
_NOTE_NAME = re.compile(r"^[0-9a-f]{8}\.md$")


def test_unmatched_utterance_writes_one_pending_note(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    written = maybe_write_growth_note(pack, loader, UTTERANCE)
    assert written is not None
    assert written.parent == pack / "growth" / "pending"
    assert _NOTE_NAME.match(written.name)
    lines = written.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "From: reachy-sim"
    assert UTTERANCE in written.read_text(encoding="utf-8")
    assert len(list((pack / "growth" / "pending").glob("*.md"))) == 1
    assert pending_count(pack) == 1
    assert not (pack / "growth" / "accepted").exists()
    assert not (pack / "growth" / "closed").exists()
    assert not (pack / "memories" / "MEMORY.md").exists()


def test_the_same_utterance_does_not_write_a_second_note(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    first = maybe_write_growth_note(pack, loader, UTTERANCE)
    second = maybe_write_growth_note(pack, loader, UTTERANCE)
    notes = list((pack / "growth" / "pending").glob("*.md"))
    assert first is not None
    assert second is None
    assert len(notes) == 1
    assert notes[0].read_text(encoding="utf-8") == first.read_text(encoding="utf-8")


def test_a_note_does_not_hide_a_corrupted_sealed_file(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    written = maybe_write_growth_note(pack, loader, UTTERANCE)
    assert written is not None and written.is_file()
    skill = pack / "skills" / "walk" / "SKILL.md"
    skill.write_text("Tampered gait text.\n", encoding="utf-8", newline="\n")
    with pytest.raises(CortexLoadError, match="skills/walk/SKILL.md"):
        CortexLoader(pack)
    assert written.read_text(encoding="utf-8").splitlines()[0] == "From: reachy-sim"


def test_panel_shows_the_pending_count(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    written = maybe_write_growth_note(pack, loader, UTTERANCE)
    assert written is not None
    panel = CortexPanel(loader.list_loaded_skills(), console=True)
    panel.note_growth(pending_count(pack), written.read_text(encoding="utf-8").splitlines()[0])
    text = panel.text()
    assert "pending notes:" in text
    assert "pending notes: 1" in text
    assert "From: reachy-sim" in text
