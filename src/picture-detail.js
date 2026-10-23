import * as THREE from 'three'
import { makeHullGeometry } from './brain-shape.js'

export const PICTURE_NOTE = 'This is a picture of Hermes. It does not move files.'

// makePictureWire() — coarser fallback hull from the geometry already built.
export function makePictureWire() {
  return makeHullGeometry(2)
}

const ROUGH_SIZE = 64
let roughnessVariation = null

function lattice(ix, iy) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function fade(t) {
  return t * t * (3 - 2 * t)
}

function valueNoise(x, y) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const a = lattice(x0, y0)
  const b = lattice(x0 + 1, y0)
  const c = lattice(x0, y0 + 1)
  const d = lattice(x0 + 1, y0 + 1)
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return top + (bottom - top) * ty
}

function foldRoughnessMap() {
  if (roughnessVariation) return roughnessVariation
  const data = new Uint8Array(ROUGH_SIZE * ROUGH_SIZE * 4)
  for (let y = 0; y < ROUGH_SIZE; y++) {
    for (let x = 0; x < ROUGH_SIZE; x++) {
      const u = x / ROUGH_SIZE
      const v = y / ROUGH_SIZE
      const n = valueNoise(u * 5, v * 5)
      const n2 = valueNoise(u * 11 + 4.2, v * 9 + 1.7)
      const mixed = Math.min(1, Math.max(0, 0.74 + 0.26 * (n * 0.72 + n2 * 0.28)))
      const g = Math.round(mixed * 255)
      const i = (y * ROUGH_SIZE + x) * 4
      data[i] = g
      data[i + 1] = g
      data[i + 2] = g
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, ROUGH_SIZE, ROUGH_SIZE, THREE.RGBAFormat)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.repeat.set(2, 2)
  tex.needsUpdate = true
  roughnessVariation = tex
  return tex
}

// applyPictureDetail(material) — on a picture MeshStandardMaterial, add close-up roughness variation and a dim emissive shade.
export function applyPictureDetail(material) {
  if (!material || !material.isMeshStandardMaterial) return material
  if (material.userData.pictureDetail) return material
  material.userData.pictureDetail = true
  const base = Number.isFinite(material.roughness) ? material.roughness : 0.84
  material.roughness = Math.min(1, base + 0.06)
  material.roughnessMap = foldRoughnessMap()
  if (material.emissive) {
    const lum = material.emissive.r + material.emissive.g + material.emissive.b
    if (lum < 0.08) {
      material.emissive.set(0x1c2a34)
      material.emissiveIntensity = 0.12
    }
  }
  material.needsUpdate = true
  return material
}

// applyDimPicture(material) — dim that same picture material once; no animation loop.
export function applyDimPicture(material) {
  if (!material || !material.isMeshStandardMaterial) return material
  if (material.userData.pictureDim) return material
  material.userData.pictureDim = true
  if (material.color) material.color.multiplyScalar(0.58)
  if (material.emissive) material.emissive.multiplyScalar(0.45)
  const intensity = Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : 0
  material.emissiveIntensity = Math.min(intensity, 0.08)
  const rough = Number.isFinite(material.roughness) ? material.roughness : 0.9
  material.roughness = Math.min(1, Math.max(rough, 0.92))
  if (Number.isFinite(material.envMapIntensity)) material.envMapIntensity = Math.min(material.envMapIntensity, 0.15)
  material.needsUpdate = true
  return material
}

const PICTURE_CLUSTER = {
  skills: 'Skills',
  memory: 'Memory',
  user: 'User',
  soul: 'Soul',
}

// detailCaption(lobe) — "Picture only. This cluster is Skills." for skills, memory, user, or soul; otherwise "Picture only."
export function detailCaption(lobe) {
  const cluster = PICTURE_CLUSTER[String(lobe == null ? '' : lobe).trim().toLowerCase()]
  if (!cluster) return 'Picture only.'
  return `Picture only. This cluster is ${cluster}.`
}

// detailForPicture(neuron) — detailCaption of neuron.lobe only. Does not read body, path, or name.
export function detailForPicture(neuron) {
  return detailCaption(neuron && neuron.lobe)
}
