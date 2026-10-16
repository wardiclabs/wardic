// The layout nodes a Follower carries stay corrected for its lock (#169, ADR-0010 *Amendment
// (#169)*), checked against a fake ProjectionSink with every Refresh frame fired by hand
// (`projection-harness.ts`).
//
// - XC1: a live Follower (a card locked onto its growing modal) re-derives its layout child each
//   frame: the child keeps its own size and rides the card at its own offset. Before #169 the
//   child was never written while the card was locked on, so the card's lock stretched it.
// - XC2: a leaving container (a modal presence closes) brings its layout child back with it: the
//   child is written each frame, keeps its size, and goes with the container, out of the engine
//   too. Before #169 its node was disposed with the modal and nothing brought it back.
// - XC3: a window resize mid-handover finishes it at once: the Follower's child is written at
//   rest with it, so it doesn't keep a mid-flight correction for the card's final lock.
// - XC4: a carried child keeps its `layoutAnchor` (ADR-0013): one anchored bottom-right rides the
//   leaving container's bottom-right corner.
//
// A node's painted box is its box through every projection, root-first, as CSS composes them: for
// the gate-driven nodes from the fake sink's writes, and for leaving ones (committed straight to
// the page) from the page itself.
import { describe, expect, it } from "@effect/vitest"
import * as Projection from "@wardic/core/Projection"
import { afterEach, beforeEach, vi } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

/** An element's box as the page lays it out (the fake sink paints nothing). */
const layoutOf = (e: Element) => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

