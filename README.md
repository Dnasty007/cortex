# Cortex

Cortex is a portable brain format for AI agents — a folder any model can load cold that carries skills, memory, safety rules, and a growth loop where only a human approves changes.

Every agent session today starts from zero, and switching providers means re-explaining everything. Cortex makes the brain the artifact, not the conversation.

Build packs a source folder into a sealed or portable brain with SHA-256 checksums and redacted secrets. Birth is the first-load ritual: the receiving agent verifies every file listed in the manifest, confirms STOP was read, and states that nothing starts itself. Growth lets the agent propose memory changes as notes with a From line. A human accepts or rejects each note, so the brain compounds without anyone hand-editing the memory files.

`cortex_pack.py` builds a portable unsealed pack you can hand to anyone. Place will not install that pack. `scanner/pack_brain.py` builds a sealed pack that passes the Place installer. Place refuses a tampered file, a destination that already has files, and a folder that looks like a live agent home. A sibling is exempt when it is itself a Cortex brain: `manifest.json` format `cortex-pack-2`, a `BIRTH.md`, and no secret-shaped name. Finished brains can sit beside each other.

```bat
python cortex_pack.py <skills-folder>
python scanner/pack_brain.py --home <home> --out <pack>
python scanner/pack_brain.py --pack <pack> --dest <empty-folder>
```

Cortex is for teams running agents across Claude, Grok, Kimi, and others who need one shared source of truth. It is for robotics builders who want a robot's learned state to transfer between machines. It is for anyone who treats an agent's memory as something worth versioning.

`cortex-spec-1` is frozen at tag `cortex-spec-1` on main. It survived cold reads from Claude, Grok, Hermes, and Kimi K2 — twenty-two gaps found and resolved across multiple rounds. The open-questions section lists the remaining known limitations honestly rather than hiding them.

The canonical document is [CORTEX-SPEC.md](CORTEX-SPEC.md). `scanner/pack_brain.py` is the sealed builder and installer. `cortex_pack.py` is the portable builder. [scripts/brain-query.mjs](scripts/brain-query.mjs) lists paths and headers from a brain without printing file bodies. A sealed pack also writes that script at the brain root. The tests include [scanner/pack_brain_test.py](scanner/pack_brain_test.py). The Windows desktop app is a separate surface: a Three.js view of a brain for people who want to see it. `npm install` then `npm run dev` opens it at http://localhost:5173.

Contributions and issues go through the spec first. The format is the contract, and code follows it.

Copyright Ray. All rights reserved. See [LICENSE](LICENSE).
