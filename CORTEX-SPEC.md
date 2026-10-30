# CORTEX-SPEC

format: cortex-spec-1
reader: any AI agent loading a Cortex brain
writer: cortex_pack.py or scanner/pack_brain.py

## layout

root: the brain folder
skills: skills/<category>/<name>/SKILL.md
memory: memories/MEMORY.md and memories/USER.md
jobs: absent. Job files stay in the source. A pack must not contain a jobs directory.
profiles: absent. Profile files stay in the source. A profiles directory marks a live Hermes home.
growth_pending: growth/pending/<id>.md
growth_accepted: growth/accepted/<id>.md
growth_closed: growth/closed/<id>.md
growth_closed.use: rejected notes
kept: growth/kept.md
stop: STOP.json
ask: ASK.json
ask.path: the brain root
ask.optional: holds questions the agent should ask the human before acting
manifest: manifest.json
birth: BIRTH.md
birth.path: the brain root
birth.role: the birth ritual
birth.first_load: verify the manifest checksums, confirm STOP.json was read, and state that nothing starts itself
grow: GROW.md
grow.path: the brain root
grow.role: growth instructions
grow.rule: all memory changes go through growth/pending as notes with a From line. Never edit memories/MEMORY.md directly. Only a human accepts or rejects.
handoff: HERMES-HANDOFF.md
handoff.path: the brain root
handoff.optional: only present when the source agent had a handoff file
handoff.region: brainstem
handoff.header: a cortex header

layout.notes: Each skill copy is only SKILL.md. Files beside a skill stay in the source. memory files are copied only when the source folder has them. cortex_pack.py packs skills from the folder it is given.

## header

fence_open: :::cortex
fence_close: :::
applies_to: every text file in the brain
json_key: cortex
fields: type, skill, brain-region, version, date, dependencies
type: skill, memory, growth, growth-index, soul, rule, stop, ask, guide, gate, query, or file
skill: the skill name on a skill file. An empty string on every non-skill file.
brain-region: temporal-l, temporal-r, frontal-l, frontal-r, parietal-l, parietal-r, occipital, corpus, cerebellum, or brainstem
version: 1
date: YYYY-MM-DD
dependencies: comma-separated skill names in a text header. A JSON array under cortex.dependencies. Empty when there are none.

header.regions: memories/MEMORY.md is temporal-l. memories/USER.md is temporal-r. A growth note is temporal-l. A skill is frontal-l or frontal-r. Categories are sorted. The category index is zero-based. Even indexes are frontal-l. Odd indexes are frontal-r. SOUL.md, CLAUDE.md, and AGENTS.md are corpus. STOP.json, ASK.json, BIRTH.md, GROW.md, and HERMES-HANDOFF.md are brainstem.

header.example:

:::cortex
type: skill
skill: demo
brain-region: frontal-l
version: 1
date: 2026-10-28
dependencies: other
:::

header.json_example:

{"cortex": {"type": "stop", "skill": "", "brain-region": "brainstem", "version": "1", "date": "2026-10-28", "dependencies": []}}

## manifest

file: manifest.json
format: cortex-pack-2
checksum: sha256 of the file bytes, lowercase hex, 64 characters
manifest_checksum: none. The manifest is the index.
manifest.self: manifest.json does not list itself.

neuron: any entry in manifest.files is one neuron. That includes a skill, a memory file, a growth note, a soul file, a brainstem file, and HERMES-HANDOFF.md when that file is present.
manifest.files[]: path, bytes, sha256, redactions, type, skill, brain-region, version, date, dependencies
manifest.regions[]: id, files
manifest.skills[]: name, path, sha256, brain-region, version, date, dependencies, description
manifest.growth.pending[]: path, bytes, sha256, type, skill, brain-region, version, date, dependencies
manifest.growth.accepted[]: path, bytes, sha256, type, skill, brain-region, version, date, dependencies
manifest.jobs: []
manifest.profiles: []

manifest.notes: description is the skill description after redaction, clipped to 200 characters. Which extra manifest fields exist depends on the builder. See builders.

## builders

