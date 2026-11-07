// PROTOTYPE, throwaway (#564 pressure test, P6): run imperative.ts's plain-element path (the spine a
// `createAnimate()` call builds for a plain element) on a Three.js Object3D, in Bun with NO DOM, and
// log every member the spine touches on the target and every DOM global it reaches.
//
// Run from the repo root:
//   bun --conditions=@wardic/source .tmp/564-canvas/p6/probe.ts [record|dom] [three|plain] [keys]
//   keys: a JSON target, default {"x":2,"rotateY":90,"opacity":0.5}
import * as Announcer from "../../../packages/core/src/Announcer.ts"
import * as FrameLoop from "../../../packages/core/src/FrameLoop.ts"
import * as Playback from "../../../packages/core/src/Playback.ts"
import * as Renderer from "../../../packages/core/src/Renderer.ts"
import * as ReducedMotion from "../../../packages/core/src/ReducedMotion.ts"
import * as DefaultTransition from "../../../packages/core/src/DefaultTransition.ts"
import * as DomDefaultTransition from "../../../packages/dom/src/DomDefaultTransition.ts"
import * as DomInterpolators from "../../../packages/dom/src/DomInterpolators.ts"
import * as DomPositionalKeys from "../../../packages/dom/src/DomPositionalKeys.ts"
import * as DomRenderer from "../../../packages/dom/src/DomRenderer.ts"
import * as FlushGate from "../../../packages/dom/src/FlushGate.ts"
import * as TestClock from "../../../packages/test/src/clock.ts"
import * as TestProbe from "../../../packages/test/src/probe.ts"
import { type AnimateEnv, scopedAnimate, scopeOf } from "../../../packages/solid/src/imperative.ts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { Object3D } from "three"

void Playback

const [rendererMode = "record", targetMode = "three", keysJson = '{"x":2,"rotateY":90,"opacity":0.5}', globalsMode = "stub"] = process.argv.slice(2)

// --- The log -----------------------------------------------------------------------------------

type Hit = { kind: string; key: string; where: string }
const hits: Array<Hit> = []
let logging = true

/** The first two Wardic frames of the current stack, skipping this file: `fn (pkg/path:line)`. */
const whereNow = (): string => {
  const stack = new Error().stack ?? ""
  const frames = stack.split("\n").slice(1)
    .filter((l) => l.includes("/packages/") && !l.includes("/p6/"))
    .slice(0, 3)
    .map((l) => l.trim().replace(/^at /, "").replace(/\/home\/bench\/dev\/wardic\/packages\//, "").replace(/:\d+\)$/, ")").replace(/(:\d+):\d+$/, "$1"))
  return frames.join(" <- ") || "(harness)"
}
const hit = (kind: string, key: string): void => {
  if (logging) hits.push({ kind, key, where: whereNow() })
}

// --- DOM globals: absent, but each read logged ------------------------------------------------

const DOM_GLOBALS = [
  "document", "window", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "HTMLElement", "SVGElement", "Element", "Node", "CSS", "matchMedia", "ResizeObserver",
  "IntersectionObserver", "MutationObserver", "DOMMatrix", "DOMMatrixReadOnly", "CSSStyleDeclaration",
  "navigator", "location", "HTMLStyleElement", "CSSStyleSheet", "visualViewport", "innerWidth",
  "innerHeight", "scrollX", "scrollY", "devicePixelRatio", "Animation", "KeyframeEffect",
]
// "absent": every DOM global reads as undefined (Node's truth). "stub": the ones the spine calls get a
// logging stand-in, so the run goes on and shows what it reads next.
const stubs: Record<string, unknown> = globalsMode === "stub" || globalsMode === "css"
  ? {
    getComputedStyle: (el: unknown) => {
      hit("call", "getComputedStyle()")
      return new Proxy({}, {
        get: (_t, k) => {
          if (k === "getPropertyValue") return (name: string) => {
            hit("call", `computed.getPropertyValue(${name})`)
            // "stub": empty, as a detached element's; "css": a page's defaults.
            if (globalsMode === "css") return ({ opacity: "1", color: "rgb(0, 0, 0)", width: "0px", height: "0px" } as Record<string, string>)[name] ?? ""
            return ""
          }
          hit("get", `computed.${String(k)}`)
          return ""
        },
      })
    },
    SVGElement: class SVGElementStub {},
    HTMLElement: class HTMLElementStub {},
    Element: class ElementStub {},
  }
  : {}
for (const name of DOM_GLOBALS) {
  if (name in globalThis) continue
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => {
      hit("global", name)
      return stubs[name]
    },
  })
}

