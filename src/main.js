import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { SCALE, brainRadius, makeHullGeometry } from './brain-shape.js'
import { adoptLook, applyLook, cameraBasis, flyDelta, parkOrbit, viewPlanePoint } from './frame.js'
import { applyHealth } from './health.js'
import { stampHermes } from './hermes-mark.js'
import { packReview } from './pack.js'
import { applyPictureDetail } from './picture-detail.js'
import { attachLiveSkin } from './live-skin.js'
import { createLiveShow } from './live-show.js'
import { kinPlain, plainKin } from './kin-plain.js'
import { LOBE_COLOR, fillHubSummaries, layoutNeurons, withHubs } from './layout.js'

const view = document.querySelector('#view')
const sourceLine = document.querySelector('#source-line')
const pictureLine = document.querySelector('#picture-line')
const sourceSelect = document.querySelector('#source')
const updateBrainButton = document.querySelector('#update-brain')
const botDoorLine = document.querySelector('#bot-door-line')
const botDoorOpen = document.querySelector('#bot-door-open')
const liveNow = document.querySelector('#live-now')
const liveLog = document.querySelector('#live-log')
const liveChat = document.querySelector('#live-chat')
const liveText = document.querySelector('#live-text')
const liveWait = []
let liveSince = 0
let liveNext = 0
let liveFocus = null
const REGION_LABEL = {
  'frontal-l': 'left front',
  'frontal-r': 'right front',
  'temporal-l': 'left side',
  'temporal-r': 'right side',
  'parietal-l': 'left top',
  'parietal-r': 'right top',
  occipital: 'back',
  cerebellum: 'low back',
  brainstem: 'stem',
  corpus: 'middle',
}

function appendLive(text) {
  if (!liveLog) return
  const item = document.createElement('li')
  item.textContent = text
  liveLog.append(item)
  while (liveLog.children.length > 12) liveLog.firstChild.remove()
  liveLog.scrollTop = liveLog.scrollHeight
}

function findLiveNeuron(row) {
  const id = String(row.id || '')
  const exact = placed.find((item) => item.id === id)
  if (exact) return exact
  let decoded = id
  try { decoded = decodeURIComponent(id) } catch { decoded = id }
  if (decoded !== id) {
    const decodedHit = placed.find((item) => item.id === decoded)
    if (decodedHit) return decodedHit
  }
  const name = String(row.name || '').trim().toLowerCase()
  if (!name) return null
  return placed.find((item) => String(item.name || '').trim().toLowerCase() === name) || null
}

function shortLiveName(name) {
  const text = String(name || 'a skill').replace(/\s+/g, ' ').trim()
  return text.length > 36 ? `${text.slice(0, 36)}…` : text
}

function showLiveRead(row) {
  const neuron = findLiveNeuron(row)
  const name = shortLiveName(neuron?.name || row.name || 'a skill')
  const part = neuron ? (REGION_LABEL[neuron.region] || neuron.region || '') : ''
  if (liveNow) liveNow.textContent = neuron
    ? `He is reading ${name}${part ? ` in the ${part}` : ''}`
    : `He asked for ${name}`
  appendLive(part ? `${name} · ${part}` : name)
  if (!neuron) return
  liveFocus = { id: neuron.id, lobe: neuron.lobe, region: neuron.region || 'corpus' }
  openInspector(neuron)
}

function playLiveRead() {
  if (!liveWait.length || performance.now() < liveNext) return
  showLiveRead(liveWait.shift())
  liveNext = performance.now() + 1100
}

async function pollBotLive() {
  try {
    const response = await fetch(`/api/bot-live?since=${liveSince}`)
    if (!response.ok) return
    const data = await response.json()
    for (const row of data.reads || []) {
      liveSince = Math.max(liveSince, row.n || 0)
      if (row.kind === 'read' && row.id) liveWait.push(row)
      else if (row.kind === 'search') appendLive(`He searched ${row.name} (${row.total || 0})`)
    }
    for (const row of data.chat || []) {
      liveSince = Math.max(liveSince, row.n || 0)
      appendLive(`${row.from}: ${row.text}`)
    }
  } catch {
    /* the picture still works if the door is quiet */
  }
}

if (liveChat && liveText) {
  liveChat.addEventListener('submit', async (event) => {
    event.preventDefault()
    const text = liveText.value.trim()
    if (!text) return
    liveText.value = ''
    await fetch('/api/bot-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'ray', text }),
    })
    await pollBotLive()
  })
}
const openHomeButton = document.querySelector('#open-home')
const openRow = document.querySelector('#open-row')
const homePath = document.querySelector('#home-path')
const browseHomeButton = document.querySelector('#browse-home')
const scanHomeButton = document.querySelector('#scan-home')
const buildPackButton = document.querySelector('#build-pack')
const rulesOnlyBox = document.querySelector('#rules-only')
const holdTitles = document.querySelector('#hold-titles')
const birthPackButton = document.querySelector('#birth-pack')
const placePackButton = document.querySelector('#place-pack')
const checkPackButton = document.querySelector('#check-pack')
const kinPackButton = document.querySelector('#kin-pack')
const kinPaths = document.querySelector('#kin-paths')
const receiptEl = document.querySelector('#receipt')
let placeArmed = ''
const searchInput = document.querySelector('#search')
const lobeNav = document.querySelector('#lobes')
const inspector = document.querySelector('#inspector')
const inspName = document.querySelector('#insp-name')
const inspMeta = document.querySelector('#insp-meta')
const inspPath = document.querySelector('#insp-path')
const inspBody = document.querySelector('#insp-body')
const statusLine = document.querySelector('#status')
const counts = document.querySelector('#counts')
const pullInput = document.querySelector('#pull')
const flyButton = document.querySelector('#fly')
const tooltip = document.querySelector('#tooltip')
const empty = document.querySelector('#empty')
const selftest = document.querySelector('#selftest')
const brandEl = document.querySelector('#brand')

function fitMoveCard() {
  if (!brandEl) return
  const receiptOpen = receiptEl && !receiptEl.hidden
  const anchor = (receiptOpen && receiptEl.querySelector('.file-fold summary'))
    || (receiptOpen && receiptEl.querySelector('.handoff-end'))
    || (receiptOpen && receiptEl)
    || document.querySelector('#first-move')
  if (!anchor) return
  const brandRect = brandEl.getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()
  const cushion = anchor.id === 'first-move' ? 0 : 22
  const need = Math.ceil(anchorRect.bottom - brandRect.top + brandEl.scrollTop + cushion)
  const room = window.innerWidth <= 640 ? window.innerHeight - 148 : window.innerHeight - 222
  const next = Math.min(Math.max(need, 240), Math.max(room, 240))
  const current = parseFloat(brandEl.style.maxHeight)
  if (!Number.isFinite(current) || Math.abs(current - next) > 2) brandEl.style.maxHeight = next + 'px'
  placeLiveDeck()
}

function placeLiveDeck() {
  const live = document.querySelector('#live-feed')
  if (!live || !brandEl) return
  if (window.innerWidth <= 640) {
    live.style.top = ''
    live.style.bottom = ''
    live.style.width = ''
    return
  }
  const brandRect = brandEl.getBoundingClientRect()
  const height = live.offsetHeight || 110
  const maxTop = window.innerHeight - 74 - height
  const top = Math.min(Math.round(brandRect.bottom + 12), Math.max(16, maxTop))
  live.style.top = top + 'px'
  live.style.bottom = 'auto'
  live.style.width = brandRect.width + 'px'
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.98
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
view.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x07040f)

const orbitAnchor = new THREE.Vector3(0, 0.25, 0)
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ')
let lookArmed = false

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 220)
camera.position.set(8.6, 3.1, 15.2)
camera.rotation.order = 'YXZ'
camera.lookAt(orbitAnchor)

// The orbit target stays the brain. The view window shifts so that point
// lands in the open gap between the left column and the inspector.
function parkFrame() {
  const w = window.innerWidth
  const h = window.innerHeight
  const wide = w > 640
  const cardRight = wide ? Math.min(400, w - 32) + 28 : 0
  const inspOpen = inspector.classList.contains('open')
  const inspW = inspOpen ? Math.min(400, w * 0.34) : 0
  const rightBlock = wide ? (inspOpen ? inspW + 28 : 24) : 0
  const aimX = wide ? (cardRight + (w - rightBlock)) / 2 : w / 2
  const shiftX = aimX - w / 2
  const lift = wide ? Math.round(Math.min(80, h * 0.07)) : 0
  camera.setViewOffset(w, h, -shiftX, lift, w, h)
}
parkFrame()

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.target.copy(orbitAnchor)
controls.minDistance = 2
controls.maxDistance = 48
controls.autoRotate = true
controls.autoRotateSpeed = 0.28

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.1, 0.2, 0.9)
composer.addPass(bloom)

scene.add(new THREE.HemisphereLight(0xe7eef6, 0x0a1018, 0.42))
const keyLight = new THREE.DirectionalLight(0xfff8f2, 4.2)
keyLight.position.set(6, 11, 7)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
keyLight.shadow.bias = -0.00015
keyLight.shadow.normalBias = 0.03
keyLight.shadow.camera.near = 1
keyLight.shadow.camera.far = 36
keyLight.shadow.camera.left = -12
keyLight.shadow.camera.right = 12
keyLight.shadow.camera.top = 12
keyLight.shadow.camera.bottom = -12
scene.add(keyLight)
scene.add(keyLight.target)
const rimLight = new THREE.DirectionalLight(0x3ee0ff, 2.4)
rimLight.position.set(-8, 4.5, -6)
scene.add(rimLight)
const kickLight = new THREE.DirectionalLight(0xff2bd6, 1.35)
kickLight.position.set(9, 1.5, -6)
scene.add(kickLight)
const fillLight = new THREE.DirectionalLight(0xfff1dc, 0.3)
fillLight.position.set(-2, -4, 8)
scene.add(fillLight)

