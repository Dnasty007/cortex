import * as THREE from 'three'
import { SCALE, brainRadius } from '../src/brain-shape.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { adoptLook, applyLook, cameraBasis, flyDelta, parkOrbit, viewPlanePoint } from '../src/frame.js'
import { layoutNeurons } from '../src/layout.js'
import { SPINE_ID, isHermesBrain, notebookEntries, stampHermes } from '../src/hermes-mark.js'

let failed = 0

function assert(condition, message) {
  if (!condition) {
    failed += 1
    console.error('FAIL', message)
  } else {
    console.log('ok', message)
  }
}

const left = brainRadius(new THREE.Vector3(1, 0, 0))
const right = brainRadius(new THREE.Vector3(-1, 0, 0))
assert(Math.abs(left - right) < 1e-9, 'hull is symmetric left to right')

const front = brainRadius(new THREE.Vector3(0, 0, 1))
const top = brainRadius(new THREE.Vector3(0, 1, 0))
assert(front > top, 'frontal reach is longer than the crown')
assert(front > 0 && top > 0, 'radius stays positive')

const sample = []
for (let i = 0; i < 36; i++) {
  sample.push({
    id: `n${i}`,
    name: `neuron ${i}`,
    lobe: i % 2 === 0 ? 'skills' : 'memory',
    region: i % 2 === 0 ? 'frontal-l' : 'temporal-l',
    kind: 'skill',
    links: [],
  })
}
sample.push({
  id: 'hub:skills|frontal-l',
  name: 'Skills',
  lobe: 'skills',
  region: 'frontal-l',
  kind: 'hub',
  links: [],
})

const placed = layoutNeurons(sample)
assert(placed.length === sample.length, 'layout keeps every neuron')
for (const neuron of placed) {
  const dir = neuron.home.clone().normalize()
  const limit = brainRadius(dir) * SCALE * 0.98
  assert(neuron.home.length() > 0.5 && neuron.home.length() < limit, `${neuron.id} sits inside the hull`)
}

const frontal = placed.filter((neuron) => neuron.region === 'frontal-l' && neuron.kind !== 'hub')
const mean = frontal.reduce((sum, neuron) => sum.add(neuron.home), new THREE.Vector3()).multiplyScalar(1 / frontal.length)
assert(mean.x < 0 && mean.z > 0, 'frontal-l cluster sits front-left')

const temporal = placed.filter((neuron) => neuron.region === 'temporal-l')
const temporalMean = temporal.reduce((sum, neuron) => sum.add(neuron.home), new THREE.Vector3()).multiplyScalar(1 / temporal.length)
assert(temporalMean.x < 0, 'temporal-l cluster sits on the left')

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
camera.position.set(0, 0, 8)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld(true)
const fwd = new THREE.Vector3()
const rightAxis = new THREE.Vector3()
cameraBasis(camera, fwd, rightAxis)
assert(fwd.z < -0.9 && Math.abs(fwd.x) < 0.05, 'idle camera forward is -z')
assert(rightAxis.x > 0.9 && Math.abs(rightAxis.z) < 0.05, 'idle camera right is +x')

const ahead = flyDelta(fwd, rightAxis, { forward: 1, strafe: 0, lift: 0 }, 2)
assert(ahead.z < -1.5 && Math.abs(ahead.x) < 0.05, 'W moves toward -z')
const aside = flyDelta(fwd, rightAxis, { forward: 0, strafe: 1, lift: 0 }, 2)
assert(aside.x > 1.5 && Math.abs(aside.z) < 0.05, 'D moves toward +x')

camera.rotation.order = 'YXZ'
camera.rotation.set(0, Math.PI / 2, 0)
camera.updateMatrixWorld(true)
cameraBasis(camera, fwd, rightAxis)
assert(fwd.x < -0.9, 'positive yaw turns the view toward -x')

const anchor = new THREE.Vector3(0.6, -0.7, 0)
const orbitCam = new THREE.PerspectiveCamera(48, 1, 0.1, 200)
orbitCam.position.set(11.2, 6.4, 18.2)
orbitCam.lookAt(anchor)
orbitCam.updateMatrixWorld(true)
const beforeLook = new THREE.Vector3()
orbitCam.getWorldDirection(beforeLook)
const euler = new THREE.Euler(0, 0, 0, 'YXZ')
adoptLook(orbitCam, euler)
const afterLook = new THREE.Vector3()
orbitCam.getWorldDirection(afterLook)
assert(beforeLook.dot(afterLook) > 0.999, 'entering fly keeps the view you had')

