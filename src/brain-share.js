/** Hand a downloaded Cortex birth to another AI. Does not scan a live agent or write keys. */

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { scrubTravelText } from './travel.js'
import { storeZip } from './zip-store.js'

const NOT_BIRTH = 'That folder is not a downloaded brain.'
const NOT_KEPT = 'Say something that can be kept.'
const SAFE_ID = /^[a-f0-9]{8}$/
const ROOT_FILES = new Set([
  'BIRTH.md',
  'START.md',
  'GROW.md',
  'ASK.md',
  'SOUL.md',
  'CLAUDE.md',
  'AGENTS.md',
  'memories/USER.md',
  'memories/MEMORY.md',
])

function folderPath(folder) {
  if (folder == null) return ''
  const text = String(folder)
  if (!text || text.includes('\0')) return ''
  let root
  try {
    root = path.resolve(text)
  } catch {
    return ''
  }
  if (path.parse(root).root === root) return ''
  return root
}

function isRealDir(folder) {
  try {
    const stat = fs.lstatSync(folder)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function realFile(file) {
  try {
    const stat = fs.lstatSync(file)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function safeRel(rel) {
  const text = String(rel ?? '').replace(/\\/g, '/')
  if (!text || text.includes('\0') || text.includes('..') || text.startsWith('/') || /^[A-Za-z]:/.test(text)) return ''
  const parts = text.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) return ''
  return parts.join('/')
}

function contained(root, rel) {
  const text = safeRel(rel)
  if (!text) return ''
  const dest = path.resolve(root, ...text.split('/'))
  const relative = path.relative(root, dest)
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return ''
  return dest
}

function shareable(rel) {
  const text = safeRel(rel)
  if (!text) return ''
  const top = text.split('/')[0]
  if (top === 'jobs' || top === 'config' || top === 'sessions') return ''
  if (ROOT_FILES.has(text)) return text
  const skill = text.startsWith('skills/') || text.startsWith('.claude/skills/') || text.startsWith('.agents/skills/')
  if (skill && text.endsWith('/SKILL.md')) return text
  if (text.startsWith('.cursor/rules/') && (text.endsWith('.md') || text.endsWith('.mdc'))) return text
  return ''
}

export function isBirthFolder(folder) {
  const root = folderPath(folder)
  if (!root || !isRealDir(root)) return false
  const birth = path.join(root, 'BIRTH.md')
  const manifestPath = path.join(root, 'manifest.json')
  if (!realFile(birth) || !realFile(manifestPath)) return false
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return Boolean(data && data.format === 'cortex-pack-2')
  } catch {
    return false
  }
}

function addGrowth(root, found) {
  walkGrowth(root, 'growth', found)
}

function walkGrowth(root, rel, found) {
  const dir = contained(root, rel)
  if (!dir || !isRealDir(dir)) return
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const childRel = `${rel}/${name}`
    if (childRel.includes('..')) continue
    const child = contained(root, childRel)
    if (!child) continue
    let stat
    try {
      stat = fs.lstatSync(child)
    } catch {
      continue
    }
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      walkGrowth(root, childRel, found)
      continue
    }
    if (stat.isFile() && name.endsWith('.md')) found.set(childRel, stat.size)
  }
}

