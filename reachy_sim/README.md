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

With `--pack`, the runner birth-checks the pack, loads the skill list and any cortex headers, and asks the decision engine once per utterance. The skill match comes from the pack. The antennas follow that result:

- `local` holds the thinking pose.
- `grok_bot` holds the handoff pose.
- `hermes` holds the handoff pose.
- any other result, including a routing error, holds the error pose.
- the antennas sit in idle while no utterance is in progress.

The three utterances are still `use the local tripod gait`, `walk while the shop link is down`, and `ask about the rental license`. A local skill on a slow link with no ethernet routes to `grok_bot`. Any other local skill stays `local`. Anything the pack does not match goes to `hermes`.

Without `--pack`, the window still opens and the six demo poses play in order.

Without the MuJoCo extra, the same command prints the decision lines and the antenna angles. It does not open a robot window. A pack that fails a sha256 check exits non-zero and names the mismatched file. A pack with no `pattern_sha256` exits non-zero and names `manifest.json`.

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
