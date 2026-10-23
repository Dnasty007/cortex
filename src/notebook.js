const SECRET_WORD = /password|ssn|secret|token|api_key|bearer/i
const PHONE_RUN = /\d{10,}/

export function notebookEntries(notes) {
  if (!notes || typeof notes !== 'object') return []
  const entries = []
  for (const [key, value] of Object.entries(notes)) {
    const name = String(key || '').trim()
    if (!name || SECRET_WORD.test(name)) continue
    const raw = String(value ?? '')
    const hidden = SECRET_WORD.test(raw) || PHONE_RUN.test(raw)
    entries.push({ key: name.slice(0, 80), value: hidden ? '' : raw.slice(0, 160) })
  }
  return entries.slice(0, 40)
}