const picture = new THREE.Group()
scene.add(picture)
const liveShow = createLiveShow(picture)
let liveSkin = { set() {} }
const liveWorld = new THREE.Vector3()
const matePool = Array.from({ length: 22 }, () => new THREE.Vector3())

const hullGeo = makeHullGeometry(4)
const hull = new THREE.LineSegments(
  new THREE.WireframeGeometry(hullGeo),
  new THREE.LineBasicMaterial({ color: 0x3d8cff, transparent: true, opacity: 0.22 }),
)
hull.visible = false
picture.add(hull)

const brainRoot = new THREE.Group()
picture.add(brainRoot)

const brainPick = new THREE.Mesh(
  new THREE.SphereGeometry(1, 12, 8),
  new THREE.MeshBasicMaterial({ depthWrite: false }),
)
brainPick.visible = false
brainPick.scale.setScalar(8)
picture.add(brainPick)

// Measured from the GLB vertex field (not from the source photo):
// X is symmetric (left/right), the sparse thin tip is -Y (brainstem),
// the +Z cap sits higher, and the low cerebellar mass sits toward -Z.
// That already matches this scene (+Z face, -Y down). No extra rotation.
const AP_LENGTH = 15.4
const LAT = 144
const LON = 72
let surface = null
let trayY = -9.4
let holoRings = null

const holoMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendEquation: THREE.AddEquation,
  toneMapped: false,
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorld);
      vec3 n = normalize(vNormal);
      float fres = pow(1.0 - abs(dot(n, viewDir)), 3.1);
      float sweep = sin(uTime * 0.7) * 6.4;
      float edgeOn = smoothstep(0.2, 0.65, 1.0 - abs(n.y));
      float band = smoothstep(0.08, 0.0, abs(vWorld.y - sweep)) * edgeOn;
      float alpha = fres * 0.22 + band * 0.12;
      if (alpha < 0.04) discard;
      vec3 cyan = vec3(0.25, 1.0, 1.0);
      vec3 magenta = vec3(1.0, 0.15, 0.75);
      vec3 yellow = vec3(1.0, 0.93, 0.08);
      vec3 col = mix(cyan, magenta, smoothstep(0.25, 0.9, fres));
      col = mix(col, yellow, band);
      gl_FragColor = vec4(col, alpha);
    }
  `,
})

function dashedRing(radius, color) {
  const positions = []
  const steps = 80
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2
    const a1 = a0 + (Math.PI * 2) / steps * 0.48
    positions.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius)
    positions.push(Math.cos(a1) * radius, 0, Math.sin(a1) * radius)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }))
  line.raycast = () => {}
  return line
}

function sampleSurface(dir) {
  if (!surface) return brainRadius(dir) * SCALE
  const lon = Math.atan2(dir.x, dir.z)
  const lat = Math.asin(Math.min(1, Math.max(-1, dir.y)))
  const fx = ((lon + Math.PI) / (Math.PI * 2)) * LAT
  const fy = ((lat + Math.PI / 2) / Math.PI) * LON
  const x0 = Math.floor(fx)
  const y0 = Math.min(LON - 1, Math.max(0, Math.floor(fy)))
  const tx = fx - x0
  const ty = Math.min(1, Math.max(0, fy - y0))
  const x1 = (x0 + 1) % LAT
  const y1 = Math.min(LON - 1, y0 + 1)
  const ix = (x0 % LAT + LAT) % LAT
  const at = (x, y) => surface[y * LAT + x]
  const a = at(ix, y0) * (1 - tx) + at(x1, y0) * tx
  const b = at(ix, y1) * (1 - tx) + at(x1, y1) * tx
  const radius = a * (1 - ty) + b * ty
  return radius > 0.4 ? radius : brainRadius(dir) * SCALE
}

function buildSurface(root) {
  const field = new Float32Array(LAT * LON)
  const v = new THREE.Vector3()
  root.updateMatrixWorld(true)
  root.traverse((obj) => {
    const pos = obj.geometry?.attributes?.position
    if (!obj.isMesh || !pos) return
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
      const radius = v.length()
      if (radius < 1e-3) continue
      const lon = Math.atan2(v.x, v.z)
      const lat = Math.asin(Math.min(1, Math.max(-1, v.y / radius)))
      let ix = Math.floor(((lon + Math.PI) / (Math.PI * 2)) * LAT)
      let iy = Math.floor(((lat + Math.PI / 2) / Math.PI) * LON)
      if (ix < 0) ix = 0
      if (ix >= LAT) ix = 0
      if (iy < 0) iy = 0
      if (iy >= LON) iy = LON - 1
      const index = iy * LAT + ix
      if (radius > field[index]) field[index] = radius
    }
  })
  for (let pass = 0; pass < 4; pass++) {
    const next = field.slice()
    for (let iy = 0; iy < LON; iy++) {
      for (let ix = 0; ix < LAT; ix++) {
        const index = iy * LAT + ix
        if (field[index] > 0) continue
        let best = 0
        for (let dy = -1; dy <= 1; dy++) {
          const y = iy + dy
          if (y < 0 || y >= LON) continue
          for (let dx = -1; dx <= 1; dx++) {
            best = Math.max(best, field[y * LAT + ((ix + dx + LAT) % LAT)])
          }
        }
        next[index] = best
      }
    }
    field.set(next)
  }
  return field
}

function refitToShell() {
  if (!surface || placed.length === 0) return
  for (const neuron of placed) {
    const dir = neuron.home.clone().normalize()
    if (neuron.shellDepth == null) {
      const procedural = brainRadius(dir) * SCALE
      neuron.shellDepth = procedural > 0 ? neuron.home.length() / procedural : 0.8
    }
    // Sit on the cortex. Hubs ride just outside the gyri so the opaque shell
    // stays sharp and the pull slider can still lift a lobe off the surface.
    const hug = neuron.kind === 'hub' ? 1.03 : 1.006
    neuron.home.copy(dir.multiplyScalar(sampleSurface(dir) * hug))
    if (neuron.target && !neuron.quarantine) neuron.target.copy(neuron.home)
    if (neuron.mesh && !neuron.quarantine) neuron.mesh.position.copy(neuron.home)
  }
}

function mountAnatomical(model) {
  const meshes = []
  model.traverse((obj) => {
    if (obj.isMesh && obj.material !== holoMat) meshes.push(obj)
  })
  let pictured = false
  for (const obj of meshes) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const mat of mats) {
      if (!mat || !mat.color) continue
      mat.map = null
      mat.metalness = 0
      mat.metalnessMap = null
      mat.roughnessMap = null
      mat.color.set(0xb7c6d0)
      mat.roughness = 0.84
      mat.transparent = false
      mat.depthWrite = true
      mat.side = THREE.FrontSide
      mat.envMapIntensity = 0
      mat.needsUpdate = true
      if (!pictured && mat.isMeshStandardMaterial) {
        try {
          applyPictureDetail(mat)
        } catch (error) {
          console.error('picture detail', error && error.message ? error.message : error)
        }
        pictured = true
      }
    }
    obj.castShadow = true
    obj.receiveShadow = true
    obj.raycast = () => {}
    obj.renderOrder = 1
    const ghost = new THREE.Mesh(obj.geometry, holoMat)
    ghost.scale.setScalar(1.012)
    ghost.raycast = () => {}
    ghost.renderOrder = 3
    ghost.castShadow = false
    obj.add(ghost)
  }
  const holder = new THREE.Group()
  holder.add(model)
  holder.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(holder)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  holder.position.sub(center)
  holder.scale.setScalar(AP_LENGTH / (size.z || 1))
  brainRoot.add(holder)
  holder.updateMatrixWorld(true)
  const fitted = new THREE.Box3().setFromObject(holder)
  tray.position.y = fitted.min.y + 0.35
  trayY = tray.position.y
  deck.position.y = trayY
  const fittedSize = fitted.getSize(new THREE.Vector3())
  brainPick.scale.setScalar(Math.max(fittedSize.x, fittedSize.y, fittedSize.z) * 0.55)
  const ringR = Math.min(fittedSize.x, fittedSize.z) * 0.22
  holoRings = new THREE.Group()
  const baseY = fitted.min.y + 0.55
  const equator = dashedRing(ringR, 0xfcee0a)
  equator.position.y = baseY
  const meridian = dashedRing(ringR * 0.82, 0x3ee0ff)
  meridian.rotation.x = 0.12
  meridian.position.y = baseY - 0.16
  const lean = dashedRing(ringR * 0.66, 0xff2bd6)
  lean.rotation.z = 0.1
  lean.position.y = baseY - 0.32
  holoRings.add(equator, meridian, lean)
  brainRoot.add(holoRings)
  liveSkin = attachLiveSkin(brainRoot)
  surface = buildSurface(holder)
  hull.visible = false
  refitToShell()
  document.documentElement.dataset.brain = 'ready'
}

new GLTFLoader().load(
  '/brain-model.glb',
  (gltf) => {
    try {
      mountAnatomical(gltf.scene)
    } catch (error) {
      console.error('MOUNT', error && error.stack ? error.stack : error)
      hull.visible = true
      document.documentElement.dataset.brain = 'fallback'
    }
  },
  undefined,
  (error) => {
    console.error('GLB', error && error.message ? error.message : error)
    hull.visible = true
    document.documentElement.dataset.brain = 'fallback'
  },
)

const stars = new Float32Array(500 * 3)
for (let i = 0; i < 500; i++) {
  const radius = 48 + Math.random() * 70
  const theta = Math.random() * Math.PI * 2
  const phi = Math.acos(2 * Math.random() - 1)
  stars[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
  stars[i * 3 + 1] = radius * Math.cos(phi)
  stars[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
}
const starGeo = new THREE.BufferGeometry()
starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3))
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xb7e4ff, size: 0.08, transparent: true, opacity: 0.8 })))

const tray = new THREE.Mesh(
  new THREE.RingGeometry(1.72, 1.84, 80),
  new THREE.MeshBasicMaterial({
    color: 0xfcee0a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    toneMapped: false,
  }),
)
tray.rotation.x = Math.PI / 2
tray.position.y = -8.1
tray.raycast = () => {}
picture.add(tray)

const deck = new THREE.Group()
function deckRing(inner, outer, color, opacity) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 96),
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  mesh.rotation.x = Math.PI / 2
  mesh.raycast = () => {}
  return mesh
}
deck.add(deckRing(2.15, 2.22, 0xfcee0a, 0.28))
deck.add(deckRing(2.55, 2.62, 0x3ee0ff, 0.2))
deck.position.y = tray.position.y
picture.add(deck)

const neuronGeo = new THREE.SphereGeometry(0.07, 16, 12)
const hubGeo = new THREE.SphereGeometry(0.13, 18, 14)
const materials = new Map()
const dimMaterial = new THREE.MeshStandardMaterial({ color: 0x1a242e, emissive: 0x0c1218, roughness: 0.6, transparent: true, opacity: 0.22 })
const quarantineMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, emissive: 0x66707a, emissiveIntensity: 0.3, roughness: 0.4 })
const selectMaterial = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe7a8, emissiveIntensity: 0.8, roughness: 0.2 })
const healthMaterial = new THREE.MeshStandardMaterial({ color: 0xfcee0a, emissive: 0x8a7408, emissiveIntensity: 0.55, roughness: 0.42 })
const liveHotMaterial = new THREE.MeshStandardMaterial({
  color: 0xfff6c2,
  emissive: 0xfcee0a,
  emissiveIntensity: 2.4,
  roughness: 0.15,
})
const livePartMaterial = new THREE.MeshStandardMaterial({
  color: 0xd9fbff,
  emissive: 0x3ee0ff,
  emissiveIntensity: 1.15,
  roughness: 0.22,
})
const liveLight = new THREE.PointLight(0xfcee0a, 0, 4.2, 2)
liveLight.castShadow = false
picture.add(liveLight)
const liveHalo = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 20, 16),
  new THREE.MeshBasicMaterial({
    color: 0xfcee0a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  }),
)
liveHalo.raycast = () => {}
liveHalo.visible = false
picture.add(liveHalo)
function roundGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.22, 'rgba(255,255,255,0.9)')
  glow.addColorStop(0.5, 'rgba(255,255,255,0.28)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
const liveSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: roundGlowTexture(),
  color: 0xfcee0a,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  toneMapped: false,
  blending: THREE.AdditiveBlending,
}))
liveSprite.scale.set(2.2, 2.2, 1)
liveSprite.visible = false
picture.add(liveSprite)
const liveOut = new THREE.Vector3()

function lobeMaterial(lobe) {
  if (!materials.has(lobe)) {
    const color = new THREE.Color(LOBE_COLOR[lobe] || 0x9ad7ff)
    materials.set(lobe, new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0,
    }))
  }
  return materials.get(lobe)
}

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const clock = new THREE.Clock()
const fwd = new THREE.Vector3()
const right = new THREE.Vector3()
const outward = new THREE.Vector3()
const keys = new Set()

let brains = []
let brain = null
let placed = []
let pairs = []
let line = null
let stageState = { quarantine: [], drafts: {} }
let selfSnapshot = null
let activeLobe = null
let activeCategory = null
let healthOnly = false
let query = ''
let matchIds = null
let selected = null
let flying = false
let lastMove = performance.now()
let pointerDown = null
let movingBrain = false
let carryArmed = false
let draggingBrain = false
let swallowClick = false
let inspectTimer = null
const clickMarks = []
const carryPlanePoint = new THREE.Vector3()
const carryGrab = new THREE.Vector3()
const carryHit = new THREE.Vector3()
const hint = document.querySelector('#hint')

function colorHex(lobe) {
  return `#${(LOBE_COLOR[lobe] || 0x9ad7ff).toString(16).padStart(6, '0')}`
}

