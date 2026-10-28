import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function readQueue(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(data.items)) return { items: [] }
    return data
  } catch {
    return { items: [] }
  }
}

function writeQueue(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function ipSite(site) {
  return /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(String(site || ''))
}

export function listQueue(file) {
  return readQueue(file).items.map((item) => ({
    id: item.id,
    at: item.at,
    from: item.from || '',
    text: item.text || '',
    skill_id: item.skill_id || '',
    site: item.site || '',
    username: item.username || '',
    status: item.status || '',
    go: item.go === true,
  }))
}

export function upsertPointers(file, skillId, pointers) {
  const data = readQueue(file)
  const stored = []
  for (const pointer of pointers || []) {
    const site = String(pointer.site || '').slice(0, 120)
    const username = String(pointer.username || '').slice(0, 80)
    if (!site && !username) continue
    let item = data.items.find((row) => row.skill_id === skillId && row.site === site && row.username === username)
    if (!item && username) {
      item = data.items.find((row) => row.skill_id === skillId && row.site === site && !String(row.username || ''))
      if (item) item.username = username
    }
    if (!item) {
      item = {
        id: randomBytes(4).toString('hex'),
        skill_id: String(skillId || '').slice(0, 180),
        site,
        username,
        status: 'waiting-for-ray',
        go: false,
        at: new Date().toISOString(),
      }
      data.items.push(item)
      if (data.items.length > 80) data.items = data.items.slice(-80)
    }
    stored.push({
      id: item.id,
      site: item.site,
      username: item.username,
      status: item.status,
      go: item.go === true,
    })
  }
  if (stored.length) writeQueue(file, data)
  return stored
}

export function dropIpSites(file) {
  const data = readQueue(file)
  const next = data.items.filter((row) => !ipSite(row.site))
  const kept = next.filter((row) => {
    if (row.site) return true
    return !next.some((other) => other !== row && other.skill_id === row.skill_id && other.username && other.username === row.username && other.site)
  })
  if (kept.length !== data.items.length) {
    data.items = kept
    writeQueue(file, data)
  }
  return kept.length
}

export function approvePointer(file, id) {
  const data = readQueue(file)
  const item = data.items.find((row) => row.id === id)
  if (!item) return null
  item.go = true
  item.status = 'approved'
  item.approved_at = new Date().toISOString()
  writeQueue(file, data)
  return {
    id: item.id,
    site: item.site,
    username: item.username,
    status: item.status,
    go: true,
    wrote: false,
  }
}

export function addProposal(file, from, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 800)
  if (!clean) return { error: 'Say something.' }
  const data = readQueue(file)
  const item = {
    id: randomBytes(4).toString('hex'),
    at: new Date().toISOString(),
    from: String(from || 'grok').replace(/[^\w .:-]/g, '').slice(0, 40) || 'grok',
    text: clean,
    status: 'pending',
  }
  data.items.push(item)
  if (data.items.length > 40) data.items = data.items.slice(-40)
  writeQueue(file, data)
  return { ok: true, id: item.id, status: 'pending' }
}

export function acceptedMemoryText(existing, from, text, id) {
  const clean = String(text || '').trim()
  const noteId = String(id || '').replace(/[^\w-]/g, '').slice(0, 40)
  const prior = String(existing || '')
  if (!clean || !noteId) return prior
  const marker = `cortex-note: ${noteId}`
  if (prior.includes(marker)) return prior
  const who = String(from || 'bot').replace(/[^\w .:-]/g, '').slice(0, 40) || 'bot'
  const block = `\n\n## Accepted ${new Date().toISOString().slice(0, 10)}\n${marker}\nFrom ${who}\n\n${clean}\n`
  return `${prior}${block}`
}

export function settleProposal(file, id, clean) {
  const data = readQueue(file)
  const item = data.items.find((row) => row.id === id)
  if (!item) return null
  if (item.status !== 'pending') {
    return { id: item.id, status: item.status, from: item.from || '', text: item.text || '', already: true, keep: false }
  }
  const text = String(clean || '').trim()
  const keep = Boolean(text && text !== '[held]')
  if (!keep) {
    item.status = 'closed'
    item.closed_at = new Date().toISOString()
    writeQueue(file, data)
    return { id: item.id, status: 'closed', from: item.from || '', text: item.text || '', already: false, keep: false }
  }
  item.status = 'accepted'
  item.accepted_at = new Date().toISOString()
  writeQueue(file, data)
  return { id: item.id, status: 'accepted', from: item.from || '', text: item.text || '', already: false, keep: true }
}

export function pendingProposal(file, id) {
  const data = readQueue(file)
  const item = data.items.find((row) => row.id === id)
  if (!item) return null
  if (item.status !== 'pending') {
    return { id: item.id, status: item.status, from: item.from || '', text: item.text || '', already: true }
  }
  return { id: item.id, status: 'pending', from: item.from || '', text: item.text || '', already: false }
}

export function acceptProposal(file, id) {
  const data = readQueue(file)
  const item = data.items.find((row) => row.id === id)
  if (!item) return null
  if (item.status !== 'pending') {
    return { id: item.id, status: item.status, from: item.from || '', text: item.text || '', already: true }
  }
  item.status = 'accepted'
  item.accepted_at = new Date().toISOString()
  writeQueue(file, data)
  return { id: item.id, status: 'accepted', from: item.from || '', text: item.text || '', already: false }
}

export function rejectProposal(file, id) {
  const data = readQueue(file)
  const item = data.items.find((row) => row.id === id)
  if (!item) return null
  if (item.status !== 'pending') {
    return { id: item.id, status: item.status, already: true }
  }
  item.status = 'closed'
  item.closed_at = new Date().toISOString()
  writeQueue(file, data)
  return { id: item.id, status: 'closed', already: false }
}
