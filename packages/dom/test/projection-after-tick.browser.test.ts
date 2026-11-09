// A Measure pass that runs after its frame's tick, before the paint, takes the first step of the
// nodes it seeded, so the frame paints that step and not the origin (ADR-0018 *Amendment (#673)*).
// It knows from its trigger: one in the Frame loop's Late window (its tick, hooks included, through the
// microtasks the tick queued, #680), one during the engine's own ResizeObserver delivery, or one during
// an after-tick pass's own step. Real frames and
// the real observer; the sink records every write, and a hook added after the engine's marks each
// tick's end, so the log reads in the order a frame is drawn.
//
// - AT1: a trigger during a tick: the pass steps the node, and the frame's last write is that step.
// - AT2: the engine's observer delivery, cold: the pass steps at the nominal dt, as a cold start
//   from a task takes its first tick.
// - AT3: a trigger in a task: no step in the pass; the next tick takes it.
// - AT4: a node the tick stepped, restarted after it: no second step in the frame (Q2).
// - AT5: warm, the step's dt is the tick's: it lands where a node started before that tick does.
// - AT6: `onLayoutAnimationStart` once, at the pass's end, before the next tick.
// - AT7: app code in a later rAF callback can't be told from a task: no step, warm or cold.
// - AT8: past the round cap, the next task's pass takes no step.
// - AT9: a trigger during an after-tick pass's own step is after the tick too.
// - AT10: a node that landed in this tick and is seeded again after it takes the step (Q14).
// - AT11: a trigger in a microtask the tick queued is in the Frame loop's Late window (ADR-0027
//   *Amendment (#680)*), as Solid 2's effects are: the pass steps the node; one in a later task doesn't.
import { describe, expect, it } from "@effect/vitest"
import * as Clock from "@wardic/core/Clock"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import * as Projection from "@wardic/core/Projection"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import { afterEach } from "vitest"
import { clearStages, el, type Engine, makeEngine, stage, wait } from "./projection-harness.ts"

afterEach(() => {
  clearStages()
})

/** Long enough for a mount's pass and the observer's first delivery (several real frames). */
const SETTLE_MS = 150

type Event =
  | { readonly kind: "write"; readonly id: string; readonly tx: number; readonly sx: number }
  | { readonly kind: "tick" }
  | { readonly kind: "start"; readonly id: string }

/** The sink, writing into one log; `onFlush(n)` runs after the n-th `flushPass`'s pass. */
const makeLog = (onFlush?: (n: number) => void) => {
  const events: Array<Event> = []
  let flushes = 0
  const sink = {
    write: (id: string, partial: Record<string, unknown>): void => {
      const value = partial[Projection.KEY] as { delta: { x: { translate: number; scale: number } } } | undefined
      if (value === undefined) return
      events.push({ kind: "write", id, tx: value.delta.x.translate, sx: value.delta.x.scale })
    },
    flushPass: (pass: () => void): void => {
      pass()
      flushes++
      onFlush?.(flushes)
    },
  }
  return { events, sink }
}

/**
 * `hook` at the end of every tick of `e`'s Frame loop, after the engine's own: once a frame. The loop
 * calls its hooks again after a Late round in the same frame (ADR-0027 *Amendment (#680)*), which
 * isn't the next tick, so a call in a frame already marked is skipped.
 */
const onTicks = (e: Engine, hook: (dt: number) => undefined): void => {
  let marked = Number.NaN
  const once = (dt: number): undefined => {
    const at = document.timeline.currentTime as number
    if (at === marked) return undefined
    marked = at
    return hook(dt)
  }
  e.runtime.runSync(Effect.flatMap(Effect.service(FrameLoop.FrameLoop), (loop) => loop.afterTick(once)).pipe(Scope.provide(Scope.makeUnsafe())))
}

