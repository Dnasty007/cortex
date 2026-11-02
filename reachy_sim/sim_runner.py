"""Drive the vendored Reachy Mini MuJoCo model from the Cortex modules.

This process never talks to a physical robot. MuJoCo is an optional extra of
the upstream package, not a required dependency, so this file does not install
it. When the extra is present, the demo starts the official daemon entry
point and the simulated robot is visible for ten seconds.
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from reachy_sim.antenna_state import ANGLES, AntennaState
from reachy_sim.cortex_loader import CortexLoader
from reachy_sim.decision_engine import DecisionEngine


REPO_ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = REPO_ROOT / "reachy_mini_upstream"
SDK_SRC = UPSTREAM / "src"
DEMO_SECONDS = 10.0
DAEMON_PORT = 8000

# Same function the reachy-mini-daemon console script calls.
DAEMON_MODULE = "reachy_mini.daemon.app.main"
DAEMON_ARGS = ["--sim", "--no-media"]

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
    loader = CortexLoader(pack) if pack is not None else None
    if loader is not None:
        names = ", ".join(loader.list_loaded_skills()) or "(none)"
        print(f"loaded skills: {names}")
        print(loader.get_skill_context(EXAMPLES[0]["utterance"]))
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

                cycle_antennas(antennas, send)
        else:
            print("Antenna cycle is running without the MuJoCo window.")
            cycle_antennas(antennas, None)
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
    return run_demo(args.pack)


if __name__ == "__main__":
    raise SystemExit(main())
