/** Plain lines for a birth comparison. Titles only. Skill text is not copied. */

const SECRET = /api[_-]?key\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S{8,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-z0-9]{12,}|xai-[a-z0-9]{12,}|bws_[a-z0-9_-]{8,}|AKIA[0-9A-Z]{16}/i
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{10,11}\b/
const HASH = /\b[a-f0-9]{64}\b/i
const SECRET_NAME = /auth\.json|\.env(?:\.local)?\b|credentials\.json|client_secret|google_token|secrets\.json|id_ed25519|\bcredential/i
const UNREAD = 'The comparison could not be read.'
const CAP = 12

function looksSecret(text) {
  return SECRET.test(text) || EMAIL.test(text) || PHONE.test(text) || HASH.test(text) || SECRET_NAME.test(text)
}

function cleanTitle(value) {
  const raw = String(value || '')
  if (!raw.trim()) return ''
  if (looksSecret(raw)) return 'hidden-title'
  const line = raw.replace(/[\r\n]+/g, ' ').replace(/[ \t]+/g, ' ').trim()
  if (!line || looksSecret(line)) return line ? 'hidden-title' : ''
  return line.slice(0, 80)
}

function itemTitle(item) {
  if (typeof item === 'string') return cleanTitle(item)
  if (!item || typeof item !== 'object' || typeof item.title !== 'string') return ''
  return cleanTitle(item.title)
}

function titlesFrom(list) {
  if (!Array.isArray(list)) return []
  const titles = []
  for (const item of list) {
    const title = itemTitle(item)
    if (title) titles.push(title)
  }
  return titles
}

function capLines(titles) {
  if (titles.length <= CAP) return titles.slice()
  const rest = titles.length - CAP
  return titles.slice(0, CAP).concat(`${rest} more`)
}

function isBirthComparison(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return false
  if (report.ok === false) return false
  if (typeof report.error === 'string' && report.error) return false
  return ['same', 'split', 'only_left', 'only_right'].every((key) => Array.isArray(report[key]))
}

