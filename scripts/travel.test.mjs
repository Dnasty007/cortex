import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addProposal, acceptProposal, approvePointer, dropIpSites, listQueue, rejectProposal, upsertPointers } from '../src/queues.js'
import { bitwardenPointers, lessonBundle, travelAnswer } from '../src/travel.js'
import { storeZip } from '../src/zip-store.js'

let failed = 0
function assert(condition, message) {
  if (!condition) {
    failed += 1
    console.error('FAIL', message)
  } else {
    console.log('ok', message)
  }
}

const brain = {
  source: { label: 'Sample', host: 'secret-host', home: '/secret/home', scanned_at: '2026-10-23T00:00:00Z' },
  neurons: [
    { id: 'skill:desk', name: 'Desk note', lobe: 'skills', kind: 'skill', summary: 'Buildium desk', body: 'Call 2675551212\nUse the skill.\ntoken=abc' },
    { id: 'job:daily', name: 'Daily', lobe: 'jobs', kind: 'job', summary: 'cron', body: 'full job text' },
    { id: 'mem:one', name: 'Note', lobe: 'memory', kind: 'memory', summary: 'a note', body: 'Remember the door.' },
  ],
}

const list = travelAnswer(brain, { q: 'buildium' })
assert(list.status === 200, 'search answers')
assert(list.body.hits.length === 1, 'search finds the skill')
assert(list.body.hits[0].id === 'skill:desk', 'search returns the skill id')
assert(!JSON.stringify(list.body).includes('secret-host'), 'search hides the host')
assert(!JSON.stringify(list.body).includes('/secret/home'), 'search hides the home path')

const skill = travelAnswer(brain, { id: 'skill:desk' })
assert(skill.body.neuron.body_open === true, 'a skill body opens')
assert(skill.body.neuron.body.includes('[held]'), 'a phone and a token are held')
assert(skill.body.neuron.body.includes('Use the skill.'), 'the rest of the skill stays')

const job = travelAnswer(brain, { id: 'job:daily' })
assert(job.body.neuron.body_open === false, 'a job body stays closed')
assert(job.body.neuron.body === '', 'job text is not copied')
assert(job.body.neuron.name === 'Daily', 'the job name is visible')

const missing = travelAnswer(brain, { id: 'nope' })
assert(missing.status === 404, 'a missing id is a miss')

const mixed = {
  source: { label: 'Sample', host: 'secret-host', home: '/secret/home', scanned_at: '2026-10-23T00:00:00Z' },
  neurons: [
    { id: 'profile:other', name: 'Buildium other bot', lobe: 'profiles', kind: 'profile', summary: 'soul file', body: 'other soul' },
    { id: 'skill:profile-pack/other', name: 'Buildium copied soul', lobe: 'profiles', kind: 'skill', summary: 'copied', body: 'copied soul' },
    { id: 'job:daily', name: 'Buildium job', lobe: 'jobs', kind: 'job', summary: 'cron', body: 'full job text' },
    { id: 'skill:notes/zebra', name: 'Zebra note', lobe: 'skills', kind: 'skill', summary: 'later', body: 'short' },
    { id: 'skill:desk', name: 'Desk note', lobe: 'skills', kind: 'skill', category: 'productivity', summary: 'Buildium desk', body: 'short clip' },
  ],
}
const study = travelAnswer(mixed, { learn: '1', limit: '5' })
assert(study.body.study === true, 'learn mode is a study list')
assert(study.body.hits.every((hit) => hit.kind === 'skill' || hit.kind === 'memory'), 'the book is skills and memory')
const sameBook = travelAnswer(mixed, { for: 'grok-bot', limit: '5' })
assert(sameBook.body.hits.some((hit) => hit.id === 'skill:desk'), 'for=grok-bot is the same book')
const unchanged = travelAnswer(mixed, { for: 'grok-bot', since: '2026-10-23T00:00:00Z' })
assert(unchanged.body.total === 0, 'the same stamp means nothing new')
assert(unchanged.body.unchanged === true, 'the same stamp is flagged unchanged')
const pages = 'ABCDEFGH'.repeat(1000)
const firstPage = travelAnswer(mixed, { id: 'skill:desk', part: '1' }, { lessonFor: () => pages })
assert(firstPage.body.neuron.body.length === 4000, 'a part is one page')
assert(firstPage.body.next_part === 2, 'the first page names the next part')
assert(firstPage.body.neuron.truncated === true, 'a middle page is unfinished')
const past = travelAnswer(mixed, { id: 'skill:desk', part: '20' }, { lessonFor: () => pages })
assert(past.body.neuron.body === '', 'a part past the end is empty')
assert(past.body.neuron.truncated === false, 'a finished lesson is not truncated')
assert(past.body.next_part === null, 'a finished lesson has no next part')
const memoryBook = travelAnswer(mixed, { id: 'memory:book' }, {
  lessonFor(neuron) {
    return neuron.id === 'memory:book' ? 'Remember the door.\nNo secrets here.' : ''
  },
})
assert(memoryBook.body.neuron.lesson === true, 'memory opens as a book')
assert(memoryBook.body.chars > 10, 'memory is longer than the old clip')
assert(!study.body.hits.some((hit) => String(hit.id).includes('profile-pack')), 'learn mode skips other bots')
assert(study.body.hits.some((hit) => hit.id === 'skill:desk'), 'the desk skill is in the book')
assert(!study.body.hits.some((hit) => hit.id === 'skill:notes/zebra'), 'unrelated skills stay out of the Grok Bot book')
assert(study.body.hits.some((hit) => hit.id === 'memory:book'), 'the book includes memory')
assert(study.body.hits.some((hit) => hit.id === 'user:book'), 'the book includes the user note')

