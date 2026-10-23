/** Review marks for a portable pack. The files are not copied here. */

const MOVE = new Set(['skills', 'user', 'soul', 'memory'])
const STAY = {
  sessions: 'Transcripts stay home.',
  vault: 'The company library stays home.',
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const EMAIL_STUB = /[a-z0-9._%+-]+@(?:\.+(?![a-z0-9])|(?![a-z0-9.-])|(?!latest\b|next\b|beta\b|canary\b|alpha\b)[a-z0-9-]+(?![a-z0-9.@_-]))/i
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{10,11}\b/
const SECRET = /api[_-]?key\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S{8,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-z0-9]{12,}|xai-[a-z0-9]{12,}|bws_[a-z0-9_-]{8,}|AKIA[0-9A-Z]{16}/i
const SECRET_FILE = /(?:^|[^a-z0-9])(?:sk-|xai-)/i
const AWS_FILE = /AKIA/

const DAY_MS = 24 * 60 * 60 * 1000
const PREVIEW_LIMIT = 900
const originals = new WeakMap()

function maskPattern(pattern, text, token) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return text.replace(new RegExp(pattern.source, flags), token)
}

function maskEmailLine(line) {
  const trimmed = line.trim()
  const found = trimmed.match(EMAIL)
  if (found && found[0] === trimmed) return '[email]'
  return line
}

/** Mask the 900-character window. Does not read or write a file. */
export function maskedPreview(text) {
  let value = String(text ?? '').split('\n').map(maskEmailLine).join('\n')
  value = maskPattern(SECRET, value, '[redacted]')
  value = maskPattern(EMAIL, value, '[email]')
  value = maskPattern(EMAIL_STUB, value, '[email]')
  value = maskPattern(PHONE, value, '[phone]')
  if (value.length <= PREVIEW_LIMIT) return value
  return `${value.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…`
}

export function scannedAtDate(value) {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])))
}

function sourceFields(neuron) {
  const kept = neuron && typeof neuron === 'object' ? originals.get(neuron) : null
  if (kept) return kept
  return {
    name: neuron?.name,
    summary: neuron?.summary,
    body: neuron?.body,
  }
}

export function hasContact(neuron) {
  const fields = sourceFields(neuron)
  const text = `${fields.name || ''}\n${fields.summary || ''}\n${fields.body || ''}`
  return EMAIL.test(text) || PHONE.test(text)
}

function secretFileName(neuron) {
  const text = `${neuron?.name || ''}\n${neuron?.path || ''}`
  return SECRET_FILE.test(text) || AWS_FILE.test(text)
}

function lobeIds(brain) {
  const ids = new Set()
  for (const lobe of brain?.lobes || []) {
    if (lobe?.id) ids.add(lobe.id)
  }
  for (const neuron of brain?.neurons || []) {
    if (neuron?.lobe) ids.add(neuron.lobe)
  }
  return ids
}

function paintPreview(neuron) {
  if (!neuron || typeof neuron !== 'object' || neuron.kind === 'hub') return
  let kept = originals.get(neuron)
  if (!kept) {
    kept = { name: neuron.name, summary: neuron.summary, body: neuron.body }
    originals.set(neuron, kept)
  }
  if (kept.body) neuron.body = maskedPreview(kept.body)
  else if (kept.summary) neuron.summary = maskedPreview(kept.summary)
}

export function packReview(brain, now = new Date()) {
  const neurons = Array.isArray(brain?.neurons) ? brain.neurons : []
  const scanned = scannedAtDate(brain?.source?.scanned_at)
  const ageMs = scanned ? now.getTime() - scanned.getTime() : null
  const stale = ageMs == null || ageMs > DAY_MS
  const marks = {}
  for (const id of lobeIds(brain)) {
    const own = neurons.filter((neuron) => neuron.lobe === id && neuron.kind !== 'hub')
    const contact = own.some(hasContact)
    if (STAY[id]) {
      marks[id] = { mark: 'stay', reason: STAY[id] }
      continue
    }
    if (!MOVE.has(id)) {
      marks[id] = { mark: 'out', reason: 'Not in the pack.' }
      continue
    }
    if (stale) {
      marks[id] = { mark: 'hold', reason: 'Scan is older than a day. Refresh before a pack.' }
      continue
    }
    if (contact && (id === 'user' || id === 'memory' || id === 'soul')) {
      marks[id] = { mark: 'hold', reason: 'Contact details are still in this lobe. Strip them before it moves.' }
      continue
    }
    if (own.some(secretFileName)) {
      marks[id] = { mark: 'hold', reason: 'A file name still looks like a secret. It does not move.' }
      continue
    }
    marks[id] = { mark: 'review', reason: 'This window is a 900-character preview. It cannot clear this file.' }
  }
  for (const neuron of neurons) paintPreview(neuron)
  return {
    stale,
    scannedAt: brain?.source?.scanned_at || '',
    marks,
  }
}
