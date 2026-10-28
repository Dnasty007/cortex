/** Hand a downloaded Cortex birth to another AI. Does not scan a live agent or write keys. */

import { randomBytes } from 'node:crypto'
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

export function shareZip(folder) {
  if (!isBirthFolder(folder)) throw new Error(NOT_BIRTH)
  const root = folderPath(folder)
  const files = shareFiles(folder).map((file) => {
    const dest = contained(root, file.path)
    if (!dest || !realFile(dest)) throw new Error(NOT_BIRTH)
    return { name: file.path, data: fs.readFileSync(dest) }
  })
  return storeZip(files)
}

function parsePending(text) {
  const match = String(text).match(/^From: ([^\r\n]*)\r?\n\r?\n([\s\S]*)$/)
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
    const parsed = parsePending(text)
    if (!parsed) continue
    rows.push({
      id: name.slice(0, -'.md'.length),
      from: parsed.from.trim().slice(0, 40),
      text: parsed.text,
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
  fs.writeFileSync(dest, `From: ${who}\n\n${clean}`, { encoding: 'utf8', flag: 'wx' })
  return { id, status: 'pending' }
}

function movePending(folder, id, dirName, status) {
  const name = String(id || '')
  if (!SAFE_ID.test(name)) return null
  const root = folderPath(folder)
  if (!root) return null
  const pending = contained(root, `growth/pending/${name}.md`)
  const destRel = `growth/${dirName}/${name}.md`
  const dest = contained(root, destRel)
  if (!pending || !dest || !realFile(pending)) return null
  let data
  try {
    data = fs.readFileSync(pending)
  } catch {
    return null
  }
  try {
    ensureDir(root, `growth/${dirName}`)
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
  }
  fs.writeFileSync(finalDest, data)
  fs.unlinkSync(pending)
  return { id: name, status }
}

export function acceptPending(folder, id) {
  return movePending(folder, id, 'accepted', 'accepted')
}

export function rejectPending(folder, id) {
  return movePending(folder, id, 'closed', 'closed')
}
