// #32 (ADR-0032): pointer input reaches the drag inside its event, under a browser's own Effect
// scheduler. The browser tier's `setImmediate` polyfill runs Effect's dispatcher on microtasks,
// so a scheduler hop lands in the same task and these tests can't see it there: T13 passed
// while the layout lab, on a browser's scheduler, painted every move a frame late. Each test
// here runs its provider on what Effect picks in a browser with no `setImmediate`, a
// `setTimeout(0)` dispatch (`effect/dist/Scheduler.js`), provided into DomLive so the Layers'
// own fibers (the Shared sources' pumps) get it too, as clock-cold-start's test does.
//
// Before #32, pointer input reached the drag through two hops: the Held pointer's queue
// released its consumer through the scheduler, and the drag track's `switchMap` forked every
// sample's inner. A move then painted one frame late, and a release could hold one.
import { cleanup, render } from "@solidjs/testing-library"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Projection from "@wardic/core/Projection"
import { DomLive } from "@wardic/dom"
import type * as FlushGate from "@wardic/dom/FlushGate"
import { useWardicGate, wardic, type WardicEnv, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scheduler from "effect/Scheduler"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { afterPaint, raf } from "./browser-helpers.ts"
import { pushedPointer } from "./pushed-pointer.ts"

/** `env` on a browser's Effect scheduler: `setTimeout(0)` dispatch, for every fiber its runtime runs. */
const onBrowserScheduler = (env: WardicEnv): WardicEnv => {
  const scheduler = new Scheduler.MixedScheduler("async", (task) => {
    const timer = setTimeout(task, 0)
    return () => clearTimeout(timer)
  })
  return env.pipe(Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, scheduler)))
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

/** The element's painted translateX, from its inline transform (0 for none). */
const translateXOf = (el: HTMLElement): number => {
  const m = /translateX\(([-\d.e]+)px\)/.exec(el.style.transform)
  return Option.match(Option.fromNullOr(m), { onNone: () => 0, onSome: (match) => Number(match[1]) })
}

/** One gate write: its keys, its `x` if it wrote one, and whether it came inside a dispatch below. */
interface Write {
  readonly keys: ReadonlyArray<string>
  readonly x: number | undefined
  readonly inDispatch: boolean
}

let dispatching = false

/** Wraps the provider's gate so each `write` is recorded, with whether it came inside {@link dispatch}. */
function GateSpy(props: { readonly writes: Array<Write> }) {
  const gate = useWardicGate()
  const write = gate.write
  ;(gate as { write: FlushGate.Shape["write"] }).write = (id, partial) => {
    const x = partial.x
    props.writes.push({ keys: Object.keys(partial), x: Option.getOrUndefined(Option.liftPredicate(x, Predicate.isNumber)), inDispatch: dispatching })
    write(id, partial)
  }
  return null
}

interface PointerInit {
  readonly pointerId?: number
  readonly pointerType?: string
  readonly isPrimary?: boolean
}

/** Dispatch a synthetic pointer event on `el` at client `(x, 50)`; a gate write before it returns counts as inside it. */
const dispatch = (el: HTMLElement, type: string, x: number, buttons: number, init: PointerInit = {}): void => {
  const event = new PointerEvent(type, {
    clientX: x,
    clientY: 50,
    buttons,
    button: Bool.match(type === "pointermove", { onTrue: () => -1, onFalse: () => 0 }),
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "mouse",
    isPrimary: init.isPrimary ?? true,
    bubbles: true,
  })
  dispatching = true
  try {
    el.dispatchEvent(event)
  } finally {
    dispatching = false
  }
}

let pressed = false
afterEach(async () => {
  if (pressed) await commands.realMouse("up", 5, 5)
  pressed = false
  await commands.realMouse("move", 5, 5)
  cleanup()
})

type Mode = "free" | "layout"

interface Scene {
  readonly el: HTMLElement
  readonly writes: Array<Write>
}

const mount = async (
  mode: Mode,
  options: { readonly momentum?: boolean; readonly snapToOrigin?: boolean; readonly env?: WardicEnv } = {},
): Promise<Scene> => {
  const writes: Array<Write> = []
  let el: HTMLElement | undefined
  render(() => (
    <WardicProvider env={options.env ?? onBrowserScheduler(DomLive)}>
      <GateSpy writes={writes} />
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>
        <wardic.div
          layout={mode === "layout"}
          drag
          dragMomentum={options.momentum ?? false}
          dragSnapToOrigin={options.snapToOrigin ?? false}
          ref={(n: HTMLElement) => (el = n)}
          style={{ position: "relative", width: "120px", height: "80px" }}
        />
      </div>
    </WardicProvider>
  ))
  // The Shared sources subscribe a few tasks after mount, on this scheduler.
  await settle()
  return { el: el!, writes }
}

