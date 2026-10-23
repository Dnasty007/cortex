import * as THREE from 'three'
import { SCALE, brainRadius } from './brain-shape.js'

// Anatomical seeds. +z is the face (frontal), -z is occipital, -y is down.
const REGION_DIR = {
  'frontal-l': new THREE.Vector3(-0.38, 0.22, 0.82),
  'frontal-r': new THREE.Vector3(0.38, 0.22, 0.82),
  'temporal-l': new THREE.Vector3(-0.86, -0.18, 0.12),
  'temporal-r': new THREE.Vector3(0.86, -0.18, 0.12),
  'parietal-l': new THREE.Vector3(-0.32, 0.72, -0.2),
  'parietal-r': new THREE.Vector3(0.32, 0.72, -0.2),
  occipital: new THREE.Vector3(0, 0.12, -0.92),
  cerebellum: new THREE.Vector3(0, -0.55, -0.62),
  brainstem: new THREE.Vector3(0, -0.92, -0.05),
  corpus: new THREE.Vector3(0, 0.02, 0.08),
}

// Keys are stored lobe ids. Values are the hub words on the picture.
const LOBE_LABEL = {
  skills: 'Skills',
  memory: 'Memory',
  user: 'You',
  soul: 'Voice',
  model: 'Model',
  jobs: 'Jobs',
  profiles: 'Bots',
  sessions: 'Sessions',
  kanban: 'Board',
  hooks: 'Triggers',
  heartbeat: 'Pulse',
  vault: 'Library',
  spine: 'Gate',
  self: 'Self',
  email: 'Email',
  pha: 'Inspections',
  wallace: 'Leads',
  'jobs-desk': 'Jobs desk',
}

function lobeDisplayName(key) {
  return LOBE_LABEL[key] || key
}

function hubMemberName(name) {
  const text = String(name ?? '')
  const secret = /\bsk-/i.test(text) || /\bxai-/i.test(text) || /\bAKIA/i.test(text) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)
  return secret ? 'redacted name' : name
}

function hubBody(names) {
  const shown = names.slice(0, 8)
  const rest = names.length - shown.length
  if (rest <= 0) return shown.join('\n')
  return `${shown.join('\n')}\nand ${rest} more`
}

export const LOBE_COLOR = {
  skills: 0x3ee0ff,
  memory: 0xff4fa3,
  user: 0xffc14a,
  soul: 0xf7f4ff,
  model: 0xffffff,
  jobs: 0x3dffb0,
  profiles: 0xc084fc,
  sessions: 0x7aa2ff,
  kanban: 0xd6ff4a,
  hooks: 0xff6a3d,
  heartbeat: 0x3dffb0,
  vault: 0xd8d2c4,
  spine: 0xfcee0a,
  self: 0xffd56a,
  email: 0x7ec8ff,
  pha: 0xc6f25a,
  wallace: 0xff9a3c,
  'jobs-desk': 0xf0a35e,
}

const _up = new THREE.Vector3(0, 1, 0)
const _quat = new THREE.Quaternion()
const _local = new THREE.Vector3()
const _dir = new THREE.Vector3()

function regionVector(region) {
  const seed = REGION_DIR[region] || REGION_DIR.corpus
  return _dir.copy(seed).normalize()
}

function scatter(region, index, count, depth) {
  const dir = regionVector(region)
  _quat.setFromUnitVectors(_up, dir)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const t = (index + 0.5) / Math.max(count, 1)
  const y = 1 - t * 0.55
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const angle = golden * index
  _local.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring).normalize()
  _local.applyQuaternion(_quat)
  const unit = _local.normalize()
  const radius = brainRadius(unit) * depth * SCALE
  return unit.multiplyScalar(radius).clone()
}