// --- The target, behind a logging Proxy ----------------------------------------------------------

const raw: Record<string, unknown> = targetMode === "three" ? (new Object3D() as unknown as Record<string, unknown>) : {}
const proxyOf = <T extends object>(obj: T, path: string): T =>
  new Proxy(obj, {
    get(t, k, r) {
      const key = `${path}${String(k)}`
      hit("get", key)
      const v = Reflect.get(t, k, t)
      if (typeof v === "function") {
        return function (this: unknown, ...args: Array<unknown>) {
          hit("call", `${key}()`)
          return Reflect.apply(v as (...a: Array<unknown>) => unknown, this === r ? t : this, args)
        }
      }
      // Follow into nested objects a spine might write through (style, position…)
      if (v !== null && typeof v === "object" && (k === "style" || k === "dataset" || k === "classList")) return proxyOf(v as object, `${key}.`)
      return v
    },
    set(t, k, v) {
      hit("set", `${path}${String(k)}`)
      return Reflect.set(t, k, v, t)
    },
    has(t, k) {
      hit("has", `${path}${String(k)}`)
      return Reflect.has(t, k)
    },
    getOwnPropertyDescriptor(t, k) {
      hit("getOwnPropertyDescriptor", `${path}${String(k)}`)
      return Reflect.getOwnPropertyDescriptor(t, k)
    },
    ownKeys(t) {
      hit("ownKeys", `${path}*`)
      return Reflect.ownKeys(t)
    },
    defineProperty(t, k, d) {
      hit("defineProperty", `${path}${String(k)}`)
      return Reflect.defineProperty(t, k, d)
    },
    deleteProperty(t, k) {
      hit("deleteProperty", `${path}${String(k)}`)
      return Reflect.deleteProperty(t, k)
    },
    getPrototypeOf(t) {
      hit("getPrototypeOf", `${path}<proto>`)
      return Reflect.getPrototypeOf(t)
    },
  })
const target = proxyOf(raw, "")

// --- The Environment: the DOM's pure pieces, a pushable clock, no DOM Probe ------------------------

const commits: Array<{ target: unknown; patch: Renderer.Patch }> = []
const recordRenderer = Layer.succeed(Renderer.Renderer, {
  project: (values) => ({ ...values }),
  commit: (t, patch) => {
    commits.push({ target: t, patch: { ...patch } })
  },
})

// "three": a canvas Renderer, the port as it stands: per-axis keys onto the Object3D's own objects.
const threeRenderer = Layer.succeed(Renderer.Renderer, {
  project: (values) => values,
  commit: (t, patch) => {
    commits.push({ target: t, patch: { ...patch } })
    const o = raw as unknown as Object3D
    for (const key in patch) {
      const v = patch[key] as number
      if (key === "x") o.position.x = v
      else if (key === "y") o.position.y = v
      else if (key === "z") o.position.z = v
      else if (key === "rotateY") o.rotation.y = (v * Math.PI) / 180
      else if (key === "scale") o.scale.setScalar(v)
      else (o.userData as Record<string, unknown>)[key] = v
    }
  },
})

const program = Effect.gen(function* () {
  const clock = yield* TestClock.pushable()
  const env = FrameLoop.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        clock.layer,
        rendererMode === "dom" ? DomRenderer.layer : rendererMode === "three" ? threeRenderer : recordRenderer,
        TestProbe.layer(),
        DomInterpolators.layer,
        DomPositionalKeys.layer,
        DomDefaultTransition.layer,
        Announcer.layerSilent,
      ),
    ),
    Layer.provideMerge(AtomRegistry.layer),
  )
  const withGate = Layer.provideMerge(FlushGate.layer({ batch: (apply) => apply() }), env)
  return { clock, withGate }
})

const { clock, withGate } = Effect.runSync(program)
const runtime = ManagedRuntime.make(withGate)
const gate = runtime.runSync(FlushGate.FlushGate)
const positionalKeys = runtime.runSync(ReducedMotion.PositionalKeys)
const defaultTransition = runtime.runSync(DefaultTransition.DefaultTransition)

