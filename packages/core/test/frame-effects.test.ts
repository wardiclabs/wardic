/**
 * Frame effects' slot (#882, ADR-0073 *Amendment (#882)*, Q3; decision 19): an ordered list an
 * Environment runs at its frame's end, after Wardic's writes. Pure, so node-tier.
 */
import * as Clock from "@wardic/core/Clock"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import * as FrameEffects from "@wardic/core/unstable/FrameEffects"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"

/** Frame effects whose frame requests and reports are counted. */
const counted = () => {
  const told = { frames: 0, reports: [] as Array<unknown> }
  const effects = FrameEffects.make({ requestFrame: () => void told.frames++, report: (defect) => void told.reports.push(defect) })
  return { effects, told }
}

it("FE1: each run calls every effect, in the order added, with the frame's time", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  effects.add((t) => void heard.push(`a ${t}`))
  effects.add((t) => void heard.push(`b ${t}`))
  effects.add((t) => void heard.push(`c ${t}`))
  effects.run(16)
  effects.run(32)
  expect(heard).toEqual(["a 16", "b 16", "c 16", "a 32", "b 32", "c 32"])
})

it("FE2: one added during a run waits for the next; one removed before its turn isn't run; order kept", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  let removeC = (): void => undefined
  effects.add(() => {
    heard.push("a")
    effects.add(() => void heard.push("late"))
    removeC()
  })
  effects.add(() => void heard.push("b"))
  removeC = effects.add(() => void heard.push("c"))
  effects.run(0)
  expect(heard).toEqual(["a", "b"])
  heard.length = 0
  effects.run(16)
  // `a` adds another late effect each run, after the first one.
  expect(heard).toEqual(["a", "b", "late"])
})

it("FE3: a remover outside a run takes it off at once, and twice is nothing", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  const removeA = effects.add(() => void heard.push("a"))
  effects.add(() => void heard.push("b"))
  removeA()
  removeA()
  effects.run(0)
  expect(heard).toEqual(["b"])
})

it("FE4: request asks the Environment for one frame until the run, and requested says so", () => {
  const { effects, told } = counted()
  expect(effects.requested()).toBe(false)
  effects.request()
  effects.request()
  expect(told.frames).toBe(1)
  expect(effects.requested()).toBe(true)
  effects.run(16)
  expect(effects.requested()).toBe(false)
  effects.request()
  expect(told.frames).toBe(2)
})

it("FE5: an effect that throws is reported, and the rest of the frame's still run", () => {
  const { effects, told } = counted()
  const heard: Array<string> = []
  const boom = new Error("boom")
  effects.add(() => {
    throw boom
  })
  effects.add(() => void heard.push("after"))
  effects.run(0)
  expect(told.reports).toEqual([boom])
  expect(heard).toEqual(["after"])
})

it("FE6: an effect that removes itself in its run runs no more, and the next run is the rest's", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  const once = effects.add(() => {
    heard.push("once")
    once()
  })
  effects.add(() => void heard.push("always"))
  effects.run(0)
  effects.run(16)
  expect(heard).toEqual(["once", "always", "always"])
})

/**
 * `onFrameLoop`'s Environment, by hand: a Frame loop whose ticks the test calls (its hooks, in the order
 * added), a Refresh frame source the test fires, and a Clock whose last frame is the tick's time.
 */
const onLoop = () => {
  const hooks: Array<(dt: number) => undefined> = []
  const frames = new Map<number, (time: number) => void>()
  let handle = 0
  let frameAt = Number.NaN
  const loop = {
    afterTick: (hook: (dt: number) => undefined) =>
      Effect.acquireRelease(
        Effect.sync(() => void hooks.push(hook)),
        () => Effect.sync(() => void hooks.splice(hooks.indexOf(hook), 1)),
      ),
  }
  const source = {
    requestFrame: (callback: (time: number) => void) => {
      handle++
      frames.set(handle, callback)
      return handle
    },
    cancelFrame: (given: unknown) => void frames.delete(given as number),
  }
  const reports: Array<unknown> = []
  const scope = Scope.makeUnsafe()
  const effects = Effect.runSync(
    FrameEffects.onFrameLoop((defect) => void reports.push(defect)).pipe(
      Effect.provideService(FrameLoop.FrameLoop, loop as never),
      Effect.provideService(RefreshFrameSource.RefreshFrameSource, source as never),
      Effect.provideService(Clock.Clock, { frameAt: () => frameAt } as never),
      Scope.provide(scope),
    ),
  )
  /** A tick at `time`: its hooks, in the order added. */
  const tick = (time: number): void => {
    frameAt = time
    for (const hook of [...hooks]) hook(16)
  }
  /** Every pending Refresh frame, at `time`. */
  const fire = (time: number): void => {
    const due = [...frames.values()]
    frames.clear()
    for (const callback of due) callback(time)
  }
  return { effects, hooks, frames, tick, fire, reports, scope }
}

it("FE7: on a Frame loop, a request with no tick runs the effects on a Refresh frame of their own, at its time", () => {
  const env = onLoop()
  const heard: Array<number> = []
  env.effects.add((time) => void heard.push(time))
  env.effects.request()
  expect(env.frames.size).toBe(1)
  env.fire(100)
  expect(heard).toEqual([100])
  // Nothing asked: no frame.
  expect(env.frames.size).toBe(0)
})

it("FE8: a tick runs them at its end, after the hooks added before them (the gate's flush), and withdraws their own frame", () => {
  const env = onLoop()
  const heard: Array<string> = []
  // The gate's hook, added before the effects' slot was: a hook at the front of the tick's list.
  env.hooks.unshift(() => {
    heard.push("flush")
    return undefined
  })
  env.effects.add((time) => void heard.push(`effect ${time}`))
  env.effects.request()
  env.tick(200)
  expect(heard).toEqual(["flush", "effect 200"])
  expect(env.frames.size).toBe(0)
  // A tick with no request runs them too: an input moved in it, which each effect checks.
  env.tick(216)
  expect(heard).toEqual(["flush", "effect 200", "flush", "effect 216"])
})

it("FE9: closing the Scope takes the slot off the loop and withdraws a pending frame", () => {
  const env = onLoop()
  env.effects.add(() => undefined)
  env.effects.request()
  Effect.runSync(Scope.close(env.scope, Exit.void))
  expect(env.hooks).toEqual([])
  expect(env.frames.size).toBe(0)
})

// #979 group I, row 22 (ADR-0074 decision 3): a run is one effect throwing on consecutive frames.
it("FE10: an effect that throws every frame is reported once a run, again after a clean frame, and another effect's run is its own", () => {
  const { effects, told } = counted()
  let aThrows = true
  let bThrows = false
  const a = new Error("a")
  const b = new Error("b")
  effects.add(() => {
    if (aThrows) throw a
  })
  effects.add(() => {
    if (bThrows) throw b
  })
  effects.run(0)
  effects.run(16)
  effects.run(32)
  expect(told.reports).toEqual([a])
  // b's first throw is reported though a's run goes on.
  bThrows = true
  effects.run(48)
  effects.run(64)
  expect(told.reports).toEqual([a, b])
  // A clean frame ends a's run: its next throw is a new one.
  aThrows = false
  effects.run(80)
  aThrows = true
  effects.run(96)
  expect(told.reports).toEqual([a, b, a])
})
