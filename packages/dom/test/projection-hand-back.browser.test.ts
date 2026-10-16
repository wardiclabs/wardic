// A leaving element that isn't a twin hands back the twins inside it (#181, ADR-0010 *Amendment
// (#181)*), checked against a fake ProjectionSink with every Refresh frame fired by hand
// (`projection-harness.ts`). Presence's part (its own exit, removal once both end) is solid's.
//
// - HB1: a wrapper's twin crossfades back onto its other twin: locked onto it every frame, fading
//   out as it fades in, and `onDone` only once the handover has ended. Before #181 nothing took
//   the wrapper: its twin was disposed with it, and its other twin popped in alone.
// - HB2: what it declines, so presence runs the exit alone: a wrapper with no twin inside, a twin
//   with no other twin, and a twin leaver itself (`handleLeave`'s).
// - HB3: the wrapper's exit scales and moves it, from its registered values: the Follower inside
//   stays on its Lead (ADR-0010 *Amendment (#181)*, Q6).
// - HB4: the returned call drops the handed-back twin at once (an interrupted exit): no write after
//   it, no `onDone`, out of the engine, and its other twin's handover goes on.
// - HB5: a layout node the twin carries comes back with it (#169); a plain one elsewhere in the
//   wrapper doesn't (Q5).
//
// A gate-driven node's painted box is its layout box through its last written delta; a leaving
// one's (committed straight to the page) is read from the page.
import { describe, expect, it } from "@effect/vitest"
import * as Projection from "@wardic/core/Projection"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>
type Rect = { readonly x: { readonly min: number; readonly max: number }; readonly y: { readonly min: number; readonly max: number } }

const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

/** An element's box as the page draws it. */
const drawnOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

/** `id`'s delta as last written, the identity before any. */
const deltaOf = (sk: Sink, id: string): Projection.Delta =>
  (sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined) ?? { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }

/** A gate-driven top-level node's painted box: its layout box (its style carries no transform) through its last delta. */
const paintedOf = (sk: Sink, id: string, e: HTMLElement): Rect => Projection.applyTreeDeltas(drawnOf(e), [deltaOf(sk, id)]).box

/** `id`'s crossfade factor as last written; 1 when it carries none. */
const factor = (sk: Sink, id: string): number => {
  const o = sk.of(id).at(-1)?.value.opacity
  if (typeof o === "number") return o
  return 1
}

const apart = (a: Rect, b: Rect): number => Math.max(Math.abs(a.x.min - b.x.min), Math.abs(a.x.max - b.x.max), Math.abs(a.y.min - b.y.min), Math.abs(a.y.max - b.y.max))

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "spring" }), ...opts })

const frames = <A>(n: number, read: (i: number) => A): Array<A> =>
  Array.from({ length: n }, (_, i) => {
    fireFrame()
    return read(i)
  })

/**
 * A thumbnail twin, and a wrapper that isn't a twin holding the other, opened and settled. `inner`
 * adds what else the wrapper holds.
 */
const opened = async (e: Engine, inner: (wrap: HTMLElement, big: HTMLElement) => void = () => {}) => {
  const root = stage()
  const thumb = makeBox(root, 20, 300, 60, 40)
  register(e, "thumb", thumb, { layoutId: "t" })
  await endOfTask()
  fireFrame()
  const wrap = makeBox(root, 300, 100, 300, 240)
  const big = makeBox(wrap, 50, 40, 200, 150)
  const handle = register(e, "big", big, { layoutId: "t" })
  inner(wrap, big)
  await endOfTask()
  frames(120, () => undefined)
  return { thumb, wrap, big, handle }
}

/** Presence closes the wrapper: Solid disposes what it holds, then presence hands the wrapper's twins back, in one task. */
const close = async (e: Engine, wrap: HTMLElement, dispose: ReadonlyArray<ProjectionSystem.NodeHandle>) => {
  const seen = { done: false, drop: undefined as (() => void) | undefined }
  queueMicrotask(() => {
    seen.drop = Option.getOrUndefined(
      e.system.handBackWithin(wrap, () => {
        seen.done = true
      }),
    )
  })
  for (const h of dispose) h.dispose()
  await endOfTask()
  return seen
}

