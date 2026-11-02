"""Ears, a voice, and one camera frame. No live Hermes and no hardware."""

import json
import random
from datetime import datetime
from pathlib import Path

from reachy_sim.cortex_loader import CortexLoader
from reachy_sim.cortex_panel import CortexPanel
from reachy_sim.decision_engine import DecisionEngine
from reachy_sim.hermes_body import HermesClient, HermesConnection, HermesTimeout
from reachy_sim.senses import read_utterances
from reachy_sim.sim_runner import live_routes, route_utterance
from reachy_sim.tests.test_cortex_loader import _good_pack


UTTERANCE = "send a photo of the boiler"
PHOTO_REPLY = {
    "action": "buildium",
    "reply": "ticket open, send photo",
    "target": "K Construction",
    "ticket": "44102",
}


def _client(payload: str) -> HermesClient:
    return HermesClient(
        HermesConnection(kind="api", url="http://127.0.0.1:9"),
        transport=lambda _prompt: payload,
    )


def _sample(utterance: str) -> dict:
    return {
        "utterance": utterance,
        "local_skill_match": False,
        "network_rtt_ms": 20.0,
        "ethernet_up": True,
    }


def test_a_buildium_photo_speaks_saves_a_frame_and_records_the_contractor(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    monkeypatch.setattr(
        "reachy_sim.senses.current_time",
        lambda: datetime(2026, 11, 2, 15, 4, 5),
    )
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    panel = CortexPanel(loader.list_loaded_skills())
    route = route_utterance(
        DecisionEngine(),
        loader,
        pack,
        panel,
        _sample(UTTERANCE),
        _client(json.dumps(PHOTO_REPLY)),
        0,
        random.Random(0),
    )
    assert route is not None
    assert route["choice"] == "buildium"
    captured = capsys.readouterr()
    assert "SPEAK: ticket open, send photo" in captured.out
    photos = list((pack.parent / "photos").glob("*.png"))
    assert len(photos) == 1
    assert photos[0].name == "photo-20261102-150405.png"
    assert photos[0].read_bytes().startswith(b"\x89PNG")
    assert "photo: photo-20261102-150405.png" in panel.text()
    assert "ticket: 44102" in panel.text()
    notes = list((pack / "growth" / "pending").glob("*.md"))
    assert len(notes) == 1
    body = notes[0].read_text(encoding="utf-8")
    assert body == (
        "From: reachy-sim\n"
        "Utterance: send a photo of the boiler\n"
        "Ticket: 44102\n"
        "Contractor: K Construction\n"
        "Photo: photos/photo-20261102-150405.png\n"
    )
    assert "44102" in body
    assert "K Construction" in body
    again = route_utterance(
        DecisionEngine(),
        loader,
        pack,
        panel,
        _sample(UTTERANCE),
        _client(json.dumps(PHOTO_REPLY)),
        0,
        random.Random(0),
    )
    assert again is not None
    assert len(list((pack / "growth" / "pending").glob("*.md"))) == 1
    assert not (pack / "growth" / "accepted").exists()
    assert not (pack / "growth" / "closed").exists()


def test_a_speak_reply_prints_speak_and_takes_no_photo(tmp_path: Path, capsys) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    panel = CortexPanel(loader.list_loaded_skills())
    route = route_utterance(
        DecisionEngine(),
        loader,
        pack,
        panel,
        _sample("ask about the rental license"),
        _client(
            '{"action":"speak","reply":"The license is current.","target":"","ticket":""}'
        ),
        0,
        random.Random(0),
    )
    assert route is not None
    assert route["choice"] == "speak"
    assert "SPEAK: The license is current." in capsys.readouterr().out
    assert "photo:" not in panel.text()
    assert not (pack.parent / "photos").exists()
    assert not (pack / "growth" / "pending").exists()


def test_a_hear_file_skips_blank_lines(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    heard = tmp_path / "heard.txt"
    heard.write_text("\n\n  \nsend a photo of the boiler\n\n", encoding="utf-8")
    lines = read_utterances(heard)
    assert lines == ["send a photo of the boiler"]
    loader = CortexLoader(pack)
    panel = CortexPanel(loader.list_loaded_skills())
    client = _client('{"action":"speak","reply":"Heard.","target":"","ticket":""}')
    routes = live_routes(
        DecisionEngine(),
        loader,
        pack,
        panel,
        0,
        random.Random(0),
        client,
        lines,
    )
    assert len(routes) == 1
    assert client.prompts
    assert "send a photo of the boiler" in client.prompts[0]
    assert len(client.prompts) == 1


def test_a_timeout_still_uses_the_local_path(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    panel = CortexPanel(loader.list_loaded_skills())

    def timed_out(_prompt: str) -> str:
        raise HermesTimeout("Hermes timed out.")

    client = HermesClient(
        HermesConnection(kind="api", url="http://127.0.0.1:9"),
        transport=timed_out,
    )
    route = route_utterance(
        DecisionEngine(),
        loader,
        pack,
        panel,
        _sample("ask about the rental license"),
        client,
        0,
        random.Random(0),
    )
    assert route is not None
    assert route["choice"] == "local"
    notes = list((pack / "growth" / "pending").glob("*.md"))
    assert len(notes) == 1
    body = notes[0].read_text(encoding="utf-8")
    assert body.splitlines()[0] == "From: reachy-sim"
    assert "Hermes timed out." in body
    assert "ask about the rental license" in body
    assert not (pack.parent / "photos").exists()
