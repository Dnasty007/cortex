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
growth_dirs: growth/pending, growth/accepted, and growth/closed
growth_dirs.present: all three directories are always present in a pack
growth_dirs.creator: both builders create them if they are absent
growth_dirs.birth: empty at birth. Neither builder writes notes into them. The receiving agent writes the notes.
kept: growth/kept.md
stop: STOP.json
ask: ASK.json
ask.path: the brain root
ask.optional: ASK.json is the canonical store of questions. The agent reads ASK.json. ASK.md is not required for loading.
manifest: manifest.json
birth: BIRTH.md
birth.path: the brain root
birth.role: the birth ritual
birth.first_load: verify every sha256 in manifest.files[] against the actual file bytes on disk, confirm STOP.json was read, and state that nothing starts itself. The manifest itself has no self-checksum and is not verified.
grow: GROW.md
grow.path: the brain root
grow.role: growth instructions
grow.rule: all memory changes go through growth/pending as notes with a From line. Never edit memories/MEMORY.md directly. Only a human accepts or rejects.
handoff: HERMES-HANDOFF.md
handoff.path: the brain root
handoff.optional: only present when the source agent had a handoff file
handoff.region: brainstem
handoff.header: a cortex header
ask_text: ASK.md
ask_text.role: a human-readable rendering of the questions in ASK.json, for display. scanner/pack_brain.py writes this file. cortex_pack.py does not write ASK.md. The read order names ASK.json only.
start: START.md
start.role: how to point the agent at this folder. scanner/pack_brain.py writes this file. cortex_pack.py does not.
install: INSTALL.txt
install.role: the install note. Place copies it beside the brain. scanner/pack_brain.py writes this file. cortex_pack.py does not.
query_script: brain-query.mjs
query_script.role: lists paths and headers. It does not print file bodies. scanner/pack_brain.py writes this file. cortex_pack.py does not.

layout.notes: Each skill copy is only SKILL.md. Files beside a skill stay in the source. memory files are copied only when the source folder has them. cortex_pack.py packs skills from the folder it is given. scanner/pack_brain.py may also write ASK.md, START.md, INSTALL.txt, and brain-query.mjs.

## header

fence_open: :::cortex
fence_close: :::
applies_to: every text file in the brain
json_key: cortex
fields: type, skill, brain-region, version, date, dependencies
type: skill, memory, growth, growth-index, soul, rule, stop, ask, guide, gate, query, or file
skill: the skill name on a skill file. An empty string on every non-skill file.
empty.skill: an empty skill field is the line `skill: ` with one trailing space. That trailing space means the field is present and empty. A missing skill line means the field is absent.
empty.dependencies: an empty dependencies field is the line `dependencies: ` with one trailing space. That trailing space means the field is present and empty. A missing dependencies line means the field is absent.
brain-region: temporal-l, temporal-r, frontal-l, frontal-r, parietal-l, parietal-r, occipital, corpus, cerebellum, or brainstem
version: 1
date: YYYY-MM-DD
dependencies: comma-separated skill names in a text header. A JSON array under cortex.dependencies. Empty when there are none.

frontmatter.order: if YAML frontmatter is present, that block starts on line one. The cortex fence comes after its closing ---. If a file has no frontmatter, the cortex fence may open on line one. The packer places it after the first line when that line has to stay first.

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

contract: a string on a sealed pack. The SHA-256 hex digest of the contract body. A portable pack omits it.
contract.body: one JSON object, serialized with keys sorted, separators comma and colon, and non-ASCII kept as characters. No trailing newline.
contract.body.keys: files, home, jobs_left_behind, pattern_sha256, read
contract.files: each manifest.files entry contributes path, bytes, and sha256 only, in the order those entries already have. The list is not sorted again.
contract.home: manifest.home
contract.jobs_left_behind: manifest.jobs_left_behind, or 0 when that value is missing
contract.read: manifest.read
pattern_sha256: the SHA-256 hex digest of the canonical pattern list. It is an input inside the contract body. It is not a hash of the contract body.
contract.same: two sealed packs match when their file order, path, bytes, sha256, home, jobs_left_behind, pattern_sha256, and read match. Place rejects a contract string that is not the digest of that body.
contract.growth: the contract body does not include the growth lists. Rewriting those lists does not change the contract.

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

## inputs

portable.source: a folder of SKILL.md files
sealed.source: an agent home
generated: STOP.json, BIRTH.md, and GROW.md
generated.by: cortex_pack.py and scanner/pack_brain.py
generated.rule: both packers write these three files into the pack. They do not read them from the source. A missing source copy is not an error. Neither packer fails for that, and neither packer names a missing file.

## pattern lock

tool: scanner/pack_brain.py
required: before a build or an install
path: ~/.cortex/pattern.lock
override: the CORTEX_PATTERN_LOCK environment variable, when it is set, replaces that path
line: one line. The SHA-256 hex digest of the canonical pattern list.
pattern_list: the secret pattern, the email pattern, and the phone pattern in scanner/pack_brain.py, joined by newlines
missing: the program exits with an error that names the lock path
mismatch: the program exits with an error that names the lock path
init: python scanner/pack_brain.py --init-lock
init.writes: the hash of the pattern list in this repo, at the lock path
init.present: if that file already holds the same hash, it is left in place. If it holds a different hash, the program exits and does not overwrite it.
issuer: Ray issues the lock for his machines
public.reference: the hash --init-lock writes from this repo. That hash is the public reference.
portable: cortex_pack.py does not read the pattern lock

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
growth.mutable: after a pack is sealed, growth/pending, growth/accepted, and growth/closed may change
growth.dirs: both builders create empty growth/pending, growth/accepted, and growth/closed if they are absent. Neither builder writes notes into them. Place creates the same three directories if they are absent.
growth.create: the receiving agent writes the notes. The builder does not.
manifest.snapshot: manifest.files[] is the snapshot taken at build time. Each sha256 is the file bytes at that build. Growth does not rewrite those rows.
manifest.growth: when Cortex saves, accepts, or rejects a note, it rewrites manifest.growth.pending and manifest.growth.accepted. It does not list growth/closed. That rewrite does not change the contract body.
checksum.scope: the checksum check covers the files that were in the pack at build time
checksum.install: Place checks every packed file. If any file's bytes do not match its manifest sha256, Place refuses the install and writes nothing. It does not skip the file and continue.

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
stop.schema: a JSON object
stop.keys: cortex, do_not_schedule, for, format, gate, held, holes, jobs_left_behind, loader, refuse, rules_only, stops_tools
stop.cortex: an object with type, skill, brain-region, version, date, and dependencies
stop.gate: an object with file, binds, and does_not
stop.refuse: the instruction string to the agent. There is no message key.
stop.effect: STOP.json does not stop a send, a push, or a delete. It does not stop a tool. The refuse string tells the agent to stop and ask first.
stop.read_order: Read STOP.json, then ASK.json, then BIRTH.md, then GROW.md, then HERMES-HANDOFF.md, then the soul files, then the memory files, then the skills. ASK.json is optional. HERMES-HANDOFF.md is optional and is present only when the source agent had a handoff file.
read.ask: immediately after STOP.json. The read order names ASK.json only. ASK.md is not part of loading.
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
