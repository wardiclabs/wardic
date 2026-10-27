// A just-disposed layout node, held until the end of its task (#221: one `Leaver` record a node,
// ADR-0010 *Amendment (#13)*, #169), checked against a fake ProjectionSink with every Refresh frame
// fired by hand (`projection-harness.ts`).
//
// - LV1: a twin that registered first and is still unmeasured when its other twin is disposed, in
//   the same task, takes the leaver's Switch seed straight away: its first frame paints at the
//   leaver's box. (Solid's register-then-dispose test measures the enterer while its twin is still
//   live, so it crossfades instead and never reaches the hand-off.)
// - LV2: a leaver lasts until the end of its task: a `handleLeave` in that task re-introduces it,
//   one a task later finds nothing once it's off the page; still on it, it's found (#402).
// - LV3: a twin inside a re-introduced leaver whose own Lead isn't in a handover is left alone: it
//   doesn't come back as a node the leaver carries, as a plain layout node beside it does (#169).
// - LV4 (#402): past its task, a leaver still on the page (a Solid 2 update holding the page) seeds
//   a twin registering then; once a task ends with it off the page, it's gone.
// - LV5 (#402): off the page a moment within a task (Solid's removal, then its presence putting it
//   back), it still seeds a twin registering in between.
// - LV6 (#402): a twin registering while its leaver's presence child is still leaving, nobody having
//   taken it over, takes over from it late: told to the presence, it starts where the leaver paints,
//   the leaver comes back as its Follower, drawn where it is and fading from its opacity then to 0,
//   and the presence's part ends with the handover.
// - LV7 (#402): its presence removing the child for good ends its records at once: a twin it lets in
//   next (`mode="wait"`) enters in its place.
// - LV8 (#402): a kept leaver doesn't come back over a twin live in its stack: the new twin crossfades
//   from the live one.
// - LV9 (#402): a late take-over whose new twin's first pass is blocked (inside a dragged node) runs no
//   handover: the Follower goes at once, ending the presence's part.
// - LV10 (#407): a leaving presence child's own layout node, no `layoutId`, comes back through
//   `keepLeaving` as a node it carries: under its parent's layout animation it's drawn at its own box,
//   its exit's values (`registerValues`) on the correction, and the returned call ends it.
// - LV11 (#407): a Follower's exit values aren't drawn on its handover: a leaver whose exit moved it,
//   taken over late, is drawn where its Lead is.
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

const drawnOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

const IDENTITY: Projection.Delta = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }

/** A gate-driven top-level node's painted box: its layout box through its last written delta. */
const paintedOf = (sk: Sink, id: string, e: HTMLElement): Rect => {
  const delta = sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined
  return Projection.applyTreeDeltas(drawnOf(e), [delta ?? IDENTITY]).box
}

const apart = (a: Rect, b: Rect): number => Math.max(Math.abs(a.x.min - b.x.min), Math.abs(a.x.max - b.x.max), Math.abs(a.y.min - b.y.min), Math.abs(a.y.max - b.y.max))

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "spring" }), ...opts })

const settle = async (): Promise<void> => {
  await endOfTask()
  for (let i = 0; i < 120; i++) fireFrame()
}

/** Two twins of `layoutId`, a small one and a big one (the Lead), settled. */
const pair = async (e: Engine, layoutId: string) => {
  const root = stage()
  const small = makeBox(root, 20, 300, 60, 40)
  const smallHandle = register(e, "small", small, { layoutId })
  await settle()
  const big = makeBox(root, 300, 100, 200, 150)
  const bigHandle = register(e, "big", big, { layoutId })
  await settle()
  return { root, small, smallHandle, big, bigHandle }
}

