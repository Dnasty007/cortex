"""Drive the vendored Reachy Mini MuJoCo model from the Cortex modules.

This process never talks to a physical robot. MuJoCo is an optional extra of
the upstream package, not a required dependency, so this file does not install
it. When the extra is present, the demo starts the official daemon entry
point. A pack drives the antennas from the decision engine. No pack keeps
the six-pose demo.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

from reachy_sim.antenna_state import ANGLES, AntennaState
from reachy_sim.cortex_loader import CortexLoadError, CortexLoader
from reachy_sim.decision_engine import DecisionEngine


REPO_ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = REPO_ROOT / "reachy_mini_upstream"
SDK_SRC = UPSTREAM / "src"
DEMO_SECONDS = 10.0
DAEMON_PORT = 8000

# Same function the reachy-mini-daemon console script calls.
DAEMON_MODULE = "reachy_mini.daemon.app.main"
DAEMON_ARGS = ["--sim", "--no-media"]

# Decision result → antenna pose. Idle is not a route; it is the pose
# between utterances, when nothing is being decided.
ROUTE_POSE = {
    "local": "THINKING",
    "grok_bot": "HANDOFF",
    "hermes": "HANDOFF",
}
_HEADER = re.compile(r":::cortex\n(.*?)\n:::", re.S)

EXAMPLES = (
    {
        "utterance": "use the local tripod gait",
        "local_skill_match": True,
        "network_rtt_ms": 40.0,
        "ethernet_up": True,
    },
    {
        "utterance": "walk while the shop link is down",
        "local_skill_match": True,
        "network_rtt_ms": 320.0,
        "ethernet_up": False,
    },
    {
        "utterance": "ask about the rental license",
        "local_skill_match": False,
        "network_rtt_ms": 20.0,
        "ethernet_up": True,
    },
)


def import_sdk():
    """Import Reachy Mini from the vendored tree, ahead of any installed copy."""
    src = str(SDK_SRC)
    if src not in sys.path:
        sys.path.insert(0, src)
    import reachy_mini
    from reachy_mini import ReachyMini

    return reachy_mini, ReachyMini


def mujoco_import_error() -> str | None:
    try:
        import mujoco  # noqa: F401
    except Exception as error:
        return f"{type(error).__name__}: {error}"
    return None


def install_help() -> str:
    return (
        "MuJoCo is an optional extra of pollen-robotics/reachy_mini "
        "(pyproject.toml optional-dependencies.mujoco = mujoco==3.3.0). "
        "It is not a required dependency, and this scaffold does not install it.\n"
        "From the repository root:\n"
        '  pip install -e ".\\reachy_mini_upstream[mujoco]"\n'
        "  python -m reachy_sim.sim_runner --pack <cortex-pack-directory>\n"
        "The official simulation entry point is:\n"
        f"  python -m {DAEMON_MODULE} --sim\n"
        "This demo adds --no-media so the window is the robot body."
    )


def port_open(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def start_mujoco_daemon() -> subprocess.Popen | None:
    """Start the official MuJoCo daemon. Return None when it cannot run."""
    reason = mujoco_import_error()
    if reason is not None:
        print(install_help())
        print(f"mujoco import failed: {reason}")
        return None
    try:
        import_sdk()
    except Exception as error:
        print(install_help())
        print(f"reachy_mini import failed: {type(error).__name__}: {error}")
        return None
    env = os.environ.copy()
    previous = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(SDK_SRC) + (os.pathsep + previous if previous else "")
    command = [sys.executable, "-m", DAEMON_MODULE, *DAEMON_ARGS]
    print("starting", " ".join(command))
    process = subprocess.Popen(
        command,
        cwd=str(UPSTREAM),
        env=env,
    )
    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline:
        if process.poll() is not None:
            print(f"MuJoCo daemon exited with code {process.returncode}.")
            print(install_help())
            return None
        if port_open(DAEMON_PORT):
            return process
        time.sleep(0.25)
    print("MuJoCo daemon did not open port 8000.")
    stop_process(process)
    print(install_help())
    return None


def stop_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    if os.name == "nt":
        # The venv interpreter re-execs the real Python. Killing the parent
        # alone leaves the MuJoCo window and port 8000 behind.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def print_decisions(engine: DecisionEngine) -> None:
    for sample in EXAMPLES:
        choice = engine.decide(sample)
        print(f"decision {choice} utterance={sample['utterance']!r}")


def _require_pattern_sha256(pack: Path) -> None:
    """A sealed pack carries pattern_sha256. A blank value names the manifest."""
    manifest_path = pack / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CortexLoadError(
            "Birth check failed. pattern_sha256 is missing: manifest.json"
        ) from error
    pattern = manifest.get("pattern_sha256") if isinstance(manifest, dict) else None
    if not isinstance(pattern, str) or not pattern.strip():
        raise CortexLoadError(
            "Birth check failed. pattern_sha256 is missing: manifest.json"
        )


def _skill_headers(pack: Path) -> list[dict[str, str]]:
    """Read cortex headers from skill files the birth check already accepted."""
    manifest_path = pack / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    headers: list[dict[str, str]] = []
    for item in manifest.get("files") or []:
        if not isinstance(item, dict):
            continue
        rel = str(item.get("path") or "")
        name = str(item.get("skill") or "").strip()
        if not name and not rel.endswith("SKILL.md"):
            continue
        text = (pack / rel).read_text(encoding="utf-8")
        header: dict[str, str] = {"skill": name or Path(rel).parent.name}
        match = _HEADER.search(text[:4000])
        if match:
            for line in match.group(1).splitlines():
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                header[key.strip()] = value.strip()
        headers.append(header)
    return headers


def live_routes(engine: DecisionEngine, loader: CortexLoader, pack: Path) -> list[str]:
    """Ask the decision engine once per utterance and return antenna poses.

    Skill names and headers ride on the sample. The engine's routing rule is
    unchanged: it still reads local_skill_match, network_rtt_ms, and ethernet_up.
    The skill match comes from the pack, not from the demo flags.
    """
    skills = loader.list_loaded_skills()
    headers = _skill_headers(pack)
    poses: list[str] = []
    for sample in EXAMPLES:
        routed = dict(sample)
        routed["local_skill_match"] = bool(loader.get_skill_context(sample["utterance"]).strip())
        routed["skills"] = list(skills)
        routed["headers"] = headers
        try:
            choice = engine.decide(routed)
        except Exception as error:
            print(
                f"decision error utterance={sample['utterance']!r} {error}",
                file=sys.stderr,
            )
            choice = "error"
        print(f"decision {choice} utterance={sample['utterance']!r}")
        poses.append(ROUTE_POSE.get(choice, "ERROR"))
    return poses


def _hold_pose(antennas: AntennaState, send, state: str, duration: float) -> None:
    antennas.set_state(state)
    angles = antennas.get_target_angles()
    print(f"antenna {state} {angles[0]:.3f} {angles[1]:.3f}")
    if send is not None:
        send(angles, duration)


def play_routes(antennas: AntennaState, send, poses: list[str]) -> None:
    """Idle, then each decision pose, then idle again. Nothing is queued ahead."""
    _hold_pose(antennas, send, "IDLE", 0.45)
    for state in poses:
        _hold_pose(antennas, send, state, 1.3)
        _hold_pose(antennas, send, "IDLE", 0.45)


def cycle_antennas(antennas: AntennaState, send) -> None:
    """Hold each of the six states once across a ten-second loop."""
    slot = DEMO_SECONDS / len(ANGLES)
    started = time.monotonic()
    for index, state in enumerate(ANGLES):
        antennas.set_state(state)
        angles = antennas.get_target_angles()
        print(f"antenna {state} {angles[0]:.3f} {angles[1]:.3f}")
        state_end = started + (index + 1) * slot
        if send is not None:
            duration = max(0.2, min(slot * 0.85, state_end - time.monotonic()))
            send(angles, duration)
        remaining = state_end - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)


def run_demo(pack: Path | None) -> int:
    engine = DecisionEngine()
    antennas = AntennaState()
    routes: list[str] | None = None
    if pack is not None:
        loader = CortexLoader(pack)
        _require_pattern_sha256(pack)
        names = ", ".join(loader.list_loaded_skills()) or "(none)"
        print(f"loaded skills: {names}")
        routes = live_routes(engine, loader, pack)
    else:
        print_decisions(engine)
    process = start_mujoco_daemon()
    try:
        if process is not None:
            _, ReachyMini = import_sdk()
            with ReachyMini(
                connection_mode="localhost_only",
                media_backend="no_media",
                timeout=30.0,
            ) as robot:
                print("MuJoCo simulation is up. The robot window should be visible.")

                def send(angles: tuple[float, float], duration: float) -> None:
                    robot.goto_target(antennas=list(angles), duration=duration)

                if routes is None:
                    cycle_antennas(antennas, send)
                else:
                    play_routes(antennas, send, routes)
        else:
            print("Antenna cycle is running without the MuJoCo window.")
            if routes is None:
                cycle_antennas(antennas, None)
            else:
                play_routes(antennas, None, routes)
    finally:
        stop_process(process)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reachy Mini MuJoCo demo for a Cortex pack.")
    parser.add_argument(
        "--pack",
        type=Path,
        default=None,
        help="Path to a Cortex pack directory. The birth check runs before the demo.",
    )
    args = parser.parse_args(argv)
    try:
        return run_demo(args.pack)
    except CortexLoadError as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
