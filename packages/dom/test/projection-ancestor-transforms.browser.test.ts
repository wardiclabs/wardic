// A twin's conversions follow Wardic's own ancestor transforms each frame (#137, ADR-0012
// *Amendment (#137)*), checked against a fake ProjectionSink with every Refresh frame fired by hand
// (`projection-harness.ts`). A modal scaling in from 0.8 while a thumbnail's twin crossfades into it:
// before #137 the Follower's lock used the modal's scale as of the pass and drifted up to 31.6px off
// its Lead (a modal that isn't a node), and a `layout` modal's own scale wasn't counted at all, so
// the Lead started 82px off its twin. Motion jumps 80px at the start either way.
//
// - AT1: an ancestor that isn't a node, its registered scale changing each frame: the Follower is
//   drawn on the Lead every frame, with the page scrolled too;
// - AT2: a `layout` ancestor's own scale: the Lead starts on its twin, the Follower on it every frame;
// - AT3: nested ancestors, a translate inside a scale, both changing;
// - AT4, AT5: guards: an ancestor with a rotation, and a transform Wardic doesn't own, are converted
//   as of the pass: what they do after it changes nothing the engine writes. AT4b: the rotated one
//   keeps #136's conversion, through the Lead's bounding box as drawn; AT5b: the one Wardic doesn't
//   own, standing still on a scrolled page, puts the Follower exactly on the Lead.
import { describe, expect, it } from "@effect/vitest"
import type * as Box from "@wardic/core/Box"
import * as Projection from "@wardic/core/Projection"
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

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

/**
 * An element's box as laid out, on the page (the engine's deltas scale about points in the page's
 * frame, so a scrolled page needs its scroll added), with `untransform`'s transform cleared for the read.
 */
const layoutOf = (e: Element, untransform: ReadonlyArray<HTMLElement> = []): Box.Box => {
  const saved = untransform.map((u) => u.style.transform)
  for (const u of untransform) u.style.transform = "none"
  const r = e.getBoundingClientRect()
  untransform.forEach((u, i) => (u.style.transform = saved[i]!))
  return { x: { min: r.left + window.scrollX, max: r.right + window.scrollX }, y: { min: r.top + window.scrollY, max: r.bottom + window.scrollY } }
}
const IDENTITY = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }
const deltaOf = (sk: Sink, id: string): Projection.Delta => (sk.of(id).at(-1)?.value.delta as Projection.Delta | undefined) ?? IDENTITY
const projected = (box: Box.Box, sk: Sink, ids: ReadonlyArray<string>): Box.Box => Projection.applyTreeDeltas(box, ids.map((id) => deltaOf(sk, id))).box

/** `box` scaled `s` and moved `(tx, ty)` about `origin`: a CSS translate-then-scale. */
const transformed = (box: Box.Box, origin: { x: number; y: number }, s: number, tx = 0, ty = 0): Box.Box => ({
  x: { min: origin.x + tx + s * (box.x.min - origin.x), max: origin.x + tx + s * (box.x.max - origin.x) },
  y: { min: origin.y + ty + s * (box.y.min - origin.y), max: origin.y + ty + s * (box.y.max - origin.y) },
})
const centre = (box: Box.Box) => ({ x: (box.x.min + box.x.max) / 2, y: (box.y.min + box.y.max) / 2 })
const apart = (a: Box.Box, b: Box.Box): number =>
  Math.max(Math.abs(a.x.min - b.x.min), Math.abs(a.x.max - b.x.max), Math.abs(a.y.min - b.y.min), Math.abs(a.y.max - b.y.max))

/** The modal's scale on frame `i` of its entrance: 0.8 to 1. */
const scaleAt = (i: number): number => 1 - 0.2 * Math.exp(-i / 6)