const ordered = travelAnswer(mixed, { q: 'buildium' })
assert(ordered.body.hits[0].id === 'skill:desk', 'a normal search lists the skill first')
assert(!ordered.body.hits.some((hit) => hit.kind === 'profile'), 'profiles stay out of a normal search')
assert(!ordered.body.hits.some((hit) => hit.kind === 'job'), 'jobs stay out of a normal search')
const profiles = travelAnswer(mixed, { lobe: 'profiles' })
assert(profiles.body.hits.some((hit) => hit.kind === 'profile'), 'a named profile lobe still opens')

const taught = travelAnswer(mixed, { id: 'skill:desk' }, {
  lessonFor(neuron) {
    assert(neuron.id === 'skill:desk', 'the lesson reader sees the skill')
    return 'Use the skill.\napi_key: hidden\nThen file the bill.'
  },
})
assert(taught.body.neuron.lesson === true, 'a library skill opens as a lesson')
assert(taught.body.neuron.body.includes('Use the skill.'), 'the lesson keeps the steps')
assert(taught.body.neuron.body.includes('Then file the bill.'), 'the lesson keeps the ending')
assert(taught.body.neuron.body.includes('[held]'), 'a key line in a lesson is held')
assert(!taught.body.neuron.body.includes('hidden'), 'the key line is not copied')
assert(taught.body.needs_bitwarden === true, 'a held key asks for Bitwarden')
assert(taught.body.held_lines === 1, 'the held line is counted')
assert(taught.body.bitwarden.length === 0, 'a key line with no login is not a vault item')
assert(!JSON.stringify(taught.body).includes('api_key'), 'the held line is not quoted')
const login = travelAnswer(mixed, { id: 'skill:desk' }, {
  lessonFor() {
    return 'Open https://secure.example.com/app user: desk.ray password: hunter2secret\nThen stop.'
  },
})
assert(login.body.bitwarden[0].site === 'secure.example.com', 'pointer keeps the site')
assert(login.body.bitwarden[0].username === 'desk.ray', 'pointer keeps the username')
assert(login.body.bitwarden[0].go === false, 'the vault write stays off')
assert(!JSON.stringify(login.body).includes('hunter2secret'), 'the secret is not in the pointer')
const bundle = lessonBundle(mixed, { lessonFor: () => 'Short lesson.' })
assert(bundle.files.some((file) => file.id === 'skill:desk'), 'the export book includes the desk skill')
assert(bundle.files.some((file) => file.id === 'memory:book'), 'the export book includes memory')
assert(!bundle.files.some((file) => file.id === 'job:daily'), 'the export book leaves jobs out')
const zip = storeZip([{ name: 'a.md', data: 'Use the skill.' }])
assert(zip.includes(Buffer.from('a.md')), 'the zip names the file')
assert(zip.includes(Buffer.from('Use the skill.')), 'the zip keeps the lesson')
const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-queue-'))
const queueFile = path.join(queueDir, 'queue.json')
const learnFile = path.join(queueDir, 'learn.json')
const stored = upsertPointers(queueFile, 'skill:desk', login.body.bitwarden)
assert(stored[0].go === false, 'a new pointer waits for Ray')
const again = upsertPointers(queueFile, 'skill:desk', login.body.bitwarden)
assert(again[0].id === stored[0].id, 'the same login is not queued twice')
const approved = approvePointer(queueFile, stored[0].id)
assert(approved.go === true && approved.wrote === false, 'approval does not write the vault')
const proposal = addProposal(learnFile, 'grok', 'Remember the side door.')
assert(proposal.status === 'pending', 'a lesson proposal starts pending')
const accepted = acceptProposal(learnFile, proposal.id)
assert(accepted.status === 'accepted' && accepted.already === false, 'accepting a note marks it accepted')
assert(accepted.text === 'Remember the side door.', 'the accepted note keeps its text')
const againAccept = acceptProposal(learnFile, proposal.id)
assert(againAccept.already === true, 'accepting twice does not write it again')
const pending = addProposal(learnFile, 'water', 'Close this note.')
const closed = rejectProposal(learnFile, pending.id)
assert(closed.status === 'closed', 'rejecting a note closes it')
const blank = upsertPointers(queueFile, 'skill:api', [{ site: 'api.buildium.com', username: '', go: false }])
const filled = upsertPointers(queueFile, 'skill:api', [{ site: 'api.buildium.com', username: 'BUILDIUM_CLIENT_ID', go: false }])
assert(filled[0].id === blank[0].id, 'a later username fills the blank pointer')
assert(filled[0].username === 'BUILDIUM_CLIENT_ID', 'the pointer keeps the name Hermes already wrote')
upsertPointers(queueFile, 'skill:bridge', [{ site: '203.0.113.10:8765', username: 'skip', go: false }])
dropIpSites(queueFile)
assert(!listQueue(queueFile).some((item) => String(item.site).includes('203.0.113')), 'an address number is not a vault site')
fs.rmSync(queueDir, { recursive: true, force: true })
assert(taught.body.chars > 20, 'chars is the lesson length')