/** A run that never settles keeps the loop ticking: a warm Clock. Returns its stop. */
const keepWarm = (e: Engine): (() => void) => {
  const forever: Machine.Machine<Frame.Frame<number>> = Machine.make({
    settles: false,
    span: { name: "test.warm", attributes: {} },
    start: () => () => ({ value: 0, done: false }),
  })
  const fiber = e.runtime.runFork(Effect.flatMap(Effect.service(FrameLoop.FrameLoop), (loop) => loop.run(forever, () => undefined)))
  return () => {
    e.runtime.runFork(Fiber.interrupt(fiber))
  }
}

const SPRING = () => Option.some({ type: "spring" as const })

/** `id`'s writes in `events` after index `from`, up to the next tick's end marker, or every one. */
const writesUntilTick = (events: ReadonlyArray<Event>, id: string, from: number): Array<Extract<Event, { kind: "write" }>> => {
  const out: Array<Extract<Event, { kind: "write" }>> = []
  for (let i = from; i < events.length; i++) {
    const event = events[i]!
    if (event.kind === "tick") break
    if (event.kind === "write" && event.id === id) out.push(event)
  }
  return out
}

/** The index just after the first tick marker at or after `from`. */
const afterTickAt = (events: ReadonlyArray<Event>, from: number): number => {
  for (let i = from; i < events.length; i++) if (events[i]!.kind === "tick") return i + 1
  return events.length
}

/** A box at `left` px in a fresh stage. */
const box = (left = 0): HTMLElement => el(stage("position:relative;width:700px;height:200px"), `position:absolute;top:0;left:${left}px;width:60px;height:60px`)

