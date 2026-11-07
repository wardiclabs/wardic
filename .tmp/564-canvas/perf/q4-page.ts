/**
 * PROTOTYPE (#564 perf round, Q4), the page: do GPU-evaluated springs draw what the CPU path draws?
 * And what does each cost in JS a frame, and to retarget, at N instances?
 *
 * CPU path: one Wardic run (group.ts) writing an InstancedMesh's matrices (Q2's `instanced`).
 * GPU path: gpu-spring.ts, the same spring evaluated per vertex from attributes set at retargets.
 */
import * as THREE from "three"
import { makeObjectEnvironment, pumped } from "../wardic-object.ts"
import { makeGroup, type Target } from "./group.ts"
import { makeGpuSprings } from "./gpu-spring.ts"

declare global { interface Window { __results: Record<string, unknown>; __done: boolean } }
window.__results = {}
// Tight rest thresholds, so the CPU path does not snap early (P4) and the two paths compare like for like.
const SPRING = { stiffness: 210, damping: 20, restDelta: 0.001, restSpeed: 0.01 }
const DT = 1000 / 60
const DEG = Math.PI / 180
const task = () => new Promise((r) => setTimeout(r, 0))

const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.setSize(256, 256, false)
const target = new THREE.WebGLRenderTarget(256, 256)
const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 100)
camera.position.z = 50
const box = new THREE.BoxGeometry(0.5, 0.5, 0.5)

const build = (n: number) => {
  let t = 0
  const source = pumped(() => t)
  const env = makeObjectEnvironment(source)
  const cpuScene = new THREE.Scene(), gpuScene = new THREE.Scene()
  const inst = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), n)
  inst.frustumCulled = false
  cpuScene.add(inst)
  const m = inst.instanceMatrix.array as Float32Array
  const group = makeGroup(env.runtime as never, n, (_, into, b) => { into[b + 4] = 1 }, (i, p, b) => {
    const s = p[b + 4], r = p[b + 3] * DEG, c = Math.cos(r) * s, sn = Math.sin(r) * s, o = i * 16
    m[o] = c; m[o + 1] = 0; m[o + 2] = -sn; m[o + 3] = 0; m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0
    m[o + 8] = sn; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0; m[o + 12] = p[b]; m[o + 13] = p[b + 1]; m[o + 14] = p[b + 2]; m[o + 15] = 1
  }, { ...SPRING, flush: () => { inst.instanceMatrix.needsUpdate = true } })
  for (let i = 0; i < n; i++) { const o = i * 16; m[o] = 1; m[o + 5] = 1; m[o + 10] = 1; m[o + 15] = 1 }
  const gpu = makeGpuSprings(box, n, SPRING)
  gpuScene.add(gpu.mesh)
  return {
    group, gpu, cpuScene, gpuScene,
    get t() { return t },
    pumpCpu: () => { t += DT; source.pump(t) },
    frameGpu: () => { gpu.frame(t / 1000); gpu.flush() },
    advance: () => { t += DT },
  }
}

let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const targetOf = (): Target => ({ x: rand() * 20 - 10, y: rand() * 20 - 10, z: rand() * 10 - 5, rotateY: rand() * 360, scale: 0.5 + rand() * 1.5 })

const read = (scene: THREE.Scene) => {
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)
  const px = new Uint8Array(256 * 256 * 4)
  renderer.readRenderTargetPixels(target, 0, 0, 256, 256, px)
  renderer.setRenderTarget(null)
  return px
}
const compare = (a: Uint8Array, b: Uint8Array) => {
  let covered = 0, differ = 0
  for (let i = 0; i < a.length; i += 4) {
    const ca = a[i] > 127, cb = b[i] > 127
    if (ca || cb) covered++
    if (ca !== cb) differ++
  }
  return { covered, differ, pct: +((100 * differ) / Math.max(covered, 1)).toFixed(3) }
}

// 1. Pixels: 200 instances, a retarget of every one at frame 0 and again mid-flight at frame 20.
{
  const N = 200
  const s = build(N)
  const A = Array.from({ length: N }, targetOf), B = Array.from({ length: N }, targetOf)
  for (let i = 0; i < N; i++) { s.group.set(i, A[i]); s.gpu.set(i, A[i], s.t / 1000) }
  const checks: Record<string, unknown> = {}
  for (let f = 1; f <= 90; f++) {
    await task()
    s.pumpCpu()
    s.frameGpu()
    if (f === 20) for (let i = 0; i < N; i++) { s.group.set(i, B[i]); s.gpu.set(i, B[i], s.t / 1000) }
    if (f === 10 || f === 25 || f === 40 || f === 90) checks[`frame ${f}`] = compare(read(s.cpuScene), read(s.gpuScene))
  }
  window.__results.pixels = checks
}

// 2. JS cost at N = 10,000: per frame (CPU path's pump vs GPU path's uniform + upload ranges), and
//    to retarget every instance. Rendering isn't timed (SwiftShader draws on the CPU).
for (const N of [1000, 10000]) {
  const s = build(N)
  const cpuFrame: Array<number> = [], gpuFrame: Array<number> = [], cpuSet: Array<number> = [], gpuSet: Array<number> = []
  for (let round = 0; round < 8; round++) {
    const targets = Array.from({ length: N }, targetOf)
    let a = performance.now()
    for (let i = 0; i < N; i++) s.group.set(i, targets[i])
    cpuSet.push(performance.now() - a)
    a = performance.now()
    for (let i = 0; i < N; i++) s.gpu.set(i, targets[i], s.t / 1000)
    gpuSet.push(performance.now() - a)
    await task()
    // Chromium coarsens performance.now() to 0.1 ms: time 30 frames together, per path.
    let b = performance.now()
    for (let f = 0; f < 30; f++) s.pumpCpu()
    cpuFrame.push((performance.now() - b) / 30)
    b = performance.now()
    for (let f = 0; f < 30; f++) { s.advance(); s.frameGpu() }
    gpuFrame.push((performance.now() - b) / 30)
    renderer.render(s.gpuScene, camera) // upload once per round, so the attributes stay live
  }
  const med = (xs: Array<number>) => { const w = xs.slice(2).sort((x, y) => x - y); return +w[w.length >> 1].toFixed(4) }
  window.__results[`N=${N}`] = {
    cpuFrameMs: med(cpuFrame), gpuFrameMs: med(gpuFrame),
    cpuRetargetAllMs: med(cpuSet), gpuRetargetAllMs: med(gpuSet),
  }
}
window.__done = true
