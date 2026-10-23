import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { notebookEntries } from './notebook.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadSpineId() {
  try {
    const file = path.join(root, 'src', 'owner-mark.local.js')
    if (!fs.existsSync(file)) return ''
    const text = fs.readFileSync(file, 'utf8')
    const match = text.match(/export const SPINE_ID = '([^']*)'/)
    return match ? match[1] : ''
  } catch {
    return ''
  }
}

const SPINE_ID = loadSpineId()

function ownerHost() {
  try {
    const line = fs.readFileSync(path.join(root, '.hermes-host'), 'utf8').split(/\r?\n/)[0].trim()
    if (!/^[\w.@:-]+$/.test(line)) return ''
    const at = line.lastIndexOf('@')
    return at >= 0 ? line.slice(at + 1) : line
  } catch {
    return ''
  }
}
const staging = path.join(root, 'staging')
const manifestPath = path.join(staging, 'manifest.json')
const ideasPath = path.join(staging, 'ideas.json')

function readJsonIf(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readHermesSelf() {
  const memory = path.join(os.homedir(), '.agent-memory')
  const self = readJsonIf(path.join(memory, 'HERMES-SELF.json')) || {}
  const notebook = readJsonIf(path.join(memory, 'HERMES-NOTEBOOK.json')) || {}
  let handoff = ''
  const handoffPath = path.join(memory, 'HERMES-HANDOFF.md')
  try {
    if (fs.existsSync(handoffPath)) handoff = fs.readFileSync(handoffPath, 'utf8').slice(0, 500)
  } catch {
    handoff = ''
  }
  return {
    who: self.who || 'Hermes',
    company: self.company || '',
    other_half: self.other_half || '',
    power: 'off',
    flash: false,
    last_grok: self.last_grok || null,
    itch: self.itch || null,
    handoff,
    notebook: notebook.notes || {},
    notebook_keys: notebookEntries(notebook.notes || {}),
    spine: '',
  }
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return { quarantine: [], drafts: {} }
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(data.quarantine)) data.quarantine = []
  if (!data.drafts || typeof data.drafts !== 'object') data.drafts = {}
  return data
}

function writeManifest(data) {
  fs.mkdirSync(staging, { recursive: true })
  const target = path.resolve(manifestPath)
  if (!target.startsWith(path.resolve(staging))) throw new Error('stage path escaped')
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8')
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 300_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, code, body) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function loadBrain() {
  const droplet = path.join(root, 'public', 'brain.droplet.json')
  const windows = path.join(root, 'public', 'brain.windows.json')
  const file = fs.existsSync(droplet) ? droplet : windows
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readIdeas() {
  if (!fs.existsSync(ideasPath)) return { ideas: [] }
  const data = JSON.parse(fs.readFileSync(ideasPath, 'utf8'))
  if (!Array.isArray(data.ideas)) data.ideas = []
  return data
}

function writeIdeas(data) {
  fs.mkdirSync(staging, { recursive: true })
  const target = path.resolve(ideasPath)
  if (!target.startsWith(path.resolve(staging))) throw new Error('ideas path escaped')
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8')
}

function looksLikeHome(home) {
  const markers = [
    'SOUL.md',
    'config.yaml',
    path.join('memories', 'MEMORY.md'),
    path.join('memories', 'USER.md'),
    'skills',
    'profiles',
  ]
  return markers.some((name) => fs.existsSync(path.join(home, name)))
}

function isRealDir(home, ...parts) {
  const target = path.join(home, ...parts)
  try {
    return fs.statSync(target).isDirectory() && !fs.lstatSync(target).isSymbolicLink()
  } catch {
    return false
  }
}

function looksLikeAgent(home) {
  let names = []
  try {
    names = fs.readdirSync(home).map((name) => name.toLowerCase())
  } catch {
    return false
  }
  const found = new Set(names)
  if (found.has('soul.md') || found.has('claude.md') || found.has('agents.md')) return true
  // A bare ~/.claude or ~/.cursor is global tool config, not a project home.
  if (isRealDir(home, '.claude', 'skills') || isRealDir(home, '.claude', 'commands')) return true
  if (isRealDir(home, '.cursor', 'rules') || fs.existsSync(path.join(home, '.cursor', 'mcp.json'))) return true
  if (found.has('.agents') || found.has('skills')) return true
  return looksLikeHome(home)
}

function spawnCapture(command, args, timeoutMs, windowsHide = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('timed out'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(err.trim() || out.trim() || `exit ${code}`))
      else resolve(out)
    })
  })
}

