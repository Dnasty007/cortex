# Reachy Mini simulation

This directory drives the official Reachy Mini MuJoCo model from a Cortex pack. It does not connect to a physical robot. The same loader, decision engine, and antenna state machine are the interfaces a later build can point at the real robot.

The vendored SDK is `reachy_mini_upstream`. Its pin is `UPSTREAM_HASH.txt` at the repository root. Nothing under that tree is edited.

## Run the MuJoCo demo

MuJoCo is an optional extra of the upstream package (`mujoco==3.3.0`). It is not a required dependency, and this repository does not install it.

From the repository root:

```
pip install -e ".\reachy_mini_upstream[mujoco]"
python -m reachy_sim.sim_runner --pack <cortex-pack-directory>
```

That command starts the official daemon entry point:

```
python -m reachy_mini.daemon.app.main --sim --no-media
```

`reachy-mini-daemon --sim` is the same entry point after the package is installed. `--no-media` keeps the window on the robot body. The demo then holds each antenna state once across ten seconds and prints three routing decisions:

- a local skill on a fast link stays `local`
- a local skill with round-trip time above 150 ms and ethernet down goes to `grok_bot`
- anything else goes to `hermes`

Without the MuJoCo extra, the same command prints the install step, the three decisions, and the antenna angles. It does not open a robot window.

## Point the loader at a pack

`--pack` is a Cortex pack directory. The loader reads `manifest.json`, checks every `sha256` in `manifest.files` against the bytes on disk, and refuses the pack if a file does not match. The error names that file. A pack that contains a `jobs` directory or a `profiles` directory is refused.

```
python -c "from reachy_sim import CortexLoader; loader = CortexLoader(r'C:\path\to\pack'); print(loader.list_loaded_skills()); print(loader.get_skill_context('rental license'))"
```

`list_loaded_skills()` returns the skill names. `get_skill_context(query)` concatenates the skill texts with the most keyword overlap.

## Tests

```
python -m pytest reachy_sim/tests
```
