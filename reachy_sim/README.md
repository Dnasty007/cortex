# Reachy Mini simulation

Launch from the repository root. MuJoCo stays an optional extra of the vendored package. This package does not install it, including in CI.

```
pip install -e ".\reachy_mini_upstream[mujoco]"
python -m reachy_sim.sim_runner --pack <cortex-pack-directory>
```

That command starts the official daemon:

```
python -m reachy_mini.daemon.app.main --sim --no-media
```

The run prints three routing lines:

- `decision local utterance='use the local tripod gait'` means a local skill matched and the link is fine, so the pack answers.
- `decision grok_bot utterance='walk while the shop link is down'` means a local skill matched, round-trip time is above 150 ms, and ethernet is down, so Grok Bot answers.
- `decision hermes utterance='ask about the rental license'` means no local skill matched, so Hermes answers.

Without the MuJoCo extra, the same command prints those lines and the antenna angles. It does not open a robot window. A pack that fails a sha256 check exits non-zero and names the mismatched file.

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
