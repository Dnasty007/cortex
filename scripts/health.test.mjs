import { applyHealth } from '../src/health.js'

let failed = 0
function assert(condition, message) {
  if (!condition) {
    failed += 1
    console.error('FAIL', message)
  } else {
    console.log('ok', message)
  }
}

function brain(neurons) {
  return applyHealth({ neurons })
}

const copies = brain([
  { id: 'skill:a', name: 'scan', kind: 'skill', lobe: 'skills', copies: ['alpha', 'beta'], summary: '', body: '' },
])
assert(copies.neurons[0].health.some((item) => item.code === 'copy'), 'two profiles mark a copy')

const summaryCopy = brain([
  { id: 'skill:b', name: 'pack', kind: 'skill', lobe: 'skills', summary: 'On alpha, beta. Extra notes.', body: '' },
])
assert(summaryCopy.neurons[0].health.some((item) => item.code === 'copy'), 'older scans still mark copied skills')

const missing = brain([
  {
    id: 'job:1',
    name: 'nightly',
    kind: 'job',
    lobe: 'jobs',
    body: 'Skills: ghost-skill\nStatus: scheduled',
  },
  { id: 'skill:real', name: 'present', kind: 'skill', lobe: 'skills', summary: '', body: '' },
])
assert(missing.neurons[0].health.some((item) => item.code === 'missing'), 'a job skill that is absent gets marked')
assert(missing.health.missing === 1, 'one missing mark')

const present = brain([
  { id: 'job:2', name: 'day', kind: 'job', lobe: 'jobs', body: 'Skills: present' },
  { id: 'skill:real', name: 'present', kind: 'skill', lobe: 'skills', summary: '', body: '' },
])
assert(present.health.missing === 0, 'a job skill that exists stays clear')

const conflict = brain([
  { id: 'user:1', name: 'USER', kind: 'memory', lobe: 'user', body: 'Do not restart the gateway during the day.' },
  { id: 'memory:1', name: 'note', kind: 'memory', lobe: 'memory', body: 'Always restart the gateway during the day.' },
  { id: 'memory:2', name: 'other', kind: 'memory', lobe: 'memory', body: 'Do not restart telegram during the day.' },
])
assert(conflict.neurons[1].health.some((item) => item.code === 'conflict'), 'opposite gateway rules conflict')
assert(!conflict.neurons[2].health.some((item) => item.code === 'conflict'), 'a different target does not conflict')

const secret = brain([
  { id: 'memory:3', name: 'leak', kind: 'memory', lobe: 'memory', body: 'The line was [redacted] in the scan.' },
  { id: 'model:pin', name: 'Model pin', kind: 'model', lobe: 'model', body: 'Secret values in config were not loaded.' },
])
assert(secret.neurons[0].health.some((item) => item.code === 'secret'), 'redacted text is marked')
assert(!secret.neurons[0].health.some((item) => /sk-|\[redacted\]/.test(item.text) && item.text.includes('sk-')), 'the mark does not repeat a key')
assert(secret.neurons[1].health.length === 0, 'the model pin note is not a secret')

const live = brain([
  { id: 'memory:4', name: 'raw', kind: 'memory', lobe: 'memory', body: 'token: abcdefghijklmnop' },
])
assert(live.neurons[0].health[0].code === 'secret', 'a leftover token shape is marked')
assert(!live.neurons[0].health[0].text.includes('abcdefghijklmnop'), 'the mark hides the token')

const crowdNeurons = [{ id: 'profile:main', name: 'main', kind: 'profile', lobe: 'profiles', body: '' }]
for (let i = 0; i < 90; i++) {
  crowdNeurons.push({ id: `profile:main:mem:${i}`, name: `m${i}`, kind: 'memory', lobe: 'profiles', body: 'A plain note about the work today.' })
}
const crowd = brain(crowdNeurons)
assert(crowd.neurons[0].health.some((item) => item.code === 'crowd'), 'a crowded profile hub is marked')
assert(crowd.health.crowd === 1, 'the memories inside the lobe are not all painted')

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('health ok')
