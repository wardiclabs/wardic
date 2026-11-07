/**
 * PROTOTYPE P7 (#564): what does reusing the spine (imperative.ts's plain-element path, through the
 * flush gate) cost per frame on N Three.js meshes, against P2's numbers? Same workload as p2-bench.ts:
 * 5 keys a mesh, one spring 210/20, every mesh retargeted each round, frames pumped by the host.
 *
 * Environment: the DOM's pure Layers (interpolators, positional keys, default transitions), the
 * host-pumped frame source of wardic-object.ts for the Clock and the gate, and a canvas Renderer.
 *
 *   bun --conditions=@wardic/source .tmp/564-canvas/p7-spine-bench.ts 1000
 *   node --expose-gc --experimental-strip-types --no-warnings --conditions=@wardic/source .tmp/564-canvas/p7-spine-bench.ts 1000
 */
import * as Announcer from "../../packages/core/src/Announcer.ts"
import * as Clock from "../../packages/core/src/Clock.ts"
import * as DefaultTransition from "../../packages/core/src/DefaultTransition.ts"
import * as FrameLoop from "../../packages/core/src/FrameLoop.ts"
import * as ReducedMotion from "../../packages/core/src/ReducedMotion.ts"
import * as RefreshFrameSource from "../../packages/core/src/RefreshFrameSource.ts"
import * as Renderer from "../../packages/core/src/Renderer.ts"
import * as DomDefaultTransition from "../../packages/dom/src/DomDefaultTransition.ts"
import * as DomInterpolators from "../../packages/dom/src/DomInterpolators.ts"
import * as DomPositionalKeys from "../../packages/dom/src/DomPositionalKeys.ts"
import * as FlushGate from "../../packages/dom/src/FlushGate.ts"
import * as TestProbe from "../../packages/test/src/probe.ts"
import { type AnimateEnv, scopedAnimate, scopeOf } from "../../packages/solid/src/imperative.ts"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as THREE from "three"
import { pumped } from "./wardic-object.ts"

const N = Number(process.argv[2] ?? 1000)
const ROUNDS = Number(process.argv[3] ?? 12)
const FRAMES = 30
const DT = 1000 / 60

// No DOM: Node's and Bun's truth. The plain path needs none for transform keys (P6).
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

// The canvas Renderer: Motion's names, grouped into one `set` per vector.
const DEG = Math.PI / 180
const threeRenderer = Layer.succeed(Renderer.Renderer, {
  project: (values) => values,
  commit: (t, patch) => {
    const o = t as THREE.Object3D
    const p = patch as Record<string, number | undefined>
    if (p.x !== undefined || p.y !== undefined || p.z !== undefined) o.position.set(p.x ?? o.position.x, p.y ?? o.position.y, p.z ?? o.position.z)
    if (p.rotateY !== undefined) o.rotation.set(o.rotation.x, p.rotateY * DEG, o.rotation.z)
    if (p.scale !== undefined) o.scale.set(p.scale, p.scale, p.scale)
  },
})

let t = 0
const source = pumped(() => t)
const env = FrameLoop.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Clock.layer,
      threeRenderer,
      TestProbe.layer(),
      DomInterpolators.layer,
      DomPositionalKeys.layer,
      DomDefaultTransition.layer,
      Announcer.layerSilent,
    ),
  ),
  Layer.provideMerge(RefreshFrameSource.layer(source as RefreshFrameSource.Shape)),
  Layer.provideMerge(AtomRegistry.layer),
)
const runtime = ManagedRuntime.make(Layer.provideMerge(FlushGate.layer({ batch: (apply) => apply() }), env))
const gate = await runtime.runPromise(FlushGate.FlushGate)
const animEnv: AnimateEnv = {
  runtime: runtime as unknown as AnimateEnv["runtime"],
  gate,
  reducedMotion: () => false,
  skipAnimations: () => false,
  positionalKeys: await runtime.runPromise(ReducedMotion.PositionalKeys),
  defaultTransition: await runtime.runPromise(DefaultTransition.DefaultTransition),
}
const animate = scopedAnimate(animEnv, () => undefined, scopeOf().watch)

const meshes: Array<THREE.Mesh> = []
const geometry = new THREE.BoxGeometry()
const material = new THREE.MeshBasicMaterial()
for (let i = 0; i < N; i++) meshes.push(new THREE.Mesh(geometry, material))
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const targetOf = () => ({ x: rand() * 20 - 10, y: rand() * 20 - 10, z: rand() * 20 - 10, rotateY: rand() * 360, scale: 0.5 + rand() })
const spring = { type: "spring" as const, stiffness: 210, damping: 20 }

const task = () => new Promise((r) => setTimeout(r, 0))
const frameMs: Array<number> = [], startMs: Array<number> = [], bytes: Array<number> = []
for (let round = 0; round < ROUNDS; round++) {
  const s0 = performance.now()
  for (const m of meshes) animate([m as unknown as Element], targetOf(), spring)
  startMs.push(performance.now() - s0)
  await task()
  t += DT
  source.pump(t)
  globalThis.gc?.()
  const a0 = allocated?.() ?? 0
  const f0 = performance.now()
  for (let i = 0; i < FRAMES; i++) {
    t += DT
    source.pump(t)
  }
  const f1 = performance.now()
  const a1 = allocated?.() ?? 0
  frameMs.push((f1 - f0) / FRAMES)
  bytes.push((a1 - a0) / FRAMES)
}
let checksum = 0
for (const m of meshes) checksum += Math.abs(m.position.x) + Math.abs(m.position.y) + Math.abs(m.position.z) + Math.abs(m.rotation.y) + m.scale.x
const median = (xs: Array<number>) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const warm = (xs: Array<number>) => xs.slice(2)
console.log(JSON.stringify({
  variant: "spine",
  N,
  runtime: typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? `node ${process.version}` : "bun",
  frameMsMedian: +median(warm(frameMs)).toFixed(3),
  frameMsMin: +Math.min(...warm(frameMs)).toFixed(3),
  retargetAllMsMedian: +median(warm(startMs)).toFixed(3),
  checksum: +checksum.toFixed(1),
  bytesPerFrameMedian: allocated ? Math.round(median(warm(bytes))) : null,
}))
process.exit(0)
