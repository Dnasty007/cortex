import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseAsk, queryBrain, regionHit } from './brain-query.mjs'

let failed = 0
function assert(condition, message) {
  if (!condition) {
    failed += 1
    console.error('FAIL', message)
  } else {
    console.log('ok', message)
  }
}

function header(fields) {
  return [
    ':::cortex',
    `type: ${fields.type}`,
    `skill: ${fields.skill || ''}`,
    `brain-region: ${fields.region}`,
    'version: 1',
    `date: ${fields.date}`,
    `dependencies: ${(fields.dependencies || []).join(', ')}`,
    ':::',
    '',
  ].join('\n')
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-query-'))
try {
  const parsed = parseAsk('show me everything in temporal updated after 2026-10-01')
  assert(parsed.region === 'temporal' && parsed.after === '2026-10-01', 'the example sentence names temporal and the date')
  assert(regionHit('temporal-l', 'temporal') && regionHit('temporal-r', 'temporal'), 'temporal matches both sides')
  assert(!regionHit('frontal-l', 'temporal'), 'frontal is not temporal')

  fs.mkdirSync(path.join(root, 'memories'), { recursive: true })
  fs.mkdirSync(path.join(root, 'skills', 'general', 'demo'), { recursive: true })
  fs.mkdirSync(path.join(root, 'growth', 'pending'), { recursive: true })
  fs.mkdirSync(path.join(root, 'growth', 'accepted'), { recursive: true })
  fs.writeFileSync(path.join(root, 'memories', 'MEMORY.md'), `${header({ type: 'memory', region: 'temporal-l', date: '2026-10-28' })}The work continues.\n`)
  fs.writeFileSync(path.join(root, 'memories', 'USER.md'), `${header({ type: 'memory', region: 'temporal-r', date: '2026-10-01' })}A person.\n`)
  fs.writeFileSync(path.join(root, 'skills', 'general', 'demo', 'SKILL.md'), `${header({ type: 'skill', skill: 'demo', region: 'frontal-l', date: '2026-10-28', dependencies: ['other'] })}Use the desk.\n`)
  fs.writeFileSync(path.join(root, 'growth', 'pending', 'abcd1234.md'), `${header({ type: 'growth', region: 'temporal-l', date: '2026-09-15' })}From: ai\n\nOld note.\n`)
  fs.writeFileSync(path.join(root, 'growth', 'accepted', '1234abcd.md'), `${header({ type: 'growth', region: 'temporal-l', date: '2026-10-20' })}From: ai\n\nKept note.\n`)
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    format: 'cortex-pack-2',
    files: [
      { path: 'memories/MEMORY.md', type: 'memory', skill: '', 'brain-region': 'temporal-l', version: '1', date: '2026-10-28', dependencies: [] },
      { path: 'memories/USER.md', type: 'memory', skill: '', 'brain-region': 'temporal-r', version: '1', date: '2026-10-01', dependencies: [] },
      { path: 'skills/general/demo/SKILL.md', type: 'skill', skill: 'demo', 'brain-region': 'frontal-l', version: '1', date: '2026-10-28', dependencies: ['other'] },
    ],
    growth: { pending: [], accepted: [] },
  }))

  const listed = queryBrain(root, 'show me everything in temporal updated after 2026-10-01')
  const paths = listed.files.map((item) => item.path)
  assert(paths.includes('memories/MEMORY.md'), 'a later temporal memory is listed')
  assert(paths.includes('growth/accepted/1234abcd.md'), 'a later accepted note is listed')
  assert(!paths.includes('memories/USER.md'), 'a file dated on the cutoff stays out')
  assert(!paths.includes('growth/pending/abcd1234.md'), 'an older pending note stays out')
  assert(!paths.includes('skills/general/demo/SKILL.md'), 'a frontal skill stays out of a temporal ask')
  assert(listed.files.every((item) => item.sha256 && item.sha256.length === 64), 'each row has a sha256')
  assert(!JSON.stringify(listed).includes('The work continues'), 'the list does not include a file body')
  const skill = queryBrain(root, { region: 'frontal-l', after: '2026-10-01' }).files[0]
  assert(skill && skill.skill === 'demo' && skill.dependencies[0] === 'other', 'a skill row keeps its name and dependencies')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('brain-query tests passed')
