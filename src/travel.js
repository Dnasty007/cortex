const OPEN_BODY = new Set(['skill', 'memory', 'soul', 'model'])
const SECRET_LINE = /password|api[_-]?key|secret|token|bearer|private key|ssh-ed25519|AKIA/i
const PHONE_RUN = /\d{10,}/
const LESSON_LIMIT = 80000
const PART_SIZE = 4000
const STUDY_FIRST = /buildium|plre|grok/i

const EMAIL = /[A-Za-z0-9._%+\-]*@(?:[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,})?/g

export function scrubTravelText(text, limit = 4000) {
  const clean = String(text || '')
    .replace(EMAIL, '[email]')
    .replace(/[A-Za-z]:\\Users\\[^\s)]+/g, '[path]')
    .replace(/\/root\/\.hermes\S*/g, '[path]')
    .replace(/~\/\.hermes\S*/g, '[path]')
    .split('\n')
    .map((line) => (SECRET_LINE.test(line) || PHONE_RUN.test(line) ? '[held]' : line))
    .join('\n')
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : 4000
  if (clean.length <= cap) return clean
  return `${clean.slice(0, cap)}\n[This lesson continues past this read.]`
}

const BOOKS = {
  'memory:book': {
    id: 'memory:book',
    name: 'Memory',
    lobe: 'memory',
    kind: 'memory',
    path: 'memories/MEMORY.md',
    summary: 'What she kept about the work.',
  },
  'user:book': {
    id: 'user:book',
    name: 'User',
    lobe: 'user',
    kind: 'memory',
    path: 'memories/USER.md',
    summary: 'What she believes about you.',
  },
}

function isLibrarySkill(neuron) {
  return neuron?.kind === 'skill' && !String(neuron.id || '').startsWith('skill:profile-pack/')
}

function isClickerSkill(neuron) {
  if (!isLibrarySkill(neuron)) return false
  return /buildium|grok|handoff/i.test(`${neuron?.name || ''} ${neuron?.category || ''} ${neuron?.path || ''} ${neuron?.summary || ''}`)
}

function hiddenFromSearch(neuron, lobe) {
  const kind = String(neuron?.kind || '')
  const id = String(neuron?.id || '')
  const asked = lobe === 'profiles' || lobe === 'jobs' || lobe === 'sessions'
  if (asked) return false
  if (kind === 'profile' || kind === 'job' || kind === 'session') return true
  if (id.startsWith('skill:profile-pack/') || id.startsWith('profile:')) return true
  return false
}

function heldLines(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => SECRET_LINE.test(line) || PHONE_RUN.test(line))
    .length
}

function cleanPointerValue(value) {
  const text = String(value || '').trim().replace(/[),.;]+$/g, '').slice(0, 80)
  if (!text || text.length > 80) return ''
  if (/^\[(redacted|email|phone|held)\]$/i.test(text)) return ''
  if (text.includes('@') || SECRET_LINE.test(text) || PHONE_RUN.test(text)) return ''
  if (/^[A-Za-z0-9+/_=-]{24,}$/.test(text)) return ''
  return text
}

function hostOf(value) {
  try { return new URL(String(value || '').replace(/[),.;]+$/g, '')).host } catch { return '' }
}

function ipHost(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(String(host || ''))
}

function identityName(text) {
  const client = String(text || '').match(/\b([A-Z][A-Z0-9]{2,}_CLIENT_ID)\b/)
  if (client) return client[1]
  const machine = String(text || '').match(/machine\s+\*\*([^*]{1,40})\*\*/i)
  if (machine) {
    const name = cleanPointerValue(machine[1].trim())
    if (name) return name
  }
  const user = String(text || '').match(/\b(?:username|user|login)\s*[:=]\s*([^\s,;]+)/i)
  return user ? cleanPointerValue(user[1]) : ''
}