/** `id`'s delta as last written, the identity before any. */
const deltaOf = (sk: Sink, id: string): Projection.Delta =>
  (sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined) ?? { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

describe("a Follower's layout nodes stay corrected for its lock (#169)", () => {
  it("XC1: a live Follower's layout child keeps its size and rides it, frame by frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const card = makeBox(root, 12, 36, 72, 56)
    register(e, "card", card, { layoutId: "card" })
    const badge = makeBox(card, 6, 40, 30, 10)
    register(e, "badge", badge)
    await endOfTask()
    fireFrame()
    register(e, "modal", makeBox(root, 200, 12, 100, 112), { layoutId: "card" })
    await endOfTask()
    const seen = frames(20, () => {
      const cardPainted = Projection.applyTreeDeltas(layoutOf(card), [deltaOf(sk, "card")]).box
      const badgePainted = Projection.applyTreeDeltas(layoutOf(badge), [deltaOf(sk, "card"), deltaOf(sk, "badge")]).box
      return {
        w: badgePainted.x.max - badgePainted.x.min,
        h: badgePainted.y.max - badgePainted.y.min,
        dx: badgePainted.x.min - cardPainted.x.min,
        dy: badgePainted.y.min - cardPainted.y.min,
        cardW: cardPainted.x.max - cardPainted.x.min,
      }
    })
    expect(seen.at(-1)!.cardW, "the card is locked onto the growing modal").toBeGreaterThan(90)
    for (const [i, s] of seen.entries()) {
      expect(s.w, `frame ${i}: width`).toBeCloseTo(30, 1)
      expect(s.h, `frame ${i}: height`).toBeCloseTo(10, 1)
      expect(s.dx, `frame ${i}: its offset in the card`).toBeCloseTo(6, 1)
      expect(s.dy, `frame ${i}: its offset in the card`).toBeCloseTo(40, 1)
    }
    e.dispose()
  })

  it("XC2: a leaving container brings its layout child back: written each frame, its size kept, gone with it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "card", makeBox(root, 12, 36, 72, 56), { layoutId: "card" })
    await endOfTask()
    fireFrame()
    const modal = makeBox(root, 200, 12, 100, 112)
    const m = register(e, "modal", modal, { layoutId: "card" })
    const badge = makeBox(modal, 10, 90, 30, 10)
    const b = register(e, "badge", badge)
    await endOfTask()
    frames(120, () => undefined)
    // Presence closes the modal: Solid disposes the badge's node, then the modal's; presence hands
    // the modal back.
    let done = false
    queueMicrotask(() => {
      e.system.handleLeave(modal, () => (done = true))
    })
    b.dispose()
    m.dispose()
    await endOfTask()
    const seen = frames(20, () => {
      const r = badge.getBoundingClientRect()
      const q = modal.getBoundingClientRect()
      return { w: r.width, h: r.height, dx: r.left - q.left, dy: r.top - q.top, modalW: q.width, t: badge.style.transform }
    })
    expect(seen.at(-1)!.modalW, "the modal is locked onto the shrinking card").toBeLessThan(85)
    for (const [i, s] of seen.entries()) {
      expect(s.w, `frame ${i}: width`).toBeCloseTo(30, 1)
      expect(s.h, `frame ${i}: height`).toBeCloseTo(10, 1)
      expect(s.dx, `frame ${i}: its offset in the modal`).toBeCloseTo(10, 1)
      expect(s.dy, `frame ${i}: its offset in the modal`).toBeCloseTo(90, 1)
    }
    frames(120, () => undefined)
    expect(done, "the modal is done").toBe(true)
    // Gone with it: no longer driven, its last write kept for the frame presence removes it in.
    const last = badge.style.transform
    frames(10, () => undefined)
    expect(badge.style.transform).toBe(last)
    // And out of the engine: the next pass holds the card alone.
    e.system.notify()
    await endOfTask()
    expect(e.spans.at(-1)?.nodes, "the nodes the engine holds").toBe(1)
    e.dispose()
  })

  it("XC3: a resize mid-handover finishes it, and the Follower's child rests corrected for the card's final lock", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const card = makeBox(root, 12, 36, 72, 56)
    register(e, "card", card, { layoutId: "card" })
    const badge = makeBox(card, 6, 40, 30, 10)
    register(e, "badge", badge)
    await endOfTask()
    fireFrame()
    register(e, "modal", makeBox(root, 200, 12, 100, 112), { layoutId: "card" })
    await endOfTask()
    frames(4, () => undefined)
    vi.stubGlobal("innerWidth", window.innerWidth - 200)
    window.dispatchEvent(new Event("resize"))
    const cardPainted = Projection.applyTreeDeltas(layoutOf(card), [deltaOf(sk, "card")]).box
    expect(cardPainted.x.max - cardPainted.x.min, "the card locked onto the modal at rest").toBeCloseTo(100, 1)
    const at = frames(3, () => Projection.applyTreeDeltas(layoutOf(badge), [deltaOf(sk, "card"), deltaOf(sk, "badge")]).box)
    for (const [i, b] of at.entries()) {
      expect(b.x.max - b.x.min, `frame ${i}: width`).toBeCloseTo(30, 1)
      expect(b.y.max - b.y.min, `frame ${i}: height`).toBeCloseTo(10, 1)
      expect(b.x.min - cardPainted.x.min, `frame ${i}: its offset in the card`).toBeCloseTo(6, 1)
      expect(b.y.min - cardPainted.y.min, `frame ${i}: its offset in the card`).toBeCloseTo(40, 1)
    }
    e.dispose()
  })

  it("XC4: a carried child keeps its layoutAnchor: anchored bottom-right, it rides the leaving container's corner", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "card", makeBox(root, 12, 36, 72, 56), { layoutId: "card" })
    await endOfTask()
    fireFrame()
    const modal = makeBox(root, 200, 12, 100, 112)
    const m = register(e, "modal", modal, { layoutId: "card" })
    const badge = makeBox(modal, 10, 90, 30, 10)
    const b = register(e, "badge", badge, { layoutAnchor: { x: 1, y: 1 } })
    await endOfTask()
    frames(120, () => undefined)
    queueMicrotask(() => {
      e.system.handleLeave(modal, () => undefined)
    })
    b.dispose()
    m.dispose()
    await endOfTask()
    const seen = frames(20, () => {
      const r = badge.getBoundingClientRect()
      const q = modal.getBoundingClientRect()
      return { right: q.right - r.right, bottom: q.bottom - r.bottom, modalW: q.width }
    })
    expect(seen.at(-1)!.modalW, "the modal is locked onto the shrinking card").toBeLessThan(85)
    // 100 − (10 + 30) and 112 − (90 + 10) from the modal's corner, every frame.
    for (const [i, s] of seen.entries()) {
      expect(s.right, `frame ${i}: from the modal's right`).toBeCloseTo(60, 1)
      expect(s.bottom, `frame ${i}: from the modal's bottom`).toBeCloseTo(12, 1)
    }
    e.dispose()
  })
})
