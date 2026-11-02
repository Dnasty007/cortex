"""Hermes decides. The body only moves and speaks that reply."""

import json
import math
import random
from pathlib import Path

from reachy_sim.antenna_state import ANGLES, AntennaState
from reachy_sim.attention import attention_targets
from reachy_sim.cortex_loader import CortexLoader
from reachy_sim.cortex_panel import CortexPanel
from reachy_sim.decision_engine import DecisionEngine
from reachy_sim.hermes_body import (
    FORWARD_ANGLES,
    INSTRUCTION,
    HermesClient,
    HermesConnection,
    HermesTimeout,
    discover_connection,
    hermes_prompt,
)
from reachy_sim.sim_runner import _look_toward, live_routes, route_utterance
from reachy_sim.tests.test_cortex_loader import _good_pack


UTTERANCE = "ask about the rental license"
SAMPLE = {
    "utterance": UTTERANCE,
    "local_skill_match": False,
    "network_rtt_ms": 20.0,
    "ethernet_up": True,
}

ACTIONS = (
    (
        "local",
        {"action": "local", "reply": "Using the local gait.", "target": "", "ticket": ""},
        "THINKING",
        ANGLES["THINKING"],
        "thinking",
        0.45,
    ),
    (
        "delegate",
        {
            "action": "delegate",
            "reply": "Asked the shop bot.",
            "target": "grok-bot",
            "ticket": "",
        },
        "HANDOFF",
        ANGLES["HANDOFF"],
        "handoff",
        0.9,
    ),
    (
        "buildium",
        {
            "action": "buildium",
            "reply": "The boiler ticket is open.",
            "target": "",
            "ticket": "44102",
        },
        "FORWARD",
        FORWARD_ANGLES,
        "forward",
        0.45,
    ),
    (
        "speak",
        {"action": "speak", "reply": "Hello.", "target": "", "ticket": ""},
        "IDLE",
        ANGLES["IDLE"],
        "idle",
        0.45,
    ),
)


def _client(payload: str) -> HermesClient:
    return HermesClient(
        HermesConnection(kind="api", url="http://127.0.0.1:9"),
        transport=lambda _prompt: payload,
    )