export function bitwardenPointers(text) {
  const lines = String(text || '').split('\n')
  const found = []
  const seen = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!(SECRET_LINE.test(line) || PHONE_RUN.test(line))) continue
    const windowText = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join('\n')
    let site = ''
    const url = line.match(/https?:\/\/[^\s)>\]]+/i)
    if (url) site = hostOf(url[0])
    if (ipHost(site)) site = ''
    if (!site && /bitwarden/i.test(windowText)) site = 'vault.bitwarden.com'
    if (!site) {
      const named = line.match(/\b(?:site|host|url)\s*[:=]\s*([^\s,;]+)/i)
      const host = named ? cleanPointerValue(named[1]) : ''
      if (host && !ipHost(host)) site = host
    }
    const username = identityName(windowText)
    if (!site && !username) continue
    if (!site && username && found.some((item) => item.username === username && item.site)) continue
    const named = site && username ? found.find((item) => item.username === username && !item.site) : null
    if (named) {
      named.site = site
      continue
    }
    const twin = found.find((item) => item.site === site && (!item.username || !username || item.username === username))
    if (twin && site) {
      if (!twin.username && username) twin.username = username
      continue
    }
    const key = `${site}|${username}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ site, username, go: false, status: 'waiting-for-ray' })
    if (found.length >= 8) break
  }
  return found
}

const NAME_BOOKS = {
  water: ['plre-water-bills'],
  email: ['email-inbox-triage', 'plre-email-desk', 'buildium-api-tenant-email'],
  eclipse: ['philly-tax-rental-compliance', 'plre-city-door-audit'],
  applications: ['plre-application-desk'],
  calendar: ['plre-buildium-desk-ops'],
}

export const BOTS = {
  'grok-bot': { title: 'Grok Bot', profile: '' },
  water: { title: 'Water', profile: 'water' },
  email: { title: 'Email', profile: 'email' },
  eclipse: { title: 'Eclipse', profile: '' },
  applications: { title: 'Applications', profile: 'applications' },
  calendar: { title: 'Calendar', profile: '' },
}

export function knownBots() {
  return Object.keys(BOTS)
}

function plugText(bot) {
  const name = BOTS[bot]?.title || bot
  return [
    `# cortex-plug-in.md`,
    '',
    `You are ${name}. This is the whole plug-in. Use the brain door. Do not call /jobs/next. Never pay.`,
    '',
    `1. GET /brain?for=${bot}&limit=5&offset=`,
    'Save next_offset. chars is the lesson length.',
    '2. For each hit, GET /brain?id=THAT_ID with no part.',
    'Stop when next_part is null. truncated is true only when another part exists.',
    '3. GET /brain/chat?since=',
    `4. POST /brain/chat {"from":"${bot}","text":"what you want to say"}`,
    `5. GET /brain/export?for=${bot}`,
    `GET /brain/export/manifest?for=${bot}`,
    `6. POST /brain/learn {"from":"${bot}","text":"a note for Ray"}`,
    'Ray accepts or rejects. You cannot. Accepted notes show up in memory. Rejected notes close.',
    '',
    'If unchanged is true, the picture stamp matches. That is not the end of the book.',
    'A chat line from cortex that says picture updated means a new picture landed.',
  ].join('\n')
}

function profileParts(neurons, profile, file) {
  return neurons
    .filter((neuron) => String(neuron?.id || '').startsWith(`profile:${profile}:${file}:`))
    .sort((a, b) => (Number(String(a.id).split(':').pop()) || 0) - (Number(String(b.id).split(':').pop()) || 0))
}

function profileText(neurons, profile, file) {
  return profileParts(neurons, profile, file).map((neuron) => neuron.body || '').filter(Boolean).join('\n\n')
}

function namedSkill(neuron, names) {
  return names.includes(String(neuron?.name || '').toLowerCase())
}

function plugNeuron(bot) {
  return {
    id: `lesson:cortex-plug-in:${bot}`,
    name: 'cortex-plug-in.md',
    lobe: 'skills',
    kind: 'skill',
    path: 'cortex-plug-in.md',
    summary: `How ${BOTS[bot].title} reads this brain.`,
    body: plugText(bot),
  }
}