function noteActivity() {
  lastMove = performance.now()
}

function runPlacementCheck() {
  const failures = []
  for (const neuron of placed) {
    const dir = neuron.home.clone().normalize()
    const limit = sampleSurface(dir) * 1.2
    if (!(neuron.home.length() > 0.4 && neuron.home.length() < limit)) failures.push(neuron.id)
  }
  selftest.hidden = failures.length === 0
  selftest.dataset.fail = failures.length ? '1' : '0'
  selftest.textContent = failures.length
    ? `Layout check failed for ${failures.slice(0, 4).join(', ')}`
    : `ok ${placed.length}`
}

function clearMeshes() {
  for (const neuron of placed) {
    neuron.mesh.removeFromParent()
  }
  if (line) {
    line.removeFromParent()
    line.geometry.dispose()
    line = null
  }
  placed = []
  pairs = []
  selected = null
  inspector.classList.remove('open')
  parkFrame()
}

function build(nextBrain) {
  clearMeshes()
  brain = stampHermes(nextBrain, selfSnapshot)
  applyHealth(brain)
  brain.pack = packReview(brain)
  const raw = withHubs(brain.neurons || [])
  placed = fillHubSummaries(layoutNeurons(raw))
  refitToShell()
  const indexById = new Map(placed.map((neuron, index) => [neuron.id, index]))
  const seen = new Set()
  placed.forEach((neuron, index) => {
    neuron.quarantine = !neuron.locked && stageState.quarantine.includes(neuron.id)
    neuron.tray = stageState.quarantine.indexOf(neuron.id)
    neuron.target = neuron.home.clone()
    const mesh = new THREE.Mesh(neuron.kind === 'hub' ? hubGeo : neuronGeo, lobeMaterial(neuron.lobe))
    mesh.position.copy(neuron.home)
    mesh.userData.neuron = neuron
    neuron.mesh = mesh
    picture.add(mesh)
    for (const link of neuron.links || []) {
      const other = indexById.get(link)
      if (other == null) continue
      const key = `${Math.min(index, other)}:${Math.max(index, other)}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push([index, other])
    }
  })
  const positions = new Float32Array(Math.max(pairs.length, 1) * 2 * 3)
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  line = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x7ef6ff, transparent: true, opacity: 0.012 }))
  picture.add(line)
  const stats = brain.stats || {}
  const source = brain.source || {}
  if (pictureLine) pictureLine.textContent = `Picture · ${source.label || 'Hermes'} · ${source.scanned_at || 'undated'}`
  counts.textContent = `${stats.neurons || placed.length} neurons · ${stats.skills || 0} skills · ${stats.jobs || 0} jobs · ${stats.profiles || 0} profiles`
  renderLobes()
  recomputeMatch()
  runPlacementCheck()
}

function renderLobes() {
  lobeNav.replaceChildren()
  const pack = brain.pack || { marks: {}, stale: false }
  const packLine = document.createElement('p')
  packLine.className = 'meta pack-line'
  const held = Object.values(pack.marks).filter((item) => item.mark === 'hold').length
  packLine.textContent = pack.stale
    ? 'Pack held. This picture is older than a day. Update picture before you trust the colors.'
    : held
      ? `Pack review. ${held} lobe${held === 1 ? '' : 's'} held. Nothing is copied yet.`
      : 'Pack review. Nothing is copied yet.'
  lobeNav.append(packLine)
  const all = document.createElement('button')
  all.type = 'button'
  all.className = `lobe${activeLobe ? '' : ' active'}`
  all.textContent = 'Whole brain'
  all.addEventListener('click', () => setFilter(null, null))
  lobeNav.append(all)
  const health = brain.health || {}
  const healthButton = document.createElement('button')
  healthButton.type = 'button'
  healthButton.className = `lobe${healthOnly ? ' active' : ''}`
  healthButton.textContent = `Health  ${health.total || 0}`
  healthButton.title = [
    health.copy ? `${health.copy} copied skills` : '',
    health.missing ? `${health.missing} jobs missing a skill` : '',
    health.conflict ? `${health.conflict} memory conflicts` : '',
    health.secret ? `${health.secret} secret-shaped` : '',
    health.crowd ? `${health.crowd} crowded profiles` : '',
  ].filter(Boolean).join(' · ') || 'No problems marked on this brain.'
  healthButton.addEventListener('click', () => setHealth(!healthOnly))
  lobeNav.append(healthButton)
  const countsByLobe = new Map()
  for (const neuron of brain.neurons) {
    countsByLobe.set(neuron.lobe, (countsByLobe.get(neuron.lobe) || 0) + 1)
  }
  for (const lobe of brain.lobes || []) {
    const button = document.createElement('button')
    button.type = 'button'
    const mark = pack.marks[lobe.id]
    button.className = `lobe${activeLobe === lobe.id ? ' active' : ''}`
    button.textContent = `${lobe.name}  ${countsByLobe.get(lobe.id) || 0}`
    if (mark && mark.mark !== 'out') {
      const badge = document.createElement('span')
      badge.className = `pack pack-${mark.mark}`
      badge.textContent = mark.mark
      button.append(badge)
    }
    button.style.borderLeft = `3px solid ${colorHex(lobe.id)}`
    button.title = [lobe.blurb || '', mark?.reason || ''].filter(Boolean).join(' ')
    button.addEventListener('click', () => setFilter(lobe.id, null))
    lobeNav.append(button)
    if (activeLobe !== lobe.id) continue
    const categories = [...new Set(
      brain.neurons.filter((neuron) => neuron.lobe === lobe.id && neuron.category).map((neuron) => neuron.category),
    )].sort()
    for (const category of categories) {
      const count = brain.neurons.filter((neuron) => neuron.lobe === lobe.id && neuron.category === category).length
      const cat = document.createElement('button')
      cat.type = 'button'
      cat.className = `cat${activeCategory === category ? ' active' : ''}`
      cat.textContent = `${category}  ${count}`
      cat.addEventListener('click', () => setFilter(lobe.id, category))
      lobeNav.append(cat)
    }
  }
}

function setHealth(on) {
  healthOnly = on
  if (on) {
    activeLobe = null
    activeCategory = null
    pullInput.value = Math.max(Number(pullInput.value), 0.35).toString()
  }
  renderLobes()
  recomputeMatch()
  noteActivity()
}

function setFilter(lobe, category) {
  healthOnly = false
  activeLobe = lobe
  activeCategory = category
  if (lobe) pullInput.value = Math.max(Number(pullInput.value), 0.55).toString()
  renderLobes()
  recomputeMatch()
  noteActivity()
}

function textOf(neuron) {
  return `${neuron.name} ${neuron.summary || ''} ${neuron.category || ''} ${neuron.lobe || ''}`.toLowerCase()
}

function recomputeMatch() {
  const needle = query.trim().toLowerCase()
  if (!needle && !activeLobe && !healthOnly) {
    matchIds = null
    return
  }
  const hits = new Set()
  for (const neuron of placed) {
    if (neuron.kind === 'hub') continue
    const lobeOk = !activeLobe || neuron.lobe === activeLobe
    const categoryOk = !activeCategory || neuron.category === activeCategory
    const queryOk = !needle || textOf(neuron).includes(needle)
    const healthOk = !healthOnly || (neuron.health && neuron.health.length)
    if (lobeOk && categoryOk && queryOk && healthOk) hits.add(neuron.id)
  }
  for (const neuron of placed) {
    if (neuron.kind !== 'hub') continue
    const child = placed.some((other) => other.kind !== 'hub' && other.lobe === neuron.lobe && other.region === neuron.region && hits.has(other.id))
    if (child || (!needle && !activeLobe && !healthOnly)) hits.add(neuron.id)
  }
  matchIds = hits
}

function openInspector(neuron) {
  selected = neuron
  inspector.classList.add('open')
  inspName.textContent = neuron.name
  const draft = stageState.drafts[neuron.id]
  inspMeta.textContent = [
    neuron.kind,
    neuron.lobe,
    neuron.category || '',
    draft ? 'draft staged on this PC' : '',
    neuron.quarantine ? 'staged for delete' : '',
    ...(neuron.health || []).map((item) => item.text),
  ].filter(Boolean).join(' · ')
  inspPath.textContent = neuron.path || ''
  inspBody.value = draft || neuron.body || neuron.summary || ''
  statusLine.textContent = 'Staged edits stay in this app. Hermes files are not changed.'
  parkFrame()
}

function markMoved() {
  const parked = picture.position.lengthSq() < 1e-6
  controls.autoRotate = !flying && !movingBrain && parked && performance.now() - lastMove > 2500
}

function desiredKick(neuron) {
  const pull = Number(pullInput.value)
  if (!activeLobe) return pull * 1.1
  const inLobe = neuron.lobe === activeLobe
  const inCategory = !activeCategory || neuron.category === activeCategory || neuron.kind === 'hub'
  return inLobe && inCategory ? pull * 5.4 : pull * 0.35
}

function updateNeurons(dt, elapsed) {
  let tray = 0
  let hotPoint = null
  if (liveFocus) {
    for (const item of placed) {
      if (item.id === liveFocus.id && item.mesh) {
        hotPoint = item.mesh.position
        break
      }
    }
  }
  for (const neuron of placed) {
    if (neuron.quarantine) {
      const angle = tray * 0.55
      tray += 1
      neuron.target.set(Math.cos(angle) * 3.1, trayY, Math.sin(angle) * 3.1)
    } else {
      outward.copy(neuron.home).normalize()
      neuron.target.copy(neuron.home).addScaledVector(outward, desiredKick(neuron))
    }
    const blend = 1 - Math.exp(-dt * 5)
    neuron.mesh.position.lerp(neuron.target, blend)
    const visible = !matchIds || matchIds.has(neuron.id)
    const inPart = liveFocus && neuron.lobe === liveFocus.lobe && (neuron.region || 'corpus') === liveFocus.region
    const nearPart = inPart && hotPoint && neuron.mesh.position.distanceToSquared(hotPoint) < 10
    if (neuron.quarantine) neuron.mesh.material = quarantineMaterial
    else if (liveFocus && neuron.id === liveFocus.id) neuron.mesh.material = liveHotMaterial
    else if (nearPart) neuron.mesh.material = livePartMaterial
    else if (neuron === selected) neuron.mesh.material = selectMaterial
    else if (liveFocus) neuron.mesh.material = dimMaterial
    else if (healthOnly && visible && neuron.health && neuron.health.length) neuron.mesh.material = healthMaterial
    else neuron.mesh.material = visible ? lobeMaterial(neuron.lobe) : dimMaterial
    let scale = neuron.kind === 'hub' ? 1 : 1
    if (liveFocus && neuron.id === liveFocus.id) scale = 2.6
    else if (nearPart) scale = neuron.kind === 'hub' ? 1.8 : 1.35
    else if (neuron === selected) scale = 1.65
    else if (neuron.kind === 'spine' && !neuron.quarantine) scale = 1.45
    else if (neuron.kind === 'heartbeat' && !neuron.quarantine) scale = 1 + Math.sin(elapsed * 3) * 0.28
    neuron.mesh.scale.setScalar(scale)
  }
  placeLiveGlow(elapsed)
  if (!line || pairs.length === 0) return
  const positions = line.geometry.attributes.position
  let write = 0
  for (const [a, b] of pairs) {
    const from = placed[a].mesh.position
    const to = placed[b].mesh.position
    positions.setXYZ(write++, from.x, from.y, from.z)
    positions.setXYZ(write++, to.x, to.y, to.z)
  }
  positions.needsUpdate = true
  line.geometry.setDrawRange(0, pairs.length * 2)
}

function liveMates(neuron) {
  const near = []
  const region = neuron.region || 'corpus'
  for (const item of placed) {
    if (!item.mesh || item.id === neuron.id || item.lobe !== neuron.lobe) continue
    if ((item.region || 'corpus') !== region) continue
    near.push(item)
  }
  near.sort((a, b) => a.mesh.position.distanceToSquared(neuron.mesh.position) - b.mesh.position.distanceToSquared(neuron.mesh.position))
  const mates = []
  const count = Math.min(matePool.length, near.length)
  for (let i = 0; i < count; i++) {
    matePool[i].copy(near[i].mesh.position)
    mates.push(matePool[i])
  }
  return mates
}

function placeLiveGlow(elapsed) {
  const neuron = liveFocus ? placed.find((item) => item.id === liveFocus.id) : null
  const locked = Boolean(neuron?.mesh)
  document.body.classList.toggle('live-locked', locked)
  deck.visible = !locked
  tray.visible = !locked
  if (holoRings) holoRings.visible = !locked
  if (!locked) {
    liveLight.intensity = 0
    liveHalo.visible = false
    liveSprite.visible = false
    liveSkin.set(liveWorld, 0x000000, 0, elapsed)
    liveShow.tick(elapsed, null)
    return
  }
  const pulse = 0.72 + Math.sin(elapsed * 7) * 0.28
  const color = LOBE_COLOR[neuron.lobe] || 0xfcee0a
  liveOut.copy(neuron.mesh.position)
  if (liveOut.lengthSq() > 1e-6) liveOut.normalize()
  else liveOut.set(0, 1, 0)
  liveHalo.visible = false
  liveSprite.visible = false
  neuron.mesh.getWorldPosition(liveWorld)
  liveSkin.set(liveWorld, color, 1, elapsed)
  liveShow.tick(elapsed, {
    position: neuron.mesh.position,
    normal: liveOut,
    color,
    mates: liveMates(neuron),
  })
  liveLight.color.set(color)
  liveLight.position.copy(neuron.mesh.position).addScaledVector(liveOut, 0.45)
  liveLight.intensity = 6 * pulse
  liveLight.distance = 3.8
  livePartMaterial.color.set(color)
  livePartMaterial.emissive.set(color)
  liveHotMaterial.emissive.set(color)
}

function easeBloom(dt) {
  const on = liveFocus ? 1 : 0
  const blend = 1 - Math.exp(-Math.max(dt, 0.001) * 3.5)
  bloom.strength += ((on ? 0.2 : 0.1) - bloom.strength) * blend
  bloom.threshold += ((on ? 0.78 : 0.9) - bloom.threshold) * blend
  bloom.radius += ((on ? 0.28 : 0.2) - bloom.radius) * blend
}

function pick(event) {
  pointerNdc(event)
  raycaster.setFromCamera(pointer, camera)
  const meshes = []
  for (const neuron of placed) if (neuron.mesh) meshes.push(neuron.mesh)
  if (!meshes.length) return null
  const hits = raycaster.intersectObjects(meshes, false)
  return hits.length ? hits[0].object.userData.neuron : null
}

async function loadStage() {
  try {
    const response = await fetch('/api/stage')
    if (!response.ok) return
    stageState = await response.json()
  } catch {
    stageState = { quarantine: [], drafts: {} }
  }
}

async function stage(op, id, text) {
  const response = await fetch('/api/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, id, text }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'stage failed')
  stageState = payload
  for (const neuron of placed) {
    neuron.quarantine = !neuron.locked && stageState.quarantine.includes(neuron.id)
  }
  if (selected) openInspector(selected)
}

function setMoveMode(on) {
  movingBrain = on
  carryArmed = false
  draggingBrain = false
  document.body.classList.toggle('moving-brain', on)
  document.body.classList.remove('dragging-brain')
  if (hint) hint.textContent = on
    ? 'Drag the brain. Triple-click again to turn.'
    : 'Drag to turn. Triple-click the brain to move it.'
  if (!flying) controls.enabled = !on
  if (on) controls.autoRotate = false
}

function pointerNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
}

function hitBrain(event) {
  pointerNdc(event)
  raycaster.setFromCamera(pointer, camera)
  if (raycaster.intersectObject(brainPick, false).length) return true
  const meshes = []
  for (const neuron of placed) if (neuron.mesh) meshes.push(neuron.mesh)
  return meshes.length > 0 && raycaster.intersectObjects(meshes, false).length > 0
}

function armCarry(event) {
  carryArmed = true
  pointerNdc(event)
  carryPlanePoint.copy(picture.position)
  if (viewPlanePoint(camera, carryPlanePoint, pointer.x, pointer.y, carryHit)) {
    carryGrab.copy(picture.position).sub(carryHit)
  } else {
    carryGrab.set(0, 0, 0)
  }
}

function slideBrain(event) {
  pointerNdc(event)
  if (!viewPlanePoint(camera, carryPlanePoint, pointer.x, pointer.y, carryHit)) return
  picture.position.copy(carryHit).add(carryGrab)
  noteActivity()
}

function setFly(next) {
  if (next === flying) return
  if (next && movingBrain) setMoveMode(false)
  flying = next
  flyButton.classList.toggle('active', flying)
  flyButton.textContent = flying ? 'Orbit' : 'Fly'
  controls.enabled = !flying
  controls.autoRotate = false
  if (flying) {
    adoptLook(camera, lookEuler)
    lookArmed = false
    renderer.domElement.requestPointerLock()
  } else {
    if (document.pointerLockElement) document.exitPointerLock()
    parkOrbit(camera, controls, orbitAnchor)
  }
  noteActivity()
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || flying) return
  if (inspectTimer) {
    clearTimeout(inspectTimer)
    inspectTimer = null
  }
  const now = performance.now()
  if (clickMarks.length && now - clickMarks[clickMarks.length - 1] > 500) clickMarks.length = 0
  clickMarks.push(now)
  const triple = event.detail === 3 || clickMarks.length >= 3
  if (triple && hitBrain(event)) {
    clickMarks.length = 0
    event.stopPropagation()
    event.preventDefault()
    const turningOn = !movingBrain
    setMoveMode(turningOn)
    swallowClick = true
    if (turningOn) {
      pointerDown = { x: event.clientX, y: event.clientY }
      armCarry(event)
    }
  }
}, true)

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY }
  if (movingBrain && event.button === 0 && !swallowClick) armCarry(event)
  noteActivity()
})

renderer.domElement.addEventListener('pointerup', (event) => {
  if (swallowClick) {
    swallowClick = false
    carryArmed = false
    draggingBrain = false
    document.body.classList.remove('dragging-brain')
    pointerDown = null
    return
  }
  if (!pointerDown) return
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
  pointerDown = null
  carryArmed = false
  draggingBrain = false
  document.body.classList.remove('dragging-brain')
  if (moved > 5 || flying || movingBrain) return
  const neuron = pick(event)
  if (!neuron) return
  inspectTimer = setTimeout(() => {
    inspectTimer = null
    if (!movingBrain) openInspector(neuron)
  }, 320)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (carryArmed && pointerDown) {
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
    if (moved > 5) {
      draggingBrain = true
      document.body.classList.add('dragging-brain')
      slideBrain(event)
    }
    return
  }
  if (flying) return
  const neuron = pick(event)
  if (!neuron) {
    tooltip.style.display = 'none'
    return
  }
  tooltip.style.display = 'block'
  tooltip.style.left = `${event.clientX + 12}px`
  tooltip.style.top = `${event.clientY + 12}px`
  const note = neuron.health && neuron.health[0] ? ` — ${neuron.health[0].text}` : ''
  tooltip.textContent = `${neuron.name}${note}`
})

renderer.domElement.addEventListener('click', () => {
  if (flying && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock()
  }
})

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement
  if (locked) {
    lookArmed = false
    return
  }
  if (flying) setFly(false)
})

document.addEventListener('mousemove', (event) => {
  if (!flying || document.pointerLockElement !== renderer.domElement) return
  // The cursor warp that starts pointer lock reports a huge first delta.
  if (!lookArmed) {
    lookArmed = true
    return
  }
  if (Math.abs(event.movementX) > 140 || Math.abs(event.movementY) > 140) return
  applyLook(camera, lookEuler, event.movementX, event.movementY)
  noteActivity()
})

window.addEventListener('keydown', (event) => {
  const typing = event.target.matches('input, textarea, select')
  if (!typing && event.code === 'KeyF') {
    setFly(!flying)
    return
  }
  if (event.code === 'Escape') {
    if (movingBrain) {
      setMoveMode(false)
      return
    }
    if (inspector.classList.contains('open')) {
      inspector.classList.remove('open')
      parkFrame()
    }
    else if (flying) setFly(false)
    return
  }
  if (!typing && event.code === 'Slash') {
    event.preventDefault()
    searchInput.focus()
    return
  }
  if (typing) return
  keys.add(event.code)
  noteActivity()
})

window.addEventListener('keyup', (event) => {
  keys.delete(event.code)
})

searchInput.addEventListener('input', () => {
  query = searchInput.value
  recomputeMatch()
})

pullInput.addEventListener('input', noteActivity)
controls.addEventListener('start', noteActivity)
controls.addEventListener('change', noteActivity)

document.querySelector('#close').addEventListener('click', () => {
  inspector.classList.remove('open')
  parkFrame()
})
document.querySelector('#save').addEventListener('click', async () => {
  if (!selected) return
  try {
    await stage('draft', selected.id, inspBody.value)
    statusLine.textContent = 'Draft saved on this PC. Her files were not touched.'
  } catch (error) {
    statusLine.textContent = error.message
  }
})
document.querySelector('#clear-draft').addEventListener('click', async () => {
  if (!selected) return
  try {
    await stage('clear-draft', selected.id, '')
  } catch (error) {
    statusLine.textContent = error.message
  }
})
document.querySelector('#quarantine').addEventListener('click', async () => {
  if (!selected) return
  if (selected.locked) {
    statusLine.textContent = 'That neuron stays.'
    return
  }
  try {
    await stage('quarantine', selected.id, '')
    statusLine.textContent = 'Pulled into the tray under the brain. Her files were not touched.'
  } catch (error) {
    statusLine.textContent = error.message
  }
})
document.querySelector('#restore').addEventListener('click', async () => {
  if (!selected) return
  try {
    await stage('restore', selected.id, '')
  } catch (error) {
    statusLine.textContent = error.message
  }
})
flyButton.addEventListener('click', () => setFly(!flying))

sourceSelect.addEventListener('change', () => {
  const next = brains.find((item) => item._file === sourceSelect.value)
  if (next) {
    activeLobe = null
    activeCategory = null
    healthOnly = false
    build(next)
  }
})

function showSourceMenu() {
  sourceSelect.hidden = brains.length < 2
  sourceSelect.replaceChildren()
  for (const item of brains) {
    const option = document.createElement('option')
    option.value = item._file
    option.textContent = item.source?.label || item._file
    if (brain && item._file === brain._file) option.selected = true
    sourceSelect.append(option)
  }
}

updateBrainButton.addEventListener('click', async () => {
  updateBrainButton.disabled = true
  sourceLine.textContent = 'Reading Hermes over SSH…'
  try {
    const response = await fetch('/api/update-brain', { method: 'POST' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Update failed.')
    const fresh = await fetch(`/brain.droplet.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!fresh.ok) throw new Error('The new map did not load.')
    const brainData = await fresh.json()
    brainData._file = 'brain.droplet.json'
    brains = [brainData, ...brains.filter((item) => item._file !== 'brain.droplet.json')]
    empty.style.display = 'none'
    healthOnly = false
    activeLobe = null
    activeCategory = null
    build(brainData)
    showSourceMenu()
  } catch (error) {
    sourceLine.textContent = error.message || 'Update failed.'
  } finally {
    updateBrainButton.disabled = false
  }
})