describe("a Measure pass after its frame's tick takes its nodes' first step (#673, ADR-0018 *Amendment (#673)*)", () => {
  it("AT1: a trigger during a tick: the pass steps the node, and the frame's last write is that step", async () => {
    const { events, sink } = makeLog()
    const e = makeEngine(sink)
    const a = box()
    const h = e.system.register({ id: "a", element: a, transition: SPRING })
    const stop = keepWarm(e)
    await wait(SETTLE_MS)
    let armedAt = -1
    let armed = true
    onTicks(e, () => {
      events.push({ kind: "tick" })
      if (!armed) return undefined
      armed = false
      armedAt = events.length
      a.style.left = "240px"
      h.notify()
      return undefined
    })
    await wait(SETTLE_MS)
    const pass = e.spans.at(-1)!
    expect(pass.seeded).toBe(1)
    expect(pass.stepped).toBe(1)
    // Before the next tick's end: the seed at the origin, the pass's step, then that tick's own.
    const frame = writesUntilTick(events, "a", armedAt)
    expect(frame.length).toBe(3)
    expect(frame[0]!.tx).toBeCloseTo(-240, 6)
    const first = frame[1]!.tx - frame[0]!.tx
    const second = frame[2]!.tx - frame[1]!.tx
    expect(first, "the pass's step moved").toBeGreaterThan(0.01)
    expect(second, "a single first step: the spring's second is larger").toBeGreaterThan(first)
    stop()
    e.dispose()
  })

  it("AT2: the engine's observer delivery, cold: the pass steps at the nominal dt, as a cold start's first tick does", async () => {
    // The node grows from 60 to 180 px wide, once seen only by the observer and once notified in a task.
    const grow = async (notified: boolean): Promise<{ readonly stepped: unknown; readonly sx: number }> => {
      const { events, sink } = makeLog()
      const e = makeEngine(sink)
      const a = box()
      const h = e.system.register({ id: "a", element: a, transition: SPRING })
      await wait(SETTLE_MS)
      const from = events.length
      a.style.width = "180px"
      if (notified) h.notify()
      await wait(SETTLE_MS)
      const pass = e.spans.at(-1)!
      const writes = events.slice(from).filter((x): x is Extract<Event, { kind: "write" }> => x.kind === "write" && x.id === "a")
      // The seed, at a third of the width, then the first step.
      expect(writes[0]!.sx).toBeCloseTo(1 / 3, 6)
      e.dispose()
      return { stepped: pass.stepped, sx: writes[1]!.sx }
    }
    const seen = await grow(false)
    const task = await grow(true)
    expect(seen.stepped).toBe(1)
    expect(task.stepped).toBe(0)
    // One step at NOMINAL_DT each: the observer's pass and the Cold start's first tick.
    expect(seen.sx).toBeCloseTo(task.sx, 9)
    expect(Clock.NOMINAL_DT).toBeCloseTo(1 / 60, 12)
  })

  it("AT3: a trigger in a task, warm: no step in the pass; the next tick takes the first", async () => {
    const { events, sink } = makeLog()
    const e = makeEngine(sink)
    const a = box()
    const h = e.system.register({ id: "a", element: a, transition: SPRING })
    const stop = keepWarm(e)
    onTicks(e, () => {
      events.push({ kind: "tick" })
      return undefined
    })
    await wait(SETTLE_MS)
    const from = events.length
    a.style.left = "240px"
    h.notify()
    await wait(SETTLE_MS)
    expect(e.spans.at(-1)!.stepped).toBe(0)
    // Up to the next tick's end: the seed, then that tick's first step.
    const frame = writesUntilTick(events, "a", from)
    expect(frame.length).toBe(2)
    expect(frame[0]!.tx).toBeCloseTo(-240, 6)
    stop()
    e.dispose()
  })

  it("AT4: a node the tick stepped, restarted after it, isn't stepped again in that frame (Q2)", async () => {
    const { events, sink } = makeLog()
    const e = makeEngine(sink)
    const a = box()
    const h = e.system.register({ id: "a", element: a, transition: SPRING })
    await wait(SETTLE_MS)
    a.style.left = "240px"
    h.notify() // flying, from a task
    let ticks = 0
    let armedAt = -1
    onTicks(e, () => {
      events.push({ kind: "tick" })
      ticks++
      if (ticks !== 4) return undefined
      armedAt = events.length
      a.style.left = "480px" // on the way: a restart after the tick that stepped it
      h.notify()
      return undefined
    })
    await wait(SETTLE_MS)
    const pass = e.spans.find((span) => span.seeded === 1 && span.stepped === 0 && e.spans.indexOf(span) > 0)
    expect(pass, "the restart's pass seeded it and took no step").toBeDefined()
    // This frame: the tick's step (before the marker), then the restart's seed, from where it
    // paints; the next tick's write is the new flight's first step.
    const before = events.slice(0, armedAt).filter((x): x is Extract<Event, { kind: "write" }> => x.kind === "write" && x.id === "a").at(-1)!
    const frame = writesUntilTick(events, "a", armedAt)
    expect(frame.length).toBe(2)
    // Where it paints: the seed's offset from the new box is the old one's, 240 px further.
    expect(frame[0]!.tx).toBeCloseTo(before.tx - 240, 3)
    e.dispose()
  })

  it("AT5: warm, the pass steps at the tick's dt: a node started after a tick lands where one started before it does", async () => {
    const { events, sink } = makeLog()
    const e = makeEngine(sink)
    const a = box()
    const b = el(a.parentElement!, "position:absolute;top:100px;left:0;width:60px;height:60px")
    const ha = e.system.register({ id: "a", element: a, transition: SPRING })
    const hb = e.system.register({ id: "b", element: b, transition: SPRING })
    const stop = keepWarm(e)
    await wait(SETTLE_MS)
    let armed = false
    onTicks(e, () => {
      events.push({ kind: "tick" })
      if (!armed) return undefined
      armed = false
      a.style.left = "240px" // after the tick in which b took its first step
      ha.notify()
      return undefined
    })
    // b from a task: seeded at its end, first stepped by the next tick, in whose hook a starts.
    b.style.left = "240px"
    hb.notify()
    armed = true
    await wait(SETTLE_MS)
    const firstOf = (id: string): number => {
      const writes = events.filter((x): x is Extract<Event, { kind: "write" }> => x.kind === "write" && x.id === id)
      const seed = writes.findIndex((w) => Math.abs(w.tx + 240) < 1e-6)
      return writes[seed + 1]!.tx
    }
    expect(firstOf("a")).toBeCloseTo(firstOf("b"), 9)
    stop()
    e.dispose()
  })

  it("AT6: onLayoutAnimationStart is called once, at the pass's end, before the next tick", async () => {
    const { events, sink } = makeLog()
    const e = makeEngine(sink)
    const a = box()
    const h = e.system.register({
      id: "a",
      element: a,
      transition: SPRING,
      onLayoutAnimationStart: () => Option.some(() => events.push({ kind: "start", id: "a" })),
    })
    const stop = keepWarm(e)
    await wait(SETTLE_MS)
    let armedAt = -1
    let armed = true
    onTicks(e, () => {
      events.push({ kind: "tick" })
      if (!armed) return undefined
      armed = false
      armedAt = events.length
      a.style.left = "240px"
      h.notify()
      return undefined
    })
    await wait(SETTLE_MS)
    const next = afterTickAt(events, armedAt)
    const kinds = events.slice(armedAt, next).map((x) => x.kind)
    // seed, step, start, then the next tick's step and its end.
    expect(kinds).toEqual(["write", "write", "start", "write", "tick"])
    expect(events.filter((x) => x.kind === "start")).toHaveLength(1)
    stop()
    e.dispose()
  })

  it("AT7: app code in a later rAF callback can't be told from a task: its pass takes no step, warm or cold", async () => {
    for (const warm of [true, false]) {
      const { sink } = makeLog()
      const e = makeEngine(sink)
      const a = box()
      const h = e.system.register({ id: "a", element: a, transition: SPRING })
      const mode = Bool.match(warm, { onTrue: () => "warm", onFalse: () => "cold" })
      const stop = Bool.match(warm, { onTrue: () => keepWarm(e), onFalse: () => () => undefined })
      await wait(SETTLE_MS)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          a.style.left = "240px"
          h.notify()
          resolve()
        }),
      )
      await wait(0)
      expect(e.spans.at(-1)!.seeded, `${mode}: seeded`).toBe(1)
      expect(e.spans.at(-1)!.stepped, `${mode}: no step`).toBe(0)
      stop()
      e.dispose()
    }
  })

  it("AT8: past the round cap, the next task's pass takes no step; the capped pass itself does", async () => {
    let rounds = 0
    let c: HTMLElement | undefined
    let hc: { readonly notify: () => void } | undefined
    // Each of the armed pass's five rounds moves c and triggers again, so the rest runs in the next task.
    const { sink } = makeLog(() => {
      if (c === undefined || hc === undefined || rounds >= 5) return
      rounds++
      c.style.left = `${rounds * 20}px`
      hc.notify()
    })
    const e = makeEngine(sink)
    const a = box()
    c = el(a.parentElement!, "position:absolute;top:100px;left:0;width:60px;height:60px")
    const ha = e.system.register({ id: "a", element: a, transition: SPRING })
    const registered = e.system.register({ id: "c", element: c, transition: SPRING })
    const stop = keepWarm(e)
    await wait(SETTLE_MS)
    const from = e.spans.length
    let armed = true
    onTicks(e, () => {
      if (!armed) return undefined
      armed = false
      rounds = 0
      hc = registered
      a.style.left = "240px"
      ha.notify()
      return undefined
    })
    await wait(SETTLE_MS)
    const passes = e.spans.slice(from)
    expect(passes[0]!.rounds).toBe(5)
    expect(passes[0]!.stepped).toBeGreaterThanOrEqual(1)
    expect(passes[1]!.seeded).toBeGreaterThanOrEqual(1)
    expect(passes[1]!.stepped, "the next task's pass").toBe(0)
    stop()
    e.dispose()
  })

  it("AT9: a trigger during an after-tick pass's own step is after the tick too", async () => {
    let b: HTMLElement | undefined
    let hb: { readonly notify: () => void } | undefined
    // Flushes since arming: the armed pass's one round, then its step's, inside which b moves and triggers.
    let sinceArm = -1
    const { sink } = makeLog(() => {
      if (sinceArm < 0) return
      sinceArm++
      if (sinceArm !== 2) return
      b!.style.left = "240px"
      hb!.notify()
    })
    const e = makeEngine(sink)
    const a = box()
    b = el(a.parentElement!, "position:absolute;top:100px;left:0;width:60px;height:60px")
    const ha = e.system.register({ id: "a", element: a, transition: SPRING })
    hb = e.system.register({ id: "b", element: b, transition: SPRING })
    const stop = keepWarm(e)
    await wait(SETTLE_MS)
    const from = e.spans.length
    let armed = true
    onTicks(e, () => {
      if (!armed) return undefined
      armed = false
      sinceArm = 0
      a.style.left = "240px"
      ha.notify()
      return undefined
    })
    await wait(SETTLE_MS)
    const passes = e.spans.slice(from)
    expect(passes[0]!.stepped).toBe(1)
    expect(passes[1], "b's pass").toBeDefined()
    expect(passes[1]!.seeded).toBe(1)
    expect(passes[1]!.stepped, "inherited: after the tick").toBe(1)
    stop()
    e.dispose()
  })

  it("AT10: a node that landed in this tick and is seeded again after it takes the step (Q14)", async () => {
    const { events, sink } = makeLog()
    const e = makeEngine(sink)
    const a = box()
    let back = false
    let armedAt = -1
    const h: { readonly notify: () => void } = e.system.register({
      id: "a",
      element: a,
      transition: () => Option.some({ type: "tween" as const, duration: 0.1 }),
      // Called after the tick it landed in, inside it (ADR-0039): it goes back.
      onLayoutAnimationComplete: () =>
        Option.some(() => {
          if (back) return
          back = true
          armedAt = events.length
          a.style.left = "0px"
          h.notify()
        }),
    })
    onTicks(e, () => {
      events.push({ kind: "tick" })
      return undefined
    })
    await wait(SETTLE_MS)
    a.style.left = "240px"
    h.notify()
    await wait(400)
    const pass = e.spans.at(-1)!
    expect(pass.seeded).toBe(1)
    expect(pass.stepped).toBe(1)
    // From the landing tick's end: the seed where it landed, then the pass's step back, in that frame.
    const frame = writesUntilTick(events, "a", afterTickAt(events, armedAt))
    expect(frame[0]!.tx).toBeCloseTo(240, 6)
    expect(frame[1]!.tx, "its first step back, in that frame").toBeLessThan(240)
    e.dispose()
  })

  it("AT11: a trigger in a microtask the tick queued steps in its pass; one in a later task doesn't (#680)", async () => {
    const { events, sink } = makeLog()
    const e = makeEngine(sink)
    const a = box()
    const h = e.system.register({ id: "a", element: a, transition: SPRING })
    const stop = keepWarm(e)
    await wait(SETTLE_MS)
    let armedAt = -1
    let armed = true
    onTicks(e, () => {
      events.push({ kind: "tick" })
      if (!armed) return undefined
      armed = false
      // As Solid 2's effect flush: queued in the tick, run after it, before the frame's paint.
      queueMicrotask(() => {
        armedAt = events.length
        a.style.left = "240px"
        h.notify()
      })
      return undefined
    })
    await wait(SETTLE_MS)
    const pass = e.spans.find((span) => span.seeded === 1)!
    expect(pass.stepped, "the microtask's pass stepped").toBe(1)
    const frame = writesUntilTick(events, "a", armedAt)
    expect(frame.length).toBe(3)
    expect(frame[0]!.tx).toBeCloseTo(-240, 6)
    expect(frame[1]!.tx - frame[0]!.tx, "the pass's step moved").toBeGreaterThan(0.01)
    // And back from a later task: the window has closed, so the pass seeds and the next tick steps.
    let back = false
    onTicks(e, () => {
      if (back) return undefined
      back = true
      setTimeout(() => {
        a.style.left = "0px"
        h.notify()
      }, 0)
      return undefined
    })
    await wait(SETTLE_MS * 3)
    const backPass = e.spans.filter((span) => span.seeded === 1).at(-1)!
    expect(backPass.stepped, "the task's pass took no step").toBe(0)
    stop()
    e.dispose()
  })
})
