const SECRET = /api[_-]?key\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S{8,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-z0-9]{12,}|xai-[a-z0-9]{12,}|bws_[a-z0-9_-]{8,}|AKIA[0-9A-Z]{16}/i
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{10,11}\b/

const STOP = new Set(
  'that this with from your their them they have been were will just into over also only when what about after before there here does'.split(' '),
)

function maskShown(text) {
  return String(text || '')
    .replace(new RegExp(SECRET.source, 'gi'), '[secret]')
    .replace(new RegExp(EMAIL.source, 'g'), '[email]')
    .replace(new RegExp(PHONE.source, 'g'), '[phone]')
}

function hideBreaks(text) {
  const swap = (match) => match.replace(/[.!?]/g, '\u0003')
  return String(text || '')
    .replace(new RegExp(SECRET.source, 'gi'), swap)
    .replace(new RegExp(EMAIL.source, 'g'), swap)
    .replace(new RegExp(PHONE.source, 'g'), swap)
}

function showBreaks(text) {
  return String(text || '').replace(/\u0003/g, '.')
}

function clipShown(text, limit = 140) {
  const value = maskShown(text)
  if (value.length <= limit) return value
  const cut = value.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return space > 40 ? cut.slice(0, space) : cut
}

function flag(neuron, code, text) {
  const shown = maskShown(text)
  if (!shown) return
  if (!neuron.health) neuron.health = []
  if (neuron.health.some((item) => item.code === code)) return
  neuron.health.push({ code, text: shown })
}

function jobSkills(neuron) {
  if (Array.isArray(neuron.skill_names) && neuron.skill_names.length) {
    return neuron.skill_names.map((item) => String(item).trim()).filter(Boolean)
  }
  const line = String(neuron.body || '').split('\n').find((item) => item.startsWith('Skills: '))
  if (!line) return []
  const rest = line.slice('Skills: '.length).trim()
  if (!rest || rest.toLowerCase() === 'none') return []
  return rest.split(',').map((item) => item.trim()).filter(Boolean)
}

function skillKnown(name, skills) {
  const needle = String(name).toLowerCase().replace(/\\/g, '/')
  const tail = needle.split('/').filter(Boolean).pop() || ''
  if (tail.length < 2) return true
  return skills.some((skill) => {
    const skillName = String(skill.name || '').toLowerCase()
    const id = String(skill.id || '').toLowerCase()
    const folder = String(skill.path || '').toLowerCase().replace(/\\/g, '/')
    return skillName === needle || skillName === tail || id.endsWith(`/${tail}`) || folder.includes(`/${tail}/skill.md`)
  })
}

function copyText(neuron) {
  const copies = Array.isArray(neuron.copies) ? neuron.copies.map((item) => String(item).trim()).filter(Boolean) : []
  if (copies.length >= 2) return `This skill is copied across ${copies.join(', ')}.`
  if (copies.length === 1) return `This skill is also on the ${copies[0]} profile, and the main library already has it.`
  const match = hideBreaks(String(neuron.summary || '')).match(/^On ([^.]+)\./)
  if (match && match[1].includes(',')) return `This skill is copied across ${showBreaks(match[1].trim())}.`
  return ''
}

function sentences(text) {
  return hideBreaks(text)
    .split(/[\n.!?]+/)
    .map((item) => showBreaks(item).trim())
    .filter((item) => item.length > 18 && item.length < 280)
}

function polarity(sentence) {
  const value = sentence.toLowerCase()
  if (/\b(do not|don't|dont|never|must not|cannot|can't)\b/.test(value)) return 'no'
  if (/\b(always|must)\b/.test(value)) return 'yes'
  return ''
}

function contentTokens(sentence) {
  const found = []
  for (const raw of sentence.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    const token = raw.replace(/^-+|-+$/g, '')
    if (token.length < 5 || STOP.has(token)) continue
    if (!found.includes(token)) found.push(token)
  }
  return found
}

function ruleNeurons(neurons) {
  return neurons.filter((neuron) => neuron.lobe === 'user' || neuron.kind === 'soul' || neuron.lobe === 'soul')
}