openHomeButton.addEventListener('click', () => {
  openRow.hidden = !openRow.hidden
  if (!openRow.hidden) homePath.focus()
})

browseHomeButton.addEventListener('click', async () => {
  browseHomeButton.disabled = true
  sourceLine.textContent = 'Choose a Hermes folder…'
  try {
    const response = await fetch('/api/pick-home', { method: 'POST' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'The folder dialog failed.')
    if (data.path) homePath.value = data.path
    else sourceLine.textContent = 'No folder chosen. Paste a path instead.'
  } catch (error) {
    sourceLine.textContent = error.message || 'The folder dialog failed. Paste a path instead.'
  } finally {
    browseHomeButton.disabled = false
  }
})

function packStatus(data) {
  const kind = data.home ? `${data.home} ` : ''
  return `Pack ready. ${data.files || 0} ${kind}files. Press Birth to make the new folder and open it. The source folder was not changed.`
}

function receiptLine(text, className) {
  const line = document.createElement('p')
  if (className) line.className = className
  line.textContent = text
  return line
}

const RECEIPT_CAP = 60
const EMAIL_IN_PATH = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/
const PHONE_IN_PATH = /(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|\b\d{10,11}\b/
const SECRET_IN_PATH = /api[_-]?key\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S{8,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-z0-9]{12,}|xai-[a-z0-9]{12,}|bws_[a-z0-9_-]{8,}|AKIA[0-9A-Z]{16}/i
const INSTRUCTION_NAMES = new Set(['SOUL.md', 'CLAUDE.md', 'AGENTS.md', 'memories/USER.md', 'memories/MEMORY.md'])

function pathHidden(value) {
  const text = String(value || '')
  if (!text) return false
  return EMAIL_IN_PATH.test(text) || PHONE_IN_PATH.test(text) || SECRET_IN_PATH.test(text)
}

function shownPath(value) {
  const text = String(value ?? '')
  if (!text) return ''
  return pathHidden(text) ? 'hidden-path' : text
}

function safeTitle(value) {
  const label = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!label) return ''
  if (pathHidden(label)) return 'redacted title'
  return label
}

function slashPath(value) {
  return String(value || '').replaceAll('\\', '/')
}

function isInstructionPath(value) {
  const text = slashPath(value)
  if (INSTRUCTION_NAMES.has(text)) return true
  return text.startsWith('.cursor/rules/') && (text.endsWith('.md') || text.endsWith('.mdc'))
}

function isSkillPath(value) {
  const text = slashPath(value)
  if (!text.endsWith('/SKILL.md')) return false
  return text.startsWith('skills/') || text.startsWith('.claude/skills/') || text.startsWith('.agents/skills/')
}

function skillFolderTitle(value) {
  const parts = slashPath(value).split('/')
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

function cappedNames(names, limit) {
  const unique = []
  const seen = new Set()
  for (const name of names) {
    const text = String(name)
    const key = text.toLowerCase()
    if (!key) continue
    if (text !== 'redacted title' && text !== 'hidden-path') {
      if (seen.has(key)) continue
      seen.add(key)
    }
    unique.push(text)
  }
  unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const shown = unique.slice(0, limit)
  if (!shown.length) return 'none'
  const more = unique.length - shown.length
  return more > 0 ? `${shown.join(', ')}, and ${more} more` : shown.join(', ')
}

function linesStripped(data, receipt) {
  const counts = data && data.redactions
  if (counts && typeof counts === 'object') {
    return ['secret', 'email', 'phone'].reduce((sum, key) => sum + (Number(counts[key]) || 0), 0)
  }
  if (typeof counts === 'number' && Number.isFinite(counts)) return counts
  const files = Array.isArray(receipt && receipt.files) ? receipt.files : []
  return files.reduce((sum, file) => sum + (Number(file && file.redactions) || 0), 0)
}

function jobCount(receipt, data) {
  if (receipt && typeof receipt.jobs_left_behind === 'number') return receipt.jobs_left_behind
  if (data && typeof data.jobs_left_behind === 'number') return data.jobs_left_behind
  return Number(receipt && receipt.jobs_left_behind) || Number(data && data.jobs_left_behind) || 0
}

function openLine(kind) {
  if (kind === 'hermes') return 'In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.'
  if (kind === 'claude') return 'In the Claude desktop app, open the Code tab, select the top entry in the Local group, then on the project folder control select Open folder…, and choose this folder. Read the Cortex note at the top of CLAUDE.md. That note is the instruction.'
  if (kind === 'cursor') return 'Open Cursor, click File, then Open Folder, and select this folder. Read the Cortex note at the top of the rule or AGENTS.md. That note is the instruction.'
  if (kind === 'agents') return 'Change into this folder in a terminal, then run codex. Read the Cortex note at the top of AGENTS.md first. That note is the instruction.'
  return 'Change into this folder in a terminal, then start the agent from this folder.'
}

function deskCard(data) {
  const receipt = receiptBody(data)
  const files = Array.isArray(receipt.files) ? receipt.files : []
  const instructions = []
  const titles = []
  for (const file of files) {
    const path = String((file && file.path) || '')
    if (!path) continue
    if (isInstructionPath(path)) {
      instructions.push(pathHidden(path) ? 'hidden-path' : path)
      continue
    }
    if (!isSkillPath(path)) continue
    titles.push(pathHidden(path) ? 'redacted title' : safeTitle(skillFolderTitle(path)))
  }
  const held = (receipt.held || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => safeTitle(item))
  return [
    receiptLine(openLine(receipt.home)),
    receiptLine('Do not copy files onto an agent already running.'),
    receiptLine(`Instruction files: ${cappedNames(instructions, 40)}.`),
    receiptLine(`Skill titles: ${cappedNames(titles, 40)}.`),
    receiptLine(`Held titles: ${held.length ? cappedNames(held, 40) : 'none'}.`),
    receiptLine(`Lines stripped: ${linesStripped(data, receipt)}.`),
    receiptLine(`Jobs left behind: ${jobCount(receipt, data)}.`),
  ]
}

function receiptList(title, items) {
  const names = (items || []).map((item) => String(item || '')).filter(Boolean)
  if (!names.length) return []
  const shown = names.slice(0, RECEIPT_CAP)
  const nodes = [receiptLine(title, 'kept')]
  const list = document.createElement('ul')
  for (const name of shown) {
    const item = document.createElement('li')
    item.textContent = name
    list.append(item)
  }
  if (names.length > shown.length) {
    const item = document.createElement('li')
    item.textContent = `${names.length - shown.length} more are in the pack folder.`
    list.append(item)
  }
  nodes.push(list)
  return nodes
}

function fileLabel(file) {
  const path = String(file.path || 'file')
  if (pathHidden(path)) return 'hidden-path'
  const bits = [path]
  if (path === 'BIRTH.md') bits.push('advice')
  if (path === 'START.md') bits.push('which agent to open')
  if (path === 'ASK.md') bits.push('note for the other AI')
  if (path === 'ASK.json') bits.push('card for the other AI')
  if (path === 'STOP.json') bits.push('read before any skill. this file does not stop a tool')
  if (path === '.claude/settings.json' || path === '.cursor/sandbox.json' || path === '.codex/rules/cortex-stop.rules') bits.push('tool file for this agent only')
  const count = Number(file.redactions) || 0
  if (count) bits.push(`${count} stripped`)
  return bits.join(' · ')
}

function receiptBody(data) {
  if (data && data.receipt && Array.isArray(data.receipt.files)) return data.receipt
  if (data && Array.isArray(data.files)) return data
  return {}
}

function renderMoveReceipt(title, data, desk) {
  const receipt = receiptBody(data)
  const files = Array.isArray(receipt.files) ? receipt.files : []
  receiptEl.hidden = false
  receiptEl.replaceChildren()
  if (desk) {
    for (const node of deskCard(data)) receiptEl.append(node)
  }
  receiptEl.append(receiptLine(title))
  for (const node of receiptList(`${files.length} ${files.length === 1 ? 'file' : 'files'}`, files.map(fileLabel))) {
    receiptEl.append(node)
  }
  const stays = (receipt.stays || []).map((item) => shownPath(item)).filter(Boolean)
  if (stays.length) receiptEl.append(receiptLine(`Left in the original folder: ${stays.join(', ')}.`))
  const jobs = Number(receipt.jobs_left_behind) || 0
  if (jobs) receiptEl.append(receiptLine(`${jobs} ${jobs === 1 ? 'job' : 'jobs'} stayed home. Their names were not copied.`))
  if (receipt.rules_only) receiptEl.append(receiptLine('Memory stayed behind.'))
  const held = (receipt.held || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => safeTitle(item))
  if (held.length) receiptEl.append(receiptLine(`Held back: ${held.join(', ')}.`))
  const missing = (receipt.missing || []).map((item) => shownPath(item)).filter(Boolean)
  if (missing.length) receiptEl.append(receiptLine(`Not in the folder: ${missing.join(', ')}.`))
  const skipped = []
  for (const item of receipt.skipped || []) {
    const note = String(item.note || '')
    const path = shownPath(item.path || '')
    if (path && note) skipped.push(pathHidden(note) ? path : `${path} · ${note}`)
    else if (path) skipped.push(path)
    else if (note && !pathHidden(note)) skipped.push(note)
  }
  for (const node of receiptList('Stayed behind', skipped)) receiptEl.append(node)
  requestAnimationFrame(fitMoveCard)
}

function dropKinPath(value) {
  const text = String(value || '')
  if (!text) return true
  if (/sk-/i.test(text) || /xai-/i.test(text) || /AKIA/i.test(text)) return true
  return EMAIL_IN_PATH.test(text)
}

function kinWhere(item) {
  const title = safeTitle(item.title || 'skill') || 'skill'
  const where = [...(item.first || []), ...(item.second || []), ...(item.paths || [])]
    .map((entry) => String(entry || ''))
    .filter((entry) => entry && !dropKinPath(entry))
    .map((entry) => shownPath(entry))
    .filter(Boolean)
  return where.length ? `${title} · ${where.join(' · ')}` : title
}

function renderKinReceipt(data) {
  receiptEl.hidden = false
  receiptEl.replaceChildren(receiptLine(`Compared ${shownPath(data.first) || 'the first birth'} with ${shownPath(data.second) || 'the second birth'}. Skill text was not copied.`))
  const groups = [
    ['Same skill', (data.same || []).map((item) => safeTitle(item.title))],
    ['Split skill', (data.split || []).map(kinWhere)],
    ['Only in the first birth', (data.only_left || []).map(kinWhere)],
    ['Only in the second birth', (data.only_right || []).map(kinWhere)],
    ['Instruction files, named only', (data.instructions || []).map((item) => {
      const path = shownPath(item.path)
      return path ? `${path} · ${item.side === 'second' ? 'second' : 'first'}` : ''
    })],
  ]
  for (const [title, items] of groups) {
    for (const node of receiptList(title, items)) receiptEl.append(node)
  }
  if (data.dest) receiptEl.append(receiptLine(`The comparison is in ${shownPath(data.dest)}. The births were not merged.`))
  requestAnimationFrame(fitMoveCard)
}

function handoffFacts(data) {
  const receipt = receiptBody(data)
  const files = Array.isArray(receipt.files) ? receipt.files : []
  const titles = []
  for (const file of files) {
    const path = String((file && file.path) || '')
    if (!isSkillPath(path)) continue
    titles.push(pathHidden(path) ? 'redacted title' : safeTitle(skillFolderTitle(path)))
  }
  const held = (receipt.held || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => safeTitle(item))
  const memory = receipt.rules_only
    ? 'Memory stayed in the original folder.'
    : 'Memory was copied when those files were in the original folder.'
  return [
    `Skill titles: ${titles.length ? cappedNames(titles, 40) : 'none'}. Each skill is only its SKILL.md.`,
    `Held back: ${held.length ? cappedNames(held, 40) : 'none'}.`,
    memory,
    `Jobs left behind: ${jobCount(receipt, data)}. Their names are not in this folder.`,
    'Files beside a skill, other than SKILL.md, stayed in the original folder.',
    'Stop and ask a person before a send, a push, or a delete. Nothing in this folder stops those.',
  ]
}

function handoffText(dest, note, kind, data) {
  const warning = typeof note === 'string' ? note.trim() : ''
  const lead = warning
    ? (pathHidden(warning) ? 'hidden-path' : warning)
    : 'Do not paste this folder into the agent that is already open.'
  const lines = [shownPath(dest), openLine(kind), lead, ...handoffFacts(data)]
  return lines.join('\n')
}

function renderHandoff(dest, note, kind, data) {
  const warning = typeof note === 'string' ? note.trim() : ''
  if (!dest && !warning) return
  const box = document.createElement('textarea')
  box.className = 'handoff'
  box.readOnly = true
  box.spellcheck = false
  box.value = handoffText(dest, warning, kind, data)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Copy for the new AI'
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(box.value)
      sourceLine.textContent = 'Copied. Paste that note to the new AI, not the one that is already open.'
    } catch {
      box.focus()
      box.select()
      sourceLine.textContent = 'Select the note and copy it.'
    }
  })
  button.className = 'handoff-end'
  const lead = receiptLine('Give this to your AI.')
  lead.classList.add('handoff-lead')
  receiptEl.prepend(button)
  receiptEl.prepend(box)
  receiptEl.prepend(lead)
  const fold = document.createElement('details')
  fold.className = 'file-fold'
  const summary = document.createElement('summary')
  summary.textContent = 'Files in the folder'
  fold.append(summary)
  for (const node of [...receiptEl.childNodes]) {
    if (node === lead || node === box || node === button) continue
    fold.append(node)
  }
  if (fold.childNodes.length > 1) receiptEl.append(fold)
  receiptEl.scrollTop = 0
  box.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  requestAnimationFrame(fitMoveCard)
}

