import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acceptPending, addPending, isBirthFolder, listKept, listPending, rejectPending, shareFiles, shareZip } from '../src/brain-share.js'
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

function treeHas(dir, needle) {
  if (!fs.existsSync(dir)) return false
  const needleBytes = Buffer.from(needle)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.name.includes(needle)) return true
    if (entry.isDirectory()) {
      if (treeHas(full, needle)) return true
      continue
    }
    if (entry.isFile() && fs.readFileSync(full).includes(needleBytes)) return true
  }
  return false
}

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-share-'))
try {
  const bare = path.join(parent, 'bare')
  fs.mkdirSync(bare)
  fs.writeFileSync(path.join(bare, 'SOUL.md'), 'only soul\n')
  assert(isBirthFolder(bare) === false, 'a folder with only SOUL.md is not a birth')
  assert(isBirthFolder(path.join(parent, 'missing')) === false, 'a missing folder is not a birth')
  assert(isBirthFolder(path.parse(parent).root) === false, 'a drive root is not a birth')

  const birth = path.join(parent, 'birth')
  const outside = path.join(parent, 'outside')
  fs.mkdirSync(path.join(birth, 'skills', 'desk'), { recursive: true })
  fs.mkdirSync(path.join(birth, 'jobs'), { recursive: true })
  fs.mkdirSync(path.join(birth, 'memories'), { recursive: true })
  fs.mkdirSync(outside)
  const memoryBytes = Buffer.from('Remember the door.\n')
  fs.writeFileSync(path.join(birth, 'memories', 'MEMORY.md'), memoryBytes)
  fs.writeFileSync(path.join(birth, 'BIRTH.md'), 'Cortex transplant\n')
  fs.writeFileSync(path.join(birth, 'SOUL.md'), 'Plain voice.\n')
  fs.writeFileSync(path.join(birth, 'skills', 'desk', 'SKILL.md'), 'Use the desk.\n')
  fs.writeFileSync(path.join(birth, 'jobs', 'daily.json'), '{"job":true}\n')
  fs.writeFileSync(path.join(birth, 'manifest.json'), JSON.stringify({
    format: 'cortex-pack-2',
    files: [
      { path: 'SOUL.md' },
      { path: 'skills/desk/SKILL.md' },
      { path: 'jobs/daily.json' },
    ],
  }))
  assert(isBirthFolder(birth) === true, 'BIRTH.md and cortex-pack-2 make a birth')

  const listed = shareFiles(birth)
  const soul = listed.find((file) => file.path === 'SOUL.md')
  const skill = listed.find((file) => file.path === 'skills/desk/SKILL.md')
  assert(Boolean(soul && skill), 'a birth lists SOUL.md and a skill')
  assert(soul.bytes === fs.statSync(path.join(birth, 'SOUL.md')).size, 'SOUL.md reports its bytes')
  assert(!listed.some((file) => file.path === 'jobs/daily.json'), 'a birth does not list jobs/daily.json')
  assert(listed.every((file, index) => index === 0 || listed[index - 1].path <= file.path), 'share files are sorted by path')

  const zip = shareZip(birth)
  assert(Buffer.isBuffer(zip) && zip.subarray(0, 2).equals(storeZip([]).subarray(0, 2)), 'shareZip begins with PK')
  assert(zip.subarray(0, 2).toString() === 'PK', 'shareZip begins with the letters PK')
  assert(zip.includes(Buffer.from('SOUL.md')), 'the zip names SOUL.md')
  assert(zip.includes(Buffer.from('skills/desk/SKILL.md')), 'the zip names the skill')
  assert(!zip.includes(Buffer.from('jobs/daily.json')), 'the zip leaves the job out')

  let bareZip = ''
  try {
    shareZip(bare)
  } catch (error) {
    bareZip = error.message
  }
  assert(bareZip === 'That folder is not a downloaded brain.', 'shareZip refuses a folder that is not a birth')

  const added = addPending(birth, 'Grok', 'Remember the side door.')
  assert(added.status === 'pending' && /^[a-f0-9]{8}$/.test(added.id), 'a note starts pending')
  const pending = listPending(birth)
  const note = pending.find((item) => item.id === added.id)
  assert(note && note.from === 'Grok' && note.text === 'Remember the side door.', 'addPending then listPending returns the note')
  assert(shareFiles(birth).some((file) => file.path === `growth/pending/${added.id}.md`), 'a growth note is part of the share')
  const pendingFile = fs.readFileSync(path.join(birth, 'growth', 'pending', `${added.id}.md`), 'utf8')
  assert(pendingFile.startsWith(':::cortex\n') && pendingFile.includes('brain-region: temporal-l'), 'a pending note carries a cortex header')
  const pendingManifest = JSON.parse(fs.readFileSync(path.join(birth, 'manifest.json'), 'utf8'))
  assert(pendingManifest.growth.pending.some((item) => item.path === `growth/pending/${added.id}.md` && item.sha256.length === 64), 'manifest lists the pending note and its sha256')

  fs.writeFileSync(path.join(birth, 'growth', 'pending', 'not-a-note.md'), 'hello\n')
  assert(!listPending(birth).some((item) => item.id === 'not-a-note'), 'a note with the wrong shape is skipped')

  let refused = ''
  try {
    addPending(birth, 'ai', 'password: hunter2secret')
    refused = 'wrote'
  } catch (error) {
    refused = error.message
  }
  assert(refused === 'Say something that can be kept.', 'a password note is refused')
  assert(!treeHas(birth, 'hunter2secret'), 'the secret is not in the folder')
  assert(!treeHas(outside, 'hunter2secret'), 'the secret is not written outside')

  const accepted = acceptPending(birth, added.id)
  assert(accepted && accepted.id === added.id && accepted.status === 'accepted', 'accept marks the note accepted')
  const acceptedManifest = JSON.parse(fs.readFileSync(path.join(birth, 'manifest.json'), 'utf8'))
  assert(acceptedManifest.growth.accepted.some((item) => item.path === `growth/accepted/${added.id}.md` && item.sha256.length === 64), 'manifest lists the accepted note and its sha256')
  assert(!acceptedManifest.growth.pending.some((item) => item.path.endsWith(`${added.id}.md`)), 'manifest drops the accepted note from pending')
  assert(fs.existsSync(path.join(birth, 'growth', 'accepted', `${added.id}.md`)), 'accept moves it to growth/accepted')
  assert(!fs.existsSync(path.join(birth, 'growth', 'pending', `${added.id}.md`)), 'accept removes the pending file')
  assert(fs.readFileSync(path.join(birth, 'memories', 'MEMORY.md')).equals(memoryBytes), 'accept does not change memories/MEMORY.md bytes')
  const keptList = fs.readFileSync(path.join(birth, 'growth', 'kept.md'), 'utf8')
  assert(keptList.includes(added.id) && keptList.split(added.id).length === 2, 'accept adds the name to growth/kept.md once')
  assert(listKept(birth).some((item) => item.id === added.id && item.text.includes('Remember the side door.')), 'kept notes stay in list order')
  fs.writeFileSync(path.join(birth, 'growth', 'pending', `${added.id}.md`), 'From: ai\n\nA second copy.\n')
  const again = acceptPending(birth, added.id)
  assert(again && again.already === true, 'accept does not overwrite a kept note')
  assert(fs.readFileSync(path.join(birth, 'growth', 'accepted', `${added.id}.md`), 'utf8').includes('Remember the side door.'), 'the kept note stays the first copy')
  fs.writeFileSync(path.join(birth, 'growth', 'pending', 'abcd1234.md'), 'From: ai\n\nKeep this.\npassword: hunter2secret\n')
  const scrubbed = acceptPending(birth, 'abcd1234')
  assert(scrubbed && scrubbed.status === 'accepted', 'a mixed note can be kept')
  const scrubbedBody = fs.readFileSync(path.join(birth, 'growth', 'accepted', 'abcd1234.md'), 'utf8')
  assert(scrubbedBody.includes('Keep this.') && !scrubbedBody.includes('hunter2secret'), 'accept stores the scrubbed note')
  fs.writeFileSync(path.join(birth, 'growth', 'pending', '1234abcd.md'), 'From: ai\n\npassword: hunter2secret\n')
  assert(!listPending(birth).some((item) => item.id === '1234abcd'), 'a secret note is not listed')
  const secretClosed = acceptPending(birth, '1234abcd')
  assert(secretClosed && secretClosed.status === 'closed', 'a secret note is closed')
  assert(!treeHas(birth, 'hunter2secret'), 'the secret is not kept in the folder')
  const zipped = shareZip(birth)
  assert(!zipped.includes(Buffer.from('hunter2secret')), 'the zip does not carry the secret')

  const closedNote = addPending(birth, 'ai', 'Close this note.')
  const rejected = rejectPending(birth, closedNote.id)
  assert(rejected && rejected.id === closedNote.id && rejected.status === 'closed', 'reject closes the note')
  assert(fs.existsSync(path.join(birth, 'growth', 'closed', `${closedNote.id}.md`)), 'reject moves it to growth/closed')
  assert(!fs.existsSync(path.join(birth, 'growth', 'pending', `${closedNote.id}.md`)), 'reject removes the pending file')
  assert(fs.readFileSync(path.join(birth, 'memories', 'MEMORY.md')).equals(memoryBytes), 'reject does not change memories/MEMORY.md bytes')
  assert(acceptPending(birth, 'nope') === null, 'an unsafe id is not accepted')
  assert(acceptPending(birth, 'abcd1234') === null, 'a missing id is not accepted')
  assert(rejectPending(birth, 'abcd1234') === null, 'a missing id is not closed')

  let outsideMessage = ''
  try {
    addPending(outside, '../../birth', 'Remember the alley.')
  } catch (error) {
    outsideMessage = error.message
  }
  assert(outsideMessage === 'That folder is not a downloaded brain.', 'a folder that is not a birth is refused')
  assert(acceptPending(outside, added.id) === null, 'accept does not write a second folder')
  assert(rejectPending(outside, 'abcd1234') === null, 'reject does not write a second folder')
  assert(fs.readdirSync(outside).length === 0, 'a second folder outside the birth is not written')
} finally {
  fs.rmSync(parent, { recursive: true, force: true })
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('brain-share tests passed')
