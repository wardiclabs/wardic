/**
 * PROTOTYPE Q1 (#564 perf round): CPU-profile (or heap-sample) one window of P1's or P7's workload in
 * Node, through the inspector, and print the top self-time functions.
 *
 *   node --expose-gc --experimental-strip-types --no-warnings --conditions=@wardic/source \
 *     .tmp/564-canvas/q1/prof.ts <p1|spine> <frame|start> <cpu|heap> [N=1000] [rounds=40]
 *
 * `frame`: only the timed frames of each round. `start`: from the retarget-all calls through the task
 * after them (where the runs' fibers start), and the first frame (the runs' first ticks).
 * Writes the raw profile to q1/out/<mode>-<window>.<cpuprofile|heapprofile>.
 */
import { Session } from "node:inspector/promises"
import { mkdirSync, writeFileSync } from "node:fs"
import * as THREE from "three"

const [mode = "p1", windowName = "frame", kind = "cpu", nArg = "1000", roundsArg = "40"] = process.argv.slice(2)
const N = Number(nArg)
const ROUNDS = Number(roundsArg)
const FRAMES = 30
const DT = 1000 / 60
const DEG = Math.PI / 180

const meshes: Array<THREE.Mesh> = []
const geometry = new THREE.BoxGeometry()
const material = new THREE.MeshBasicMaterial()
for (let i = 0; i < N; i++) meshes.push(new THREE.Mesh(geometry, material))
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const targetOf = () => ({ x: rand() * 20 - 10, y: rand() * 20 - 10, z: rand() * 20 - 10, rotateY: rand() * 360, scale: 0.5 + rand() })

let t = 0
let retarget: () => void
let pump: (t: number) => void

const { pumped } = await import("../wardic-object.ts")
const source = pumped(() => t)

if (mode.startsWith("wo-")) {
  const { makeObjectEnvironment, pumped: pumpedQ } = await import(`./${mode}.ts`)
  const src = pumpedQ(() => t)
  const env = await makeObjectEnvironment(src)
  const SPRING = { stiffness: 210, damping: 20 }
  retarget = () => {
    for (const m of meshes) void env.animate(m, targetOf(), SPRING)
  }
  pump = src.pump
} else if (mode === "p1") {
  const { makeObjectEnvironment } = await import("../wardic-object.ts")
  const env = makeObjectEnvironment(source)
  const SPRING = { stiffness: 210, damping: 20 }
  retarget = () => {
    for (const m of meshes) void env.animate(m, targetOf(), SPRING)
  }
  pump = source.pump
} else {
  const Announcer = await import("../../../packages/core/src/Announcer.ts")
  const Clock = await import("../../../packages/core/src/Clock.ts")
  const DefaultTransition = await import("../../../packages/core/src/DefaultTransition.ts")
  const FrameLoop = await import("../../../packages/core/src/FrameLoop.ts")
  const ReducedMotion = await import("../../../packages/core/src/ReducedMotion.ts")
  const RefreshFrameSource = await import("../../../packages/core/src/RefreshFrameSource.ts")
  const Renderer = await import("../../../packages/core/src/Renderer.ts")
  const DomDefaultTransition = await import("../../../packages/dom/src/DomDefaultTransition.ts")
  const DomInterpolators = await import("../../../packages/dom/src/DomInterpolators.ts")
  const DomPositionalKeys = await import("../../../packages/dom/src/DomPositionalKeys.ts")
  const FlushGate = await import("../../../packages/dom/src/FlushGate.ts")
  const TestProbe = await import("../../../packages/test/src/probe.ts")
  const { scopedAnimate, scopeOf } = await import("../../../packages/solid/src/imperative.ts")
  const Layer = await import("effect/Layer")
  const ManagedRuntime = await import("effect/ManagedRuntime")
  const AtomRegistry = await import("effect/reactivity/AtomRegistry")
  const threeRenderer = Layer.succeed(Renderer.Renderer, {
    project: (values: Record<string, unknown>) => values,
    commit: (target: unknown, patch: Record<string, unknown>) => {
      const o = target as THREE.Object3D
      const p = patch as Record<string, number | undefined>
      if (p.x !== undefined || p.y !== undefined || p.z !== undefined) o.position.set(p.x ?? o.position.x, p.y ?? o.position.y, p.z ?? o.position.z)
      if (p.rotateY !== undefined) o.rotation.set(o.rotation.x, p.rotateY * DEG, o.rotation.z)
      if (p.scale !== undefined) o.scale.set(p.scale, p.scale, p.scale)
    },
  })
  const env = FrameLoop.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(Clock.layer, threeRenderer, TestProbe.layer(), DomInterpolators.layer, DomPositionalKeys.layer, DomDefaultTransition.layer, Announcer.layerSilent)),
    Layer.provideMerge(RefreshFrameSource.layer(source as never)),
    Layer.provideMerge(AtomRegistry.layer),
  )
  const runtime = ManagedRuntime.make(Layer.provideMerge(FlushGate.layer({ batch: (apply: () => void) => apply() }), env))
  const gate = await runtime.runPromise(FlushGate.FlushGate)
  const animEnv = {
    runtime,
    gate,
    reducedMotion: () => false,
    skipAnimations: () => false,
    positionalKeys: await runtime.runPromise(ReducedMotion.PositionalKeys),
    defaultTransition: await runtime.runPromise(DefaultTransition.DefaultTransition),
  }
  const animate = scopedAnimate(animEnv as never, () => undefined, scopeOf().watch)
  const spring = { type: "spring" as const, stiffness: 210, damping: 20 }
  retarget = () => {
    for (const m of meshes) animate([m as unknown as Element], targetOf(), spring)
  }
  pump = source.pump
}