export function withHubs(neurons) {
  const seen = new Map()
  for (const neuron of neurons) {
    const region = neuron.region || 'corpus'
    const key = `${neuron.lobe}|${region}`
    if (!seen.has(key)) {
      seen.set(key, {
        id: `hub:${key}`,
        name: lobeDisplayName(neuron.lobe),
        lobe: neuron.lobe,
        region,
        kind: 'hub',
        summary: '',
        body: '',
        path: '',
        links: [],
        tags: [],
        category: '',
      })
    }
  }
  const hubs = [...seen.values()]
  const linked = neurons.map((neuron) => {
    const region = neuron.region || 'corpus'
    const hubId = `hub:${neuron.lobe}|${region}`
    const links = Array.isArray(neuron.links) ? neuron.links.filter((id) => id !== hubId) : []
    links.push(hubId)
    return { ...neuron, region, links }
  })
  return [...hubs, ...linked]
}

export function layoutNeurons(neurons) {
  const groups = new Map()
  for (const neuron of neurons) {
    const region = neuron.region || 'corpus'
    if (!groups.has(region)) groups.set(region, [])
    groups.get(region).push(neuron)
  }
  const placed = []
  for (const [region, list] of groups) {
    const hubs = list.filter((neuron) => neuron.kind === 'hub')
    const rest = list
      .filter((neuron) => neuron.kind !== 'hub')
      .sort((a, b) => a.name.localeCompare(b.name))
    hubs.forEach((neuron, index) => {
      const depth = 0.48 + index * 0.04
      placed.push({ ...neuron, depth, home: scatter(region, 0, 1, depth) })
    })
    rest.forEach((neuron, index) => {
      const depth = Math.min(0.72 + (index % 6) * 0.03, 0.9)
      placed.push({ ...neuron, depth, home: scatter(region, index, rest.length, depth) })
    })
  }
  return placed
}

export function fillHubSummaries(placed) {
  const members = new Map()
  for (const neuron of placed) {
    if (neuron.kind === 'hub') continue
    const key = `${neuron.lobe}|${neuron.region}`
    if (!members.has(key)) members.set(key, [])
    members.get(key).push(hubMemberName(neuron.name))
  }
  for (const neuron of placed) {
    if (neuron.kind !== 'hub') continue
    const names = members.get(`${neuron.lobe}|${neuron.region}`) || []
    neuron.summary = `${names.length} in this cluster`
    neuron.body = hubBody(names)
  }
  return placed
}

const PLAIN_WORDS = {
  skills: 'Skills',
  memory: 'Memory',
  user: 'You',
  soul: 'Voice',
  model: 'Model',
  jobs: 'Jobs',
  profiles: 'Bots',
  sessions: 'Sessions',
  kanban: 'Board',
  hooks: 'Triggers',
  heartbeat: 'Pulse',
  vault: 'Library',
  spine: 'Gate',
  self: 'Self',
  email: 'Email',
  pha: 'Inspections',
  wallace: 'Leads',
  'jobs-desk': 'Jobs desk',
}

function checkPictureLabels() {
  const neurons = Object.keys(PLAIN_WORDS).map((key) => ({
    id: `check:${key}`,
    name: key === 'skills' ? 'sk-live-key' : key,
    lobe: key,
    region: 'corpus',
    kind: 'note',
    links: [],
  }))
  const placed = fillHubSummaries(layoutNeurons(withHubs(neurons)))
  for (const [key, word] of Object.entries(PLAIN_WORDS)) {
    const hub = placed.find((neuron) => neuron.kind === 'hub' && neuron.lobe === key)
    if (!hub) throw new Error(`missing hub for ${key}`)
    if (hub.name !== word) throw new Error(`${key} shows ${hub.name}, expected ${word}`)
    if (hub.lobe !== key) throw new Error(`stored lobe id changed for ${key}`)
  }
  const skills = placed.find((neuron) => neuron.kind === 'hub' && neuron.lobe === 'skills')
  if (!String(skills.body).includes('redacted name')) throw new Error('secret-shaped member name was not redacted')
  if (String(skills.body).includes('sk-live-key')) throw new Error('raw secret stayed in the hub body')
}

function ranAsLayoutScript() {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return false
  return String(process.argv[1] || '').replace(/\\/g, '/').endsWith('src/layout.js')
}

if (ranAsLayoutScript()) {
  checkPictureLabels()
  console.log('picture labels ok')
}