describe("a twin's conversions follow Wardic's own ancestor transforms (#137)", () => {
  for (const scroll of [0, 200]) it(`AT1: an ancestor that isn't a node scaling in, the page scrolled ${scroll}px: the Follower is drawn on the Lead every frame`, async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    window.scrollTo(0, scroll)
    const thumb = el(root, "position:absolute;left:20px;top:300px;width:60px;height:40px")
    register(e, "thumb", thumb, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const values: Record<string, unknown> = { scale: 0.8 }
    const modal = el(root, "position:absolute;left:300px;top:100px;width:300px;height:240px;transform:scale(0.8)")
    e.system.registerValues(modal, () => values)
    const big = el(modal, "position:absolute;left:50px;top:40px;width:200px;height:150px")
    register(e, "big", big, { layoutId: "twin" })
    await endOfTask()
    const origin = centre(layoutOf(modal, [modal]))
    const bigLayout = layoutOf(big, [modal])
    for (let i = 1; i <= 40; i++) {
      values.scale = scaleAt(i)
      modal.style.transform = `scale(${values.scale})`
      fireFrame()
      const lead = transformed(projected(bigLayout, sk, ["big"]), origin, values.scale as number)
      const follower = projected(layoutOf(thumb), sk, ["thumb"])
      expect(apart(follower, lead), `frame ${i}: the Follower on the Lead`).toBeLessThan(0.5)
    }
    e.dispose()
    window.scrollTo(0, 0)
  })

  it("AT2: a layout ancestor's own scale: the Lead starts on its twin, the Follower on it every frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const thumb = el(root, "position:absolute;left:20px;top:300px;width:60px;height:40px")
    register(e, "thumb", thumb, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    let own = 0.8
    const modal = el(root, "position:absolute;left:300px;top:100px;width:300px;height:240px")
    register(e, "modal", modal, { layout: true, ownScale: () => ({ x: own, y: own }) } as Partial<RegisterNodeOptions>)
    const big = el(modal, "position:absolute;left:50px;top:40px;width:200px;height:150px")
    register(e, "big", big, { layoutId: "twin" })
    await endOfTask()
    const origin = centre(layoutOf(modal))
    const thumbAt = layoutOf(thumb)
    const leads: Array<Box.Box> = []
    for (let i = 1; i <= 40; i++) {
      own = scaleAt(i - 1)
      fireFrame()
      // The modal draws its own scale about its centre (the fake sink paints nothing).
      const lead = transformed(projected(layoutOf(big), sk, ["modal", "big"]), origin, own)
      leads.push(lead)
      const follower = projected(layoutOf(thumb), sk, ["thumb"])
      expect(apart(follower, lead), `frame ${i}: the Follower on the Lead`).toBeLessThan(0.5)
    }
    // It goes on from its twin: its first frame no further from it than its next step.
    expect(apart(leads[0]!, thumbAt), "the Lead starts on its twin").toBeLessThanOrEqual(apart(leads[1]!, leads[0]!) + 0.5)
    e.dispose()
  })

  it("AT3: nested ancestors, a translate inside a scale, both changing: the Follower on the Lead", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const thumb = el(root, "position:absolute;left:20px;top:300px;width:60px;height:40px")
    register(e, "thumb", thumb, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const outer: Record<string, unknown> = { scale: 0.8 }
    const inner: Record<string, unknown> = { x: 40 }
    const shell = el(root, "position:absolute;left:300px;top:100px;width:300px;height:240px;transform:scale(0.8)")
    const slide = el(shell, "position:absolute;left:20px;top:20px;width:260px;height:200px;transform:translateX(40px)")
    e.system.registerValues(shell, () => outer)
    e.system.registerValues(slide, () => inner)
    const big = el(slide, "position:absolute;left:30px;top:20px;width:200px;height:150px")
    register(e, "big", big, { layoutId: "twin" })
    await endOfTask()
    const shellOrigin = centre(layoutOf(shell, [shell, slide]))
    const slideOrigin = centre(layoutOf(slide, [shell, slide]))
    const bigLayout = layoutOf(big, [shell, slide])
    for (let i = 1; i <= 40; i++) {
      outer.scale = scaleAt(i)
      inner.x = 40 * Math.exp(-i / 6)
      shell.style.transform = `scale(${outer.scale})`
      slide.style.transform = `translateX(${inner.x}px)`
      fireFrame()
      const lead = transformed(transformed(projected(bigLayout, sk, ["big"]), slideOrigin, 1, inner.x as number), shellOrigin, outer.scale as number)
      const follower = projected(layoutOf(thumb), sk, ["thumb"])
      expect(apart(follower, lead), `frame ${i}: the Follower on the Lead`).toBeLessThan(0.5)
    }
    e.dispose()
  })

  for (const [name, setUp] of [
    ["AT4: an ancestor with a rotation", (e: Engine, modal: HTMLElement, values: Record<string, unknown>) => {
      values.rotate = 10
      modal.style.transform = "scale(0.8) rotate(10deg)"
      e.system.registerValues(modal, () => values)
    }],
    ["AT5: a transform Wardic doesn't own", (_e: Engine, modal: HTMLElement) => {
      modal.style.transform = "scale(0.8)"
    }],
  ] as const) {
    it(`${name} is converted as of the pass: what it does after changes nothing the engine writes`, async () => {
      const writes: Array<Array<number>> = []
      for (const changes of [false, true]) {
        const sk = makeSink()
        const e = makeEngine(sk.sink)
        const root = stage()
        const thumb = el(root, "position:absolute;left:20px;top:300px;width:60px;height:40px")
        register(e, "thumb", thumb, { layoutId: "twin" })
        await endOfTask()
        fireFrame()
        const values: Record<string, unknown> = { scale: 0.8 }
        const modal = el(root, "position:absolute;left:300px;top:100px;width:300px;height:240px")
        setUp(e, modal, values)
        const big = el(modal, "position:absolute;left:50px;top:40px;width:200px;height:150px")
        register(e, "big", big, { layoutId: "twin" })
        await endOfTask()
        const seen: Array<number> = []
        for (let i = 1; i <= 20; i++) {
          if (changes) {
            values.scale = scaleAt(i)
            modal.style.transform = modal.style.transform.replace(/scale\([^)]*\)/, `scale(${values.scale})`)
          }
          fireFrame()
          const d = deltaOf(sk, "thumb")
          seen.push(d.x.translate, d.y.translate, d.x.scale, d.y.scale)
        }
        writes.push(seen)
        e.dispose()
        clearStages()
      }
      expect(writes[1]).toEqual(writes[0])
    })
  }

  it("AT4b: a rotated ancestor keeps #136's conversion: the Follower is locked onto the Lead's bounding box as drawn", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const thumb = el(root, "position:absolute;left:20px;top:300px;width:60px;height:40px")
    register(e, "thumb", thumb, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const modal = el(root, "position:absolute;left:300px;top:100px;width:300px;height:240px;transform:scale(0.8) rotate(10deg)")
    e.system.registerValues(modal, () => ({ scale: 0.8, rotate: 10 }))
    const big = el(modal, "position:absolute;left:50px;top:40px;width:200px;height:150px")
    register(e, "big", big, { layoutId: "twin" })
    await endOfTask()
    // #136: the box as painted, its bounding box, against the box laid out.
    const local = layoutOf(big, [modal])
    const seen = layoutOf(big)
    const paint = Projection.calcBoxDelta(local, seen)
    for (let i = 1; i <= 10; i++) {
      fireFrame()
      const lead = Projection.applyBoxDelta(projected(local, sk, ["big"]), paint)
      const follower = projected(layoutOf(thumb), sk, ["thumb"])
      expect(apart(follower, lead), `frame ${i}: the Follower on the Lead's bounding box`).toBeLessThan(0.5)
    }
    e.dispose()
  })

  it("AT5b: a transform Wardic doesn't own, standing still, the page scrolled: the Follower is on the Lead", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:100%;height:3000px")
    window.scrollTo(0, 200)
    const thumb = el(root, "position:absolute;left:20px;top:300px;width:60px;height:40px")
    register(e, "thumb", thumb, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const modal = el(root, "position:absolute;left:300px;top:100px;width:300px;height:240px;transform:scale(0.8)")
    const big = el(modal, "position:absolute;left:50px;top:40px;width:200px;height:150px")
    register(e, "big", big, { layoutId: "twin" })
    await endOfTask()
    const origin = centre(layoutOf(modal, [modal]))
    const bigLayout = layoutOf(big, [modal])
    for (let i = 1; i <= 20; i++) {
      fireFrame()
      const lead = transformed(projected(bigLayout, sk, ["big"]), origin, 0.8)
      const follower = projected(layoutOf(thumb), sk, ["thumb"])
      expect(apart(follower, lead), `frame ${i}: the Follower on the Lead`).toBeLessThan(0.5)
    }
    e.dispose()
    window.scrollTo(0, 0)
  })
})