applyLook(orbitCam, euler, 50, 0)
orbitCam.updateMatrixWorld(true)
const turned = new THREE.Vector3()
orbitCam.getWorldDirection(turned)
assert(turned.x > afterLook.x + 0.02, 'mouse right looks toward +x')

orbitCam.position.set(11.2, 6.4, 18.2)
orbitCam.lookAt(anchor)
adoptLook(orbitCam, euler)
const level = new THREE.Vector3()
orbitCam.getWorldDirection(level)
applyLook(orbitCam, euler, 0, -40)
orbitCam.updateMatrixWorld(true)
const climbed = new THREE.Vector3()
orbitCam.getWorldDirection(climbed)
assert(climbed.y > level.y + 0.02, 'mouse up looks up')

const rig = new OrbitControls(orbitCam, null)
rig.target.copy(anchor)
rig.minDistance = 2
rig.enableDamping = true
rig._sphericalDelta.theta = 1.2
rig._sphericalDelta.phi = 0.4
orbitCam.position.set(11.2, 6.4, 18.2)
orbitCam.lookAt(anchor)
const parkedFrom = orbitCam.position.clone()
parkOrbit(orbitCam, rig, anchor)
assert(orbitCam.position.distanceTo(parkedFrom) < 0.05, 'leaving fly does not teleport the camera')
assert(rig.target.distanceTo(anchor) < 1e-6, 'orbit target returns to the brain')
const parkedDir = new THREE.Vector3()
orbitCam.getWorldDirection(parkedDir)
const toward = anchor.clone().sub(orbitCam.position).normalize()
assert(parkedDir.dot(toward) > 0.99, 'orbit looks at the brain')
assert(Math.abs(rig._sphericalDelta.theta) < 1e-6, 'leftover orbit drag is cleared')

orbitCam.position.copy(anchor)
parkOrbit(orbitCam, rig, anchor)
assert(orbitCam.position.distanceTo(anchor) >= rig.minDistance - 1e-4, 'a camera inside the pivot steps back')

const stranger = { source: { label: 'Other agent', host: 'example', home: '/tmp/other' }, neurons: [{ id: 'a', lobe: 'skills' }], lobes: [] }
stampHermes(stranger, null)
assert(!stranger.neurons.some((neuron) => neuron.id === SPINE_ID), 'a stranger brain does not get the spine')

const hermes = {
  source: { label: 'Sample home', host: 'owner.example', home: '/tmp/sample-home' },
  neurons: [
    { id: 'profile:email:SOUL.md:0', lobe: 'profiles', category: 'email', kind: 'profile', name: 'email soul' },
    { id: 'job:daily', lobe: 'jobs', kind: 'job', name: 'daily cron' },
  ],
  lobes: [{ id: 'jobs', name: 'Jobs', blurb: 'Cron.' }],
}
const before = hermes.neurons.length
stampHermes(hermes, null)
if (isHermesBrain(hermes)) {
  assert(hermes.neurons.some((neuron) => neuron.locked), 'an owner brain can keep a locked neuron')
} else {
  assert(hermes.neurons.length === before, 'without a local owner mark, the sample brain stays as it was')
}
assert(!isHermesBrain(stranger), 'a stranger brain is not an owner brain')
const hidden = notebookEntries({ api_key: 'abc', password_note: 'x', plain: '12345678901234', ok: 'plain note' })
assert(hidden.every((entry) => entry.key !== 'api_key' && entry.key !== 'password_note'), 'secret notebook keys are omitted')
assert(hidden.find((entry) => entry.key === 'plain').value === '', 'a long digit run is not shown')
assert(hidden.find((entry) => entry.key === 'ok').value === 'plain note', 'an ordinary notebook value stays')

try {
  const ownerTests = await import('./owner-selftest.mjs')
  if (typeof ownerTests.runOwnerTests === 'function') ownerTests.runOwnerTests(assert)
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
}

const slideCam = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
const slideHit = new THREE.Vector3()
slideCam.position.set(0, 0, 10)
slideCam.lookAt(0, 0, 0)
slideCam.updateMatrixWorld()
assert(viewPlanePoint(slideCam, new THREE.Vector3(), 0.4, 0, slideHit), 'a view-plane point exists in front of the camera')
assert(slideHit.x > 0.2, 'screen-right from +z moves the brain toward +x')
slideCam.position.set(10, 0, 0)
slideCam.lookAt(0, 0, 0)
slideCam.updateMatrixWorld()
slideCam.updateProjectionMatrix()
assert(viewPlanePoint(slideCam, new THREE.Vector3(), 0.4, 0, slideHit), 'a view-plane point exists from the side')
assert(slideHit.z < -0.2, 'screen-right from +x moves the brain toward -z')

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('self-test passed')
