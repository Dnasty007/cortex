import * as THREE from 'three'

// Target lock parented to the picture so a brain drag carries it.

const ARC_COUNT = 22
const ARC_SEGS = 5
const ARC_VERTS = ARC_COUNT * ARC_SEGS * 2
const SPARK_N = 72
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)

function radialTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.18, 'rgba(255,255,255,0.95)')
  glow.addColorStop(0.45, 'rgba(255,255,255,0.28)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function addMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
}

function torus(radius, tube, arc, material) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 56, arc),
    material,
  )
  mesh.raycast = () => {}
  return mesh
}

function bezier(out, control, end, t) {
  const u = 1 - t
  const c = 2 * u * t
  const e = t * t
  out.set(
    c * control.x + e * end.x,
    c * control.y + e * end.y,
    c * control.z + e * end.z,
  )
}

export function createLiveShow(picture) {
  const group = new THREE.Group()
  group.visible = false
  picture.add(group)

  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture(),
    color: 0xfcee0a,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  }))
  core.raycast = () => {}
  core.scale.set(2.8, 2.8, 1)
  group.add(core)

  const ringTilt = new THREE.Group()
  ringTilt.rotation.x = -Math.PI / 2
  group.add(ringTilt)

  const reticleMats = [
    addMaterial(0xff2bd6, 0.9),
    addMaterial(0xfcee0a, 0.75),
    addMaterial(0x3ee0ff, 0.9),
  ]
  const reticles = [
    torus(0.55, 0.014, Math.PI * 1.35, reticleMats[0]),
    torus(0.95, 0.012, Math.PI * 1.15, reticleMats[1]),
    torus(1.45, 0.01, Math.PI * 1.55, reticleMats[2]),
  ]
  const spin = [1.7, -1.15, 0.72]
  for (const mesh of reticles) ringTilt.add(mesh)

  const waveMats = [0, 1, 2].map(() => addMaterial(0x3ee0ff, 0.7))
  const waves = waveMats.map((material) => torus(1, 0.016, Math.PI * 2, material))
  for (const mesh of waves) ringTilt.add(mesh)

  const scanMat = addMaterial(0xfcee0a, 0.95)
  const scan = torus(0.85, 0.02, Math.PI * 2, scanMat)
  scan.rotation.x = -Math.PI / 2
  group.add(scan)

  const columnMat = addMaterial(0xff2bd6, 0.45)
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, 1, 12, 1, true), columnMat)
  column.raycast = () => {}
  column.scale.y = 2.4
  column.position.y = 1.2
  group.add(column)

  const arcPositions = new Float32Array(ARC_VERTS * 3)
  const arcGeo = new THREE.BufferGeometry()
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3))
  arcGeo.setDrawRange(0, 0)
  const arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
    color: 0x3ee0ff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  }))
  arcLines.raycast = () => {}
  group.add(arcLines)

  const sparkPositions = new Float32Array(SPARK_N * 3)
  const sparkLives = new Float32Array(SPARK_N)
  const sparkAngle = new Float32Array(SPARK_N)
  const sparkRad = new Float32Array(SPARK_N)
  for (let i = 0; i < SPARK_N; i++) {
    sparkLives[i] = Math.random()
    sparkAngle[i] = Math.random() * Math.PI * 2
    sparkRad[i] = 0.15 + Math.random() * 0.4
  }
  const sparkGeo = new THREE.BufferGeometry()
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3))
  const sparkMat = new THREE.PointsMaterial({
    color: 0xfcee0a,
    size: 0.14,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  sparks.raycast = () => {}
  sparks.frustumCulled = false
  group.add(sparks)

  const invQ = new THREE.Quaternion()
  const end = new THREE.Vector3()
  const control = new THREE.Vector3()
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  let lastElapsed = -1

  function tick(elapsed, focus) {
    const dt = lastElapsed < 0 ? 0.016 : Math.min(0.05, Math.max(0, elapsed - lastElapsed))
    lastElapsed = elapsed
    if (!focus || !focus.position) {
      group.visible = false
      return
    }
    group.visible = true
    normal.copy(focus.normal || Y_AXIS)
    if (normal.lengthSq() < 1e-6) normal.copy(Y_AXIS)
    else normal.normalize()
    if (normal.dot(DOWN) > 0.999) normal.copy(DOWN)
    group.position.copy(focus.position).addScaledVector(normal, 0.28)
    group.quaternion.setFromUnitVectors(Y_AXIS, normal)
    invQ.copy(group.quaternion).invert()

    const color = focus.color || 0xfcee0a
    const pulse = 0.7 + Math.sin(elapsed * 7.5) * 0.3
    core.material.color.set(color)
    core.material.opacity = 0.75 + pulse * 0.2
    core.scale.setScalar(1.35 + pulse * 0.7)
    reticleMats[2].color.set(color)
    scanMat.color.set(color)
    waveMats[0].color.set(color)
    arcLines.material.color.set(color)
    sparkMat.color.set(color)
    columnMat.opacity = 0.28 + pulse * 0.35
    scanMat.opacity = 0.55 + pulse * 0.4

    for (let i = 0; i < reticles.length; i++) {
      reticles[i].rotation.z = elapsed * spin[i]
      reticleMats[i].opacity = 0.45 + pulse * 0.5
    }
    for (let i = 0; i < waves.length; i++) {
      const span = (elapsed * 0.62 + i / 3) % 1
      waves[i].scale.setScalar(0.35 + span * 2.05)
      waveMats[i].opacity = (1 - span) * 0.7
    }
    scan.position.y = ((elapsed * 0.85) % 1) * 2.2 - 0.15

    const mates = focus.mates || []
    const count = Math.min(ARC_COUNT, mates.length)
    let vertex = 0
    for (let i = 0; i < count; i++) {
      end.copy(mates[i]).sub(group.position).applyQuaternion(invQ)
      control.set(end.x * 0.5, 0.7 + end.y * 0.25, end.z * 0.5)
      for (let s = 0; s < ARC_SEGS; s++) {
        bezier(point, control, end, s / ARC_SEGS)
        arcPositions[vertex * 3] = point.x
        arcPositions[vertex * 3 + 1] = point.y
        arcPositions[vertex * 3 + 2] = point.z
        vertex += 1
        bezier(point, control, end, (s + 1) / ARC_SEGS)
        arcPositions[vertex * 3] = point.x
        arcPositions[vertex * 3 + 1] = point.y
        arcPositions[vertex * 3 + 2] = point.z
        vertex += 1
      }
    }
    arcGeo.setDrawRange(0, vertex)
    arcGeo.attributes.position.needsUpdate = true

    for (let i = 0; i < SPARK_N; i++) {
      sparkLives[i] += dt * 0.55
      if (sparkLives[i] > 1) {
        sparkLives[i] = 0
        sparkAngle[i] = Math.random() * Math.PI * 2
        sparkRad[i] = 0.15 + Math.random() * 0.4
      }
      const life = sparkLives[i]
      const ang = sparkAngle[i] + life * 1.6
      const radius = sparkRad[i] * (1 - life * 0.35)
      sparkPositions[i * 3] = Math.cos(ang) * radius
      sparkPositions[i * 3 + 1] = life * 3.2
      sparkPositions[i * 3 + 2] = Math.sin(ang) * radius
    }
    sparkGeo.attributes.position.needsUpdate = true
  }

  return { tick }
}