def test_each_hermes_action_sets_the_pose_and_the_panel(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("reachy_sim.sim_runner.time.sleep", lambda _seconds: None)
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    engine = DecisionEngine()
    antennas = AntennaState()
    for action, body, pose, base, label, duration in ACTIONS:
        panel = CortexPanel(loader.list_loaded_skills())
        client = _client(json.dumps(body))
        route = route_utterance(
            engine,
            loader,
            pack,
            panel,
            SAMPLE,
            client,
            40,
            random.Random(0),
        )
        assert route is not None
        assert route["choice"] == action
        assert route["pose"] == pose
        assert route["duration"] == duration
        assert route["reply"] == body["reply"]
        assert route["target"] == body["target"]
        assert route["ticket"] == body["ticket"]
        assert client.prompts == [hermes_prompt(UTTERANCE, pack)]
        sent = json.loads(client.prompts[0])
        assert sent["utterance"] == UTTERANCE
        assert sent["pack"] == str(pack)
        assert sent["instruction"] == INSTRUCTION
        assert sent["expect"]["action"] == "local|delegate|buildium|speak"
        seen: list[dict] = []

        def send(angles, move_for, yaw, seen=seen, panel=panel):
            seen.append(
                {
                    "angles": angles,
                    "duration": move_for,
                    "yaw": yaw,
                    "panel": panel.text(),
                }
            )

        _look_toward(
            antennas,
            send,
            panel,
            route["pose"],
            route["doa"],
            route["choice"],
            duration=route["duration"],
            base=route["base"],
        )
        yaw, leaned = attention_targets(40, base)
        first = seen[0]
        assert math.isclose(first["yaw"], yaw, abs_tol=1e-6)
        assert math.isclose(math.degrees(first["yaw"]), 25.0, abs_tol=0.01)
        assert math.isclose(first["angles"][0], leaned[0], abs_tol=1e-6)
        assert math.isclose(first["angles"][1], leaned[1], abs_tol=1e-6)
        assert first["duration"] == duration
        text = first["panel"]
        assert label in text
        assert f"{leaned[0]:.3f}" in text
        assert f"{leaned[1]:.3f}" in text
        assert "doa 40" in text
        assert f"action {action}" in text
        assert f"reply: {body['reply']}" in text
        assert seen[1]["angles"] == (0.0, 0.0)
        assert seen[1]["yaw"] == 0.0
        assert not (pack / "growth" / "pending").exists()
    delegate = ACTIONS[1][1]
    assert delegate["target"] == "grok-bot"


def test_a_timeout_falls_back_and_writes_one_growth_note(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    manifest = (pack / "manifest.json").read_bytes()
    loader = CortexLoader(pack)
    panel = CortexPanel(loader.list_loaded_skills())
    engine = DecisionEngine()

    def timed_out(_prompt: str) -> str:
        raise HermesTimeout("Hermes timed out.")

    client = HermesClient(
        HermesConnection(kind="api", url="http://127.0.0.1:9"),
        transport=timed_out,
    )
    route = route_utterance(
        engine, loader, pack, panel, SAMPLE, client, 0, random.Random(0)
    )
    assert route is not None
    assert route["choice"] == "local"
    assert route["pose"] == "THINKING"
    assert "decision local" in panel.text()
    notes = list((pack / "growth" / "pending").glob("*.md"))
    assert len(notes) == 1
    body = notes[0].read_text(encoding="utf-8")
    assert body.splitlines()[0] == "From: reachy-sim"
    assert UTTERANCE in body
    assert "Hermes timed out." in body
    again = route_utterance(
        engine, loader, pack, panel, SAMPLE, client, 0, random.Random(0)
    )
    assert again is not None and again["choice"] == "local"
    assert len(list((pack / "growth" / "pending").glob("*.md"))) == 1
    assert (pack / "manifest.json").read_bytes() == manifest
    assert not (pack / "growth" / "accepted").exists()
    assert not (pack / "growth" / "closed").exists()


def test_a_missing_connection_warns_and_decides_locally(tmp_path: Path, capsys) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    panel = CortexPanel(loader.list_loaded_skills())
    client = HermesClient(None)
    routes = live_routes(
        DecisionEngine(),
        loader,
        pack,
        panel,
        0,
        random.Random(0),
        client,
    )
    captured = capsys.readouterr()
    warning = "Hermes connection details are missing. Using the local decision path."
    assert captured.err.count(warning) == 1
    assert client.prompts == []
    assert any(route["choice"] == "local" and route["pose"] == "THINKING" for route in routes)
    assert "decision local" in captured.out
    pending = pack / "growth" / "pending"
    if pending.is_dir():
        for note in pending.glob("*.md"):
            assert "Hermes" not in note.read_text(encoding="utf-8")


def test_an_empty_utterance_does_not_ask_hermes(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    loader = CortexLoader(pack)
    panel = CortexPanel(loader.list_loaded_skills())
    client = _client('{"action":"speak","reply":"nope"}')
    sample = dict(SAMPLE)
    sample["utterance"] = "   "
    assert (
        route_utterance(
            DecisionEngine(),
            loader,
            pack,
            panel,
            sample,
            client,
            0,
            random.Random(0),
        )
        is None
    )
    assert client.prompts == []


def test_connection_details_come_from_the_environment(tmp_path: Path) -> None:
    source = Path(__file__).resolve().parents[1].joinpath("hermes_body.py").read_text(encoding="utf-8")
    assert "159.89.88.33" not in source
    assert discover_connection(env={}, root=tmp_path) is None
    api = discover_connection(
        env={"HERMES_API_URL": "http://127.0.0.1:9119", "HERMES_API_TOKEN": "test-token"},
        root=tmp_path,
    )
    assert api is not None
    assert api.kind == "api"
    assert api.url == "http://127.0.0.1:9119"
    assert api.token == "test-token"
    ssh = discover_connection(env={"HERMES_SSH": "root@example"}, root=tmp_path)
    assert ssh is not None
    assert ssh.kind == "ssh"
    assert ssh.target == "root@example"
    (tmp_path / ".hermes-host").write_text("ops@example\n", encoding="utf-8")
    filed = discover_connection(env={}, root=tmp_path)
    assert filed is not None
    assert filed.target == "ops@example"
    assert discover_connection(env={"HERMES_SSH": "not a host"}, root=tmp_path) is None