const animEnv: AnimateEnv = {
  runtime: runtime as unknown as AnimateEnv["runtime"],
  gate,
  reducedMotion: () => false,
  skipAnimations: () => false,
  positionalKeys,
  defaultTransition,
}
const made = scopeOf()
const animate = scopedAnimate(animEnv, () => undefined, made.watch)

// --- Run ---------------------------------------------------------------------------------------

const report = (label: string): void => {
  console.log(`\n== ${label}`)
}
let error: unknown = undefined
let state = "(never started)"
const marks: Record<string, number> = {}
try {
  // A bare Object3D isn't an element to subjectsOf (no nodeType): pass it in a list, and also try it bare.
  logging = false
  const bare = animate(target as unknown as Element, JSON.parse(keysJson), { duration: 0.2, ease: "linear" })
  console.log("bare Object3D subject -> state", bare.state, "(subjectsOf found", (bare as unknown as { duration: number }).duration, "s of animation)")
  logging = true
  report("animate([target], …)")
  const controls = animate([target as unknown as Element], JSON.parse(keysJson), { duration: 0.2, ease: "linear" })
  state = controls.state
  for (let i = 0; i < 20; i++) runtime.runSync(clock.advance(1 / 60))
  state = controls.state
  // A second call: a Retarget from where the first left it (latest-wins, velocity)
  marks.second = commits.length
  report("second call (Retarget)")
  const second = animate([target as unknown as Element], { x: -1 }, { type: "spring", stiffness: 100, damping: 10 })
  for (let i = 0; i < 6; i++) runtime.runSync(clock.advance(1 / 60))
  marks.third = commits.length
  const third = animate([target as unknown as Element], { x: 3 }, { type: "spring", stiffness: 100, damping: 10 })
  for (let i = 0; i < 120; i++) runtime.runSync(clock.advance(1 / 60))
  state = `${controls.state} / ${second.state} / ${third.state}`
} catch (e) {
  error = e
}
logging = false

// --- Report ------------------------------------------------------------------------------------

console.log("\nrenderer:", rendererMode, " target:", targetMode, " keys:", keysJson, " globals:", globalsMode)
console.log("final controls state:", state)
if (error !== undefined) console.log("ERROR:", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.split("\n").slice(0, 8).join("\n")}` : error)
if (process.env.DUMP) console.log("first commits:", commits.slice(0, Number(process.env.DUMP)).map((c) => JSON.stringify(c.patch)).join(" | "))
console.log("commits:", commits.length, commits.length > 0 ? JSON.stringify(commits.at(0)?.patch) + " … " + JSON.stringify(commits.at(-1)?.patch) : "")
console.log("commit targets are the proxy:", commits.length > 0 && commits.every((c) => c.target === target))
const xs = commits.map((c) => (c.patch as Record<string, number>).x)
const around = (i: number) => xs.slice(Math.max(0, i - 3), i + 4).map((v) => (typeof v === "number" ? v.toFixed(4) : String(v))).join(", ")
if (marks.second !== undefined) console.log("x around the second call (commit", marks.second, "):", around(marks.second))
if (marks.third !== undefined) console.log("x around the third call  (commit", marks.third, "):", around(marks.third))
if (targetMode === "three") {
  const o = raw as unknown as Object3D
  console.log("object3d after: position", o.position.toArray(), "rotation", o.rotation.toArray().slice(0, 3), "keys added:", Object.keys(raw).filter((k) => !Object.keys(new Object3D()).includes(k)))
}

// Group: kind+key -> set of where
const grouped = new Map<string, Map<string, number>>()
for (const h of hits) {
  const k = `${h.kind.padEnd(8)} ${h.key}`
  const m = grouped.get(k) ?? new Map<string, number>()
  m.set(h.where, (m.get(h.where) ?? 0) + 1)
  grouped.set(k, m)
}
console.log(`\n== touches (${hits.length} total, ${grouped.size} distinct)`)
for (const [k, wheres] of [...grouped.entries()].sort()) {
  console.log(k)
  for (const [w, n] of wheres) console.log(`    ${String(n).padStart(4)}x  ${w}`)
}
await runtime.dispose()
