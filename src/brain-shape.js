import * as THREE from 'three'

// Unit-space radius along a direction. The hull is an ellipsoid with a
// frontal bulge, a top fissure, side temporal droop, and a rear-lower
// cerebellum. Symmetric in x: brainRadius(+x) === brainRadius(-x).
// Fold ridges live only on makeHullGeometry. SCALE and brainRadius stay
// the neuron shell so placed points do not leave the picture.
export const SCALE = 6

export function brainRadius(dir) {
  const x = dir.x
  const y = dir.y
  const z = dir.z
  const ax = Math.abs(x)
  const front = Math.max(0, z)
  const back = Math.max(0, -z)
  const temporal = Math.exp(-((ax - 0.72) ** 2) / 0.06) * Math.exp(-((y + 0.22) ** 2) / 0.08)
  const cere = Math.exp(-(x * x) / 0.18) * Math.exp(-((y + 0.62) ** 2) / 0.05) * Math.exp(-((z + 0.62) ** 2) / 0.08)
  const fissure = Math.exp(-(x * x) / 0.004) * Math.max(0, y)
  let rx = 1.22 + 0.55 * temporal + 0.12 * front
  let ry = 0.74 + 0.16 * temporal + 0.2 * cere - 0.22 * fissure
  let rz = 0.92 + 0.72 * front * front + 0.15 * back + 0.48 * cere
  rx = Math.max(rx, 0.45)
  ry = Math.max(ry, 0.32)
  rz = Math.max(rz, 0.45)
  return 1 / Math.sqrt((x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz))
}

// Small left-right symmetric sulci. Fraction of the radius already built,
// damped on the downward stem so the thin tip stays put.
function foldFraction(dir) {
  const x = Math.abs(dir.x)
  const y = dir.y
  const z = dir.z
  const broad = Math.sin(x * 6.5 + z * 4.0) * Math.cos(y * 5.5)
  const cross = Math.sin(y * 7.5 + x * 3.0) * Math.cos(z * 5.0)
  const stem = Math.max(0, -y)
  const damp = 1 - 0.65 * stem * stem
  return (broad * 0.7 + cross * 0.3) * 0.028 * damp
}

export function makeHullGeometry(detail = 4) {
  const geo = new THREE.IcosahedronGeometry(1, detail)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    const radius = brainRadius(v) * SCALE
    const folded = radius * (1 + foldFraction(v))
    pos.setXYZ(i, v.x * folded, v.y * folded, v.z * folded)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}