const session = new Session()
session.connect()
if (kind === "cpu") {
  await session.post("Profiler.enable")
  await session.post("Profiler.setSamplingInterval", { interval: 25 })
} else {
  await session.post("HeapProfiler.enable")
}
const begin = async () => {
  if (kind === "cpu") await session.post("Profiler.start")
  else await session.post("HeapProfiler.startSampling", { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
}
const end = async () => {
  if (kind === "cpu") return (await session.post("Profiler.stop")).profile
  return (await session.post("HeapProfiler.stopSampling")).profile
}

const task = () => new Promise((r) => setTimeout(r, 0))
// Warm: 4 rounds unprofiled.
for (let round = 0; round < 4; round++) {
  retarget()
  await task()
  for (let i = 0; i <= FRAMES; i++) { t += DT; pump(t) }
}
// Profile only the chosen window. Profiler start/stop are async: wrap the whole loop once, and keep
// the other window out by pausing... the inspector can't pause, so the window is the whole profile
// and the other work runs in separate, unprofiled rounds between profiled spans.
let profile: unknown
if (windowName === "frame") {
  // Retarget first (unprofiled), then profile only frames. One profile over ROUNDS spans.
  const spans: Array<unknown> = []
  for (let round = 0; round < ROUNDS; round++) {
    retarget()
    await task()
    t += DT
    pump(t)
    globalThis.gc?.()
    await begin()
    for (let i = 0; i < FRAMES; i++) { t += DT; pump(t) }
    spans.push(await end())
  }
  profile = spans
} else {
  const spans: Array<unknown> = []
  for (let round = 0; round < ROUNDS; round++) {
    globalThis.gc?.()
    await begin()
    retarget()
    await task()
    t += DT
    pump(t)
    spans.push(await end())
    for (let i = 0; i < FRAMES; i++) { t += DT; pump(t) }
  }
  profile = spans
}
mkdirSync(new URL("./out/", import.meta.url).pathname, { recursive: true })
const file = new URL(`./out/${mode}-${windowName}.${kind === "cpu" ? "cpuprofiles" : "heapprofiles"}.json`, import.meta.url).pathname
writeFileSync(file, JSON.stringify(profile))
console.log("wrote", file)
process.exit(0)
