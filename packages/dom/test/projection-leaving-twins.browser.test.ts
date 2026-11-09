// A Lead that leaves hands over only to a twin that isn't leaving (#682, ADR-0010 *Amendment (#682)*,
// Motion's `NodeStack.relegate`). Checked against a fake ProjectionSink with every Refresh frame fired
// by hand (`projection-harness.ts`).
//
// - LW1: a Lead disposed while its only other twin is leaving: nothing takes over. The leaving twin
//   isn't flown home from the Lead's box; its handover ends at once (`onDone`), so its page can go.
//   Before #682 it was promoted, and flew from the Lead's box home (the catalogue's photo flying back).
// - LW2: a Lead disposed with a twin below it that isn't leaving: that one takes over and flies from
//   the Lead's box, as before; a leaving twin above it in the stack doesn't.
// - LW3: presence closing a Lead (`handleLeave`) whose only other twin is leaving: it declines, so
//   presence runs the Lead's own exit, and the Lead goes on flying meanwhile, as Motion's relegate
//   leaves it the Lead.
// - LW4: a Lead disposed with a leaving twin above a present one: the present one takes over, from
//   the Lead's box, and becomes the stack's top; the leaving one rides it, its handover going on.
//
// A leaving node's writes go straight to the page, so its drawn box is read from the page.
import { describe, expect, it } from "@effect/vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Option from "effect/Option"
import { afterEach, beforeEach } from "vitest"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Engine = ReturnType<typeof makeEngine>

const LINEAR = () => Option.some({ type: "tween" as const, duration: 0.5, ease: "linear" as const })

const register = (e: Engine, id: string, element: HTMLElement, layoutId: string): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: LINEAR, layoutId })

const makeBox = (parent: HTMLElement, left: number, top: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:100px;height:80px`)

/** An element's box as the page draws it. */
const drawn = (element: HTMLElement): { readonly left: number; readonly top: number } => {
  const r = element.getBoundingClientRect()
  return { left: r.left, top: r.top }
}

/** `n` frames fired. */
const fire = (n: number): void => {
  for (let i = 0; i < n; i++) fireFrame()
}

/**
 * Two twins of `photo`: `a`, then `b`, the Lead, flying from `a`'s box, 10 frames in. With `aLeaves`,
 * presence closes `a` (a Follower riding `b`), as a page leaving under `popLayout` does.
 */
const setUp = async (aLeaves: boolean) => {
  const sk = makeSink()
  const e = makeEngine(sk.sink)
  const root = stage()
  const aEl = makeBox(root, 40, 60)
  const a = register(e, "a", aEl, "photo")
  await endOfTask()
  fireFrame()
  const bEl = makeBox(root, 300, 200)
  const b = register(e, "b", bEl, "photo")
  await endOfTask()
  fire(10)
  let aDone = false
  if (aLeaves) expect(e.system.handleLeave(aEl, () => (aDone = true)), "a leaves riding b").toBe(true)
  await endOfTask()
  return { sk, e, a, aEl, b, bEl, done: () => aDone }
}

describe("a Lead that leaves hands over only to a twin that isn't leaving (#682)", () => {
  it("LW1: a Lead disposed while its only other twin is leaving: nothing takes over, and the leaver's handover ends", async () => {
    const t = await setUp(true)
    const before = drawn(t.aEl)
    t.b.dispose() // its page leaves too: Solid disposes it before its presence asks
    await endOfTask()
    fire(10)
    const after = drawn(t.aEl)
    expect(Math.abs(after.left - before.left), "a isn't flown home from b's box").toBeLessThan(0.5)
    expect(Math.abs(after.top - before.top)).toBeLessThan(0.5)
    expect(t.done(), "a's handover ends at once, so its page can go").toBe(true)
    t.e.dispose()
  })

  it("LW2: a Lead disposed with a twin below that isn't leaving: that one takes over and flies from the Lead's box", async () => {
    const t = await setUp(false)
    const writes = t.sk.of("a").length
    t.b.dispose()
    await endOfTask()
    fire(3)
    const moves = t.sk.of("a").slice(writes)
    expect(moves.length, "a is written again: it took over").toBeGreaterThan(0)
    // Promoted from where b is drawn, a third of the way to its own box (about 87 px from a's): on its way home.
    expect(moves[0]!.tx, "from b's drawn box").toBeGreaterThan(50)
    expect(moves.at(-1)!.tx, "on its way home").toBeLessThan(moves[0]!.tx)
    t.e.dispose()
  })

  it("LW3: presence closing a Lead whose only other twin is leaving: it declines, and the Lead flies on", async () => {
    const t = await setUp(true)
    expect(t.e.system.handleLeave(t.bEl, () => undefined), "nothing to hand over to: presence runs b's own exit").toBe(false)
    const writes = t.sk.of("b").length
    fire(3)
    const moves = t.sk.of("b").slice(writes)
    expect(moves.length, "b goes on flying").toBe(3)
    expect(Math.abs(moves.at(-1)!.tx), "toward its own box").toBeLessThan(Math.abs(moves[0]!.tx))
    expect(t.done(), "a still rides it").toBe(false)
    t.e.dispose()
  })
  it("LW4: a Lead disposed with a leaving twin above a present one: the present one takes over; the leaver rides it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "a", makeBox(root, 40, 60), "photo")
    await endOfTask()
    fireFrame()
    const cEl = makeBox(root, 40, 300)
    register(e, "c", cEl, "photo")
    await endOfTask()
    fire(5)
    const b = register(e, "b", makeBox(root, 300, 200), "photo")
    await endOfTask()
    fire(5)
    let cDone = false
    expect(e.system.handleLeave(cEl, () => (cDone = true)), "c leaves riding b").toBe(true)
    await endOfTask()
    const writes = sk.of("a").length
    b.dispose()
    await endOfTask()
    fire(3)
    const moves = sk.of("a").slice(writes)
    expect(moves.length, "a, the one present, takes over").toBeGreaterThan(0)
    // b is drawn a sixth of the way from c's box, about 43 px right of a's.
    expect(moves[0]!.tx, "from b's drawn box").toBeGreaterThan(20)
    expect(moves.at(-1)!.tx, "on its way home").toBeLessThan(moves[0]!.tx)
    expect(cDone, "c rides a: its handover goes on").toBe(false)
    fire(40)
    expect(cDone, "and ends with a's").toBe(true)
    e.dispose()
  })
})
