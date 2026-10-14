// A layout node's release as a Release offset on top of its layout animation (ADR-0016,
// *Amendment (velocity family)*: #28, #30, #34, #38), checked against a fake ProjectionSink
// with every Refresh frame fired by hand.
//
// The release is the drag target's distance from where the layout puts the node, springing
// to zero per axis on the node's transition, from the drag's velocity. A slot move during it
// starts a layout animation under it and leaves its motion alone. A grab leaves a running
// layout animation running, and stops a release where it is. Only a shared-element handover
// crossfades.
//
// Nothing here is painted: a node paints at its box plus its last write's translate, and a
// child at its box plus its parent's and its own (every parent here moves by translation only).
// Deterministic: requestAnimationFrame is stubbed before the runtime builds, so the test fires
// Refresh frames by hand; ResizeObserver is stubbed to a no-op, so every Measure pass here
// comes from `notify`.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type { ProjectionNodeHandle, RegisterNodeOptions } from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

/** `id`'s translate as last written ({0,0} before any). */
const t = (sk: Sink, id: string): { readonly x: number; readonly y: number } => {
  const w = sk.of(id).at(-1)
  return { x: w?.tx ?? 0, y: w?.ty ?? 0 }
}

/** A write's crossfade factor, when it carries one. */
const opacityOf = (w: Sink["writes"][number]): number | undefined => w.value.opacity as number | undefined

/** An absolutely positioned box in `parent`. */
const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

/** Where a top-level node paints: its layout position plus its last translate. */
const painted = (box: HTMLElement, sk: Sink, id: string): { x: number; y: number } => {
  const at = t(sk, id)
  return { x: box.offsetLeft + at.x, y: box.offsetTop + at.y }
}

/** `n` frames, each followed by `read`, collected. */
const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

const steps = (xs: ReadonlyArray<number>): Array<number> => xs.slice(1).map((x, k) => x - xs[k]!)

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