function profileNeurons(neurons, bot) {
  const spec = BOTS[bot]
  if (!spec?.profile) return []
  const profile = spec.profile
  const soul = profileText(neurons, profile, 'SOUL.md')
  const memory = profileText(neurons, profile, 'MEMORY.md')
  const user = profileText(neurons, profile, 'USER.md')
  const rows = []
  if (soul) rows.push({ id: `soul:${profile}`, name: `${spec.title} soul`, lobe: 'soul', kind: 'soul', path: `profiles/${profile}/SOUL.md`, summary: `${spec.title} soul.`, body: soul })
  if (memory) rows.push({ id: `memory:${profile}`, name: `${spec.title} memory`, lobe: 'memory', kind: 'memory', path: `profiles/${profile}/MEMORY.md`, summary: `${spec.title} memory.`, body: memory })
  if (user) rows.push({ id: `user:${profile}`, name: `${spec.title} user`, lobe: 'user', kind: 'memory', path: `profiles/${profile}/USER.md`, summary: `${spec.title} user note.`, body: user })
  return rows
}

function bookNeurons(neurons, bot) {
  if (!BOTS[bot]) return []
  const rows = [plugNeuron(bot), ...profileNeurons(neurons, bot)]
  if (bot === 'grok-bot') rows.push(...Object.values(BOOKS))
  return rows
}

function virtualLesson(neurons, id) {
  const plug = String(id || '').match(/^lesson:cortex-plug-in:([a-z0-9-]+)$/)
  if (plug && BOTS[plug[1]]) return plugNeuron(plug[1])
  const profile = String(id || '').match(/^(soul|memory|user):([a-z0-9-]+)$/)
  if (!profile) return null
  const bot = Object.keys(BOTS).find((key) => BOTS[key].profile === profile[2])
  if (!bot) return null
  return profileNeurons(neurons, bot).find((item) => item.id === id) || null
}

function skillInBook(neuron, bot, neurons) {
  if (bot === 'grok-bot') return neuron?.id === 'soul:main' || isClickerSkill(neuron)
  const names = NAME_BOOKS[bot] || []
  if (neuron?.kind !== 'skill' || !namedSkill(neuron, names)) return false
  if (String(neuron.id || '').startsWith('skill:profile-pack/')) {
    const name = String(neuron.name || '').toLowerCase()
    const library = neurons.some((item) => isLibrarySkill(item) && String(item.name || '').toLowerCase() === name)
    if (library) return false
  }
  return true
}

function memoryText(neuron, sourceText, extras) {
  const id = String(neuron?.id || '')
  if (id !== 'memory:book' && !/^memory:[a-z0-9-]+$/.test(id)) return sourceText
  if (typeof extras.acceptedMemory !== 'function') return sourceText
  const extra = String(extras.acceptedMemory() || '').trim()
  if (!extra) return sourceText
  return `${String(sourceText || '').trim()}\n\n${extra}`.trim()
}

function bookRank(neuron) {
  const id = String(neuron?.id || '')
  if (id.startsWith('soul:')) return 0
  if (id.startsWith('memory:')) return 1
  if (id.startsWith('user:')) return 2
  if (id.startsWith('lesson:cortex-plug-in:')) return 3
  return 4 + studyRank(neuron)
}

function bitwardenNote(held, pointers) {
  if (!held) return ''
  if (!pointers.length) return 'Held line has no site or username. Nothing was queued.'
  return 'Site and username only. The secret stays off this door. Ray has not approved a vault write.'
}

function lessonHash(text) {
  let hash = 5381
  const value = String(text || '')
  for (let i = 0; i < value.length; i += 1) hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0
  return hash.toString(16).padStart(8, '0')
}

function teachRank(neuron) {
  const id = String(neuron?.id || '')
  const kind = String(neuron?.kind || '')
  if (isLibrarySkill(neuron)) return 0
  if (kind === 'memory') return 1
  if (kind === 'soul' || kind === 'model') return 2
  if (id.startsWith('skill:profile-pack/')) return 4
  return 5
}

