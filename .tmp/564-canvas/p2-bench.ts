/**
 * PROTOTYPE P2 (#564): JS cost per frame of driving N Three.js meshes, 5 keys each
 * ({ x, y, z, rotateY, scale }, one spring 210/20), three ways:
 *
 * - `wardic`:   the core-only object animator (wardic-object.ts), host-pumped frames.
 * - `motion`:   Motion 14.10.1's `animate(mesh, …)` with `motion/three`'s effect, `processFrame(t)`.
 * - `baseline`: a hand-written loop, the same exact spring step on typed arrays: the floor.
 *
 * Each round retargets every mesh to new random values (latest-wins, velocity carried), lets one task
 * pass so the runs register, then times `frames` frames of the host's pump alone (no render). It
 * reports ms per frame and, under Node with --expose-gc, bytes allocated per frame.
 *
 *   bun p2-bench.ts wardic 1000
 *   node --expose-gc --experimental-strip-types --no-warnings p2-bench.ts motion 1000
 */
import * as THREE from "three"

const variant = process.argv[2] ?? "wardic"
const N = Number(process.argv[3] ?? 1000)
const ROUNDS = Number(process.argv[4] ?? 12)
const FRAMES = 30
const DT = 1000 / 60
const SPRING = { stiffness: 210, damping: 20 }

// --- Allocation hook (as packages/core/bench/one.mjs) -------------------------------------------
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

// --- The scene: N meshes sharing one geometry and material --------------------------------------
const geometry = new THREE.BoxGeometry(1, 1, 1)
const material = new THREE.MeshBasicMaterial()
const scene = new THREE.Scene()
const meshes: Array<THREE.Mesh> = []
for (let i = 0; i < N; i++) {
  const m = new THREE.Mesh(geometry, material)
  scene.add(m)
  meshes.push(m)
}
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const targetOf = () => ({ x: rand() * 20 - 10, y: rand() * 20 - 10, z: rand() * 20 - 10, rotateY: rand() * 360, scale: 0.5 + rand() })

// --- The three drivers: retarget all, and one frame --------------------------------------------
let t = 0
let retarget: () => void
let frame: () => void

if (variant === "wardic") {
  const { makeObjectEnvironment, pumped } = await import("./wardic-object.ts")
  const env = makeObjectEnvironment(pumped(() => t))
  retarget = () => {
    for (const m of meshes) void env.animate(m, targetOf(), SPRING)
  }
  frame = () => env.source.pump(t)
} else if (variant === "motion") {
  await import("./dom-shim.ts")
  const motion = await import("motion")
  const { threeEffect } = await import("motion/three")
  motion.MotionGlobalConfig.useManualTiming = true
  motion.animate.addEffect?.(threeEffect)
  motion.processFrame(t)
  retarget = () => {
    for (const m of meshes) void motion.animate(m, targetOf(), { type: "spring", ...SPRING })
  }
  frame = () => motion.processFrame(t)
} else {
  // The floor: per key position and velocity, the exact damped-spring step (as core's), in place.
  const K = 5
  const pos = new Float64Array(N * K), vel = new Float64Array(N * K), goal = new Float64Array(N * K)
  for (let i = 0; i < N; i++) pos[i * K + 4] = 1
  const k = SPRING.stiffness, c = SPRING.damping
  const w0 = Math.sqrt(k), zeta = c / (2 * Math.sqrt(k))
  const wd = w0 * Math.sqrt(1 - zeta * zeta)
  const dt = DT / 1000
  const e = Math.exp(-zeta * w0 * dt), cs = Math.cos(wd * dt), sn = Math.sin(wd * dt)
  const dd = e * (cs + (zeta * w0 / wd) * sn), dv = e * (sn / wd)
  const vd = -e * (w0 * w0 / wd) * sn, vv = e * (cs - (zeta * w0 / wd) * sn)
  const DEG = Math.PI / 180
  retarget = () => {
    for (let i = 0; i < N; i++) {
      const g = targetOf()
      goal[i * K] = g.x; goal[i * K + 1] = g.y; goal[i * K + 2] = g.z; goal[i * K + 3] = g.rotateY; goal[i * K + 4] = g.scale
    }
  }
  frame = () => {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < K; j++) {
        const at = i * K + j
        const d = pos[at] - goal[at], v = vel[at]
        pos[at] = goal[at] + dd * d + dv * v
        vel[at] = vd * d + vv * v
      }
      const m = meshes[i], b = i * K
      m.position.set(pos[b], pos[b + 1], pos[b + 2])
      m.rotation.set(m.rotation.x, pos[b + 3] * DEG, m.rotation.z)
      m.scale.set(pos[b + 4], pos[b + 4], pos[b + 4])
    }
  }
}

// --- Rounds -------------------------------------------------------------------------------------
const task = () => new Promise((r) => setTimeout(r, 0))
const frameMs: Array<number> = []
const startMs: Array<number> = []
const bytes: Array<number> = []
for (let round = 0; round < ROUNDS; round++) {
  const s0 = performance.now()
  retarget()
  startMs.push(performance.now() - s0)
  await task()
  t += DT
  frame() // the first frame after a retarget isn't timed: it includes the runs' first ticks
  globalThis.gc?.()
  const a0 = allocated?.() ?? 0
  const f0 = performance.now()
  for (let i = 0; i < FRAMES; i++) {
    t += DT
    frame()
  }
  const f1 = performance.now()
  const a1 = allocated?.() ?? 0
  frameMs.push((f1 - f0) / FRAMES)
  bytes.push((a1 - a0) / FRAMES)
  // Sanity: every mesh moved this round.
  if (meshes[N - 1].position.x === 0) throw new Error("last mesh never moved")
}
// Cross-check: the same targets and spring give the same scene in every variant.
let checksum = 0
for (const m of meshes) checksum += Math.abs(m.position.x) + Math.abs(m.position.y) + Math.abs(m.position.z) + Math.abs(m.rotation.y) + m.scale.x
const median = (xs: Array<number>) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const warm = (xs: Array<number>) => xs.slice(2) // drop the JIT's first rounds
console.log(JSON.stringify({
  variant,
  N,
  runtime: typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? `node ${process.version}` : "bun",
  frameMsMedian: +median(warm(frameMs)).toFixed(3),
  frameMsMin: +Math.min(...warm(frameMs)).toFixed(3),
  retargetAllMsMedian: +median(warm(startMs)).toFixed(3),
  checksum: +checksum.toFixed(1),
  bytesPerFrameMedian: allocated ? Math.round(median(warm(bytes))) : null,
}))
process.exit(0)