async function scanHome(home, label) {
  const script = path.join(root, 'scanner', 'scan_brain.py')
  const out = path.join(os.tmpdir(), `cortex-open-${randomBytes(6).toString('hex')}.json`)
  const scanArgs = [script, '--home', home, '--out', out, '--label', label, '--host', 'this PC']
  try {
    await runPython(scanArgs, 90_000)
    return JSON.parse(fs.readFileSync(out, 'utf8'))
  } finally {
    fs.rmSync(out, { force: true })
  }
}

function publicError(error) {
  return String(error?.message || error || 'update failed')
    .replace(/(token|secret|password|bearer)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/(^|[^A-Za-z0-9])((?:sk|xai)-[^\s"']+)/gi, '$1[redacted]')
    .replace(/[Cc]:[\\/][^\r\n"']+/g, '[redacted]')
    .replace(/\/home\/[^\r\n"']+/g, '[redacted]')
    .slice(0, 300)
}

let dropletScan = null

function updateDropletBrain() {
  if (dropletScan) return dropletScan
  const script = path.join(root, 'scan-droplet.ps1')
  dropletScan = spawnCapture(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    240_000,
  ).finally(() => {
    dropletScan = null
  })
  return dropletScan
}

function packStamp() {
  const now = new Date()
  const part = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`
}

function parsePackResult(output) {
  const line = String(output || '').split(/\r?\n/).map((item) => item.trim()).filter((item) => item.startsWith('{')).pop()
  if (!line) throw new Error('The pack did not report a result.')
  return JSON.parse(line)
}

async function runPython(args, timeoutMs) {
  const runners = [
    ['py', ['-3', ...args]],
    ['python', args],
    ['python3', args],
  ]
  let last = null
  for (const [command, commandArgs] of runners) {
    try {
      return await spawnCapture(command, commandArgs, timeoutMs)
    } catch (error) {
      last = error
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw last || new Error('Python is not available.')
}

function newestPack() {
  const packs = path.resolve(root, 'packs')
  if (!fs.existsSync(packs)) return null
  const found = fs.readdirSync(packs, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => path.join(packs, item.name))
    .filter((dir) => dir.startsWith(packs + path.sep) && fs.existsSync(path.join(dir, 'manifest.json')))
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return found[0] || null
}

function holdList(value) {
  const raw = Array.isArray(value) ? value : []
  const titles = []
  for (const item of raw) {
    const title = String(item || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, 80)
    if (!title || titles.includes(title)) continue
    titles.push(title)
    if (titles.length >= 40) break
  }
  return titles
}

async function buildLocalPack(home, label, options = {}) {
  const packs = path.resolve(root, 'packs')
  const out = path.join(packs, `local-${packStamp()}-${randomBytes(2).toString('hex')}`)
  if (!out.startsWith(packs + path.sep)) throw new Error('pack path escaped')
  fs.mkdirSync(packs, { recursive: true })
  const script = path.join(root, 'scanner', 'pack_brain.py')
  const args = [script, '--home', home, '--out', out, '--label', label]
  if (options.rulesOnly) args.push('--rules-only')
  for (const title of holdList(options.hold)) args.push('--hold', title)
  const output = await runPython(args, 120_000)
  return parsePackResult(output)
}

let serverPack = null

function buildServerPack() {
  if (serverPack) return serverPack
  const candidates = [
    path.join(root, 'pack-droplet.ps1'),
    path.join(root, 'scripts', 'pack-droplet.ps1'),
    path.join(os.tmpdir(), 'pack-droplet.ps1'),
  ]
  const script = candidates.find((item) => fs.existsSync(item))
  serverPack = spawnCapture(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    300_000,
  ).finally(() => {
    serverPack = null
  })
  return serverPack
}

async function verifyPack(folder) {
  const script = path.join(root, 'scanner', 'pack_brain.py')
  let args = [script, '--verify']
  if (!folder) {
    const last = lastBirth()
    const source = last && safeSource(last.source, last.dest)
    if (last && source && fs.existsSync(path.join(last.dest, 'manifest.json'))) {
      args.push(last.dest, '--home', source)
    } else {
      const pack = newestPack()
      if (!pack) {
        const error = new Error('Build a pack first.')
        error.status = 400
        throw error
      }
      args.push(pack)
    }
  } else if (fs.existsSync(path.join(folder, 'manifest.json'))) {
    args.push(folder)
  } else if (looksLikeAgent(folder)) {
    const pack = newestPack()
    if (!pack) {
      const error = new Error('Build a pack first.')
      error.status = 400
      throw error
    }
    args.push(pack, '--home', folder)
  } else {
    args.push(folder)
  }
  return parsePackResult(await runPython(args, 120_000))
}

function kinDestination() {
  const births = path.resolve(os.homedir(), 'Cortex Births')
  const dest = path.resolve(births, `kin-${packStamp()}-${randomBytes(2).toString('hex')}`)
  if (path.dirname(dest) !== births) throw new Error('kin path escaped')
  return dest
}

function birthPath(value) {
  const requested = String(value || '').trim()
  if (!requested || requested.includes('\0') || requested.length > 1024) {
    const error = new Error('Paste two birth folders, one path on each line.')
    error.status = 400
    throw error
  }
  const folder = path.resolve(requested)
  if (path.parse(folder).root === folder) {
    const error = new Error('Choose a birth folder, not a whole drive.')
    error.status = 400
    throw error
  }
  return folder
}

function oneLine(value, max) {
  return String(value || '').replace(/[\r\n]/g, ' ').slice(0, max)
}

function pathList(item, key) {
  const list = Array.isArray(item?.[key]) ? item[key] : []
  return list.map((entry) => oneLine(entry, 240)).filter(Boolean).slice(0, 8)
}

function publicKin(report) {
  const pair = (item) => {
    const title = oneLine(item?.title, 80).trim()
    if (!title) return null
    return { title, first: pathList(item, 'first'), second: pathList(item, 'second') }
  }
  const one = (item) => {
    const title = oneLine(item?.title, 80).trim()
    if (!title) return null
    return { title, paths: pathList(item, 'paths') }
  }
  const notes = (Array.isArray(report.instructions) ? report.instructions : []).slice(0, 40).map((item) => ({
    path: oneLine(item?.path, 240).trim(),
    side: item?.side === 'second' ? 'second' : 'first',
  })).filter((item) => item.path)
  return {
    ok: true,
    first: oneLine(report.first, 40).trim(),
    second: oneLine(report.second, 40).trim(),
    same: (report.same || []).map(pair).filter(Boolean).slice(0, 80),
    split: (report.split || []).map(pair).filter(Boolean).slice(0, 80),
    only_left: (report.only_left || []).map(one).filter(Boolean).slice(0, 80),
    only_right: (report.only_right || []).map(one).filter(Boolean).slice(0, 80),
    instructions: notes,
  }
}

async function compareBirths(left, right) {
  const script = path.join(root, 'scanner', 'pack_brain.py')
  const report = publicKin(parsePackResult(await runPython([script, '--kin', left, right], 120_000)))
  const dest = kinDestination()
  const file = path.join(dest, 'kin.json')
  if (path.dirname(file) !== dest) throw new Error('kin path escaped')
  fs.mkdirSync(dest, { recursive: true })
  try {
    fs.writeFileSync(file, JSON.stringify(report))
    const names = fs.readdirSync(dest)
    if (names.length !== 1 || names[0] !== 'kin.json') throw new Error('The comparison folder held more than kin.json.')
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw error
  }
  return { ...report, dest }
}

function birthDestination(homeKind) {
  const kind = String(homeKind || 'agent').toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'agent'
  const root = path.resolve(os.homedir(), 'Cortex Births')
  const dest = path.resolve(root, `${kind}-${packStamp()}-${randomBytes(2).toString('hex')}`)
  if (path.dirname(dest) !== root) throw new Error('birth path escaped')
  return dest
}

function openFolder(folder) {
  const child = spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' })
  child.unref()
}

function birthsIndexPath() {
  return path.join(staging, 'births.json')
}

function safeSource(source, dest) {
  const text = String(source || '').trim()
  if (!text || text.includes('\0') || text.length > 1024) return ''
  const resolved = path.resolve(text)
  const birth = path.resolve(dest)
  if (resolved === birth || resolved.startsWith(birth + path.sep) || birth.startsWith(resolved + path.sep)) return ''
  try {
    if (!fs.statSync(resolved).isDirectory()) return ''
  } catch {
    return ''
  }
  return resolved
}

function rememberBirth(dest, source, home) {
  const file = birthsIndexPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let data = { births: [] }
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    data = { births: [] }
  }
  if (!Array.isArray(data.births)) data.births = []
  const row = { dest, home: String(home || ''), at: new Date().toISOString() }
  const kept = safeSource(source, dest)
  if (kept) row.source = kept
  data.births.push(row)
  data.births = data.births.slice(-30)
  fs.writeFileSync(file, JSON.stringify(data))
}

function lastBirth() {
  try {
    const data = JSON.parse(fs.readFileSync(birthsIndexPath(), 'utf8'))
    const rows = Array.isArray(data.births) ? data.births : []
    return rows[rows.length - 1] || null
  } catch {
    return null
  }
}

function maskListedPath(value) {
  const text = String(value ?? '').replace(/[\r\n\0]/g, '')
  if (/(^|[^A-Za-z0-9])sk-/i.test(text) || /(^|[^A-Za-z0-9])xai-/i.test(text) || text.includes('AKIA')) {
    return 'hidden-path'
  }
  return text
}

function maskListedPaths(list) {
  return (Array.isArray(list) ? list : []).slice(0, 40).map((item) => maskListedPath(item))
}

async function birthPack(openAfter, source) {
  const preview = await readPackReceipt()
  const dest = birthDestination(preview.home)
  const kept = safeSource(source, dest)
  if (kept) {
    const pack = newestPack()
    const script = path.join(root, 'scanner', 'pack_brain.py')
    const report = parsePackResult(await runPython([script, '--verify', pack, '--home', kept], 120_000))
    const stale = Number(report.stale) || 0
    const grew = Array.isArray(report.grew) ? report.grew : []
    if (!report.ok || stale > 0 || grew.length) {
      const error = new Error('The agent changed since Build. Press Build again before Birth.')
      error.status = 409
      error.stale = stale
      error.stale_files = maskListedPaths(report.stale_files)
      error.grew = maskListedPaths(grew)
      throw error
    }
  }
  const result = await installNewestPack(dest)
  result.dest = dest
  result.line = 'Born.'
  result.note = 'Do not paste this folder into the agent that is already open. Keys and chats were not copied. The Cortex note at the top of the file this agent loads is the instruction. Stop and ask a person before a send, a push, or a delete. Nothing in this folder stops those.'
  rememberBirth(dest, source, result.home || preview.home)
  if (openAfter) openFolder(dest)
  return result
}

async function readPackReceipt() {
  const pack = newestPack()
  if (!pack) {
    const error = new Error('Build a pack first.')
    error.status = 400
    throw error
  }
  const script = path.join(root, 'scanner', 'pack_brain.py')
  return parsePackResult(await runPython([script, '--receipt', pack], 60_000))
}

async function installNewestPack(dest) {
  const pack = newestPack()
  if (!pack) throw new Error('Build a pack first.')
  const script = path.join(root, 'scanner', 'pack_brain.py')
  const output = await runPython([script, '--pack', pack, '--dest', dest], 120_000)
  const result = parsePackResult(output)
  result.dest = dest
  result.pack = path.basename(pack)
  result.line = 'Placed.'
  return result
}

function pickHome() {
  const command = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Choose a Hermes home'",
    '$dialog.ShowNewFolderButton = $false',
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($dialog.SelectedPath) }",
  ].join('; ')
  return spawnCapture('powershell.exe', ['-NoProfile', '-STA', '-Command', command], 120_000, false)
}

function homeFromBody(payload) {
  const requested = String(payload.path || '').trim()
  if (!requested || requested.includes('\0') || requested.length > 1024) {
    const error = new Error('bad path')
    error.status = 400
    throw error
  }
  const home = path.resolve(requested)
  if (path.parse(home).root === home) {
    const error = new Error('Choose a folder, not a whole drive.')
    error.status = 400
    throw error
  }
  return home
}

function stagePlugin() {
  return {
    name: 'hermes-stage',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        if (url.pathname === '/api/explore') {
          try {
            const brain = loadBrain()
            if (!brain) return sendJson(res, 404, { error: 'no scan yet' })
            const neurons = brain.neurons || []
            const id = url.searchParams.get('id') || ''
            if (id) {
              const neuron = neurons.find((item) => item.id === id)
              if (!neuron) return sendJson(res, 404, { error: 'not in this scan' })
              return sendJson(res, 200, {
                source: brain.source || {},
                neuron: {
                  id: neuron.id,
                  name: neuron.name,
                  lobe: neuron.lobe,
                  category: neuron.category || '',
                  path: neuron.path || '',
                  summary: String(neuron.summary || '').slice(0, 400),
                  body: String(neuron.body || '').slice(0, 4000),
                },
              })
            }
            const q = (url.searchParams.get('q') || '').trim().toLowerCase()
            const lobe = (url.searchParams.get('lobe') || '').trim().toLowerCase()
            const limitRaw = Number(url.searchParams.get('limit') || 40)
            const limit = Number.isFinite(limitRaw) ? Math.min(40, Math.max(1, Math.floor(limitRaw))) : 40
            const pageRaw = Number(url.searchParams.get('page') || 0)
            const page = Number.isFinite(pageRaw) ? Math.max(0, Math.floor(pageRaw)) : 0
            const offsetRaw = Number(url.searchParams.get('offset') || (page > 0 ? (page - 1) * limit : 0))
            const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0
            const hits = []
            for (const neuron of neurons) {
              if (neuron.kind === 'hub') continue
              if (lobe && String(neuron.lobe || '').toLowerCase() !== lobe) continue
              const hay = `${neuron.name} ${neuron.summary || ''} ${neuron.category || ''} ${neuron.lobe || ''}`.toLowerCase()
              if (q && !hay.includes(q)) continue
              hits.push({
                id: neuron.id,
                name: neuron.name,
                lobe: neuron.lobe,
                category: neuron.category || '',
                summary: String(neuron.summary || '').slice(0, 180),
              })
            }
            const pageHits = hits.slice(offset, offset + limit)
            return sendJson(res, 200, {
              source: brain.source || {},
              stats: brain.stats || {},
              total: hits.length,
              offset,
              shown: pageHits.length,
              neurons: pageHits,
            })
          } catch (error) {
            return sendJson(res, 500, { error: error.message || 'explore failed' })
          }
        }
        if (url.pathname === '/api/hermes-self') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
          return sendJson(res, 200, readHermesSelf())
        }
        if (url.pathname === '/api/ideas') {
          try {
            if (req.method === 'GET') return sendJson(res, 200, readIdeas())
            if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
            const payload = JSON.parse(await readBody(req))
            const text = String(payload.text || '').trim().slice(0, 2000)
            if (!text) return sendJson(res, 400, { error: 'text required' })
            const from = String(payload.from || 'hermes').replace(/[^\w .:-]/g, '').slice(0, 40) || 'hermes'
            const data = readIdeas()
            data.ideas.push({ at: new Date().toISOString(), from, text })
            if (data.ideas.length > 100) data.ideas = data.ideas.slice(-100)
            writeIdeas(data)
            return sendJson(res, 200, { ok: true, count: data.ideas.length })
          } catch (error) {
            return sendJson(res, 500, { error: error.message || 'ideas failed' })
          }
        }
        if (url.pathname === '/api/pick-home') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const picked = (await pickHome()).trim()
            return sendJson(res, 200, { path: picked })
          } catch (error) {
            return sendJson(res, 500, { error: error.message || 'dialog failed' })
          }
        }
        if (url.pathname === '/api/update-brain') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          if (dropletScan) return sendJson(res, 409, { error: 'Update already running.' })
          try {
            await updateDropletBrain()
            const file = path.join(root, 'public', 'brain.droplet.json')
            const brain = JSON.parse(fs.readFileSync(file, 'utf8'))
            const stats = brain.stats || {}
            const source = brain.source || {}
            const expected = ownerHost()
            if (!expected || source.host !== expected) {
              return sendJson(res, 500, { error: 'Scan did not come from the server on this PC.' })
            }
            return sendJson(res, 200, {
              ok: true,
              label: source.label || 'Droplet Hermes',
              scanned_at: source.scanned_at || '',
              neurons: stats.neurons || 0,
              skills: stats.skills || 0,
              jobs: stats.jobs || 0,
              profiles: stats.profiles || 0,
            })
          } catch (error) {
            return sendJson(res, 500, { error: publicError(error) })
          }
        }
        if (url.pathname === '/api/pack') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const payload = JSON.parse(await readBody(req))
            const home = homeFromBody(payload)
            if (!fs.existsSync(home) || !fs.statSync(home).isDirectory()) {
              return sendJson(res, 400, { error: 'Folder not found.' })
            }
            if (!looksLikeAgent(home)) return sendJson(res, 400, { error: 'That folder does not look like an agent home.' })
            const label = path.basename(home).replace(/[^\w .\-]/g, '').slice(0, 60) || 'Opened Hermes'
            return sendJson(res, 200, await buildLocalPack(home, label, {
              rulesOnly: payload.rules_only === true,
              hold: payload.hold,
            }))
          } catch (error) {
            return sendJson(res, error.status || 500, { error: publicError(error) })
          }
        }
        if (url.pathname === '/api/pack-server') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          return sendJson(res, 400, { error: 'A server pack is not part of this cut. Paste a folder on this PC.' })
        }
        if (url.pathname === '/api/birth') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const raw = await readBody(req)
            const payload = raw ? JSON.parse(raw) : {}
            return sendJson(res, 200, await birthPack(payload.open !== false, payload.source))
          } catch (error) {
            const body = { error: publicError(error), ok: false }
            if (Array.isArray(error.stale_files)) body.stale_files = error.stale_files
            if (Array.isArray(error.grew)) body.grew = error.grew
            if (typeof error.stale === 'number') body.stale = error.stale
            return sendJson(res, error.status || 500, body)
          }
        }
        if (url.pathname === '/api/pack-receipt') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            return sendJson(res, 200, await readPackReceipt())
          } catch (error) {
            return sendJson(res, error.status || 500, { error: publicError(error) })
          }
        }
        if (url.pathname === '/api/kin') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const payload = JSON.parse(await readBody(req) || '{}')
            const left = birthPath(payload.left)
            const right = birthPath(payload.right)
            if (left === right) return sendJson(res, 400, { error: 'Pick two different births.', ok: false })
            return sendJson(res, 200, await compareBirths(left, right))
          } catch (error) {
            return sendJson(res, error.status || 400, { error: publicError(error), ok: false })
          }
        }
        if (url.pathname === '/api/verify-pack') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const payload = JSON.parse(await readBody(req) || '{}')
            const requested = String(payload.path || '').trim()
            const folder = requested ? homeFromBody(payload) : ''
            return sendJson(res, 200, await verifyPack(folder))
          } catch (error) {
            return sendJson(res, error.status || 500, { error: publicError(error) })
          }
        }
        if (url.pathname === '/api/install-pack') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const dest = homeFromBody(JSON.parse(await readBody(req)))
            if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory()) {
              return sendJson(res, 400, { error: 'Choose an empty folder.' })
            }
            return sendJson(res, 200, await installNewestPack(dest))
          } catch (error) {
            return sendJson(res, error.status || 500, { error: publicError(error) })
          }
        }
        if (url.pathname === '/api/scan-home') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const home = homeFromBody(JSON.parse(await readBody(req)))
            if (!fs.existsSync(home) || !fs.statSync(home).isDirectory()) {
              return sendJson(res, 400, { error: 'Folder not found.' })
            }
            if (!looksLikeHome(home)) {
              return sendJson(res, 400, { error: 'That folder does not look like a Hermes home. It needs skills, memories, SOUL.md, profiles, or config.yaml.' })
            }
            const label = path.basename(home).replace(/[^\w .\-]/g, '').slice(0, 60) || 'Opened Hermes'
            return sendJson(res, 200, await scanHome(home, label))
          } catch (error) {
            return sendJson(res, error.status || 500, { error: publicError(error) })
          }
        }
        if (url.pathname !== '/api/stage') return next()
        res.setHeader('content-type', 'application/json')
        try {
          if (req.method === 'GET') {
            res.end(JSON.stringify(readManifest()))
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ error: 'POST only' }))
            return
          }
          const payload = JSON.parse(await readBody(req))
          const id = String(payload.id || '')
          if (id.includes('..') || id.startsWith('/') || id.includes('\\') || !/^[a-zA-Z0-9:._/|\-]{1,180}$/.test(id)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'bad id' }))
            return
          }
          if (payload.op === 'quarantine' && id === SPINE_ID) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'That neuron stays.' }))
            return
          }
          const state = readManifest()
          if (payload.op === 'quarantine') {
            if (!state.quarantine.includes(id)) state.quarantine.push(id)
          } else if (payload.op === 'restore') {
            state.quarantine = state.quarantine.filter((item) => item !== id)
          } else if (payload.op === 'draft') {
            state.drafts[id] = String(payload.text || '').slice(0, 20_000)
          } else if (payload.op === 'clear-draft') {
            delete state.drafts[id]
          } else {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'bad op' }))
            return
          }
          writeManifest(state)
          res.end(JSON.stringify(state))
        } catch (error) {
          if (!res.writableEnded) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: publicError(error) }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  root,
  plugins: [stagePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5179,
    strictPort: true,
    watch: { ignored: ['**/packs/**'] },
  },
})