/** The x writes after `from`, in order. */
const xWritesFrom = (writes: ReadonlyArray<Write>, from: number): ReadonlyArray<Write> =>
  writes.slice(from).filter((w) => w.x !== undefined)

describe("a move is written inside its pointermove's dispatch", () => {
  it("H1: a free drag's direct-set", async () => {
    const { el, writes } = await mount("free")
    dispatch(el, "pointerdown", 100, 1)
    const from = writes.length
    for (const x of [104, 108, 112, 116]) {
      dispatch(el, "pointermove", x, 1)
      await afterPaint()
    }
    // `dragMomentum={false}`: the release rests where the pointer let go, written by the up.
    dispatch(el, "pointerup", 116, 0)
    const moves = xWritesFrom(writes, from)
    expect(moves.map((w) => w.x)).toEqual([4, 8, 12, 16, 16])
    expect(moves.map((w) => w.inDispatch)).toEqual([true, true, true, true, true])
  })

  it("H2: a layout drag's projection (dragMove derives the dragged group into the gate)", async () => {
    const { el, writes } = await mount("layout")
    dispatch(el, "pointerdown", 100, 1)
    const inside: Array<boolean> = []
    for (const x of [104, 108, 112, 116]) {
      const from = writes.length
      dispatch(el, "pointermove", x, 1)
      inside.push(writes.slice(from).some((w) => w.inDispatch && w.keys.includes(Projection.KEY)))
      await afterPaint()
    }
    dispatch(el, "pointerup", 116, 0)
    await settle()
    expect(inside).toEqual([true, true, true, true])
  })
})

it("H3: a move and its release in one task: the release is on the Frame loop by the end of that task", async () => {
  // The runs added to the loop, by their machine's span name.
  const added: Array<string> = []
  const recording = Layer.effect(FrameLoop.FrameLoop)(
    FrameLoop.FrameLoop.useSync((loop) => ({
      afterTick: loop.afterTick,
      inLateWindow: loop.inLateWindow,
      run: (machine, sink) =>
        Effect.suspend(() => {
          added.push(machine.span.name)
          return loop.run(machine, sink)
        }),
      runLast: (machine, sink) =>
        Effect.suspend(() => {
          added.push(machine.span.name)
          return loop.runLast(machine, sink)
        }),
    })),
  )
  const { el, writes } = await mount("free", { momentum: true, env: recording.pipe(Layer.provideMerge(onBrowserScheduler(DomLive))) })
  dispatch(el, "pointerdown", 100, 1)
  for (const x of [104, 112]) {
    dispatch(el, "pointermove", x, 1)
    await wait(10)
  }
  // A browser flushes a queued move when its up comes, in one task: here, one synchronous run.
  const from = writes.length
  const runsFrom = added.length
  dispatch(el, "pointermove", 130, 1)
  dispatch(el, "pointerup", 140, 0)
  // The end of the task: microtasks only, no timer and no frame.
  for (let i = 0; i < 20; i++) await Promise.resolve()
  // The move and the release's position were written in the dispatch, and the release is on
  // the loop by the end of the task, with no step before the next Refresh frame (ADR-0033).
  expect(xWritesFrom(writes, from).filter((w) => w.inDispatch).map((w) => w.x)).toEqual([30])
  expect(added.length - runsFrom, "the release is on the loop by the end of the task").toBe(1)
  expect(xWritesFrom(writes, from).filter((w) => !w.inDispatch)).toEqual([])
  // Its first step at that frame, past the release point.
  await raf()
  const tail = xWritesFrom(writes, from)
  expect(tail.filter((w) => !w.inDispatch).length, "the release steps at the next Refresh frame").toBeGreaterThan(0)
  expect(tail[tail.length - 1]!.x!).toBeGreaterThan(30)
  await settle()
})

/**
 * T13's measure (drag-measure-pass.browser.test.tsx), real mouse: per move, the frame it was
 * delivered in (the first whose rAF ran after it) and the first frame from there whose box
 * reached its position.
 */