portable: cortex_pack.py
portable.role: builder only. It does not install.
portable.command: python cortex_pack.py <skills-folder>
portable.pack: unsealed. Checksums and headers. No pattern_sha256. No contract.
portable.place: refused. Place will not install this pack.
sealed: scanner/pack_brain.py
sealed.role: sealed builder and installer
sealed.build: python scanner/pack_brain.py --home <home> --out <pack>
sealed.pack: adds pattern_sha256 and contract so the pack passes Place install checks
place: python scanner/pack_brain.py --pack <pack> --dest <empty-folder>
place.dest: the destination must be empty
sealed.place: accepted when the destination is empty and the pack is sealed
query: brain-query.mjs
query.packs: portable or sealed. Readers use brain-query.mjs on either.

## query

tool: brain-query.mjs
query.region: a region name without a suffix matches every region with that prefix. temporal matches temporal-l and temporal-r. frontal matches frontal-l and frontal-r. The same rule applies to the other region names.
query.exact: a full region id, such as temporal-l, matches only that id.

## growth

id: eight lowercase hex characters
id.format: 8 characters from 0-9 and a-f
id.length: 8
one_note: one file
pending_body: a cortex header, then the line From: <who>, then a blank line, then the note
pending_path: growth/pending/<id>.md
accept: a person accepts the note in Cortex. The file moves to growth/accepted/<id>.md. The id is appended once to growth/kept.md.
reject: the file moves to growth/closed/<id>.md. It is not added to growth/kept.md.
agent_accept: refused. The receiving agent cannot accept its own note.
memory_file: do not edit memories/MEMORY.md to grow. Write a pending note instead.
kept_header: growth/kept.md starts with a cortex header. The line under it is "Kept notes, in order. Read each file under growth/accepted/." Then one id per line.

## handoff

file: HERMES-HANDOFF.md
source: the Hermes handoff file read by Cortex
path: the brain root
header: a cortex header
brain-region: brainstem
fields: last_grok, itch, last_awake
last_grok: string. The last Grok job id that touched the brain. Not a live session.
itch: string. The open itch id.
last_awake: string. The UTC timestamp the source agent last ran. Format YYYY-MM-DDTHH:MM:SSZ.
lines_after: standing rules may follow the three fields. They are not extra keys.

handoff.example:

last_grok: cortex-explain-001
itch: cortex-unique-001
last_awake: 2026-10-18T08:26:00Z

## safety

stop.format: cortex-stop-1
stop.loader: false
stop.stops_tools: false
stop.effect: STOP.json does not stop a send, a push, or a delete. It does not stop a tool. It tells the agent to stop and ask first.
stop.read_order: Read STOP.json, then ASK.json, then BIRTH.md, then GROW.md, then HERMES-HANDOFF.md, then the soul files, then the memory files, then the skills. ASK.json is optional. HERMES-HANDOFF.md is optional and is present only when the source agent had a handoff file.
read.ask: immediately after STOP.json. It holds questions the agent should ask the human before acting.
read.soul: soul files sorted alphabetically. AGENTS.md, then CLAUDE.md, then SOUL.md, for the files that are present.
read.memory: memories/MEMORY.md before memories/USER.md.
redaction.secret: api keys, secrets, passwords, tokens, bearer tokens, private keys, and known key prefixes are replaced with `[redacted]`
redaction.email: replaced with `[email]`
redaction.phone: replaced with `[phone]`
redaction.names: a file name that matches those patterns is not copied as itself
redaction.proof: a clean pattern match is not proof that every secret was found
refuse.live: do not install into a folder that already looks like an agent home
refuse.inside: do not install into a folder inside a live agent home
refuse.beside: do not install into a folder beside a live agent home
refuse.empty: the destination must be empty
refuse.root: do not use a drive root
live.markers: SOUL.md, memories/USER.md, memories/MEMORY.md, CLAUDE.md, AGENTS.md, a skills directory, config.yaml, a profiles directory, .claude, .cursor, .agents, .hermes, or a secret-shaped file name
source: read only. The source folder is not modified.
start: nothing in the pack starts itself
