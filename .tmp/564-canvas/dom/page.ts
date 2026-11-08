/**
 * PROTOTYPE (#564 follow-up): would the DOM gain from a batch? N absolutely placed divs, each sprung on
 * `x` and `y` (210/20) to a new random spot every round, three ways:
 *
 * - `ward`:  `createAnimate`'s Animation scope (`scopedAnimate`), a spine per element, through
 *            `DomLive` and the flush gate as the Solid provider builds them: `DomRenderer` writes each
 *            element's `transform` through `setProperty`.
 * - `batch`: one run on the same Frame loop for every element (perf/group.ts), writing each moving
 *            element's `transform` in `DomRenderer`'s own form.
 * - `floor`: a hand loop on rAF, the same spring step and the same writes, no Wardic.
 *
 * The runner (run.mjs) times each round with Chromium's own accounting (CDP `Performance.getMetrics`).
 */
import * as Machine from "../../../packages/core/src/Machine.ts"
import * as Spring from "../../../packages/core/src/Spring.ts"
import * as DefaultTransition from "../../../packages/core/src/DefaultTransition.ts"
import * as ReducedMotion from "../../../packages/core/src/ReducedMotion.ts"
import { DomLive } from "../../../packages/dom/src/index.ts"
import * as FlushGate from "../../../packages/dom/src/FlushGate.ts"
import { type AnimateEnv, scopedAnimate, scopeOf } from "../../../packages/solid/src/imperative.ts"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { makeGroup } from "../perf/group.ts"

declare global {
  interface Window {
    __probe: { ready: boolean; retarget: () => number; frames: (n: number) => Promise<void>; moving: () => number }
  }
}

const params = new URLSearchParams(location.search)
const MODE = params.get("mode") ?? "ward"
const N = Number(params.get("n") ?? 1000)
const SPRING = { stiffness: 210, damping: 20 }

document.body.style.margin = "0"
const els: Array<HTMLElement> = []
for (let i = 0; i < N; i++) {
  const el = document.createElement("div")
  el.style.cssText = "position:absolute;left:0;top:0;width:6px;height:6px;background:#88c0d0"
  document.body.append(el)
  els.push(el)
}
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const writeTransform = (el: HTMLElement, x: number, y: number) =>
  el.style.setProperty("transform", "translateX(" + x + "px) translateY(" + y + "px)")

let retargetAll: () => void
let moving: () => number = () => 0

if (MODE === "ward" || MODE === "batch") {
  const runtime = ManagedRuntime.make(Layer.provideMerge(FlushGate.layer({ batch: (apply) => apply() }), DomLive))
  const gate = runtime.runSync(FlushGate.FlushGate)
  if (MODE === "ward") {
    const env: AnimateEnv = {
      runtime: runtime as unknown as AnimateEnv["runtime"],
      gate,
      reducedMotion: () => false,
      skipAnimations: () => false,
      positionalKeys: runtime.runSync(ReducedMotion.PositionalKeys),
      defaultTransition: runtime.runSync(DefaultTransition.DefaultTransition),
    }
    const scope = scopeOf()
    const animate = scopedAnimate(env, () => undefined, scope.watch)
    const transition = { type: "spring" as const, ...SPRING }
    retargetAll = () => {
      for (const el of els) animate([el], { x: rand() * 800, y: rand() * 600 }, transition)
    }
    moving = () => scope.scope.animations.length
  } else {
    // A batch's 5 slots per element; only x and y move (rotateY and scale stay at rest).
    const group = makeGroup(runtime as never, N, (_, into, b) => { into[b + 4] = 1 }, (i, p, b) => writeTransform(els[i]!, p[b]!, p[b + 1]!), SPRING)
    retargetAll = () => {
      for (let i = 0; i < N; i++) group.set(i, { x: rand() * 800, y: rand() * 600, z: 0, rotateY: 0, scale: 1 })
    }
    moving = group.moving
  }
} else {
  // The floor: per element x and y, the exact spring step, on rAF.
  const pos = new Float64Array(N * 2), vel = new Float64Array(N * 2), goal = new Float64Array(N * 2)
  const spring = Spring.resolve(SPRING)
  let running = false
  let last = 0
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, Machine.MAX_DT)
    last = now
    const m = Spring.matrixFor(spring, dt)
    let any = false
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < 2; j++) {
        const at = i * 2 + j
        const d = pos[at]! - goal[at]!, v = vel[at]!
        pos[at] = goal[at]! + m.dd * d + m.dv * v
        vel[at] = m.vd * d + m.vv * v
        if (Math.abs(vel[at]!) > 0.01 || Math.abs(pos[at]! - goal[at]!) > 0.01) any = true
      }
      writeTransform(els[i]!, pos[i * 2]!, pos[i * 2 + 1]!)
    }
    if (any) requestAnimationFrame(tick)
    else running = false
  }
  retargetAll = () => {
    for (let i = 0; i < N; i++) {
      goal[i * 2] = rand() * 800
      goal[i * 2 + 1] = rand() * 600
    }
    if (!running) {
      running = true
      last = performance.now()
      requestAnimationFrame(tick)
    }
  }
  moving = () => (running ? N : 0)
}

window.__probe = {
  ready: true,
  retarget: () => {
    const t0 = performance.now()
    retargetAll()
    return performance.now() - t0
  },
  frames: (n) =>
    new Promise((resolve) => {
      let left = n
      const next = () => {
        left--
        if (left <= 0) resolve()
        else requestAnimationFrame(next)
      }
      requestAnimationFrame(next)
    }),
  moving: () => moving(),
}