const paintLags = async (el: HTMLElement): Promise<ReadonlyArray<number>> => {
  const slot = el.getBoundingClientRect()
  const frames: Array<{ cbAt: number; left: number }> = []
  const moves: Array<{ t: number; x: number }> = []
  let downX = 0
  const onDown = (e: PointerEvent): void => {
    downX = e.clientX
  }
  const onMove = (e: PointerEvent): void => {
    moves.push({ t: performance.now(), x: e.clientX })
  }
  window.addEventListener("pointerdown", onDown, true)
  window.addEventListener("pointermove", onMove, true)
  let recording = true
  const channel = new MessageChannel()
  let cbAt = 0
  const tick = (): void => {
    cbAt = performance.now()
    channel.port2.postMessage(undefined)
  }
  channel.port1.onmessage = () => {
    frames.push({ cbAt, left: el.getBoundingClientRect().left })
    if (recording) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  try {
    const x0 = slot.left + 20
    const y0 = slot.top + 20
    await commands.realMouse("down", x0, y0)
    pressed = true
    for (let k = 1; k <= 3; k++) {
      await commands.realMouse("move", x0 + 2 * k, y0) // past the recognizer's threshold
      await wait(20)
    }
    await wait(200)
    const since = performance.now()
    for (let k = 1; k <= 30; k++) {
      await commands.realMouse("move", x0 + 6 + 8 * k, y0)
      await wait(16)
    }
    await wait(100)
    recording = false
    await commands.realMouse("up", x0 + 6 + 8 * 30, y0)
    pressed = false
    const lags: Array<number> = []
    for (const m of moves.filter((mv) => mv.t > since)) {
      const want = slot.left + (m.x - downX)
      const delivered = frames.findIndex((f) => f.cbAt > m.t)
      if (delivered < 0) continue
      const painted = frames.findIndex((f, i) => i >= delivered && f.left >= want - 0.5)
      if (painted >= 0) lags.push(painted - delivered)
    }
    return lags
  } finally {
    recording = false
    window.removeEventListener("pointerdown", onDown, true)
    window.removeEventListener("pointermove", onMove, true)
  }
}

describe("H4: with real mouse input, each move is painted in the frame it was delivered", () => {
  for (const mode of ["free", "layout"] as const) {
    it(`a ${mode} drag`, async () => {
      const { el } = await mount(mode)
      const lags = await paintLags(el)
      expect.soft(lags.length, "moves measured").toBeGreaterThan(20)
      expect.soft(Math.max(...lags), "every move painted in the frame it was delivered").toBe(0)
      await settle()
    })
  }
})

describe("a running release (a fling) and the next press", () => {
  /** A free drag flung right: 30 px fast, released; returns once the fling is a few frames in. */
  const fling = async (scene: Scene): Promise<void> => {
    dispatch(scene.el, "pointerdown", 100, 1)
    for (const x of [106, 112, 118, 124, 130]) {
      dispatch(scene.el, "pointermove", x, 1)
      await wait(8)
    }
    dispatch(scene.el, "pointerup", 130, 0)
    for (let i = 0; i < 3; i++) await raf()
  }

  it("H5: a primary press stops it where it is, inside the press's dispatch", async () => {
    const scene = await mount("free", { momentum: true })
    await fling(scene)
    const at = scene.writes.length
    const reached = translateXOf(scene.el)
    expect(reached, "the fling has gone past the release point").toBeGreaterThan(30)
    dispatch(scene.el, "pointerdown", 300, 1)
    for (let i = 0; i < 5; i++) await raf()
    await afterPaint()
    expect(xWritesFrom(scene.writes, at), "no release step after the press").toEqual([])
    dispatch(scene.el, "pointerup", 300, 0)
  })

  it("H6: a non-primary pointer's press doesn't stop it", async () => {
    const scene = await mount("free", { momentum: true })
    await fling(scene)
    const at = scene.writes.length
    dispatch(scene.el, "pointerdown", 300, 1, { pointerId: 2, pointerType: "touch", isPrimary: false })
    for (let i = 0; i < 5; i++) await raf()
    expect(xWritesFrom(scene.writes, at).length, "release steps after the second finger's press").toBeGreaterThan(0)
    dispatch(scene.el, "pointerup", 300, 0, { pointerId: 2, pointerType: "touch", isPrimary: false })
    await settle()
  })
})

it("H7 (rule B, the order): a Stale gesture's end and the grab of the same down: the release is stopped before its first frame, and the next drag rebases once", async () => {
  // An input with no page-wide feed, so the owner's second down reaches the drag as one
  // event (ADR-0019, rule B), the stale "end" and the grab together. With `dragSnapToOrigin`,
  // a release that ran would spring the element back toward 0.
  const pointer = pushedPointer({ step: 16, over: onBrowserScheduler(DomLive) })
  const scene = await mount("free", { snapToOrigin: true, env: pointer.env })
  pointer.push("down", 0)
  pointer.push("move", 10)
  pointer.push("move", 40)
  await settle()
  expect(translateXOf(scene.el)).toBe(40)
  // The owner goes down again, its release lost: the old gesture's "end" and this down's grab.
  pointer.push("down", 60)
  for (let i = 0; i < 6; i++) await raf()
  await afterPaint()
  expect(translateXOf(scene.el), "no spring back toward the origin").toBe(40)
  // The second gesture: offset 10 from its down, from where the first ended.
  pointer.push("move", 70)
  await settle()
  expect(translateXOf(scene.el)).toBe(50)
  pointer.push("up", 70)
  await settle()
})