export function shareFiles(folder) {
  const root = folderPath(folder)
  if (!root || !isRealDir(root)) return []
  const found = new Map()
  const manifestPath = path.join(root, 'manifest.json')
  if (realFile(manifestPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const files = Array.isArray(data?.files) ? data.files : []
      for (const item of files) {
        const rel = shareable(item && item.path)
        if (!rel || found.has(rel)) continue
        const dest = contained(root, rel)
        if (!dest || !realFile(dest)) continue
        found.set(rel, fs.lstatSync(dest).size)
      }
    } catch {
      /* a broken manifest contributes no pack files */
    }
  }
  addGrowth(root, found)
  return [...found.entries()]
    .map(([filePath, bytes]) => ({ path: filePath, bytes }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function sharedBytes(name, data) {
  if (!String(name).endsWith('.md') && !String(name).endsWith('.mdc')) return data
  return Buffer.from(scrubTravelText(data.toString('utf8'), 80000), 'utf8')
}

export function shareZip(folder) {
  if (!isBirthFolder(folder)) throw new Error(NOT_BIRTH)
  const root = folderPath(folder)
  const files = shareFiles(folder).map((file) => {
    const dest = contained(root, file.path)
    if (!dest || !realFile(dest)) throw new Error(NOT_BIRTH)
    return { name: file.path, data: sharedBytes(file.path, fs.readFileSync(dest)) }
  })
  return storeZip(files)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function cortexBlock(meta) {
  const deps = Array.isArray(meta.dependencies) ? meta.dependencies.join(', ') : (meta.dependencies || '')
  return [
    ':::cortex',
    `type: ${meta.type || 'growth'}`,
    `skill: ${meta.skill || ''}`,
    `brain-region: ${meta['brain-region'] || 'temporal-l'}`,
    `version: ${meta.version || '1'}`,
    `date: ${meta.date || today()}`,
    `dependencies: ${deps}`,
    ':::',
    '',
  ].join('\n')
}

function growthMeta(date) {
  return {
    type: 'growth',
    skill: '',
    'brain-region': 'temporal-l',
    version: '1',
    date: date || today(),
    dependencies: '',
  }
}

function readHeader(text) {
  const raw = String(text || '')
  const start = raw.indexOf(':::cortex\n')
  if (start === -1 || start > 4000) return null
  const end = raw.indexOf('\n:::\n', start)
  if (end === -1) return null
  const meta = {}
  for (const line of raw.slice(start + ':::cortex\n'.length, end).split(/\r?\n/)) {
    const cut = line.indexOf(':')
    if (cut === -1) continue
    meta[line.slice(0, cut).trim()] = line.slice(cut + 1).trim()
  }
  return meta
}

function stripHeader(text) {
  const raw = String(text || '')
  const start = raw.indexOf(':::cortex\n')
  if (start === -1 || start > 4000) return raw
  const end = raw.indexOf('\n:::\n', start)
  if (end === -1) return raw
  return raw.slice(0, start) + raw.slice(end + '\n:::\n'.length)
}

function parsePending(text) {
  const match = stripHeader(text).match(/^From: ([^\r\n]*)\r?\n\r?\n([\s\S]*)$/)
  if (!match) return null
  return { from: match[1], text: match[2] }
}

export function listPending(folder) {
  const root = folderPath(folder)
  if (!root) return []
  const dir = contained(root, 'growth/pending')
  if (!dir || !isRealDir(dir)) return []
  const rows = []
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const rel = `growth/pending/${name}`
    const file = contained(root, rel)
    if (!file || !realFile(file)) continue
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const id = name.slice(0, -'.md'.length)
    if (!SAFE_ID.test(id)) continue
    const parsed = parsePending(text) || { from: 'ai', text }
    let clean = ''
    try {
      clean = keptNote(parsed.text)
    } catch {
      continue
    }
    rows.push({
      id,
      from: cleanFrom(parsed.from),
      text: clean,
    })
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return rows
}

function cleanFrom(from) {
  const text = String(from ?? '').replace(/[^A-Za-z0-9 .:-]/g, '').trim().slice(0, 40)
  return text || 'ai'
}

function keptNote(text) {
  const clean = scrubTravelText(text, 800)
  if (!clean.trim() || clean.trim() === '[held]') throw new Error(NOT_KEPT)
  return clean
}

function ensureDir(root, rel) {
  const text = safeRel(rel)
  if (!text) throw new Error(NOT_BIRTH)
  let current = root
  for (const part of text.split('/')) {
    current = path.join(current, part)
    const relative = path.relative(root, current)
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(NOT_BIRTH)
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(NOT_BIRTH)
      continue
    }
    fs.mkdirSync(current)
    const created = fs.lstatSync(current)
    if (created.isSymbolicLink() || !created.isDirectory()) throw new Error(NOT_BIRTH)
  }
  return current
}

export function addPending(folder, from, text) {
  if (!isBirthFolder(folder)) throw new Error(NOT_BIRTH)
  const clean = keptNote(text)
  const who = cleanFrom(from)
  const root = folderPath(folder)
  const dir = ensureDir(root, 'growth/pending')
  let id = ''
  let dest = ''
  for (let attempt = 0; attempt < 5; attempt += 1) {
    id = randomBytes(4).toString('hex')
    dest = path.join(dir, `${id}.md`)
    if (!fs.existsSync(dest)) break
  }
  if (!SAFE_ID.test(id) || !contained(root, `growth/pending/${id}.md`)) throw new Error(NOT_BIRTH)
  fs.writeFileSync(dest, `${cortexBlock(growthMeta())}From: ${who}\n\n${clean}`, { encoding: 'utf8', flag: 'wx' })
  refreshGrowth(root)
  return { id, status: 'pending' }
}

function scrubbedPending(data) {
  const text = data.toString('utf8')
  const parsed = parsePending(text) || { from: 'ai', text }
  const who = cleanFrom(parsed.from)
  const prior = readHeader(text)
  const block = cortexBlock(growthMeta(prior && prior.date))
  try {
    const clean = keptNote(parsed.text)
    return { keep: true, from: who, raw: Buffer.from(`${block}From: ${who}\n\n${clean}`, 'utf8') }
  } catch {
    return { keep: false, from: who, raw: Buffer.from(`${block}From: ${who}\n\n[held]\n`, 'utf8') }
  }
}

function rememberKept(root, id) {
  const dest = contained(root, 'growth/kept.md')
  if (!dest) throw new Error(NOT_BIRTH)
  ensureDir(root, 'growth')
  const prior = realFile(dest) ? fs.readFileSync(dest, 'utf8') : ''
  if (prior.split(/\r?\n/).some((line) => line.trim() === id)) return
  const banner = 'Kept notes, in order. Read each file under growth/accepted/.\n'
  const next = prior.trim()
    ? `${prior.replace(/\s*$/, '')}\n${id}\n`
    : `${cortexBlock({ type: 'growth-index', skill: '', 'brain-region': 'temporal-l', version: '1', date: today(), dependencies: '' })}${banner}\n${id}\n`
  fs.writeFileSync(dest, next, 'utf8')
}

function growthRows(root, bucket) {
  const dir = contained(root, `growth/${bucket}`)
  if (!dir || !isRealDir(dir)) return []
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const rows = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const rel = `growth/${bucket}/${name}`
    const file = contained(root, rel)
    if (!file || !realFile(file)) continue
    let data
    try {
      data = fs.readFileSync(file)
    } catch {
      continue
    }
    const header = readHeader(data.toString('utf8')) || {}
    const deps = String(header.dependencies || '').split(',').map((item) => item.trim()).filter(Boolean)
    rows.push({
      path: rel,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      type: header.type || 'growth',
      skill: header.skill || '',
      'brain-region': header['brain-region'] || 'temporal-l',
      version: header.version || '1',
      date: header.date || '',
      dependencies: deps,
    })
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return rows
}

function refreshGrowth(root) {
  const manifestPath = path.join(root, 'manifest.json')
  if (!realFile(manifestPath)) return
  let data
  try {
    data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return
  }
  if (!data || data.format !== 'cortex-pack-2') return
  data.growth = {
    pending: growthRows(root, 'pending'),
    accepted: growthRows(root, 'accepted'),
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`)
}

function readNoteFile(root, rel) {
  const file = contained(root, rel)
  if (!file || !realFile(file)) return null
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const parsed = parsePending(text) || { from: 'ai', text }
  let clean = ''
  try {
    clean = keptNote(parsed.text)
  } catch {
    return null
  }
  return { from: cleanFrom(parsed.from), text: clean }
}

export function listKept(folder) {
  const root = folderPath(folder)
  if (!root) return []
  const order = []
  const listFile = contained(root, 'growth/kept.md')
  if (listFile && realFile(listFile)) {
    let text = ''
    try {
      text = fs.readFileSync(listFile, 'utf8')
    } catch {
      text = ''
    }
    for (const line of text.split(/\r?\n/)) {
      const id = line.trim()
      if (SAFE_ID.test(id) && !order.includes(id)) order.push(id)
    }
  }
  const found = new Map()
  const dir = contained(root, 'growth/accepted')
  if (dir && isRealDir(dir)) {
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      names = []
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const id = name.slice(0, -'.md'.length)
      if (!SAFE_ID.test(id)) continue
      const parsed = readNoteFile(root, `growth/accepted/${name}`)
      if (parsed) found.set(id, parsed)
    }
  }
  const rows = []
  const seen = new Set()
  for (const id of order) {
    const parsed = found.get(id)
    if (!parsed) continue
    seen.add(id)
    rows.push({ id, from: parsed.from, text: parsed.text })
  }
  for (const [id, parsed] of found) {
    if (seen.has(id)) continue
    rows.push({ id, from: parsed.from, text: parsed.text })
  }
  return rows
}

function movePending(folder, id, dirName, status, scrub) {
  const name = String(id || '')
  if (!SAFE_ID.test(name)) return null
  const root = folderPath(folder)
  if (!root) return null
  const pending = contained(root, `growth/pending/${name}.md`)
  if (!pending || !realFile(pending)) return null
  let data
  try {
    data = fs.readFileSync(pending)
  } catch {
    return null
  }
  let targetDir = dirName
  let targetStatus = status
  if (scrub) {
    const cleaned = scrubbedPending(data)
    data = cleaned.raw
    if (!cleaned.keep && status === 'accepted') {
      targetDir = 'closed'
      targetStatus = 'closed'
    }
  }
  const destRel = `growth/${targetDir}/${name}.md`
  const dest = contained(root, destRel)
  if (!dest) return null
  try {
    ensureDir(root, `growth/${targetDir}`)
  } catch {
    return null
  }
  const finalDest = contained(root, destRel)
  if (!finalDest) return null
  if (fs.existsSync(finalDest)) {
    let stat
    try {
      stat = fs.lstatSync(finalDest)
    } catch {
      return null
    }
    if (stat.isSymbolicLink() || !stat.isFile()) return null
    fs.unlinkSync(pending)
    refreshGrowth(root)
    return { id: name, status: targetStatus, already: true }
  }
  fs.writeFileSync(finalDest, data)
  fs.unlinkSync(pending)
  if (targetStatus === 'accepted') rememberKept(root, name)
  refreshGrowth(root)
  return { id: name, status: targetStatus, already: false }
}

export function acceptPending(folder, id) {
  return movePending(folder, id, 'accepted', 'accepted', true)
}

export function rejectPending(folder, id) {
  return movePending(folder, id, 'closed', 'closed', true)
}
