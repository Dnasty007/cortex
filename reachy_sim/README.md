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

With `--pack`, the runner birth-checks the pack and loads the skill list. On every non-empty utterance it asks Hermes and moves only from the JSON Hermes returns. If Hermes cannot be reached, the skill match comes from the pack and the local decision engine chooses:

- `local` holds the thinking pose.
- `grok_bot` holds the handoff pose.
- `hermes` holds the handoff pose.
- any other result, including a routing error, holds the error pose.
- the antennas sit in idle while no utterance is in progress.

The three utterances are still `use the local tripod gait`, `walk while the shop link is down`, and `ask about the rental license`. A local skill on a slow link with no ethernet routes to `grok_bot`. Any other local skill stays `local`. Anything the pack does not match goes to `hermes`.

`--doa` is an optional speaker direction in degrees, from -180 to 180. 0 is straight ahead. On each decision the head yaws up to 25 degrees toward that angle and both antennas add up to 15 degrees. After 1.2 seconds they return to idle. Without `--doa`, each decision uses a small random angle. An error shakes the head once instead of leaning.

Hermes answers with one JSON object: `local`, `delegate`, `buildium`, or `speak`. `local` uses the thinking lean. `delegate` uses a slow outward lean and the panel records the target name. `buildium` uses a forward lean and shows a ticket id when one is present. `speak` holds idle. The robot does not call a Grok Bot, Claude, or Buildium itself. Set `HERMES_API_URL` (optional `HERMES_API_TOKEN` or `HERMES_DESKTOP_REMOTE_URL`) or `HERMES_SSH` to `user@host`. A `.hermes-host` file in the repo root is read the same way the pack scripts read it. `HERMES_SSH_KEY` selects a key file; otherwise the runner uses `~/.ssh/id_ed25519` when that file is already there. This repo does not store a password or a token. If those details are missing, the runner prints `Hermes connection details are missing. Using the local decision path.` Hermes has 12 seconds. A timeout or a bad reply writes one growth note, then uses the local path above. An idle hold does not ask Hermes.

Without `--pack`, the window still opens and the six demo poses play in order.

With a pack, a Cortex panel sits beside the body. It lists up to 12 skill titles, a count when there are more, the last decision, the round-trip time used for that decision, the antenna state next to the angles, the DoA angle (`doa 34°`), and `pending notes: N`. The matched skill is gold for about a second. A `grok_bot` or `hermes` result with no local skill shows a dim `no local match` line. A decision with no usable local match writes one file under `growth/pending/`. The robot does not accept that note, and it does not edit sealed files.

Without the MuJoCo extra, the same command prints those panel lines, the decision lines, and the antenna angles. It does not open a robot window. A pack that fails a sha256 check exits non-zero and names the mismatched file. A pack with no `pattern_sha256` exits non-zero and names `manifest.json`.

## Point the loader at a pack

`--pack` is a Cortex pack directory. The loader reads `manifest.json`, checks every `sha256` in `manifest.files` against the bytes on disk, and refuses the pack if a file does not match. The error names that file. A pack that contains a `jobs` directory or a `profiles` directory is refused.

```
python -c "from reachy_sim import CortexLoader; loader = CortexLoader(r'C:\path\to\pack'); print(loader.list_loaded_skills()); print(loader.get_skill_context('rental license'))"
```

`list_loaded_skills()` returns the skill names. `get_skill_context(query)` concatenates the skill texts with the most keyword overlap. Overlap is computed on the skill title and description after dropping stop words: the, a, an, and, or, but, if, is, are, was, be, to, of, in, on, for, with, use, and local. A query with no content word left, or with no content word in common, does not match.

## Tests

```
python -m pytest reachy_sim/tests
```
