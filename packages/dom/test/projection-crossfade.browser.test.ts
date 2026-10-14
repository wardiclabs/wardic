// A `layoutId` crossfade's opacity, Motion's (#5, ADR-0010 *Amendment (#5)*), checked against a
// fake ProjectionSink with every Refresh frame fired by hand (`projection-harness.ts`).
//
// - XF1: the Lead fades in over the first half of the handover's progress (`circOut`), and its
//   Follower fades out over 0.5–0.95 (linear), frame by frame: both opaque at the middle.
// - XF2, XF2b: an interrupt continues each twin from the factor it had, along its own curve, early
//   (the Lead mid fade-in) and late (the Follower mid fade-out).
// - XF3: a handover that starts while a projection ancestor crossfades only moves: its twins keep
//   their own opacity, and its Follower is hidden when it ends (Motion's
//   `path.some(hasOpacityCrossfade)`), opening and closing.
// - XF4: a handover crossfades even when the twins' boxes are equal, nothing to move (Motion's: any
//   `resumeFrom` animates), a live twin's and a promotion under presence.
// - XF5: a Follower already hidden stays hidden through a later handover, with no flash.
//
// Motion's curves (motion-dom 13.3.0, `projection/animation/mix-values.ts`), copied here as the
// oracle: `easeCrossfadeIn = compress(0, 0.5, circOut)`, `easeCrossfadeOut = compress(0.5, 0.95, linear)`.
// The handover's progress `p` is read from where the Lead paints: an absolute Lead paints at
// `mix(origin, box, p)`.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import * as Projection from "@wardic/core/Projection"
import type { ProjectionNodeHandle, RegisterNodeOptions } from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

/** A write's crossfade factor; 1 when it carries none (the element's own opacity). */
const factorOf = (w: Sink["writes"][number] | undefined): number => {
  const o = w?.value.opacity
  if (typeof o === "number") return o
  return 1
}
/** `id`'s factor as last written. */
const factor = (sk: Sink, id: string): number => factorOf(sk.of(id).at(-1))

/** An absolutely positioned box in `parent`. */
const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

/** Where a top-level node paints on x: its layout position plus its last translate. */
const paintedX = (box: HTMLElement, sk: Sink, id: string): number => box.offsetLeft + (sk.of(id).at(-1)?.tx ?? 0)

/** An element's box as the page paints it. */
const rectBox = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { x: { min: r.left, max: r.right }, y: { min: r.top, max: r.bottom } }
}

/** `id`'s delta as last written. */
const deltaOf = (sk: Sink, id: string): Projection.Delta => sk.of(id).at(-1)!.value.delta as Projection.Delta

/** `n` frames, each followed by `read`, collected. */
const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

/** Motion's `circOut`: `reverseEasing(circIn)`. */
const circOut = (p: number): number => Math.sin(Math.acos(1 - p))
/** Motion's `easeCrossfadeIn`. */
const motionIn = (p: number): number => {
  if (p < 0) return 0
  if (p > 0.5) return 1
  return circOut(p / 0.5)
}
/** Motion's `easeCrossfadeOut`. */
const motionOut = (p: number): number => {
  if (p < 0.5) return 0
  if (p > 0.95) return 1
  return (p - 0.5) / 0.45
}