describe("a just-disposed layout node, held until the end of its task (#221)", () => {
  it("LV1: a twin registered first and unmeasured takes the leaver's seed straight away: its first frame is at the leaver's box", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    const leaverBox = drawnOf(leaver)
    // In one task, before any Measure pass: the enterer registers, then its twin is disposed.
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    leaverHandle.dispose()
    leaver.remove()
    // The task's Measure pass writes the enterer's progress-0 frame.
    await endOfTask()
    expect(apart(paintedOf(sk, "enterer", enterer), leaverBox), "the first frame at the leaver's box, px").toBeLessThan(1)
    e.dispose()
  })

  it("LV2: a handleLeave in the leaver's task re-introduces it; one a task later finds nothing", async () => {
    const same = makeEngine(makeSink().sink)
    const a = await pair(same, "a")
    a.bigHandle.dispose()
    expect(same.system.handleLeave(a.big, () => {}), "in the same task").toBe(true)
    same.dispose()
    clearStages()

    const later = makeEngine(makeSink().sink)
    const b = await pair(later, "b")
    b.bigHandle.dispose()
    b.big.remove()
    await endOfTask()
    b.root.append(b.big)
    expect(later.system.handleLeave(b.big, () => {}), "a task later, off the page at its end: expired").toBe(false)
    later.dispose()
    clearStages()

    const onPage = makeEngine(makeSink().sink)
    const c = await pair(onPage, "c")
    c.bigHandle.dispose()
    await endOfTask()
    expect(onPage.system.handleLeave(c.big, () => {}), "a task later, still on the page (#402): found").toBe(true)
    onPage.dispose()
  })

  it("LV3: a twin inside a re-introduced leaver, whose Lead isn't in a handover, isn't carried; a plain layout node beside it is", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const thumbA = makeBox(root, 20, 400, 60, 40)
    register(e, "thumbA", thumbA, { layoutId: "a" })
    await settle()
    // The wrapper, A's Lead, holds a twin of "b" (a Follower: its Lead registers after it) and a plain layout node.
    const wrap = makeBox(root, 300, 100, 300, 240)
    const wrapHandle = register(e, "wrap", wrap, { layoutId: "a" })
    const inner = makeBox(wrap, 20, 20, 60, 40)
    const innerHandle = register(e, "inner", inner, { layoutId: "b" })
    const plain = makeBox(wrap, 120, 20, 60, 40)
    const plainHandle = register(e, "plain", plain)
    const thumbB = makeBox(root, 20, 500, 60, 40)
    register(e, "thumbB", thumbB, { layoutId: "b" })
    await settle()
    // Solid disposes the wrapper's contents with it; presence then asks for the wrapper back, in the task.
    let back = false
    queueMicrotask(() => {
      back = e.system.handleLeave(wrap, () => {})
    })
    innerHandle.dispose()
    plainHandle.dispose()
    wrapHandle.dispose()
    await endOfTask()
    expect(back, "the wrapper comes back as A's Follower").toBe(true)
    const innerStyles: Array<string> = []
    const plainStyles: Array<string> = []
    for (let i = 0; i < 30; i++) {
      fireFrame()
      innerStyles.push(inner.style.transform)
      plainStyles.push(plain.style.transform)
    }
    // A node the leaver carries is written every frame (`none` at rest in it); one left alone, never.
    expect(innerStyles.every((t) => t === ""), "the inner twin is never written: its Lead isn't in a handover").toBe(true)
    expect(plainStyles.every((t) => t !== ""), "the plain layout node is carried").toBe(true)
    e.dispose()
  })

  it("LV4: past its task, a leaver still on the page seeds a twin registering then; off the page at a task's end, it's gone (#402)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    const leaverBox = drawnOf(leaver)
    leaverHandle.dispose()
    // A Solid 2 update holds the page as it was: the leaver stays on it, tasks go by.
    await endOfTask()
    await endOfTask()
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    await endOfTask()
    expect(apart(paintedOf(sk, "enterer", enterer), leaverBox), "its first frame at the leaver's box, px").toBeLessThan(1)
    e.dispose()
    clearStages()

    const sk2 = makeSink()
    const gone = makeEngine(sk2.sink)
    const root2 = stage()
    const leaver2 = makeBox(root2, 40, 60, 120, 80)
    const leaver2Handle = register(gone, "leaver", leaver2, { layoutId: "s" })
    await settle()
    leaver2Handle.dispose()
    await endOfTask()
    // Off the page, then a task ends (something reading the leavers ran in it).
    leaver2.remove()
    register(gone, "other", makeBox(root2, 0, 0, 10, 10))
    await endOfTask()
    const enterer2 = makeBox(root2, 400, 300, 120, 80)
    register(gone, "enterer", enterer2, { layoutId: "s" })
    await endOfTask()
    expect(apart(paintedOf(sk2, "enterer", enterer2), drawnOf(enterer2)), "it enters in its place, px").toBeLessThan(1)
    gone.dispose()
  })

  it("LV5: off the page a moment within a task, a kept leaver still seeds a twin registering in between (#402)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    const leaverBox = drawnOf(leaver)
    leaverHandle.dispose()
    await endOfTask()
    // The held update lands: Solid takes the leaver off the page, its twin registers, its presence puts it back.
    leaver.remove()
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    root.append(leaver)
    await endOfTask()
    expect(apart(paintedOf(sk, "enterer", enterer), leaverBox), "its first frame at the leaver's box, px").toBeLessThan(1)
    e.dispose()
  })

  it("LV6: a twin registering while its leaver's presence child is still leaving takes over from it late, the leaver its fading Follower (#402)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    const leaverBox = drawnOf(leaver)
    leaverHandle.dispose()
    // Its presence ran its own exit, nobody to take it over: it's half faded when the twin comes.
    let taken = 0
    let ended = 0
    const forget = e.system.keepLeaving(leaver, () => {
      taken++
      return () => {
        ended++
      }
    })
    leaver.style.opacity = "0.5"
    await endOfTask()
    await endOfTask()
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    expect(taken, "told to the presence").toBe(1)
    await endOfTask()
    expect(apart(paintedOf(sk, "enterer", enterer), leaverBox), "the twin starts where the leaver paints, px").toBeLessThan(1)
    const fades: Array<number> = []
    const offs: Array<number> = []
    for (let i = 0; i < 40; i++) {
      fireFrame()
      fades.push(Number(leaver.style.opacity))
      offs.push(apart(drawnOf(leaver), paintedOf(sk, "enterer", enterer)))
    }
    expect(fades[0], "the leaver fades from where it was").toBeGreaterThan(0.3)
    expect(fades[0]).toBeLessThanOrEqual(0.5)
    expect(Math.min(...fades), "to nothing").toBeLessThan(0.02)
    expect(Math.max(...offs), "drawn where its Lead is, px").toBeLessThan(1.5)
    for (let i = 0; i < 120; i++) fireFrame()
    expect(ended, "the handover's end ends the presence's part").toBe(1)
    forget()
    e.dispose()
  })

  it("LV7: its presence removing the child for good ends its records at once: the twin let in next enters in place (#402)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    leaverHandle.dispose()
    const forget = e.system.keepLeaving(leaver, () => () => {})
    await endOfTask()
    // `mode="wait"`: the exit ends, the presence removes the child and lets the next one in, in one task.
    forget()
    leaver.remove()
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    await endOfTask()
    expect(apart(paintedOf(sk, "enterer", enterer), drawnOf(enterer)), "it enters in its place, px").toBeLessThan(1)
    e.dispose()
  })

  it("LV8: a kept leaver doesn't come back over a twin live in its stack: the new twin crossfades from the live one (#402)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    // A plain child holding a twin, then the twin's live other twin, its Lead, at rest elsewhere.
    const row = makeBox(root, 20, 40, 240, 120)
    const leaver = makeBox(row, 10, 10, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    const live = makeBox(root, 600, 400, 60, 40)
    register(e, "live", live, { layoutId: "s" })
    await settle()
    // The row leaves, nobody taking its twin over at that moment: its presence keeps it.
    leaverHandle.dispose()
    const forget = e.system.keepLeaving(row, () => () => {})
    await endOfTask()
    await endOfTask()
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    await endOfTask()
    expect(apart(paintedOf(sk, "enterer", enterer), drawnOf(live)), "it starts at the live twin, px").toBeLessThan(1)
    forget()
    e.dispose()
  })

  it("LV9: a late take-over whose new twin's first pass is blocked runs no handover: the presence's part ends at once (#402)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    const card = makeBox(root, 300, 300, 200, 200)
    const cardHandle = register(e, "card", card)
    await settle()
    leaverHandle.dispose()
    let ended = 0
    const forget = e.system.keepLeaving(leaver, () => () => {
      ended++
    })
    await endOfTask()
    await endOfTask()
    // The new twin registers inside a node being dragged: its first pass is drag-blocked.
    cardHandle.dragStart()
    const enterer = makeBox(card, 10, 10, 60, 40)
    register(e, "enterer", enterer, { layoutId: "s" })
    await endOfTask()
    fireFrame()
    expect(ended, "no handover runs: the presence's part ends").toBe(1)
    forget()
    e.dispose()
  })

  it("LV10: a leaving child's own layout node comes back through keepLeaving: carried at its own box, its exit's values on the correction, ended by the returned call (#407)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const card = makeBox(root, 20, 40, 200, 160)
    register(e, "card", card)
    const answer = makeBox(card, 0, 60, 120, 60)
    const answerHandle = register(e, "answer", answer)
    await settle()
    const was = drawnOf(answer)
    // The answer leaves and its card shrinks: Solid disposes its node, its presence keeps it, pops it,
    // runs its exit (an `x` here) and tells the projection.
    answerHandle.dispose()
    const forget = e.system.keepLeaving(answer, () => () => {})
    let x = 0
    e.system.registerValues(answer, () => ({ x }))
    card.style.height = "60px"
    e.system.notify()
    await endOfTask()
    // The card is drawn through the fake sink, the answer straight onto the page: its painted box is
    // the page's through the card's last delta.
    const seen = Array.from({ length: 12 }, (_, i) => {
      x = i * 2
      fireFrame()
      const delta = sk.of("card").at(-1)?.value.delta as Projection.Delta
      return { x, scale: delta.y.scale, painted: Projection.applyTreeDeltas(drawnOf(answer), [delta]).box }
    })
    expect(seen[0].scale, "the card shrinking").toBeGreaterThan(1.5)
    for (const [i, s] of seen.entries()) {
      expect(s.painted.y.max - s.painted.y.min, `frame ${i}: its own height`).toBeCloseTo(60, 1)
      expect(s.painted.y.min, `frame ${i}: where it was`).toBeCloseTo(was.y.min, 1)
      expect(s.painted.x.min, `frame ${i}: moved by its exit`).toBeCloseTo(was.x.min + s.x, 1)
    }
    // Its presence removes it for good: the engine no longer draws it.
    forget()
    answer.style.transform = ""
    const cardWrites = sk.of("card").length
    for (let i = 0; i < 5; i++) fireFrame()
    expect(sk.of("card").length, "the card still shrinking").toBeGreaterThan(cardWrites)
    expect(answer.style.transform, "not written once ended").toBe("")
    e.dispose()
  })

  it("LV11: a Follower's exit values aren't drawn on its handover: a leaver whose exit moved it, taken over late, is drawn on its Lead (#407)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaver = makeBox(root, 40, 60, 120, 80)
    const leaverHandle = register(e, "leaver", leaver, { layoutId: "s" })
    await settle()
    leaverHandle.dispose()
    const forget = e.system.keepLeaving(leaver, () => () => {})
    // Its exit moves it 40 px right: what the presence registers as it draws it.
    e.system.registerValues(leaver, () => ({ x: 40 }))
    await endOfTask()
    await endOfTask()
    const enterer = makeBox(root, 400, 300, 120, 80)
    register(e, "enterer", enterer, { layoutId: "s" })
    await endOfTask()
    const offs = Array.from({ length: 20 }, () => {
      fireFrame()
      return apart(drawnOf(leaver), paintedOf(sk, "enterer", enterer))
    })
    expect(Math.max(...offs), "drawn where its Lead is, px").toBeLessThan(1.5)
    forget()
    e.dispose()
  })
})