function renderCheckReceipt(data) {
  receiptEl.hidden = false
  receiptEl.replaceChildren(receiptLine(verifyStatus(data)))
  const groups = [
    ['Changed', data.tamper],
    ['Missing', data.missing],
    ['Takeover', data.takeover],
    ['Growth', data.growth],
    ['Changed in the agent', data.changed],
    ['Gone from the agent', data.gone],
    ['Source drifted', data.changed || data.gone ? [] : data.stale_files],
    ['New since this pack', data.grew],
  ]
  for (const [title, items] of groups) {
    for (const node of receiptList(title, (items || []).map((item) => shownPath(item)))) receiptEl.append(node)
  }
  requestAnimationFrame(fitMoveCard)
}

birthPackButton.addEventListener('click', async () => {
  birthPackButton.disabled = true
  placeArmed = ''
  placePackButton.textContent = 'Place'
  sourceLine.textContent = 'Reading the file list.'
  try {
    const preview = await fetch('/api/pack-receipt', { method: 'POST' })
    const previewData = await preview.json()
    if (!preview.ok) throw new Error(previewData.error || 'Build a pack first.')
    renderMoveReceipt('These files will be born into a new folder.', previewData)
    sourceLine.textContent = 'Writing the new folder, away from the live agent.'
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const response = await fetch('/api/birth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ open: true, source: homePath.value.trim() }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (Array.isArray(data.grew) || Array.isArray(data.stale_files)) renderCheckReceipt(data)
      throw new Error(data.error || 'Birth failed.')
    }
    const bornLine = typeof data.line === 'string' ? data.line.trim() : ''
    sourceLine.textContent = bornLine || 'Born.'
    renderMoveReceipt(`Born at ${shownPath(data.dest) || 'the new folder'}.`, data)
    renderHandoff(data.dest, data.note, data.home || previewData.home, previewData)
  } catch (error) {
    sourceLine.textContent = error.message || 'Birth failed.'
  } finally {
    birthPackButton.disabled = false
  }
})

