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
kept: growth/kept.md
stop: STOP.json
manifest: manifest.json
birth: BIRTH.md
grow: GROW.md

layout.notes: Each skill copy is only SKILL.md. Files beside a skill stay in the source. memory files are copied only when the source folder has them. cortex_pack.py packs skills from the folder it is given.

## header

fence_open: :::cortex
fence_close: :::
applies_to: every text file in the brain
json_key: cortex
fields: type, skill, brain-region, version, date, dependencies
type: skill, memory, growth, growth-index, soul, rule, stop, ask, guide, gate, query, or file
skill: skill name, or empty
brain-region: temporal-l, temporal-r, frontal-l, frontal-r, parietal-l, parietal-r, occipital, corpus, cerebellum, or brainstem
version: 1
date: YYYY-MM-DD
dependencies: comma-separated skill names in a text header. A JSON array under cortex.dependencies. Empty when there are none.

header.regions: memories/MEMORY.md is temporal-l. memories/USER.md is temporal-r. A growth note is temporal-l. A skill is frontal-l or frontal-r. Categories are sorted. Even indexes are frontal-l. Odd indexes are frontal-r. SOUL.md, CLAUDE.md, and AGENTS.md are corpus. STOP.json, ASK.json, BIRTH.md, and GROW.md are brainstem.

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
manifest_checksum: none. The manifest is the index. It is not listed inside itself.

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
portable.pack: unsealed. Checksums and headers. No pattern_sha256. No contract.
portable.place: refused. Place will not install this pack.
sealed: scanner/pack_brain.py
sealed.pack: adds pattern_sha256 and contract so the pack passes Place install checks
sealed.place: accepted
query: brain-query.mjs
query.packs: portable or sealed. Readers use brain-query.mjs on either.

## growth

id: 8 lowercase hex characters
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
fields: last_grok, itch, last_awake
last_grok: string. The last recorded Grok job id. Not a live session.
itch: string. The open itch id.
last_awake: string. UTC time YYYY-MM-DDTHH:MM:SSZ.
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
stop.read_order: Read STOP.json, then BIRTH.md, then the soul, the memory, and the skills.
redaction.secret: api keys, secrets, passwords, tokens, bearer tokens, private keys, and known key prefixes are replaced with [redacted]
redaction.email: replaced with [email]
redaction.phone: replaced with [phone]
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