describe("a layoutId crossfade's opacity is Motion's (#5)", () => {
  it("XF1: frame by frame, the Lead fades in over the first half (circOut) and the Follower out over 0.5–0.95", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const lEl = makeBox(root, 240, 60, 100, 80)
    register(e, "l", lEl, { layoutId: "twin" })
    await endOfTask()
    const seen = frames(90, () => ({ p: (paintedX(lEl, sk, "l") - 40) / 200, lead: factor(sk, "l"), follower: factor(sk, "f") }))
    const running = seen.filter((s) => s.p < 1 - 1e-6)
    expect(running.length, "frames of the handover").toBeGreaterThan(10)
    for (const s of running) {
      expect(s.lead, `the Lead at p ${s.p}`).toBeCloseTo(motionIn(s.p), 9)
      expect(s.follower, `the Follower at p ${s.p}`).toBeCloseTo(1 - motionOut(s.p), 9)
    }
    // Before the Follower moves, the Lead is in; until it's in, the Follower holds: never see-through.
    expect(running.filter((s) => s.p > 0.3 && s.p < 0.5).every((s) => s.lead > 0.9 && s.follower === 1)).toBe(true)
    expect(seen.at(-1)).toMatchObject({ lead: 1, follower: 0 })
    e.dispose()
  })

  it("XF2: an interrupt continues each twin from the factor it had, along its own curve", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const lEl = makeBox(root, 240, 60, 100, 80)
    const l = register(e, "l", lEl, { layoutId: "twin" })
    await endOfTask()
    // Early: the Lead mid fade-in, the Follower held.
    frames(2, () => undefined)
    const lead0 = factor(sk, "l")
    expect(lead0).toBeGreaterThan(0.1)
    expect(lead0).toBeLessThan(0.9)
    expect(factor(sk, "f")).toBe(1)
    lEl.style.left = "400px"
    l.notify()
    await endOfTask()
    const after = frames(120, () => ({ lead: factor(sk, "l"), follower: factor(sk, "f") }))
    expect(after[0]!.lead, "no drop at the restart").toBeGreaterThanOrEqual(lead0 - 1e-9)
    after.slice(1).forEach((s, k) => {
      expect(s.lead, `the Lead, frame ${k + 1}`).toBeGreaterThanOrEqual(after[k]!.lead - 1e-9)
      expect(s.follower, `the Follower, frame ${k + 1}`).toBeLessThanOrEqual(after[k]!.follower + 1e-9)
    })
    expect(after.at(-1)).toEqual({ lead: 1, follower: 0 })
    e.dispose()
  })

  it("XF2b: interrupted late, the Follower mid fade-out goes on from where it was, with no flash back", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const lEl = makeBox(root, 240, 60, 100, 80)
    const l = register(e, "l", lEl, { layoutId: "twin" })
    await endOfTask()
    // Until the Follower is fading out: past the handover's middle.
    for (let i = 0; i < 120 && !(factor(sk, "f") < 0.9 && factor(sk, "f") > 0.1); i++) fireFrame()
    const follower0 = factor(sk, "f")
    expect(follower0).toBeGreaterThan(0.1)
    expect(follower0).toBeLessThan(0.9)
    expect(factor(sk, "l")).toBe(1)
    lEl.style.left = "400px"
    l.notify()
    await endOfTask()
    const after = frames(120, () => ({ lead: factor(sk, "l"), follower: factor(sk, "f") }))
    expect(after.every((s) => s.lead === 1), "the Lead stays in").toBe(true)
    expect(after[0]!.follower, "no flash back at the restart").toBeLessThanOrEqual(follower0 + 1e-9)
    after.slice(1).forEach((s, k) => expect(s.follower, `frame ${k + 1}`).toBeLessThanOrEqual(after[k]!.follower + 1e-9))
    expect(after.at(-1)!.follower).toBe(0)
    e.dispose()
  })

  it("XF3: a handover inside a crossfading ancestor only moves: its twins keep their opacity, its Follower hidden at its end", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    // A card holding an avatar, and later a modal holding its twin avatar.
    const card = makeBox(root, 40, 60, 160, 120)
    register(e, "card", card, { layoutId: "card" })
    register(e, "a1", makeBox(card, 10, 10, 40, 40), { layoutId: "avatar" })
    await endOfTask()
    fireFrame()
    const modal = makeBox(root, 260, 40, 300, 240)
    register(e, "modal", modal, { layoutId: "card" })
    register(e, "a2", makeBox(modal, 20, 20, 60, 60), { layoutId: "avatar" })
    await endOfTask()
    const seen = frames(120, () => ({ modal: factor(sk, "modal"), a2: factor(sk, "a2"), a1: factor(sk, "a1") }))
    expect(seen.some((s) => s.modal > 0.05 && s.modal < 0.95), "the modal crossfades").toBe(true)
    expect(seen.every((s) => s.a2 === 1), "the modal's avatar has no fade of its own").toBe(true)
    // The card's avatar keeps its own opacity inside the fading card until its handover ends, then hides.
    const a1 = sk.of("a1").slice(-seen.length).map(factorOf)
    expect(a1.slice(0, 5).every((o) => o === 1)).toBe(true)
    expect(a1.at(-1)).toBe(0)
    e.dispose()
  })

  it("XF3b: closing, the inner twins are disposed before their container, still only move, and stay locked onto their Leads", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const card = makeBox(root, 40, 60, 160, 120)
    register(e, "card", card, { layoutId: "card" })
    const a1El = makeBox(card, 10, 10, 40, 40)
    register(e, "a1", a1El, { layoutId: "avatar" })
    await endOfTask()
    fireFrame()
    const modal = makeBox(root, 260, 40, 300, 240)
    const m = register(e, "modal", modal, { layoutId: "card" })
    const a2El = makeBox(modal, 20, 20, 60, 60)
    const a2 = register(e, "a2", a2El, { layoutId: "avatar" })
    await endOfTask()
    frames(120, () => undefined)
    // Presence closes the modal: Solid disposes the inner node first, then the container; presence
    // re-introduces both as leaving Followers after.
    let left = 0
    queueMicrotask(() => {
      if (e.system.handleLeave(a2El, () => undefined)) left++
      if (e.system.handleLeave(modal, () => undefined)) left++
    })
    a2.dispose()
    m.dispose()
    await endOfTask()
    expect(left).toBe(2)
    const from = sk.writes.length
    // Where each avatar paints, every frame: the leaving ones are committed to the page itself; the
    // card's avatar, through the fake sink, is its box through the card's delta, then its own.
    const apart = frames(120, () => {
      const a1Painted = Projection.applyTreeDeltas(rectBox(a1El), [deltaOf(sk, "card"), deltaOf(sk, "a1")]).box
      const a2Painted = rectBox(a2El)
      return Math.max(
        Math.abs(a1Painted.x.min - a2Painted.x.min),
        Math.abs(a1Painted.x.max - a2Painted.x.max),
        Math.abs(a1Painted.y.min - a2Painted.y.min),
        Math.abs(a1Painted.y.max - a2Painted.y.max),
      )
    })
    // The inner twin was handed back before its container: derived after it all the same (top-down).
    expect(Math.max(...apart.slice(0, 40)), "the closing avatar off the card's, px").toBeLessThan(0.5)
    const card1 = sk.writes.slice(from).filter((w) => w.id === "card").map(factorOf)
    const a1 = sk.writes.slice(from).filter((w) => w.id === "a1").map(factorOf)
    expect(card1.some((o) => o > 0.05 && o < 0.95), "the card crossfades back in").toBe(true)
    expect(a1.every((o) => o === 1), "the card's avatar, promoted inside it, has no fade of its own").toBe(true)
    e.dispose()
  })

  it("XF4: a handover crossfades even when the twins' boxes are equal: a live twin's, and a promotion under presence", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "f", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const lEl = makeBox(root, 40, 60, 100, 80)
    register(e, "l", lEl, { layoutId: "twin" })
    await endOfTask()
    const seen = frames(120, () => ({ lead: factor(sk, "l"), follower: factor(sk, "f"), tx: sk.of("l").at(-1)?.tx ?? 0 }))
    expect(seen.every((s) => Math.abs(s.tx) < 1e-9), "nothing moves").toBe(true)
    expect(seen[0]!.lead, "the Lead fades in from 0").toBeLessThan(0.6)
    expect(seen.some((s) => s.follower > 0 && s.follower < 1), "the Follower fades out").toBe(true)
    expect(seen.at(-1)).toMatchObject({ lead: 1, follower: 0 })

    // Presence closes the Lead where its twin stands: the twin is promoted in place, and crossfades.
    let done = false
    expect(e.system.handleLeave(lEl, () => (done = true))).toBe(true)
    await endOfTask()
    const back = frames(120, () => ({ twin: factor(sk, "f"), leaver: Number(lEl.style.opacity || "1") }))
    expect(back[0]!.twin, "the promoted twin fades in from 0").toBeLessThan(0.6)
    expect(back.some((s) => s.leaver > 0 && s.leaver < 1), "the leaver fades out").toBe(true)
    expect(done, "and is removed once it has").toBe(true)
    e.dispose()
  })

  it("XF5: a Follower already hidden stays hidden through a later handover, with no flash", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "a", makeBox(root, 40, 60, 100, 80), { layoutId: "trio" })
    await endOfTask()
    fireFrame()
    register(e, "b", makeBox(root, 240, 60, 100, 80), { layoutId: "trio" })
    await endOfTask()
    frames(120, () => undefined)
    expect(factor(sk, "a"), "A hidden behind B").toBe(0)
    const from = sk.writes.length
    register(e, "c", makeBox(root, 440, 60, 100, 80), { layoutId: "trio" })
    await endOfTask()
    frames(120, () => undefined)
    const a = sk.writes.slice(from).filter((w) => w.id === "a").map(factorOf)
    const b = sk.writes.slice(from).filter((w) => w.id === "b").map(factorOf)
    expect(a.length).toBeGreaterThan(10)
    expect(a.every((o) => o === 0), "A never shows").toBe(true)
    expect(b[0], "B, the prior Lead, fades out from 1").toBe(1)
    expect(b.at(-1)).toBe(0)
    e.dispose()
  })
})