homePath.addEventListener('input', () => {
  placeArmed = ''
  placePackButton.textContent = 'Place'
})

placePackButton.addEventListener('click', async () => {
  const folder = homePath.value.trim()
  if (!folder) {
    openRow.hidden = false
    homePath.focus()
    sourceLine.textContent = 'Paste an empty folder. A live agent home is refused.'
    return
  }
  if (placeArmed !== folder) {
    placePackButton.disabled = true
    sourceLine.textContent = 'Reading the file list. Nothing is written yet.'
    try {
      const response = await fetch('/api/pack-receipt', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Build a pack first.')
      placeArmed = folder
      placePackButton.textContent = 'Write'
      const count = Array.isArray(data.files) ? data.files.length : 0
      sourceLine.textContent = `${count} files are ready for ${shownPath(folder)}. Press Write to put them there. Nothing has been written.`
      renderMoveReceipt('Ready to write. Press Write.', data)
    } catch (error) {
      placeArmed = ''
      placePackButton.textContent = 'Place'
      sourceLine.textContent = error.message || 'No pack to place.'
      receiptEl.hidden = true
      receiptEl.replaceChildren()
    } finally {
      placePackButton.disabled = false
    }
    return
  }
  placePackButton.disabled = true
  sourceLine.textContent = 'Writing the pack into that empty folder.'
  try {
    const response = await fetch('/api/install-pack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: folder }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Place failed.')
    placeArmed = ''
    placePackButton.textContent = 'Place'
    sourceLine.textContent = `Written. Give the note below to your AI. The folder is ${shownPath(folder)}.`
    renderMoveReceipt(`Written to ${shownPath(folder)}.`, data)
    renderHandoff(folder, data.note, data.home, data)
  } catch (error) {
    placeArmed = ''
    placePackButton.textContent = 'Place'
    sourceLine.textContent = error.message || 'Place failed.'
  } finally {
    placePackButton.disabled = false
  }
})

function verifyStatus(data) {
  const matched = data.match || 0
  const tamper = (data.tamper || []).length
  const missing = (data.missing || []).length
  const takeover = (data.takeover || []).length
  const growth = (data.growth || []).length
  const stale = data.stale
  const grew = (data.grew || []).length
  const arrived = grew ? ` ${grew} new ${grew === 1 ? 'file' : 'files'} appeared in the source.` : ''
  if (data.lock === 'mismatch') return 'The packing list does not match its hash. Nothing was written.'
  if (!data.ok) {
    const parts = []
    if (tamper) parts.push(`${tamper} packed ${tamper === 1 ? 'file' : 'files'} changed`)
    if (missing) parts.push(`${missing} packed ${missing === 1 ? 'file' : 'files'} missing`)
    if (takeover) parts.push(`${takeover} ${takeover === 1 ? 'file is a takeover' : 'files are takeovers'}`)
    if (typeof stale === 'number' && stale > 0) parts.push(`${stale} source ${stale === 1 ? 'file is' : 'files are'} stale`)
    const why = parts.length ? parts.join('. ') : 'The packing list does not hold'
    return `Packing list broken. ${why}. The folder is unchanged.${arrived} This check does not stop a skill.`
  }
  const grown = growth ? ` ${growth} ${growth === 1 ? 'file' : 'files'} under growth/.` : ''
  if (grew) return `${grew} new ${grew === 1 ? 'file' : 'files'} appeared since Build. The packed files still match.${grown} Nothing was written.`
  return `Packing list matched at this check. ${matched} files.${grown} This check does not stop a skill.`
}

function compareStatusText(data) {
  const same = Array.isArray(data && data.same) ? data.same.length : 0
  const split = Array.isArray(data && data.split) ? data.split.length : 0
  const left = Array.isArray(data && data.only_left) ? data.only_left.length : 0
  const right = Array.isArray(data && data.only_right) ? data.only_right.length : 0
  let line = `${same} same, ${split} split, ${left} only in the first birth, ${right} only in the second. Skill text was not copied.`
  if (typeof plainKin === 'function') {
    const view = plainKin(data)
    if (typeof view === 'string' && view.trim()) line = view.trim()
  }
  if (typeof kinPlain === 'function') {
    const text = kinPlain(data)
    if (typeof text === 'string' && text.trim()) line = text.trim()
  }
  if (!/were not merged/i.test(line)) line = `${line} The births were not merged.`
  return line
}

if (kinPackButton && kinPaths) {
  kinPackButton.addEventListener('click', async () => {
    const lines = kinPaths.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines.length !== 2) {
      sourceLine.textContent = 'Paste two birth folders, one path on each line.'
      kinPaths.focus()
      return
    }
    kinPackButton.disabled = true
    sourceLine.textContent = 'Comparing the two births. Skill text stays in those folders.'
    try {
      const response = await fetch('/api/kin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ left: lines[0], right: lines[1] }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Compare failed.')
      sourceLine.textContent = await compareStatusText(data)
      renderKinReceipt(data)
    } catch (error) {
      sourceLine.textContent = error.message || 'Compare failed.'
    } finally {
      kinPackButton.disabled = false
    }
  })
}

