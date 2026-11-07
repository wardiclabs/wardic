/**
 * PROTOTYPE (#564 perf round, Q2 + Q3): per-frame cost, Wardic's and the host's, for N subjects
 * with 5 keys each (one spring 210/20), measured through the profiling layer (profiling.ts).
 *
 * Variants:
 * - `p1`:            an `animate()` call per mesh (wardic-object.ts), a run per mesh.
 * - `group`:         one run for every mesh (group.ts), writing each mesh's position/rotation/scale.
 * - `group-settle`:  the same, and a mesh at rest leaves three's matrix updates
 *                    (`matrixAutoUpdate = false` after one `updateMatrix()`), rejoining when it moves.
 * - `instanced`:     one run writing straight into one InstancedMesh's instanceMatrix.
 *
 * Each round retargets `frac` of the subjects (a different slice each round), then times `FRAMES`
 * frames. A frame is the host's: pump Wardic, then `scene.updateMatrixWorld()`, the matrix work
 * `renderer.render` does first (timed as the host's "render"). No GPU work is measured.
 *
 *   bun perf/q2-bench.ts group 1000 1
 *   node --expose-gc --experimental-strip-types --no-warnings perf/q2-bench.ts instanced 10000 0.1
 */
import * as THREE from "three"
import { makeObjectEnvironment, pumped } from "../wardic-object.ts"
import { makeProfiler } from "./profiling.ts"
import { K, makeGroup, type Target } from "./group.ts"

const variant = process.argv[2] ?? "group"
const N = Number(process.argv[3] ?? 1000)
const FRAC = Number(process.argv[4] ?? 1)
const ROUNDS = Number(process.argv[5] ?? 10)
const FRAMES = 60
const DT = 1000 / 60
const SPRING = { stiffness: 210, damping: 20 }
const DEG = Math.PI / 180

let allocated: (() => number) | undefined
if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined" && typeof globalThis.gc === "function") {
  const { GCProfiler } = await import("node:v8")
  let freed = 0
  let profiler = new GCProfiler()
  profiler.start()
  allocated = () => {
    for (const gc of profiler.stop().statistics) freed += gc.beforeGC.heapStatistics.usedHeapSize - gc.afterGC.heapStatistics.usedHeapSize
    profiler = new GCProfiler()
    profiler.start()
    return process.memoryUsage().heapUsed + freed
  }
}

let t = 0
const profiler = makeProfiler()
const source = pumped(() => t)
const env = makeObjectEnvironment(source, { wrap: profiler.source, extra: profiler.loopMetrics })

const scene = new THREE.Scene()
const geometry = new THREE.BoxGeometry()
const material = new THREE.MeshBasicMaterial()
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const targetOf = (): Target => ({ x: rand() * 20 - 10, y: rand() * 20 - 10, z: rand() * 20 - 10, rotateY: rand() * 360, scale: 0.5 + rand() })

let retarget: (i: number, target: Target) => void
let check: () => number

if (variant === "instanced") {
  const mesh = new THREE.InstancedMesh(geometry, material, N)
  scene.add(mesh)
  const m = mesh.instanceMatrix.array as Float32Array
  const write = (i: number, p: Float64Array, b: number) => {
    const s = p[b + 4], r = p[b + 3] * DEG
    const c = Math.cos(r) * s, sn = Math.sin(r) * s
    const o = i * 16
    m[o] = c; m[o + 1] = 0; m[o + 2] = -sn; m[o + 3] = 0
    m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0
    m[o + 8] = sn; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0
    m[o + 12] = p[b]; m[o + 13] = p[b + 1]; m[o + 14] = p[b + 2]; m[o + 15] = 1
  }
  const group = makeGroup(env.runtime as never, N, (_, into, b) => { into[b + 4] = 1 }, write, {
    ...SPRING,
    flush: () => { mesh.instanceMatrix.needsUpdate = true },
  })
  retarget = group.set
  // Cross-check one instance against three's own compose.
  check = () => {
    const i = N >> 1, b = i * K, p = group.pos
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p[b + 3] * DEG, 0))
    const ref = new THREE.Matrix4().compose(new THREE.Vector3(p[b], p[b + 1], p[b + 2]), q, new THREE.Vector3(p[b + 4], p[b + 4], p[b + 4]))
    let err = 0
    for (let k = 0; k < 16; k++) err = Math.max(err, Math.abs(ref.elements[k] - m[i * 16 + k]))
    return err
  }
} else {
  const meshes: Array<THREE.Mesh> = []
  for (let i = 0; i < N; i++) {
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    meshes.push(mesh)
  }
  check = () => 0
  if (variant === "p1") {
    retarget = (i, target) => { void env.animate(meshes[i], target as unknown as Record<string, number>, SPRING) }
  } else {
    const write = (i: number, p: Float64Array, b: number) => {
      const o = meshes[i]
      o.position.set(p[b], p[b + 1], p[b + 2])
      o.rotation.set(0, p[b + 3] * DEG, 0)
      o.scale.set(p[b + 4], p[b + 4], p[b + 4])
    }
    const settle = variant === "group-settle"
    const group = makeGroup(env.runtime as never, N, (_, into, b) => { into[b + 4] = 1 }, write, {
      ...SPRING,
      onRest: settle ? (i) => { const o = meshes[i]; o.updateMatrix(); o.matrixAutoUpdate = false } : undefined,
      onWake: settle ? (i) => { meshes[i].matrixAutoUpdate = true } : undefined,
    })
    retarget = group.set
    if (settle) for (const o of meshes) { o.updateMatrix(); o.matrixAutoUpdate = false }
  }
}

const task = () => new Promise((r) => setTimeout(r, 0))
const per: Array<number> = []
const rows: Array<Record<string, number>> = []
const bytes: Array<number> = []
const movers = Math.max(1, Math.round(N * FRAC))
let next = 0
for (let round = 0; round < ROUNDS; round++) {
  const s0 = performance.now()
  for (let k = 0; k < movers; k++) {
    retarget(next, targetOf())
    next = (next + 1) % N
  }
  per.push(performance.now() - s0)
  await task()
  t += DT
  source.pump(t)
  profiler.render(() => scene.updateMatrixWorld())
  globalThis.gc?.()
  const a0 = allocated?.() ?? 0
  const from = profiler.mark()
  for (let i = 0; i < FRAMES; i++) {
    t += DT
    source.pump(t)
    profiler.render(() => scene.updateMatrixWorld())
  }
  const a1 = allocated?.() ?? 0
  bytes.push((a1 - a0) / FRAMES)
  rows.push(profiler.summary(from))
}
const median = (xs: Array<number>) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const warm = rows.slice(2)
const pick = (k: string) => +median(warm.map((r) => r[k])).toFixed(4)
console.log(JSON.stringify({
  variant, N, frac: FRAC,
  runtime: typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? `node ${process.version}` : "bun",
  wardicMs: pick("wardicMs"), stepsMs: pick("stepsMs"), aroundStepsMs: pick("aroundStepsMs"),
  hostMatrixMs: pick("renderMs"), animations: pick("animations"),
  retargetMs: +median(per.slice(2)).toFixed(3),
  bytesPerFrame: allocated ? Math.round(median(bytes.slice(2))) : null,
  instancedMaxErr: check(),
}))
process.exit(0)