const closedLesson = travelAnswer(mixed, { id: 'job:daily' }, {
  lessonFor() { return 'full job text that must not travel' },
})
assert(closedLesson.body.neuron.lesson === false, 'a job is not a lesson')
assert(closedLesson.body.neuron.body === '', 'job text is still not copied')

const remembered = travelAnswer(mixed, { id: 'memory:book' }, {
  lessonFor(neuron) {
    return neuron.id === 'memory:book' ? 'Remember the door.' : ''
  },
  acceptedMemory: () => 'From water\n\nThe meter is in the alley.',
})
assert(remembered.body.neuron.body.includes('Remember the door.'), 'accepted memory keeps the book')
assert(remembered.body.neuron.body.includes('The meter is in the alley.'), 'accepted memory is part of the book')

const desks = {
  source: { label: 'Sample', scanned_at: '2026-10-28 00:33 UTC' },
  neurons: [
    { id: 'profile:water:SOUL.md:1', name: 'SOUL', lobe: 'profiles', kind: 'memory', body: 'You are Water. Mail desk.ray@example.com and desk.ray@. See `@desk.example.com` and C:\\Users\\Pennl\\notes' },
    { id: 'profile:water:MEMORY.md:1', name: 'MEMORY', lobe: 'profiles', kind: 'memory', body: 'Water bills live here.' },
    { id: 'profile:water:USER.md:2', name: 'USER', lobe: 'profiles', kind: 'memory', body: 'Desk owner.' },
    { id: 'profile:water:USER.md:1', name: 'USER', lobe: 'profiles', kind: 'memory', body: 'First line.' },
    { id: 'skill:profile-pack/plre-water-bills', name: 'plre-water-bills', lobe: 'skills', kind: 'skill', path: 'profiles/jobs/skills/plre-water-bills/SKILL.md', summary: 'water', body: 'Read the bill. ~/.hermes/google_tokens/ray.json' },
    { id: 'skill:notes/zebra', name: 'Zebra', lobe: 'skills', kind: 'skill', summary: 'water application email', body: 'nope' },
    { id: 'skill:profile-pack/airtable', name: 'airtable', lobe: 'skills', kind: 'skill', path: 'profiles/water/skills/airtable/SKILL.md', summary: 'On applications, email, files, jobs, water.', body: 'shared' },
    { id: 'skill:email/email-inbox-triage', name: 'email-inbox-triage', lobe: 'skills', kind: 'skill', path: 'skills/email/email-inbox-triage/SKILL.md', summary: 'mail', body: 'triage' },
    { id: 'skill:productivity/plre-email-desk', name: 'plre-email-desk', lobe: 'skills', kind: 'skill', summary: 'desk', body: 'desk' },
    { id: 'skill:profile-pack/buildium-api-tenant-email', name: 'buildium-api-tenant-email', lobe: 'skills', kind: 'skill', summary: 'mail api', body: 'api' },
    { id: 'skill:productivity/philly-tax-rental-compliance', name: 'philly-tax-rental-compliance', lobe: 'skills', kind: 'skill', summary: 'eclipse', body: 'tax' },
    { id: 'skill:productivity/plre-city-door-audit', name: 'plre-city-door-audit', lobe: 'skills', kind: 'skill', summary: 'doors', body: 'doors' },
    { id: 'skill:productivity/plre-application-desk', name: 'plre-application-desk', lobe: 'skills', kind: 'skill', summary: 'apps', body: 'apps' },
    { id: 'skill:productivity/plre-buildium-desk-ops', name: 'plre-buildium-desk-ops', lobe: 'skills', kind: 'skill', summary: 'calendar', body: 'cal' },
    { id: 'skill:desk', name: 'Desk note', lobe: 'skills', kind: 'skill', summary: 'Buildium desk', body: 'short' },
  ],
}
const water = travelAnswer(desks, { for: 'water', limit: '20' })
assert(water.body.hits.map((hit) => hit.id).join(',') === 'soul:water,memory:water,user:water,lesson:cortex-plug-in:water,skill:profile-pack/plre-water-bills', 'water is its own book')
const waterSoul = travelAnswer(desks, { id: 'soul:water' })
assert(waterSoul.body.neuron.body.includes('You are Water.'), 'water soul opens')
assert(waterSoul.body.neuron.body.includes('[email]'), 'a mail address is covered')
assert(!waterSoul.body.neuron.body.includes('desk.ray'), 'the mail address is not copied')
assert(!waterSoul.body.neuron.body.includes('@'), 'a cut-off mail mark is covered')
assert(!waterSoul.body.neuron.body.includes('desk.example'), 'a sample mail mark is covered')
assert(waterSoul.body.neuron.body.includes('[path]'), 'a home path is covered')
const waterSkill = travelAnswer(desks, { id: 'skill:profile-pack/plre-water-bills' })
assert(waterSkill.body.neuron.body.includes('[path]'), 'a home token path is covered')
assert(!waterSkill.body.neuron.body.includes('.hermes'), 'the home path is not copied')
const plug = travelAnswer(desks, { id: 'lesson:cortex-plug-in:water' })
assert(plug.body.neuron.body.includes('GET /brain?for=water'), 'the plug-in card names the bot')
assert(!plug.body.neuron.body.includes('[held]'), 'the plug-in card stays readable')
const unknown = travelAnswer(desks, { for: 'nope', since: '2026-10-28 00:33 UTC' })
assert(unknown.status === 400, 'an unknown bot is refused')
assert(unknown.body.bots.join(',') === 'grok-bot,water,email,eclipse,applications,calendar', 'the refusal names the bots')
const email = travelAnswer(desks, { for: 'email', limit: '20' })
assert(email.body.hits.some((hit) => hit.name === 'email-inbox-triage'), 'email keeps its triage skill')
assert(email.body.hits.some((hit) => hit.name === 'buildium-api-tenant-email'), 'email keeps the tenant mail skill')
assert(!email.body.hits.some((hit) => hit.name === 'airtable' || hit.name === 'Zebra'), 'email does not take the shared dump')
const eclipse = travelAnswer(desks, { for: 'eclipse', limit: '20' })
assert(eclipse.body.hits.map((hit) => hit.name).sort().join(',') === 'cortex-plug-in.md,philly-tax-rental-compliance,plre-city-door-audit', 'eclipse is the renewal pair')
const applications = travelAnswer(desks, { for: 'applications', limit: '20' })
assert(applications.body.hits.some((hit) => hit.name === 'plre-application-desk'), 'applications keeps its desk')
assert(!applications.body.hits.some((hit) => hit.name === 'airtable'), 'applications skips the shared dump')
const calendar = travelAnswer(desks, { for: 'calendar', limit: '20' })
assert(calendar.body.hits.some((hit) => hit.name === 'plre-buildium-desk-ops'), 'calendar keeps the desk ops skill')
assert(!calendar.body.hits.some((hit) => hit.id === 'skill:desk'), 'calendar is not the whole Buildium book')
const stillGrok = travelAnswer(desks, { for: 'grok-bot', limit: '20' })
assert(stillGrok.body.hits.some((hit) => hit.id === 'skill:desk'), 'the Grok Bot book still has the desk skill')
assert(stillGrok.body.hits.some((hit) => hit.id === 'lesson:cortex-plug-in:grok-bot'), 'the Grok Bot book has the plug-in card')
assert(!stillGrok.body.hits.some((hit) => hit.name === 'Zebra'), 'the Grok Bot book stays curated')
const waterPack = lessonBundle(desks, { for: 'water', lessonFor: () => '' })
assert(waterPack.status === 200, 'a known bot exports')
assert(waterPack.files.some((file) => file.name === 'cortex-plug-in.md'), 'the export includes the plug-in card')
assert(!waterPack.files.some((file) => file.id === 'skill:notes/zebra'), 'the export stays on that bot')
const refused = lessonBundle(desks, { for: 'nope' })
assert(refused.status === 400, 'an unknown export is refused')
const named = travelAnswer(desks, { id: 'skill:desk' }, {
  lessonFor() {
    return 'BUILDIUM_CLIENT_ID, BUILDIUM_CLIENT_SECRET, BUILDIUM_API_BASE=https://api.buildium.com\nThen stop.'
  },
})
assert(named.body.bitwarden[0].site === 'api.buildium.com', 'the API pointer keeps the site')
assert(named.body.bitwarden[0].username === 'BUILDIUM_CLIENT_ID', 'the API pointer keeps the client name')
const repeated = bitwardenPointers([
  'BUILDIUM_CLIENT_ID, BUILDIUM_CLIENT_SECRET, BUILDIUM_API_BASE=https://api.buildium.com',
  'later',
  'later',
  'later',
  'later',
  'x-buildium-client-secret: $BUILDIUM_CLIENT_ID',
].join('\n'))
assert(repeated.length === 1 && repeated[0].site === 'api.buildium.com', 'a later name does not add a second pointer')
assert(!JSON.stringify(named.body).includes('CLIENT_SECRET'), 'the client secret name is not copied')
const machine = travelAnswer(desks, { id: 'skill:desk' }, {
  lessonFor() {
    return 'Open https://203.0.113.10:8765/jobs/next token=abc machine **Hermes** Bitwarden org\nThen stop.'
  },
})
assert(machine.body.bitwarden[0].site === 'vault.bitwarden.com', 'a number host is not the vault site')
assert(machine.body.bitwarden[0].username === 'Hermes', 'the machine name is the username')
assert(!JSON.stringify(machine.body).includes('203.0.113.10'), 'the number host is not copied')

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('travel tests passed')