checkPackButton.addEventListener('click', async () => {
  const folder = homePath.value.trim()
  checkPackButton.disabled = true
  sourceLine.textContent = folder
    ? 'Checking that folder against the packing list. Nothing is written.'
    : 'Checking the last birth against the agent that made it. Nothing is written.'
  try {
    const response = await fetch('/api/verify-pack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(folder ? { path: folder } : {}),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Check failed.')
    sourceLine.textContent = verifyStatus(data)
    renderCheckReceipt(data)
  } catch (error) {
    sourceLine.textContent = error.message || 'Check failed.'
  } finally {
    checkPackButton.disabled = false
  }
})

buildPackButton.addEventListener('click', async () => {
  const folder = homePath.value.trim()
  if (!folder) {
    openRow.hidden = false
    homePath.focus()
    sourceLine.textContent = 'Paste an agent folder. An empty box does not pack the server brain.'
    return
  }
  placeArmed = ''
  placePackButton.textContent = 'Place'
  buildPackButton.disabled = true
  const hold = holdTitles
    ? holdTitles.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 40)
    : []
  const rulesOnly = Boolean(rulesOnlyBox && rulesOnlyBox.checked)
  sourceLine.textContent = rulesOnly
    ? 'Building a rules-only pack. Memory stays in the original folder.'
    : 'Building a pack from that folder. The folder stays as it is.'
  try {
    const response = await fetch('/api/pack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: folder, rules_only: rulesOnly, hold }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Pack failed.')
    sourceLine.textContent = packStatus(data)
    renderMoveReceipt(`Copied. The pack is in ${shownPath(data.out) || 'the pack folder'}.`, data, true)
  } catch (error) {
    sourceLine.textContent = error.message || 'Pack failed.'
  } finally {
    buildPackButton.disabled = false
  }
})

