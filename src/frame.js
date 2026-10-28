import * as THREE from 'three'

// Camera-relative fly frame. Read it from the camera every move.
// Check, camera on +z looking at the origin: forward is (0,0,-1),
// right = forward × up = (1,0,0). crossVectors(up, forward) would be left.
export const UP = new THREE.Vector3(0, 1, 0)

export function cameraBasis(camera, fwd, right) {
  camera.getWorldDirection(fwd)
  fwd.y = 0
  if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1)
  else fwd.normalize()
  right.crossVectors(fwd, UP)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  else right.normalize()
}

export function flyDelta(fwd, right, input, speed) {
  const move = new THREE.Vector3()
  move.addScaledVector(fwd, input.forward * speed)
  move.addScaledVector(right, input.strafe * speed)
  move.y += input.lift * speed
  return move
}

const _offset = new THREE.Vector3()
const PITCH_LIMIT = Math.PI / 2 - 0.08

// Take the orbit camera's view into a yaw/pitch pair with no roll.
// OrbitControls writes a quaternion; reading camera.rotation afterwards
// can carry a non-zero roll and the next mouse move tilts the horizon.
export function adoptLook(camera, euler) {
  euler.order = 'YXZ'
  euler.setFromQuaternion(camera.quaternion, 'YXZ')
  euler.z = 0
  camera.quaternion.setFromEuler(euler)
  return euler
}

export function applyLook(camera, euler, movementX, movementY, sensitivity = 0.0022) {
  euler.order = 'YXZ'
  euler.y -= movementX * sensitivity
  euler.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, euler.x - movementY * sensitivity))
  euler.z = 0
  camera.quaternion.setFromEuler(euler)
}

// Hand the camera back to orbit around the brain, not around whatever
// point happened to sit 8 units in front of the lens.
const _slideRay = new THREE.Raycaster()
const _slideNdc = new THREE.Vector2()
const _slideNormal = new THREE.Vector3()
const _slidePlane = new THREE.Plane()
const _slideHit = new THREE.Vector3()

// Point on the plane through planePoint that faces the camera.
// The plane normal is the camera's look direction, so the point tracks the cursor.
export function viewPlanePoint(camera, planePoint, ndcX, ndcY, out) {
  _slideNdc.set(ndcX, ndcY)
  _slideRay.setFromCamera(_slideNdc, camera)
  camera.getWorldDirection(_slideNormal)
  _slidePlane.setFromNormalAndCoplanarPoint(_slideNormal, planePoint)
  if (!_slideRay.ray.intersectPlane(_slidePlane, _slideHit)) return false
  out.copy(_slideHit)
  return true
}

export function parkOrbit(camera, controls, anchor) {
  _offset.copy(camera.position).sub(anchor)
  if (_offset.length() < controls.minDistance) {
    if (_offset.lengthSq() < 1e-8) _offset.set(0, 0.35, 1)
    _offset.setLength(controls.minDistance)
    camera.position.copy(anchor).add(_offset)
  }
  controls.target.copy(anchor)
  if (controls._sphericalDelta) controls._sphericalDelta.set(0, 0, 0)
  if (controls._panOffset) controls._panOffset.set(0, 0, 0)
  if (controls._scale != null) controls._scale = 1
  controls.autoRotate = false
  controls.update()
}