function clause(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`
}

function leadSentence(same, split, only) {
  return `${clause(same, 'skill matches', 'skills match')}, ${clause(split, 'skill splits', 'skills split')}, and ${clause(only, 'skill sits', 'skills sit')} on only one side.`
}

function emptyView(lead) {
  return { lead, same: [], split: [], onlyLeft: [], onlyRight: [] }
}

export function plainKin(report) {
  if (!isBirthComparison(report)) return emptyView(UNREAD)
  const same = titlesFrom(report.same)
  const split = titlesFrom(report.split)
  const onlyLeft = titlesFrom(report.only_left)
  const onlyRight = titlesFrom(report.only_right)
  return {
    lead: leadSentence(same.length, split.length, onlyLeft.length + onlyRight.length),
    same: capLines(same),
    split: capLines(split),
    onlyLeft: capLines(onlyLeft),
    onlyRight: capLines(onlyRight),
  }
}

function instructionNote(report) {
  if (!Array.isArray(report?.instructions) || report.instructions.length === 0) return ''
  return ' Instruction files are named only.'
}

export function kinPlain(report) {
  if (!isBirthComparison(report)) return UNREAD
  const same = titlesFrom(report.same).length
  const split = titlesFrom(report.split).length
  const left = titlesFrom(report.only_left).length
  const right = titlesFrom(report.only_right).length
  return `${same} same, ${split} split, ${left} only in the first birth, ${right} only in the second. Skill text was not copied.${instructionNote(report)}`
}

export function selfCheck() {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }
  const keys = ['lead', 'same', 'split', 'onlyLeft', 'onlyRight']
  const unread = (report) => {
    const view = plainKin(report)
    check(view.lead === UNREAD, 'unreadable lead')
    check(view.same.length === 0 && view.split.length === 0 && view.onlyLeft.length === 0 && view.onlyRight.length === 0, 'unreadable lists')
    check(kinPlain(report) === UNREAD, 'unreadable sentence')
  }

  unread(undefined)
  unread(null)
  unread('birth')
  unread(4)
  unread([])
  unread({ ok: true, files: 3, home: 'Hermes' })
  unread({ ok: false, same: [], split: [], only_left: [], only_right: [] })
  unread({ error: 'missing birth', same: [], split: [], only_left: [], only_right: [] })
  unread({ same: [], split: [], only_left: [] })

  const empty = { same: [], split: [], only_left: [], only_right: [] }
  const emptyViewResult = plainKin(empty)
  check(emptyViewResult.lead === '0 skills match, 0 skills split, and 0 skills sit on only one side.', 'empty lead')
  check(emptyViewResult.same.length === 0 && emptyViewResult.split.length === 0 && emptyViewResult.onlyLeft.length === 0 && emptyViewResult.onlyRight.length === 0, 'empty lists')
  check(kinPlain(empty) === '0 same, 0 split, 0 only in the first birth, 0 only in the second. Skill text was not copied.', 'empty sentence')

  const leftOnly = { ok: true, same: [], split: [], only_left: [{ title: 'solo' }], only_right: [] }
  const leftView = plainKin(leftOnly)
  check(leftView.lead === '0 skills match, 0 skills split, and 1 skill sits on only one side.', 'one side lead')
  check(leftView.onlyLeft.length === 1 && leftView.onlyLeft[0] === 'solo', 'one side title')
  check(leftView.same.length === 0 && leftView.split.length === 0 && leftView.onlyRight.length === 0, 'one side other lists')
  check(kinPlain(leftOnly) === '0 same, 0 split, 1 only in the first birth, 0 only in the second. Skill text was not copied.', 'one side sentence')

  const rightOnly = { ok: true, same: [], split: [], only_left: [], only_right: ['kept'] }
  const rightView = plainKin(rightOnly)
  check(rightView.onlyRight[0] === 'kept', 'string title on the right')
  check(rightView.lead === '0 skills match, 0 skills split, and 1 skill sits on only one side.', 'right side lead')

  const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const email = 'ray@example.com'
  const token = 'sk-abcdefghijklmnopqrstuvwxyz'
  const body = 'beta-hermes body stays in the birth'
  const report = {
    ok: true,
    first: 'Hermes',
    second: 'Claude',
    dest: `C:/Users/${email}/Cortex Births/kin`,
    same: [{ title: 'alpha', sha256: hash, body: 'alpha-same' }],
    split: [{ title: 'beta', body, first: [`skills/${email}/SKILL.md`], second: ['skills/beta/SKILL.md'] }],
    only_left: [
      { title: 'gamma' },
      { title: email },
      { title: token },
      { title: hash },
      { title: '555-010-0199' },
      { title: 'password = sample-value' },
      { title: '  ' },
      { body: 'only a body' },
    ],
    only_right: [{ title: 'delta', paths: [`skills/${token}/SKILL.md`, 'skills/delta/SKILL.md'] }],
    instructions: [{ path: `notes/${email}.md`, side: 'first', body: 'instruction body' }],
  }
  const mixed = plainKin(report)
  check(JSON.stringify(Object.keys(mixed)) === JSON.stringify(keys), 'return keys')
  check(mixed.lead === '1 skill matches, 1 skill splits, and 7 skills sit on only one side.', 'mixed lead')
  check(mixed.same.join('|') === 'alpha', 'same titles')
  check(mixed.split.join('|') === 'beta', 'split titles')
  check(mixed.onlyRight.join('|') === 'delta', 'right titles')
  check(mixed.onlyLeft[0] === 'gamma', 'plain left title')
  check(mixed.onlyLeft.filter((line) => line === 'hidden-title').length === 5, 'hidden titles')
  check(!mixed.onlyLeft.some((line) => line !== 'gamma' && line !== 'hidden-title'), 'left lines are titles')
  const blob = JSON.stringify(mixed) + kinPlain(report)
  const leaks = [
    [hash, 'hash leaked'],
    [email, 'email leaked'],
    [token, 'token leaked'],
    [body, 'body leaked'],
    ['alpha-same', 'same body leaked'],
    ['sample-value', 'password leaked'],
    ['only a body', 'untitled body leaked'],
    ['instruction body', 'instruction leaked'],
    ['skills/delta/SKILL.md', 'path leaked'],
    ['skills/beta/SKILL.md', 'split path leaked'],
  ]
  for (const [needle, label] of leaks) check(!blob.includes(needle), label)
  check(!/[\r\n]/.test(mixed.same.concat(mixed.split, mixed.onlyLeft, mixed.onlyRight).join('\u0000')), 'lines stay single')

  const blanks = plainKin({
    ok: true,
    same: [{ title: 'token counter' }, { title: 'First line\nSecond line' }],
    split: [{ title: 'api notes' }],
    only_left: [],
    only_right: [],
  })
  check(blanks.same[0] === 'token counter', 'ordinary token word stays')
  check(blanks.same[1] === 'First line Second line', 'newline collapsed')
  check(blanks.split[0] === 'api notes', 'ordinary api word stays')
  check(blanks.lead === '2 skills match, 1 skill splits, and 0 skills sit on only one side.', 'word lead')

  const secrets = plainKin({
    ok: true,
    same: [
      { title: 'AKIAAAAAAAAAAAAAAAAA' },
      { title: 'xai-aaaaaaaaaaaa' },
      { title: 'bearer abcdefghijklmnop' },
      { title: 'client_secret.json' },
    ],
    split: [],
    only_left: [],
    only_right: [],
  })
  check(secrets.same.every((line) => line === 'hidden-title'), 'secret shaped titles')
  check(secrets.lead.startsWith('4 skills match'), 'secret titles still count')
  const secretBlob = JSON.stringify(secrets)
  check(!secretBlob.includes('AKIA') && !secretBlob.includes('xai-') && !secretBlob.includes('bearer') && !secretBlob.includes('client_secret'), 'secret labels absent')

  const manyTitles = Array.from({ length: 15 }, (_, index) => ({ title: `skill-${index}` }))
  const many = plainKin({ ok: true, same: manyTitles, split: manyTitles, only_left: [], only_right: [] })
  check(many.same.length === 13 && many.same[12] === '3 more', 'same cap and rest')
  check(many.same[0] === 'skill-0' && many.same[11] === 'skill-11' && !many.same.includes('skill-12'), 'same shows twelve')
  check(many.split[12] === '3 more', 'split cap')
  check(many.lead.startsWith('15 skills match, 15 skills split'), 'lead uses the full count')

  const exact = plainKin({
    ok: true,
    same: Array.from({ length: 12 }, (_, index) => `exact-${index}`),
    split: [],
    only_left: [],
    only_right: [],
  })
  check(exact.same.length === 12 && exact.same.every((line) => !line.includes('more')), 'twelve has no rest line')

  const longTitle = `${'n'.repeat(90)} tail`
  const longView = plainKin({ ok: true, same: [{ title: longTitle }], split: [], only_left: [], only_right: [] })
  check(longView.same[0].length === 80 && longView.same[0].startsWith('nnn') && !longView.same[0].includes('tail'), 'long title capped')

  const pathTitles = plainKin({
    ok: true,
    same: [{ title: `skills/${email}/SKILL.md` }],
    split: [{ title: `skills/${hash}/SKILL.md` }],
    only_left: [{ title: 'skills/.env/SKILL.md' }],
    only_right: [{ title: 'redacted title' }],
  })
  check(pathTitles.same[0] === 'hidden-title', 'email path title hidden')
  check(pathTitles.split[0] === 'hidden-title', 'hash path title hidden')
  check(pathTitles.onlyLeft[0] === 'hidden-title', 'env path title hidden')
  check(pathTitles.onlyRight[0] === 'redacted title', 'redacted label stays')
  check(pathTitles.lead === '1 skill matches, 1 skill splits, and 2 skills sit on only one side.', 'path title lead')
  const pathBlob = JSON.stringify(pathTitles)
  check(!pathBlob.includes(email) && !pathBlob.includes(hash) && !pathBlob.includes('.env'), 'path titles do not leak')

  const notedReport = {
    ok: true,
    same: [],
    split: [],
    only_left: [],
    only_right: [],
    instructions: [{ path: `notes/${email}.md`, side: 'first', body: 'instruction body' }],
  }
  const noted = kinPlain(notedReport)
  check(noted === '0 same, 0 split, 0 only in the first birth, 0 only in the second. Skill text was not copied. Instruction files are named only.', 'instructions named only')
  check(!noted.includes(email) && !noted.includes('instruction body') && !noted.includes('notes/'), 'instruction path stays off the sentence')
  check(kinPlain({ ...empty, instructions: [] }) === kinPlain(empty), 'empty instruction list adds nothing')
  check(!kinPlain(report).includes('notes/') && kinPlain(report).endsWith('Instruction files are named only.'), 'mixed instructions stay unnamed')

  return failures.length ? failures : { ok: true }
}

function ranAsScript() {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) return false
  const entry = String(process.argv[1] || '').replace(/\\/g, '/')
  return /(^|\/)kin-plain\.js$/.test(entry)
}

if (ranAsScript()) {
  const result = selfCheck()
  if (!result || result.ok !== true) {
    const failures = Array.isArray(result) ? result : ['selfCheck failed']
    for (const failure of failures) console.error(failure)
    process.exitCode = 1
  } else {
    console.log(kinPlain({ same: [], split: [], only_left: [], only_right: [] }))
    console.log('ok')
  }
}
