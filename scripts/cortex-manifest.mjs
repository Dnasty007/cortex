/** Hash a GLB into a cortex-avatar-1 manifest. The hash check is the release gate. */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FORMAT = 'cortex-avatar-1'
const HASH = /^[a-f0-9]{64}$/i

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function buildManifest({ buffer, file, created }) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return {
    format: FORMAT,
    hash: sha256Hex(bytes),
    bytes: bytes.length,
    created,
    file: path.basename(file),
  }
}

export function manifestErrors(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest is not an object']
  }
  if (manifest.format !== FORMAT) errors.push('format must be cortex-avatar-1')
  if (typeof manifest.hash !== 'string' || !HASH.test(manifest.hash)) errors.push('hash must be sha256 hex')
  if (!Number.isInteger(manifest.bytes) || manifest.bytes < 0) errors.push('bytes must be a non-negative integer')
  if (typeof manifest.created !== 'string' || Number.isNaN(Date.parse(manifest.created))) errors.push('created must be an ISO date')
  if (typeof manifest.file !== 'string' || !manifest.file || manifest.file !== path.basename(manifest.file)) {
    errors.push('file must be a base name')
  }
  return errors
}

export function checkManifest(manifest, buffer) {
  const errors = manifestErrors(manifest)
  const hash = sha256Hex(buffer)
  if (!errors.some((item) => item.startsWith('hash')) && String(manifest.hash || '').toLowerCase() !== hash) {
    errors.push('hash mismatch')
  }
  return { ok: errors.length === 0, hash, errors }
}

export function embedSnippet(hash) {
  return `<cortex-avatar hash="${hash}" />`
}

function parseArgs(argv) {
  const out = { glb: '', out: '', check: '' }
  const args = argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--glb') out.glb = args[index + 1] || ''
    else if (arg === '--out') out.out = args[index + 1] || ''
    else if (arg === '--check') out.check = args[index + 1] || ''
    else return { error: `unknown argument ${arg}` }
    index += 1
    if (!args[index]) return { error: `missing value for ${arg}` }
  }
  return out
}

function readBuffer(file) {
  return fs.readFileSync(file)
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function cli(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error || !parsed.glb || (!parsed.out && !parsed.check) || (parsed.out && parsed.check)) {
    process.stderr.write('usage: node scripts/cortex-manifest.mjs --glb <file> --out <manifest.json>\n')
    process.stderr.write('       node scripts/cortex-manifest.mjs --check <manifest.json> --glb <file>\n')
    process.exit(1)
  }
  let buffer
  try {
    buffer = readBuffer(parsed.glb)
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: ['glb not found'] })}\n`)
    process.exit(1)
  }
  if (parsed.check) {
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(parsed.check, 'utf8'))
    } catch {
      process.stdout.write(`${JSON.stringify({ ok: false, errors: ['manifest is not json'] })}\n`)
      process.exit(1)
    }
    const result = checkManifest(manifest, buffer)
    process.stdout.write(`${JSON.stringify({ ok: result.ok, hash: result.hash, errors: result.errors })}\n`)
    if (!result.ok) process.exit(1)
    process.stdout.write(`${embedSnippet(result.hash)}\n`)
    process.exit(0)
  }
  if (samePath(parsed.out, parsed.glb)) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: ['refusing to overwrite glb'] })}\n`)
    process.exit(1)
  }
  const created = fs.statSync(parsed.glb).mtime.toISOString()
  const manifest = buildManifest({ buffer, file: parsed.glb, created })
  const schema = manifestErrors(manifest)
  if (schema.length) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: schema })}\n`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(path.resolve(parsed.out)), { recursive: true })
  fs.writeFileSync(parsed.out, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(manifest)}\n`)
  process.stdout.write(`${embedSnippet(manifest.hash)}\n`)
  process.exit(0)
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invoked) cli(process.argv)
