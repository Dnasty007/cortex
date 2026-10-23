import { hasContact, packReview } from '../src/pack.js'

let failed = 0
function assert(condition, message) {
  if (!condition) {
    failed += 1
    console.error('FAIL', message)
  } else {
    console.log('ok', message)
  }
}

const now = new Date('2026-10-23T00:30:00Z')

const fresh = packReview({
  source: { scanned_at: '2026-10-23 00:10 UTC' },
  lobes: [
    { id: 'skills' },
    { id: 'user' },
    { id: 'soul' },
    { id: 'memory' },
    { id: 'sessions' },
    { id: 'vault' },
    { id: 'jobs' },
  ],
  neurons: [
    { id: 'skill:a', lobe: 'skills', kind: 'skill', name: 'scan', summary: 'Read a folder.', body: '' },
    { id: 'user:1', lobe: 'user', kind: 'memory', name: 'Ray', summary: 'Call ray@example.com about the door.', body: '' },
    { id: 'soul:main', lobe: 'soul', kind: 'soul', name: 'SOUL', summary: 'Plain voice.', body: 'No secrets in this line.' },
    { id: 'memory:1', lobe: 'memory', kind: 'memory', name: 'note', summary: 'The office line is 215-555-0100.', body: '' },
    { id: 'session:1', lobe: 'sessions', kind: 'session', name: 'chat', summary: 'Index only.', body: '' },
    { id: 'vault:1', lobe: 'vault', kind: 'vault', name: 'Vault', summary: 'Not scanned.', body: '' },
    { id: 'job:1', lobe: 'jobs', kind: 'job', name: 'nightly', summary: 'Cron.', body: '' },
  ],
}, now)

assert(fresh.stale === false, 'a scan from this hour is fresh')
assert(fresh.marks.skills.mark === 'review', 'a fresh skill lobe stays a review')
assert(fresh.marks.user.mark === 'hold', 'user holds when an email is in the text')
assert(!fresh.marks.user.reason.includes('ray@example.com'), 'the hold does not repeat the email')
assert(fresh.marks.memory.mark === 'hold', 'memory holds when a phone is in the text')
assert(!fresh.marks.memory.reason.includes('215'), 'the hold does not repeat the phone')
assert(fresh.marks.soul.mark === 'review', 'a preview does not clear the soul')
assert(fresh.marks.soul.reason.includes('cannot clear'), 'the badge says the preview cannot clear the file')
assert(fresh.marks.sessions.mark === 'stay', 'sessions stay')
assert(fresh.marks.vault.mark === 'stay', 'vault stays')
assert(fresh.marks.jobs.mark === 'out', 'jobs are outside the pack')

const old = packReview({
  source: { scanned_at: '2026-10-19 21:44 UTC' },
  neurons: [
    { id: 'skill:a', lobe: 'skills', kind: 'skill', name: 'scan', summary: 'Read a folder.', body: '' },
  ],
}, now)
assert(old.stale === true, 'a four-day scan is stale')
assert(old.marks.skills.mark === 'hold', 'a stale skill lobe is held')

assert(hasContact({ name: 'Model pin', summary: '', body: 'Secret values in config were not loaded.' }) === false, 'the model pin note is not a contact')
assert(hasContact({ name: 'line', summary: '', body: '215-555-0199' }) === true, 'a dashed phone is a contact')

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('pack ok')