describe("a layout node's release is a Release offset on its layout animation (ADR-0016, Amendment (velocity family))", () => {
  it("RL1: a release with no velocity paints a FLIP's curve and settles on the same frame (guard)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 0, 0, 100, 50)
    const bEl = makeBox(root, 80, 100, 100, 50)
    const a = register(e, "a", aEl)
    const b = register(e, "b", bEl)
    await endOfTask()
    fireFrame()
    a.dragStart()
    a.dragMove({ x: 80, y: 0 })
    fireFrame()
    // In one task: A released 80 px right of its slot, B moved 80 px left of where it paints.
    a.dragEnd()
    bEl.style.left = "0px"
    b.notify()
    await endOfTask()
    const run = frames(90, () => [t(sk, "a").x, t(sk, "b").x] as const)
    const as = run.map(([x]) => x)
    const bs = run.map(([, x]) => x)
    expect(as[0]).toBeLessThan(80)
    as.forEach((x, k) => expect(x, `frame ${k}`).toBeCloseTo(bs[k]!, 6))
    const settledAt = (id: string) => sk.writes.map((w) => w.id).lastIndexOf(id)
    const aLast = sk.writes[settledAt("a")]!
    const bLast = sk.writes[settledAt("b")]!
    expect(aLast.tx).toBe(0)
    expect(bLast.tx).toBe(0)
    // Settled on the same frame: their last writes are adjacent in the log.
    expect(Math.abs(settledAt("a") - settledAt("b"))).toBe(1)
    e.dispose()
  })

  it("RL2: a slot move mid-release starts a layout animation under it, and the release keeps its speed (#28)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 100, 50)
    const d = register(e, "d", dEl)
    await endOfTask()
    fireFrame()
    d.dragStart()
    d.dragMove({ x: -100, y: 0 })
    fireFrame()
    d.dragEnd()
    await endOfTask()
    const before = frames(5, () => painted(dEl, sk, "d").x)
    // The slot moves 60 px right, the way the release is going.
    dEl.style.left = "60px"
    d.notify()
    await endOfTask()
    const atPass = painted(dEl, sk, "d").x
    expect(atPass, "the pass paints it where it was").toBeCloseTo(before.at(-1)!, 6)
    const after = frames(5, () => painted(dEl, sk, "d").x)
    const lastBefore = steps(before).at(-1)!
    const firstAfter = after[0]! - atPass
    expect(lastBefore).toBeGreaterThan(4)
    expect(firstAfter, `a step of ${firstAfter} after one of ${lastBefore}: no stall`).toBeGreaterThan(0.85 * lastBefore)
    frames(120, () => undefined)
    expect(painted(dEl, sk, "d").x, "ends on its new slot").toBeCloseTo(60, 6)
    e.dispose()
  })

  it("RL3: a resting child stays on its released parent through a slot move (#28's glued child)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 0, 0, 200, 120)
    const cEl = makeBox(pEl, 20, 20, 40, 40)
    const p = register(e, "p", pEl)
    register(e, "c", cEl)
    await endOfTask()
    fireFrame()
    const offset = (): { x: number; y: number } => {
      const ct = t(sk, "c")
      return { x: cEl.offsetLeft + ct.x, y: cEl.offsetTop + ct.y }
    }
    p.dragStart()
    p.dragMove({ x: 100, y: 30 })
    fireFrame()
    p.dragEnd()
    await endOfTask()
    const seen = frames(4, offset)
    pEl.style.top = "60px"
    p.notify()
    await endOfTask()
    seen.push(offset())
    seen.push(...frames(90, offset))
    // The child's own translate, on top of its parent's, keeps it at 20,20 inside it.
    seen.forEach((o, k) => {
      expect(Math.abs(o.x - 20), `frame ${k}: x ${o.x}`).toBeLessThan(0.01)
      expect(Math.abs(o.y - 20), `frame ${k}: y ${o.y}`).toBeLessThan(0.01)
    })
    e.dispose()
  })

  it("RL4: a running child keeps its line as its released parent comes to rest (#38)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const pEl = makeBox(root, 60, 60, 160, 120)
    const mEl = makeBox(pEl, 10, 40, 30, 30)
    const p = register(e, "p", pEl)
    const m = register(e, "m", mEl, { transition: () => ({ type: "spring", stiffness: 40, damping: 15 }) })
    await endOfTask()
    fireFrame()
    // M starts a slow FLIP across P on x, then P is dragged on y while it runs.
    mEl.style.left = "110px"
    m.notify()
    await endOfTask()
    fireFrame()
    fireFrame()
    p.dragStart()
    p.dragMove({ x: 0, y: 30 })
    frames(3, () => undefined)
    p.dragEnd()
    await endOfTask()
    // M's offset from P on y: it never moves on y, inside P or with it.
    const rel = frames(150, () => mEl.offsetTop + t(sk, "m").y)
    const worst = Math.max(...rel.map((y) => Math.abs(y - 40)))
    expect(worst, `M strays ${worst} px off its line in P`).toBeLessThan(0.01)
    e.dispose()
  })

  it("RL5: a grab leaves a running layout animation running under the drag, with no jump (#30)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 100, 50)
    const d = register(e, "d", dEl)
    await endOfTask()
    fireFrame()
    dEl.style.left = "100px"
    d.notify()
    await endOfTask()
    const flying = frames(6, () => painted(dEl, sk, "d").x)
    const atGrab = flying.at(-1)!
    expect(atGrab).toBeGreaterThan(10)
    expect(atGrab).toBeLessThan(90)
    d.dragStart()
    expect(painted(dEl, sk, "d").x, "no jump at the grab").toBeCloseTo(atGrab, 6)
    d.dragMove({ x: 0, y: 0 })
    const under = frames(4, () => painted(dEl, sk, "d").x)
    expect(under[0], "the flight goes on under the drag").toBeGreaterThan(atGrab + 1)
    d.dragMove({ x: 0, y: 20 })
    frames(120, () => undefined)
    expect(painted(dEl, sk, "d"), "it lands on its slot, moved by the pointer").toEqual({ x: 100, y: 20 })
    d.dragEnd()
    await endOfTask()
    frames(120, () => undefined)
    expect(painted(dEl, sk, "d")).toEqual({ x: 100, y: 0 })
    e.dispose()
  })

  it("RL6: a release from a flight the grab left running, after a slot move mid-drag, keeps the flight's speed", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 100, 50)
    const d = register(e, "d", dEl)
    await endOfTask()
    fireFrame()
    dEl.style.left = "100px"
    d.notify()
    await endOfTask()
    frames(5, () => undefined)
    d.dragStart()
    d.dragMove({ x: 30, y: 0 })
    fireFrame()
    // The slot moves mid-drag: drag-blocked, the flight keeps its course to the grab's slot.
    const beforePass = painted(dEl, sk, "d").x
    dEl.style.left = "160px"
    d.notify()
    await endOfTask()
    expect(painted(dEl, sk, "d").x, "the drag-blocked pass moves nothing").toBeCloseTo(beforePass, 6)
    const [prev, atRelease] = frames(2, () => painted(dEl, sk, "d").x)
    d.dragEnd()
    expect(painted(dEl, sk, "d").x, "no jump at the release").toBeCloseTo(atRelease!, 6)
    fireFrame()
    const next = painted(dEl, sk, "d").x
    // The flight goes on toward the new slot at the speed it had: moved with the anchor's
    // distance to the slot, not stretched over it.
    const before = atRelease! - prev!
    const after = next - atRelease!
    expect(before).toBeGreaterThan(3)
    expect(Math.abs(after - before), `a step of ${after} after one of ${before}`).toBeLessThan(1.5)
    frames(150, () => undefined)
    expect(painted(dEl, sk, "d").x, "ends on the latest slot").toBeCloseTo(160, 6)
    e.dispose()
  })

  it("RL7: a grab stops a release where it is; a press with no drag starts it again from rest, and a drag continues from there", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 100, 50)
    const d = register(e, "d", dEl)
    await endOfTask()
    fireFrame()
    d.dragStart()
    d.dragMove({ x: 80, y: 0 })
    fireFrame()
    d.dragEnd()
    await endOfTask()
    frames(4, () => undefined)
    d.stopRelease()
    const stopped = painted(dEl, sk, "d").x
    expect(stopped).toBeGreaterThan(20)
    expect(frames(5, () => painted(dEl, sk, "d").x).every((x) => x === stopped), "it holds while pressed").toBe(true)
    d.resumeRelease()
    const resumed = frames(3, () => painted(dEl, sk, "d").x)
    // From rest: the first step is smaller than the next.
    expect(resumed[0]).toBeLessThan(stopped)
    expect(stopped - resumed[0]!).toBeLessThan(resumed[0]! - resumed[1]!)
    // A second grab, and this time a drag: it starts where the release stopped.
    d.stopRelease()
    const held = painted(dEl, sk, "d").x
    d.dragStart()
    d.dragMove({ x: 10, y: 0 })
    expect(painted(dEl, sk, "d").x).toBeCloseTo(held + 10, 6)
    expect(d.dragOffset().x, "the handle's drag offset counts from the slot").toBeCloseTo(held + 10, 6)
    d.dragEnd()
    await endOfTask()
    frames(150, () => undefined)
    expect(painted(dEl, sk, "d").x).toBe(0)
    e.dispose()
  })

  it("RL8: a release starts at the drag's velocity, per axis", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 0, 0, 100, 50)
    const bEl = makeBox(root, 0, 100, 100, 50)
    const a = register(e, "a", aEl)
    const b = register(e, "b", bEl)
    await endOfTask()
    fireFrame()
    for (const h of [a, b]) {
      h.dragStart()
      h.dragMove({ x: 50, y: 0 })
    }
    fireFrame()
    // A is flicked away from its slot at 1,000 px/s; B is let go at rest.
    a.dragEnd({ x: 1000, y: 0 })
    b.dragEnd()
    await endOfTask()
    const run = frames(4, () => [painted(aEl, sk, "a"), painted(bEl, sk, "b")] as const)
    expect(run[0]![0].x, "A carries on away from its slot").toBeGreaterThan(50)
    expect(run[0]![1].x, "B heads straight back").toBeLessThan(50)
    expect(run.every(([pa]) => pa.y === 0), "no velocity, no offset: y stays").toBe(true)
    frames(150, () => undefined)
    expect(painted(aEl, sk, "a").x).toBe(0)
    e.dispose()
  })

  it("RL9: a released layoutId Lead with a Follower keeps opacity 1/0 (#34)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const l = register(e, "l", makeBox(root, 240, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    frames(120, () => undefined) // the mount's crossfade settles
    const from = sk.writes.length
    l.dragStart()
    l.dragMove({ x: 100, y: 30 })
    fireFrame()
    l.dragEnd()
    await endOfTask()
    frames(90, () => undefined)
    const after = sk.writes.slice(from)
    expect(after.filter((w) => w.id === "l").length).toBeGreaterThan(10)
    after.forEach((w) => {
      if (w.id === "l") expect(opacityOf(w), "the Lead").toBe(1)
      if (w.id === "f") expect(opacityOf(w), "the Follower").toBe(0)
    })
    e.dispose()
  })

  it("RL10: a Lead with Followers that moves for a layout change keeps 1/0: only a handover crossfades (#34)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const lEl = makeBox(root, 240, 60, 100, 80)
    const l = register(e, "l", lEl, { layoutId: "twin" })
    await endOfTask()
    frames(120, () => undefined)
    const from = sk.writes.length
    lEl.style.left = "400px"
    l.notify()
    await endOfTask()
    frames(90, () => undefined)
    const moved = sk.writes.slice(from).filter((w) => w.id === "l")
    expect(moved.length).toBeGreaterThan(10)
    expect(moved.every((w) => opacityOf(w) === 1)).toBe(true)
    e.dispose()
  })

  it("RL11: a layout change mid-crossfade continues the crossfade from where it was (#34)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const lEl = makeBox(root, 240, 60, 100, 80)
    const l = register(e, "l", lEl, { layoutId: "twin" })
    await endOfTask()
    // Early, mid fade-in: since #5 the Lead is in by the handover's middle (Motion's circOut).
    frames(2, () => undefined)
    const from = sk.writes.length
    const mid = opacityOf(sk.of("l").at(-1)!)!
    expect(mid).toBeGreaterThan(0.1)
    expect(mid).toBeLessThan(0.9)
    lEl.style.left = "400px"
    l.notify()
    await endOfTask()
    frames(120, () => undefined)
    const lead = sk.writes.slice(from).filter((w) => w.id === "l").map((w) => opacityOf(w)!)
    const follower = sk.writes.slice(from).filter((w) => w.id === "f").map((w) => opacityOf(w)!)
    expect(lead[0], "no drop at the restart").toBeGreaterThanOrEqual(mid - 1e-9)
    lead.slice(1).forEach((o, k) => expect(o, `write ${k + 1}`).toBeGreaterThanOrEqual(lead[k]! - 1e-9))
    expect(lead.at(-1)).toBe(1)
    expect(follower.at(-1)).toBe(0)
    e.dispose()
  })

  it("RL12: a promotion crossfades: a Lead closed under presence fades out as its twin fades in from 0 (#34)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const lEl = makeBox(root, 240, 60, 100, 80)
    register(e, "l", lEl, { layoutId: "twin" })
    await endOfTask()
    frames(120, () => undefined)
    // Presence closes it in a later task, once the mount's crossfade has settled.
    await endOfTask()
    let done = false
    expect(e.system.handleLeave(lEl, () => (done = true))).toBe(true)
    // The coordinator's run, started by the promotion, asks for its first frame by the end of the task.
    await endOfTask()
    frames(2, () => undefined)
    const f = opacityOf(sk.of("f").at(-1)!)!
    expect(f, "the promoted twin fades in").toBeGreaterThan(0.1)
    expect(f).toBeLessThan(0.9)
    // Since #5 the leaver holds until its twin is in, then fades out (Motion's curves).
    expect(Number(lEl.style.opacity), "the leaver holds").toBe(1)
    const leaver = frames(120, () => Number(lEl.style.opacity))
    expect(leaver.some((o) => o > 0 && o < 1), "the leaver fades out").toBe(true)
    expect(done, "the leaver is removed once the crossfade settles").toBe(true)
    e.dispose()
  })

  it("RL13: a Switch fades out a leaver presence re-introduces as its Follower (#34)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const x = register(e, "x", makeBox(root, 0, 300, 50, 50))
    const aEl = makeBox(root, 40, 60, 100, 80)
    const a = register(e, "a", aEl, { layoutId: "t" })
    await endOfTask()
    fireFrame()
    // One task: a pass queued first, presence's handleLeave queued after it, then A's node
    // disposed (its element kept, as presence keeps it) and B mounted, which takes A's seed.
    x.notify()
    let left = false
    let done = false
    queueMicrotask(() => {
      left = e.system.handleLeave(aEl, () => (done = true))
    })
    a.dispose()
    register(e, "b", makeBox(root, 240, 60, 100, 80), { layoutId: "t" })
    await endOfTask()
    expect(left, "A is re-introduced as B's Follower").toBe(true)
    frames(2, () => undefined)
    const b = opacityOf(sk.of("b").at(-1)!)!
    expect(b, "B fades in over its Switch").toBeGreaterThan(0.1)
    expect(b).toBeLessThan(0.9)
    // Since #5, A holds until B is in, then fades out (Motion's curves).
    expect(Number(aEl.style.opacity), "A holds").toBe(1)
    const aOpacity = frames(120, () => Number(aEl.style.opacity))
    expect(aOpacity.some((o) => o > 0 && o < 1), "A fades out").toBe(true)
    expect(done).toBe(true)
    e.dispose()
  })

  it("RL14: released where it was grabbed, mid-flight, the flight goes on with no jump (#30)", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 100, 50)
    const d = register(e, "d", dEl)
    await endOfTask()
    fireFrame()
    dEl.style.left = "100px"
    d.notify()
    await endOfTask()
    const atGrab = frames(5, () => painted(dEl, sk, "d").x).at(-1)!
    d.dragStart()
    d.dragEnd()
    await endOfTask()
    expect(painted(dEl, sk, "d").x, "no jump at the release").toBeCloseTo(atGrab, 6)
    const next = frames(3, () => painted(dEl, sk, "d").x)
    expect(next[0]).toBeGreaterThan(atGrab)
    expect(next[0]).toBeLessThan(90)
    frames(120, () => undefined)
    expect(painted(dEl, sk, "d").x).toBeCloseTo(100, 6)
    e.dispose()
  })

  it("RL15: a settled release leaves nothing behind: a press after it doesn't hold a later layout animation", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 100, 50)
    const d = register(e, "d", dEl)
    await endOfTask()
    fireFrame()
    d.dragStart()
    d.dragMove({ x: 80, y: 0 })
    fireFrame()
    d.dragEnd()
    await endOfTask()
    frames(150, () => undefined)
    // A press that never lets go (no up, no drag), then a layout change.
    d.stopRelease()
    dEl.style.left = "100px"
    d.notify()
    await endOfTask()
    frames(150, () => undefined)
    const count = sk.of("d").length
    frames(10, () => undefined)
    expect(sk.of("d").length, "it settled: nothing written since").toBe(count)
    expect(painted(dEl, sk, "d").x).toBeCloseTo(100, 6)
    e.dispose()
  })

  it("RL16: a re-grab mid-release leaves a resting node inside a layoutRoot inside the item at identity: CSS carries it", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const dEl = makeBox(root, 0, 0, 220, 96)
    const rEl = makeBox(dEl, 120, 10, 80, 60)
    const gEl = makeBox(rEl, 10, 10, 20, 20)
    const d = register(e, "d", dEl)
    register(e, "r", rEl, { layoutRoot: true })
    register(e, "g", gEl)
    await endOfTask()
    fireFrame()
    d.dragStart()
    d.dragMove({ x: 80, y: 30 })
    fireFrame()
    d.dragEnd()
    await endOfTask()
    frames(4, () => undefined)
    // The grab stops the release well off the slot, and the drag starts from there.
    d.stopRelease()
    d.dragStart()
    expect(t(sk, "d").x, "the item is held off its slot").toBeGreaterThan(20)
    // G rides the item through R by CSS; a translate of its own would count the offset twice.
    expect(t(sk, "g"), "G at identity").toEqual({ x: 0, y: 0 })
    d.dragMove({ x: 10, y: 0 })
    d.dragEnd()
    await endOfTask()
    frames(150, () => undefined)
    expect(t(sk, "g")).toEqual({ x: 0, y: 0 })
    e.dispose()
  })
})
