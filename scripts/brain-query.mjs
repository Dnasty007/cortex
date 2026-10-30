/** List files in a Cortex birth without printing their bodies. */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OPEN = ':::cortex\n'
const CLOSE = '\n:::\n'
const REGIONS = ['temporal', 'frontal', 'parietal', 'occipital', 'corpus', 'cerebellum', 'brainstem']

export function parseHeader(text) {
  const raw = String(text || '')
  const start = raw.indexOf(OPEN)
  if (start === -1 || start > 4000) return null
  const end = raw.indexOf(CLOSE, start)
  if (end === -1) return null
  const meta = {}
  for (const line of raw.slice(start + OPEN.length, end).split(/\r?\n/)) {
    const cut = line.indexOf(':')
    if (cut === -1) continue
    meta[line.slice(0, cut).trim()] = line.slice(cut + 1).trim()
  }
  return meta
}

export function parseAsk(text) {
  const raw = String(text || '')
  const after = raw.match(/\bafter\s+(\d{4}-\d{2}-\d{2})\b/i)
  let region = ''
  const named = raw.match(/\bin\s+([A-Za-z][A-Za-z-]*)/i)
  if (named) {
    const word = named[1].toLowerCase()
    if (REGIONS.some((item) => word === item || word.startsWith(`${item}-`))) region = word
  }
  return { region, after: after ? after[1] : '' }
}

export function regionHit(have, want) {
  if (!want) return true
  const left = String(have || '').toLowerCase()
  const right = String(want || '').toLowerCase()
  return left === right || left.startsWith(`${right}-`)
}

function dependenciesOf(value) {
  if (Array.isArray(value)) return value.filter((item) => item)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function contained(root, rel) {
  const text = String(rel || '').replace(/\\/g, '/')
  if (!text || text.includes('..') || text.startsWith('/')) return ''
  const dest = path.resolve(root, ...text.split('/'))
  const relative = path.relative(root, dest)
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return ''
  return dest
}

function rowFrom(root, rel, fallback) {
  const dest = contained(root, rel)
  if (!dest) return null
  let stat
  try {
    stat = fs.lstatSync(dest)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return null
  const data = fs.readFileSync(dest)
  const text = data.toString('utf8')
  const header = parseHeader(text) || {}
  let card = {}
  if (rel.endsWith('.json')) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && parsed.cortex && typeof parsed.cortex === 'object') card = parsed.cortex
    } catch {
      card = {}
    }
  }
  const base = fallback || {}
  return {
    path: rel,
    type: header.type || card.type || base.type || '',
    skill: header.skill || card.skill || base.skill || '',
    'brain-region': header['brain-region'] || card['brain-region'] || base['brain-region'] || '',
    version: header.version || card.version || base.version || '',
    date: header.date || card.date || base.date || '',
    dependencies: dependenciesOf(header.dependencies || card.dependencies || base.dependencies),
    sha256: createHash('sha256').update(data).digest('hex'),
  }
}

export function queryBrain(folder, ask) {
  const root = path.resolve(String(folder || ''))
  const manifestPath = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const wanted = typeof ask === 'string' ? parseAsk(ask) : (ask || {})
  const rows = []
  const seen = new Set()
  const take = (rel, fallback) => {
    const text = String(rel || '').replace(/\\/g, '/')
    if (!text || seen.has(text)) return
    const row = rowFrom(root, text, fallback)
    if (!row) return
    if (!regionHit(row['brain-region'], wanted.region || '')) return
    if (wanted.after && !(row.date > wanted.after)) return
    seen.add(text)
    rows.push(row)
  }
  for (const item of manifest.files || []) take(item && item.path, item)
  for (const bucket of ['pending', 'accepted']) {
    const listed = manifest.growth && manifest.growth[bucket]
    for (const item of listed || []) take(item && item.path, item)
    const dir = path.join(root, 'growth', bucket)
    let names = []
    try {
      if (fs.statSync(dir).isDirectory()) names = fs.readdirSync(dir)
    } catch {
      names = []
    }
    for (const name of names) {
      if (name.endsWith('.md')) take(`growth/${bucket}/${name}`, { type: 'growth', 'brain-region': 'temporal-l' })
    }
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files: rows }
}

function cli(argv) {
  const args = argv.slice(2)
  let folder = ''
  let region = ''
  let after = ''
  const words = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--region') {
      region = args[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--after') {
      after = args[index + 1] || ''
      index += 1
      continue
    }
    if (!folder) {
      folder = arg
      continue
    }
    words.push(arg)
  }
  const parsed = parseAsk(words.join(' '))
  const ask = {
    region: region || parsed.region,
    after: after || parsed.after,
  }
  const result = queryBrain(folder, ask)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invoked) cli(process.argv)
