/**
 * PROTOTYPE (#564 perf round, Q4): core's exact spring, evaluated in a vertex shader.
 *
 * Core steps a spring by its closed-form matrix (Spring.matrixFor, #370, ADR-0054), so a key's value at
 * any time τ after a start is a formula in (d0 = from − target, v0, τ). A shader can evaluate it for
 * every instance from attributes written only at a retarget; per frame the CPU writes one uniform.
 *
 * Per instance (16 floats): aFrom (x, y, z, rotateY), aVel (the same), aGoal (the same),
 * aScale (from, velocity, goal), aT0 (the frame time the leg starts from, s).
 */
import * as THREE from "three"
import * as Spring from "../../../packages/core/src/Spring.ts"
import type * as Machine from "../../../packages/core/src/Machine.ts"

/** The closed form, in JS: the same as the shader's, for a retarget's starting state. */
export const springAt = (e: Spring.Exact, d0: number, v0: number, tau: number): [number, number] => {
  const w2 = e.w0 * e.w0
  if (e.kind === 0) {
    const x = Math.exp(-e.decay * tau), s = Math.sin(e.freq * tau) / e.freq, c = Math.cos(e.freq * tau)
    return [x * (c + e.decay * s) * d0 + x * s * v0, -x * w2 * s * d0 + x * (c - e.decay * s) * v0]
  }
  if (e.kind === 1) {
    const x = Math.exp(-e.w0 * tau)
    return [x * (1 + e.w0 * tau) * d0 + x * tau * v0, -x * w2 * tau * d0 + x * (1 - e.w0 * tau) * v0]
  }
  const r1 = e.freq - e.decay, r2 = -e.freq - e.decay
  const e1 = Math.exp(r1 * tau), e2 = Math.exp(r2 * tau), span = 2 * e.freq
  return [((r1 * e2 - r2 * e1) / span) * d0 + ((e1 - e2) / span) * v0, ((w2 * (e2 - e1)) / span) * d0 + ((r1 * e1 - r2 * e2) / span) * v0]
}

const SHADER_SPRING = /* glsl */ `
uniform float uTime;
uniform float uDecay;
uniform float uFreq;
uniform float uW0;
uniform int uKind;
attribute vec4 aFrom;
attribute vec4 aVel;
attribute vec4 aGoal;
attribute vec3 aScale;
attribute float aT0;
// d(tau) for a start offset d0 and velocity v0: the dd/dv row of core's Exact matrix.
vec4 springD(vec4 d0, vec4 v0, float tau) {
  float w2 = uW0 * uW0;
  if (uKind == 0) {
    float x = exp(-uDecay * tau);
    float s = sin(uFreq * tau) / uFreq;
    float c = cos(uFreq * tau);
    return x * (c + uDecay * s) * d0 + x * s * v0;
  }
  if (uKind == 1) {
    float x = exp(-uW0 * tau);
    return x * (1.0 + uW0 * tau) * d0 + x * tau * v0;
  }
  float r1 = uFreq - uDecay;
  float r2 = -uFreq - uDecay;
  float e1 = exp(r1 * tau);
  float e2 = exp(r2 * tau);
  float span = 2.0 * uFreq;
  return ((r1 * e2 - r2 * e1) / span) * d0 + ((e1 - e2) / span) * v0;
}
`

const SHADER_BEGIN = /* glsl */ `
float tau = max(uTime - aT0, 0.0);
vec4 p = aGoal + springD(aFrom - aGoal, aVel, tau);
float sc = aScale.z + springD(vec4(aScale.x - aScale.z), vec4(aScale.y), tau).x;
float r = radians(p.w);
float cr = cos(r);
float sr = sin(r);
vec3 transformed = vec3(position) * sc;
transformed = vec3(cr * transformed.x + sr * transformed.z, transformed.y, -sr * transformed.x + cr * transformed.z);
transformed += p.xyz;
`

export interface GpuSprings {
  readonly mesh: THREE.Mesh
  /** Sets the frame time (s) the shader evaluates at: the one per-frame write. */
  readonly frame: (seconds: number) => void
  /** Retargets instance i from where it is at `nowS`, with its velocity there. */
  readonly set: (i: number, target: { x: number; y: number; z: number; rotateY: number; scale: number }, nowS: number) => void
  /** Uploads the attribute ranges retargeted since the last call. */
  readonly flush: () => void
}

export const makeGpuSprings = (base: THREE.BufferGeometry, n: number, options: Machine.SpringOptions, material = new THREE.MeshBasicMaterial()): GpuSprings => {
  const spring = Spring.resolve(options)
  const e = Spring.matrixFor(spring, 1 / 60) // only for its kind, w0, decay and freq
  const geometry = new THREE.InstancedBufferGeometry().copy(base as THREE.InstancedBufferGeometry)
  geometry.instanceCount = n
  const from = new Float32Array(n * 4), vel = new Float32Array(n * 4), goal = new Float32Array(n * 4)
  const scale = new Float32Array(n * 3), t0 = new Float32Array(n)
  for (let i = 0; i < n; i++) { scale[i * 3] = 1; scale[i * 3 + 2] = 1 }
  const attrs = {
    aFrom: new THREE.InstancedBufferAttribute(from, 4),
    aVel: new THREE.InstancedBufferAttribute(vel, 4),
    aGoal: new THREE.InstancedBufferAttribute(goal, 4),
    aScale: new THREE.InstancedBufferAttribute(scale, 3),
    aT0: new THREE.InstancedBufferAttribute(t0, 1),
  }
  for (const [name, a] of Object.entries(attrs)) {
    a.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute(name, a)
  }
  const uniforms = {
    uTime: { value: 0 },
    uDecay: { value: e.decay },
    uFreq: { value: e.freq },
    uW0: { value: e.w0 },
    uKind: { value: e.kind },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = SHADER_SPRING + shader.vertexShader.replace("#include <begin_vertex>", SHADER_BEGIN)
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false // the base geometry's bounds say nothing about where instances are

  let lo = Infinity, hi = -Infinity
  const set: GpuSprings["set"] = (i, target, nowS) => {
    const tau = Math.max(nowS - t0[i], 0)
    const g = [target.x, target.y, target.z, target.rotateY]
    for (let k = 0; k < 4; k++) {
      const at = i * 4 + k
      const [d, v] = springAt(e.kind === undefined ? e : e, from[at] - goal[at], vel[at], tau)
      from[at] = goal[at] + d
      vel[at] = v
      goal[at] = g[k]
    }
    const s = i * 3
    const [ds, vs] = springAt(e, scale[s] - scale[s + 2], scale[s + 1], tau)
    scale[s] = scale[s + 2] + ds
    scale[s + 1] = vs
    scale[s + 2] = target.scale
    t0[i] = nowS
    if (i < lo) lo = i
    if (i > hi) hi = i
  }
  const flush = () => {
    if (hi < lo) return
    const count = hi - lo + 1
    for (const a of Object.values(attrs)) {
      a.clearUpdateRanges()
      a.addUpdateRange(lo * a.itemSize, count * a.itemSize)
      a.needsUpdate = true
    }
    lo = Infinity
    hi = -Infinity
  }
  return { mesh, frame: (s) => { uniforms.uTime.value = s }, set, flush }
}