describe("a leaving element that isn't a twin hands back the twins inside it (#181)", () => {
  it("HB1: its twin crossfades back onto its other twin, locked every frame, and onDone waits for the handover", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { thumb, wrap, big, handle } = await opened(e)
    const closed = await close(e, wrap, [handle])
    expect(closed.drop, "the wrapper is taken").toBeTypeOf("function")
    const seen = frames(120, () => ({
      apart: apart(drawnOf(big), paintedOf(sk, "thumb", thumb)),
      follower: Number(big.style.opacity || "1"),
      lead: factor(sk, "thumb"),
      done: closed.done,
      moving: apart(paintedOf(sk, "thumb", thumb), drawnOf(thumb)),
    }))
    const flying = seen.filter((s) => s.follower > 0.01)
    expect(flying.length, "frames the Follower shows").toBeGreaterThan(10)
    expect(Math.max(...flying.map((s) => s.apart)), "the Follower off its Lead, px").toBeLessThan(0.5)
    expect(seen[0]!.lead, "the Lead fades in from 0").toBeLessThan(0.6)
    expect(seen.some((s) => s.follower > 0.05 && s.follower < 0.95), "the Follower fades out").toBe(true)
    expect(seen.filter((s) => s.moving > 0.5).every((s) => !s.done), "no onDone while the handover runs").toBe(true)
    expect(seen.at(-1)).toMatchObject({ done: true, lead: 1 })
    expect(Number(big.style.opacity), "and hidden at its end").toBe(0)
    e.dispose()
  })

  it("HB2: it declines a wrapper with no twin inside, a twin with no other twin, and a twin leaver itself", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    // No twin inside: a layout node only.
    const plainWrap = makeBox(root, 0, 0, 100, 100)
    const plain = register(e, "plain", makeBox(plainWrap, 10, 10, 20, 20))
    // A twin with no other twin.
    const loneWrap = makeBox(root, 200, 0, 100, 100)
    const lone = register(e, "lone", makeBox(loneWrap, 10, 10, 20, 20), { layoutId: "lone" })
    await endOfTask()
    fireFrame()
    expect((await close(e, plainWrap, [plain])).drop, "no twin inside").toBeUndefined()
    expect((await close(e, loneWrap, [lone])).drop, "a twin with no other twin").toBeUndefined()

    // A twin leaver itself is handleLeave's.
    const { big, handle } = await opened(e)
    const declined = await close(e, big, [handle])
    expect(declined.drop, "a twin leaver").toBeUndefined()
    e.dispose()
  })

  it("HB3: the wrapper's exit scales and moves it, from its registered values: the Follower stays on its Lead", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { thumb, wrap, big, handle } = await opened(e)
    await close(e, wrap, [handle])
    // What presence does as it drives the wrapper's exit: the values it draws, registered, and written.
    const values: Record<string, unknown> = {}
    e.system.registerValues(wrap, () => values)
    // Each frame: the wrapper drawn at its next exit values, then the frame that derives from them.
    const apartEach: Array<number> = []
    for (let i = 1; i <= 40; i++) {
      values.scale = 1 - 0.006 * i
      values.y = 2 * i
      wrap.style.transform = `translateY(${values.y}px) scale(${values.scale})`
      fireFrame()
      if (Number(big.style.opacity || "1") > 0.01) apartEach.push(apart(drawnOf(big), paintedOf(sk, "thumb", thumb)))
    }
    expect(apartEach.length, "frames the Follower shows").toBeGreaterThan(5)
    expect(Math.max(...apartEach), "the Follower off its Lead while the wrapper scales and moves, px").toBeLessThan(0.5)
    e.dispose()
  })

  it("HB4: the returned call drops the handed-back twin at once: no write after it, no onDone, and its other twin goes on", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const { thumb, wrap, big, handle } = await opened(e)
    const closed = await close(e, wrap, [handle])
    frames(6, () => undefined)
    closed.drop?.()
    const last = { transform: big.style.transform, opacity: big.style.opacity }
    frames(120, () => undefined)
    expect({ transform: big.style.transform, opacity: big.style.opacity }, "no write after the drop").toEqual(last)
    expect(closed.done, "no onDone").toBe(false)
    expect(apart(paintedOf(sk, "thumb", thumb), drawnOf(thumb)), "its other twin landed, px").toBeLessThan(0.5)
    expect(factor(sk, "thumb")).toBe(1)
    // Out of the engine: the next pass holds the thumbnail alone.
    e.system.notify()
    await endOfTask()
    expect(e.spans.at(-1)?.nodes, "the nodes the engine holds").toBe(1)
    e.dispose()
  })

  it("HB5: a layout node the twin carries comes back with it; a plain one elsewhere in the wrapper doesn't", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const held: { badge?: HTMLElement; note?: HTMLElement; handles: Array<ProjectionSystem.NodeHandle> } = { handles: [] }
    const { wrap, big, handle } = await opened(e, (w, b) => {
      held.badge = makeBox(b, 10, 100, 40, 12)
      held.note = makeBox(w, 10, 200, 80, 20)
      held.handles.push(register(e, "badge", held.badge), register(e, "note", held.note))
    })
    const badge = held.badge!
    const note = held.note!
    await close(e, wrap, [...held.handles, handle])
    const seen = frames(20, () => {
      const r = drawnOf(badge)
      const b = drawnOf(big)
      return { w: r.x.max - r.x.min, dx: r.x.min - b.x.min, bigW: b.x.max - b.x.min, badge: badge.style.transform, note: note.style.transform }
    })
    expect(seen.at(-1)!.bigW, "the twin is locked onto the shrinking thumbnail").toBeLessThan(150)
    expect(new Set(seen.map((s) => s.badge)).size, "the badge is written each frame").toBeGreaterThan(5)
    for (const [i, s] of seen.entries()) {
      expect(s.w, `frame ${i}: the badge keeps its width`).toBeCloseTo(40, 1)
      expect(s.dx, `frame ${i}: and its offset in the twin`).toBeCloseTo(10, 1)
    }
    expect(seen.every((s) => s.note === ""), "the plain layout node isn't brought back").toBe(true)
    // Nor held: once the handover ends, the engine holds the thumbnail alone.
    frames(120, () => undefined)
    e.system.notify()
    await endOfTask()
    expect(e.spans.at(-1)?.nodes, "the nodes the engine holds").toBe(1)
    e.dispose()
  })
})