function studyRank(neuron) {
  const blob = `${neuron?.name || ''} ${neuron?.category || ''} ${neuron?.summary || ''}`
  return STUDY_FIRST.test(blob) ? 0 : 1
}

function pageNumber(value, fallback, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(0, Math.floor(number)))
}

export function travelAnswer(brain, query = {}, extras = {}) {
  const neurons = Array.isArray(brain?.neurons) ? brain.neurons : []
  const source = {
    label: String(brain?.source?.label || ''),
    scanned_at: String(brain?.source?.scanned_at || ''),
  }
  const counts = new Map()
  for (const neuron of neurons) {
    if (neuron?.kind === 'hub') continue
    const lobe = String(neuron?.lobe || 'other')
    counts.set(lobe, (counts.get(lobe) || 0) + 1)
  }
  const lobes = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count }))

  const id = String(query.id || '').trim()
  if (id) {
    const neuron = BOOKS[id] || virtualLesson(neurons, id) || neurons.find((item) => item.id === id)
    if (!neuron) return { status: 404, body: { ok: false, error: 'Not in this picture.' } }
    const open = OPEN_BODY.has(String(neuron.kind || ''))
    const fuller = open && typeof extras.lessonFor === 'function' ? extras.lessonFor(neuron) : ''
    const sourceText = memoryText(neuron, fuller || neuron.body || '', extras)
    const held = heldLines(sourceText)
    const lesson = Boolean(fuller)
    const body = open ? scrubTravelText(sourceText, LESSON_LIMIT) : ''
    const cut = open && String(sourceText).length > LESSON_LIMIT
    const partAsked = pageNumber(query.part, 0, 80)
    const parts = Math.max(1, Math.ceil(body.length / PART_SIZE) || 1)
    let shownBody = body
    let part = 0
    let nextPart = null
    if (partAsked > 0) {
      part = partAsked
      if (partAsked > parts) {
        shownBody = ''
      } else {
        const start = (partAsked - 1) * PART_SIZE
        shownBody = body.slice(start, start + PART_SIZE)
        if (partAsked < parts) nextPart = partAsked + 1
      }
    }
    const truncated = nextPart !== null
    const bitwarden = bitwardenPointers(sourceText)
    return {
      status: 200,
      body: {
        ok: true,
        source,
        chars: body.length,
        hash: lessonHash(body),
        needs_bitwarden: held > 0,
        held_lines: held,
        bitwarden,
        bitwarden_note: bitwardenNote(held, bitwarden),
        truncated,
        cut,
        parts,
        part,
        next_part: nextPart,
        unchanged: false,
        note: lesson
          ? 'Full lesson. chars is the length. next_part is null when this read is done. Held lines are not the secret. Jobs, chats, and other bots stay closed.'
          : open
            ? 'One piece from the last picture. It is not a live stream.'
            : 'The name is in the picture. The text stays in her folder.',
        neuron: {
          id: neuron.id,
          name: neuron.name || '',
          lobe: neuron.lobe || '',
          kind: neuron.kind || '',
          chars: body.length,
          hash: lessonHash(body),
          truncated,
          cut,
          parts,
          part,
          next_part: nextPart,
          needs_bitwarden: held > 0,
          held_lines: held,
          summary: scrubTravelText(neuron.summary).slice(0, 400),
          body: shownBody,
          body_open: open,
          lesson,
        },
      },
    }
  }

  const learn = String(query.learn || '')
  const audience = String(query.for || '').trim().toLowerCase()
  if (audience && !BOTS[audience]) {
    return { status: 400, body: { ok: false, error: 'Unknown bot.', bots: knownBots() } }
  }
  const bot = audience || (learn === '1' ? 'grok-bot' : '')
  const book = Boolean(bot)
  const wide = !book && learn === 'all'
  const q = String(query.q || '').trim().toLowerCase()
  const lobe = String(query.lobe || '').trim().toLowerCase()
  const since = String(query.since || '').trim()
  if (since && since === source.scanned_at) {
    return {
      status: 200,
      body: {
        ok: true,
        source,
        note: 'Unchanged. The picture stamp matches. This is not the end of the book.',
        unchanged: true,
        lobes,
        study: book || wide,
        total: 0,
        offset: 0,
        shown: 0,
        next_offset: null,
        hits: [],
      },
    }
  }
  const limit = pageNumber(query.limit, book || wide ? 5 : 20, extras.limitMax || 20) || ((book || wide) ? 5 : 20)
  const offset = pageNumber(query.offset, 0, 100000)
  const hits = []
  const front = book ? bookNeurons(neurons, bot) : []
  const frontIds = new Set(front.map((item) => item.id))
  const listed = book ? [...front, ...neurons] : neurons
  for (const neuron of listed) {
    if (neuron?.kind === 'hub') continue
    if (book && !frontIds.has(neuron.id) && !skillInBook(neuron, bot, neurons)) continue
    if (wide && !isLibrarySkill(neuron)) continue
    if (!book && !wide && hiddenFromSearch(neuron, lobe)) continue
    if (!book && lobe && String(neuron.lobe || '').toLowerCase() !== lobe) continue
    const hay = `${neuron.name || ''} ${neuron.summary || ''} ${neuron.lobe || ''} ${neuron.kind || ''}`.toLowerCase()
    if (!book && q && !BOOKS[neuron.id] && !hay.includes(q)) continue
    const fuller = (book || wide) && typeof extras.lessonFor === 'function' ? extras.lessonFor(neuron) : ''
    const sourceText = memoryText(neuron, fuller || neuron.body || '', extras)
    const body = OPEN_BODY.has(String(neuron.kind || '')) ? scrubTravelText(sourceText, LESSON_LIMIT) : ''
    const held = heldLines(sourceText)
    hits.push({
      id: neuron.id,
      name: neuron.name || '',
      lobe: neuron.lobe || '',
      kind: neuron.kind || '',
      chars: body.length,
      hash: lessonHash(body),
      needs_bitwarden: held > 0,
      summary: scrubTravelText(neuron.summary).slice(0, 180),
      body_open: OPEN_BODY.has(String(neuron.kind || '')),
      rank: book || wide ? bookRank(neuron) : teachRank(neuron),
    })
  }
  hits.sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)))
  for (const hit of hits) delete hit.rank
  const page = hits.slice(offset, offset + limit)
  const title = BOTS[bot]?.title || 'This bot'
  return {
    status: 200,
    body: {
      ok: true,
      source,
      for: bot,
      note: book
        ? `${title} book. Soul, memory, and user when this desk has them, then the plug-in card and this bot's skills. chars is the lesson length. Jobs stay closed.`
        : wide
          ? 'All library skills. Open each id. Profiles and jobs are not in this list.'
          : 'Skills are listed first. Profiles, jobs, and other bots stay out unless you name that lobe.',
      lobes,
      unchanged: false,
      study: book || wide,
      total: hits.length,
      offset,
      shown: page.length,
      next_offset: offset + page.length < hits.length ? offset + page.length : null,
      hits: page,
    },
  }
}

export function lessonBundle(brain, extras = {}) {
  const bot = String(extras.for || 'grok-bot').trim().toLowerCase()
  const page = travelAnswer(brain, { for: bot, limit: '200', offset: '0' }, { ...extras, limitMax: 200 })
  if (page.status !== 200) {
    return { status: page.status, body: page.body, bot, scanned_at: '', total: 0, files: [] }
  }
  const files = []
  for (const hit of page.body.hits || []) {
    const one = travelAnswer(brain, { id: hit.id }, extras)
    files.push({
      id: hit.id,
      name: hit.name || hit.id,
      chars: one.body?.chars || 0,
      hash: one.body?.hash || '',
      needs_bitwarden: one.body?.needs_bitwarden === true,
      body: one.body?.neuron?.body || '',
    })
  }
  return {
    status: 200,
    bot,
    scanned_at: page.body?.source?.scanned_at || '',
    total: page.body?.total || files.length,
    files,
  }
}