scanHomeButton.addEventListener('click', async () => {
  const folder = homePath.value.trim()
  if (!folder) {
    sourceLine.textContent = 'Paste a Hermes home path, or browse to one.'
    return
  }
  scanHomeButton.disabled = true
  sourceLine.textContent = 'Scanning that folder on this PC…'
  try {
    const response = await fetch('/api/scan-home', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: folder }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Scan failed.')
    data._file = `opened:${data.source?.home || folder}`
    brains = brains.filter((item) => !String(item._file || '').startsWith('opened:'))
    brains.unshift(data)
    empty.style.display = 'none'
    healthOnly = false
    activeLobe = null
    activeCategory = null
    showSourceMenu()
    build(data)
  } catch (error) {
    sourceLine.textContent = error.message || 'Scan failed.'
  } finally {
    scanHomeButton.disabled = false
  }
})

window.addEventListener('resize', () => {
  fitMoveCard()
  parkFrame()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
  bloom.resolution.set(window.innerWidth, window.innerHeight)
})

function animate() {
  playLiveRead()
  const dt = Math.min(clock.getDelta(), 0.05)
  const elapsed = clock.elapsedTime
  markMoved()
  if (flying) {
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
    const lift = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)
    cameraBasis(camera, fwd, right)
    camera.position.add(flyDelta(fwd, right, { forward, strafe, lift }, 7 * dt))
  } else {
    controls.update()
  }
  if (placed.length) updateNeurons(dt, elapsed)
  else placeLiveGlow(elapsed)
  easeBloom(dt)
  holoMat.uniforms.uTime.value = elapsed
  if (holoRings) holoRings.rotation.y = elapsed * (liveFocus ? 0.48 : 0.12)
  composer.render()
  requestAnimationFrame(animate)
}

async function loadBrains() {
  const found = []
  for (const name of ['brain.droplet.json', 'brain.windows.json']) {
    const response = await fetch(`/${name}`, { cache: 'no-store' })
    if (!response.ok) continue
    const data = await response.json()
    data._file = name
    found.push(data)
  }
  return found
}

async function loadSelf() {
  try {
    const response = await fetch('/api/hermes-self', { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

let learnStamp = ''

async function refreshLearnInbox() {
  const box = document.querySelector('#learn-inbox')
  if (!box) return
  try {
    const response = await fetch('/api/brain-learn', { cache: 'no-store' })
    const data = await response.json()
    const proposals = Array.isArray(data.proposals) ? data.proposals : []
    const stamp = proposals.map((item) => `${item.id}:${item.text}`).join('|')
    if (stamp === learnStamp) return
    learnStamp = stamp
    box.replaceChildren()
    if (!proposals.length) {
      const empty = document.createElement('p')
      empty.className = 'aside-note'
      empty.textContent = 'No notes waiting.'
      box.append(empty)
      return
    }
    for (const item of proposals) {
      const row = document.createElement('p')
      row.className = 'aside-note'
      const text = document.createElement('span')
      text.textContent = `${item.from || 'bot'}: ${item.text}`
      const accept = document.createElement('button')
      accept.type = 'button'
      accept.textContent = 'Accept'
      accept.addEventListener('click', () => decideLearn(item.id, 'accept'))
      const reject = document.createElement('button')
      reject.type = 'button'
      reject.textContent = 'Reject'
      reject.addEventListener('click', () => decideLearn(item.id, 'reject'))
      row.append(text, document.createTextNode(' '), accept, document.createTextNode(' '), reject)
      box.append(row)
    }
  } catch {
    /* the picture still works if the inbox is quiet */
  }
}

async function decideLearn(id, action) {
  learnStamp = ''
  await fetch(`/api/brain-learn/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  await refreshLearnInbox()
}

async function refreshBotDoor() {
  if (!botDoorLine) return
  try {
    const response = await fetch('/api/bot-door')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'The door check failed.')
    if (data.tunnel) {
      botDoorLine.textContent = 'The tunnel is open. His computer can call /brain on the jobs bridge.'
      if (botDoorOpen) botDoorOpen.hidden = true
    } else {
      botDoorLine.textContent = 'The tunnel is closed. His computer cannot see this picture yet.'
      if (botDoorOpen) botDoorOpen.hidden = false
    }
  } catch (error) {
    botDoorLine.textContent = error.message || 'The door check failed.'
  }
}

if (botDoorOpen) {
  botDoorOpen.addEventListener('click', async () => {
    botDoorOpen.disabled = true
    botDoorLine.textContent = 'Opening the tunnel…'
    try {
      const response = await fetch('/api/bot-door', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'The tunnel did not open.')
    } catch (error) {
      botDoorLine.textContent = error.message || 'The tunnel did not open.'
    } finally {
      botDoorOpen.disabled = false
      await refreshBotDoor()
    }
  })
}

async function boot() {
  await refreshBotDoor()
  await refreshLearnInbox()
  setInterval(refreshLearnInbox, 5000)
  await pollBotLive()
  setInterval(pollBotLive, 1000)
  await loadStage()
  selfSnapshot = await loadSelf()
  brains = await loadBrains()
  if (!brains.length) {
    empty.style.display = 'block'
    sourceLine.textContent = 'No Hermes picture yet. Paste a folder, then press Build.'
    requestAnimationFrame(animate)
    return
  }
  showSourceMenu()
  build(brains[0])
  requestAnimationFrame(animate)
}

const firstMove = document.querySelector('#first-move')
if (firstMove && typeof ResizeObserver !== 'undefined') {
  let fitting = false
  new ResizeObserver(() => {
    if (fitting) return
    fitting = true
    fitMoveCard()
    requestAnimationFrame(() => { fitting = false })
  }).observe(firstMove)
}
const holdMore = document.querySelector('#hold-more')
if (holdMore) holdMore.addEventListener('toggle', () => requestAnimationFrame(fitMoveCard))
fitMoveCard()
boot()
