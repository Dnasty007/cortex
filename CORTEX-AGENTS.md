# CORTEX-AGENTS.md

This file is for an AI agent that cloned the public Cortex format repo: https://github.com/Dnasty007/cortex

That repo is the format layer only. A private VR runtime may exist on a machine that also has this format. It is a different tree. Do not treat this clone as that runtime.

## Architecture

The format is the contract. Contributions go through the spec first, and code follows it.

| Piece | Path | Role |
| --- | --- | --- |
| Spec | `CORTEX-SPEC.md` | `cortex-spec`. Frozen at tag `cortex-spec-1`. Skills, memory, safety rules, and human-gated growth. |
| Portable packer | `cortex_pack.py` | Unsealed pack you can hand to anyone. Place will not install it. |
| Sealed packer | `scanner/pack_brain.py` | Sealed pack and the Place installer. Checksums and redacted secrets. |
| Boot check | `scanner/boot_check.py` | Read-only birth check. It does not write a birth, delete a file, or start an agent. |
| Query | `scripts/brain-query.mjs` | Lists paths and headers from a brain. It does not print file bodies. A sealed pack also writes this script at the brain root. |
| CI | `.github/workflows/ci.yml` | Ubuntu job. Python 3.12, then Node 20. |

`cortex_pack.py` packs a folder that contains at least one `SKILL.md`. Run it from outside the clone. The clone contains a `skills` directory, and a pack folder created inside it is refused.

Place refuses a tampered file, a destination that already has files, and a folder that looks like a live agent home. A sibling is exempt when it is itself a Cortex brain: `manifest.json` format `cortex-pack-2`, a `BIRTH.md`, and no secret-shaped name. Finished brains can sit beside each other.

Birth verifies every file listed in the manifest, confirms STOP was read, and states that nothing starts itself. Growth proposes memory changes as notes with a From line. A human accepts or rejects each note.

## Commands

```bash
pip install -r requirements.txt
python scanner/pack_brain_test.py
node --check scripts/brain-query.mjs
node scripts/cortex-manifest.mjs --check scripts/fixtures/tiny-rig.manifest.json --glb scripts/fixtures/tiny-rig.glb
```

`requirements.txt` installs nothing. The Python code uses the standard library only.

Pack and place from a folder outside the clone:

```bash
python cortex_pack.py <skills-folder>
python scanner/pack_brain.py --home <home> --out <pack>
python scanner/pack_brain.py --pack <pack> --dest <empty-folder>
```

## Tests

- Packer tests are Python unittest in `scanner/pack_brain_test.py`. Run that file directly. CI does this after `pip install -r requirements.txt`.
- The query script is syntax-checked with `node --check scripts/brain-query.mjs`. CI does not execute it against a live brain.
- `scripts/cortex-manifest.mjs --check` is a release gate. It exits non-zero when `scripts/fixtures/tiny-rig.manifest.json` does not match the bytes of `scripts/fixtures/tiny-rig.glb`. That fixture is a synthetic skeleton. It is not a character model.
- Do not print secret fixtures' raw keys in new output. Existing tests assert that `sk-` material is redacted and does not appear in pack output. Keep new output the same way.

## Boundaries

The public repo stays the format.

Do not add VR, GLB models, SSH keys, Hermes homes, or headset code. Do not commit `cortana.glb`.

VR, Cortana, orbs, SSH, and Grok Build drops are local runtime. They belong to the other tree. They must not be added to the public repo.

Do not put a credential, a host, or a shell into a file this format writes for another agent. The packer redacts secrets and records checksums. A person still accepts or rejects growth.