function memoryNeurons(neurons) {
  return neurons.filter((neuron) => neuron.kind === 'memory' && neuron.lobe !== 'user')
}

function contradictions(neurons) {
  const rules = []
  for (const neuron of ruleNeurons(neurons)) {
    const text = `${neuron.name}\n${neuron.summary || ''}\n${neuron.body || ''}`
    for (const sentence of sentences(text)) {
      const side = polarity(sentence)
      const tokens = contentTokens(sentence)
      if (!side || tokens.length < 2) continue
      rules.push({ neuron, side, tokens, sentence })
    }
  }
  const hits = []
  for (const neuron of memoryNeurons(neurons)) {
    const text = `${neuron.name}\n${neuron.summary || ''}\n${neuron.body || ''}`
    let marked = false
    for (const sentence of sentences(text)) {
      if (marked) break
      const side = polarity(sentence)
      const tokens = contentTokens(sentence)
      if (!side || tokens.length < 2) continue
      for (const rule of rules) {
        if (rule.side === side) continue
        const shared = rule.tokens.filter((token) => tokens.includes(token))
        if (shared.length < 2) continue
        const who = rule.neuron.lobe === 'user' ? 'USER' : 'SOUL'
        const excerpt = clipShown(rule.sentence)
        hits.push({
          neuron,
          text: `This memory conflicts with a ${who} rule that says “${excerpt}”.`,
        })
        marked = true
        break
      }
    }
    if (hits.length >= 12) break
  }
  return hits
}

function looksSecret(neuron) {
  const text = `${neuron.name || ''}\n${neuron.path || ''}\n${neuron.summary || ''}\n${neuron.body || ''}`
  if (/secret values in config were not loaded/i.test(text) && !/\[redacted\]/i.test(text) && !SECRET.test(text)) {
    return ''
  }
  if (SECRET.test(text)) return 'This neuron still looks like it holds a key or a token.'
  if (/\[redacted\]/i.test(text)) return 'A secret-shaped line was removed from this neuron, and the value is not in the view.'
  return ''
}

export function applyHealth(brain) {
  const neurons = Array.isArray(brain?.neurons) ? brain.neurons : []
  for (const neuron of neurons) neuron.health = []
  const skills = neurons.filter((neuron) => neuron.kind === 'skill')

  for (const neuron of skills) {
    const text = copyText(neuron)
    if (text) flag(neuron, 'copy', text)
  }

  for (const neuron of neurons) {
    if (neuron.kind !== 'job' || neuron.id === 'job:none') continue
    const missing = jobSkills(neuron).filter((name) => !skillKnown(name, skills))
    if (!missing.length) continue
    const shown = missing.slice(0, 3).join(', ')
    const tail = missing.length === 1 ? 'that skill is not in this brain' : 'those skills are not in this brain'
    flag(neuron, 'missing', `This job asks for ${shown}, and ${tail}.`)
  }

  for (const hit of contradictions(neurons)) flag(hit.neuron, 'conflict', hit.text)

  for (const neuron of neurons) {
    if (neuron.kind === 'hub') continue
    const text = looksSecret(neuron)
    if (text) flag(neuron, 'secret', text)
  }

  const profileCount = neurons.filter((neuron) => neuron.lobe === 'profiles').length
  const crowded = profileCount >= 80 || (neurons.length > 0 && profileCount / neurons.length > 0.28)
  if (crowded) {
    for (const neuron of neurons) {
      if (neuron.kind !== 'profile') continue
      flag(neuron, 'crowd', `Profiles hold ${profileCount} neurons, and that lobe is crowding the rest of the brain.`)
    }
  }

  const counts = { copy: 0, missing: 0, conflict: 0, secret: 0, crowd: 0, total: 0 }
  for (const neuron of neurons) {
    if (!neuron.health.length) continue
    counts.total += 1
    for (const item of neuron.health) counts[item.code] += 1
  }
  brain.health = counts
  return brain
}
