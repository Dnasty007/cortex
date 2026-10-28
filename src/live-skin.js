import * as THREE from 'three'

// Gyri pool, scan ring, and fresnel on MeshStandardMaterial. ShaderMaterial shells stay dark.

function afterInclude(source, includeLine, extra) {
  const at = source.indexOf(includeLine)
  if (at < 0) return null
  const cut = at + includeLine.length
  return source.slice(0, cut) + extra + source.slice(cut)
}

export function attachLiveSkin(root) {
  const materials = []
  const seen = new Set()
  if (root && typeof root.traverse === 'function') {
    root.traverse((obj) => {
      const listed = obj.material
      if (!listed) return
      const list = Array.isArray(listed) ? listed : [listed]
      for (const material of list) {
        if (!material || !material.isMeshStandardMaterial || material.isShaderMaterial) continue
        if (material.userData && material.userData.liveSkin) continue
        if (seen.has(material)) continue
        seen.add(material)
        materials.push(material)
      }
    })
  }

  if (materials.length === 0) return { set() {} }

  const uniforms = {
    uLiveWorld: { value: new THREE.Vector3(0, -999, 0) },
    uLiveColor: { value: new THREE.Color() },
    uLiveOn: { value: 0 },
    uLiveTime: { value: 0 },
  }

  for (const material of materials) {
    material.userData.liveSkin = true
    material.customProgramCacheKey = () => 'cortex-live-skin-2'
    material.onBeforeCompile = (shader) => {
      let vert = afterInclude(shader.vertexShader, '#include <common>', `
varying vec3 vLiveWorld;
varying vec3 vLiveNormal;`)
      if (vert) {
        vert = afterInclude(vert, '#include <project_vertex>', `
vLiveWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vLiveNormal = normalize(mat3(modelMatrix) * normal);`)
      }
      let frag = afterInclude(shader.fragmentShader, '#include <common>', `
uniform vec3 uLiveWorld;
uniform vec3 uLiveColor;
uniform float uLiveOn;
uniform float uLiveTime;
varying vec3 vLiveWorld;
varying vec3 vLiveNormal;`)
      if (frag) {
        frag = afterInclude(frag, '#include <emissivemap_fragment>', `
float d = distance(vLiveWorld, uLiveWorld);
float body = exp(-d * d * 0.11);
float scan = exp(-pow(d - mod(uLiveTime * 1.7, 5.2), 2.0) * 22.0);
vec3 nrm = normalize(vLiveNormal);
vec3 viewDir = normalize(cameraPosition - vLiveWorld);
float fres = pow(1.0 - abs(dot(nrm, viewDir)), 2.2);
float flicker = 0.78 + 0.22 * sin(uLiveTime * 8.0 + vLiveWorld.y * 2.0);
totalEmissiveRadiance += uLiveColor * uLiveOn * (body * 0.85 + scan * 1.15 + body * fres * 0.55) * flicker;`)
      }
      if (!vert || !frag) return
      shader.uniforms.uLiveWorld = uniforms.uLiveWorld
      shader.uniforms.uLiveColor = uniforms.uLiveColor
      shader.uniforms.uLiveOn = uniforms.uLiveOn
      shader.uniforms.uLiveTime = uniforms.uLiveTime
      shader.vertexShader = vert
      shader.fragmentShader = frag
    }
    material.needsUpdate = true
  }

  return {
    set(worldPosition, colorHex, on, elapsed) {
      uniforms.uLiveWorld.value.copy(worldPosition)
      uniforms.uLiveColor.value.set(colorHex)
      uniforms.uLiveOn.value = on ? 1 : 0
      uniforms.uLiveTime.value = elapsed
    },
  }
}
