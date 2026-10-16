// A node's Layout mode shapes where its layout animation starts (#42, ADR-0009 *Amendment (#42)*,
// Motion's snapshot shaping), checked against a fake ProjectionSink with every Refresh frame fired
// by hand. Each box is 100x50 at (40, 40) and moves to (140, 60), growing to 200 wide (or 200x100).
//
// Nothing here is painted: a node paints at its layout box scaled by its write about the box's
// centre, then moved by its translate.
import { describe, expect, it } from "@effect/vitest"
import type * as Projection from "@wardic/core/Projection"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>
interface Painted {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

/** Where `id`'s element paints, in its stage's frame: its layout box through its last write. */
const painted = (sk: Sink, id: string, element: HTMLElement): Painted => {
  const box = element.getBoundingClientRect()
  const stageAt = (element.closest("[data-harness-stage]") as HTMLElement).getBoundingClientRect()
  const w = sk.of(id).at(-1)
  const sx = w?.sx ?? 1
  const sy = w?.sy ?? 1
  const cx = box.left - stageAt.left + box.width / 2 + (w?.tx ?? 0)
  const cy = box.top - stageAt.top + box.height / 2 + (w?.ty ?? 0)
  return { left: cx - (box.width * sx) / 2, top: cy - (box.height * sy) / 2, width: box.width * sx, height: box.height * sy }
}

/** `n` frames, each followed by where `id` paints. */
const run = (sk: Sink, id: string, element: HTMLElement, n: number): Array<Painted> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return painted(sk, id, element)
  })

/** A box at (40, 40), 100x50, under `mode`, moved to (140, 60) and resized to `to`; its painted box for `n` frames. */
const change = async (mode: Projection.LayoutMode, to: readonly [number, number] = [200, 50], n = 40) => {
  const sk = makeSink()
  const e = makeEngine(sk.sink)
  const element = makeBox(stage(), 40, 40, 100, 50)
  const handle = register(e, "b", element, { layoutMode: () => mode })
  await endOfTask()
  fireFrame()
  Object.assign(element.style, { left: "140px", top: "60px", width: `${to[0]}px`, height: `${to[1]}px` })
  handle.notify()
  await endOfTask()
  const frames = run(sk, "b", element, n)
  e.dispose()
  return frames
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.05
const between = (v: number, lo: number, hi: number): boolean => v > lo + 0.5 && v < hi - 0.5

describe("a Layout mode shapes where a layout animation starts (#42)", () => {
  it("LM1 (guard): true animates position and size together", async () => {
    const frames = await change(true)
    expect(between(frames[2]!.left, 40, 140), `left ${frames[2]!.left}`).toBe(true)
    expect(between(frames[2]!.width, 100, 200), `width ${frames[2]!.width}`).toBe(true)
    expect(frames.at(-1)).toMatchObject({ left: expect.closeTo(140, 0), width: expect.closeTo(200, 0) })
  })

  it("LM2: position takes the new size at once; only the top-left slides", async () => {
    const frames = await change("position")
    for (const f of frames) expect(near(f.width, 200) && near(f.height, 50), `size ${f.width}x${f.height}`).toBe(true)
    expect(between(frames[2]!.left, 40, 140), `left ${frames[2]!.left}`).toBe(true)
    expect(between(frames[2]!.top, 40, 60), `top ${frames[2]!.top}`).toBe(true)
    expect(frames[0]!.left, "it starts from its old top-left").toBeLessThan(50)
  })

  it("LM3: size takes the new position at once; only the size animates, from the new top-left", async () => {
    const frames = await change("size")
    for (const f of frames) expect(near(f.left, 140) && near(f.top, 60), `at ${f.left},${f.top}`).toBe(true)
    expect(between(frames[2]!.width, 100, 200), `width ${frames[2]!.width}`).toBe(true)
  })

  it("LM4: x animates the x axis only: y is at its new place at once", async () => {
    const frames = await change("x")
    for (const f of frames) expect(near(f.top, 60) && near(f.height, 50), `y ${f.top} h ${f.height}`).toBe(true)
    expect(between(frames[2]!.left, 40, 140) && between(frames[2]!.width, 100, 200), `x ${frames[2]!.left} w ${frames[2]!.width}`).toBe(true)
  })

  it("LM5: y animates the y axis only: x and the width are at their new values at once", async () => {
    const frames = await change("y")
    for (const f of frames) expect(near(f.left, 140) && near(f.width, 200), `x ${f.left} w ${f.width}`).toBe(true)
    expect(between(frames[2]!.top, 40, 60), `top ${frames[2]!.top}`).toBe(true)
  })

  it("LM6: preserve-aspect: a changed ratio animates position only; a kept ratio animates both", async () => {
    const changed = await change("preserve-aspect", [200, 50])
    for (const f of changed) expect(near(f.width, 200), `width ${f.width}`).toBe(true)
    const kept = await change("preserve-aspect", [200, 100])
    expect(between(kept[2]!.width, 100, 200) && between(kept[2]!.height, 50, 100), `size ${kept[2]!.width}x${kept[2]!.height}`).toBe(true)
  })

  it("LM7: size on a node that only moved starts no layout animation: it's at its new place at once", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const element = makeBox(stage(), 40, 40, 100, 50)
    const handle = register(e, "b", element, { layoutMode: () => "size" })
    await endOfTask()
    fireFrame()
    const before = e.spans.length
    element.style.left = "140px"
    handle.notify()
    await endOfTask()
    expect(e.spans[before]?.seeded).toBe(0)
    for (const f of run(sk, "b", element, 5)) expect(near(f.left, 140), `left ${f.left}`).toBe(true)
    e.dispose()
  })

  it("LM8: the mode is read at each start: true, then position for the next change", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const element = makeBox(stage(), 40, 40, 100, 50)
    let mode: Projection.LayoutMode = true
    const handle = register(e, "b", element, { layoutMode: () => mode })
    await endOfTask()
    fireFrame()
    element.style.width = "200px"
    handle.notify()
    await endOfTask()
    const first = run(sk, "b", element, 60)
    expect(between(first[2]!.width, 100, 200), `first change, width ${first[2]!.width}`).toBe(true)
    mode = "position"
    Object.assign(element.style, { left: "140px", width: "300px" })
    handle.notify()
    await endOfTask()
    const second = run(sk, "b", element, 10)
    for (const f of second) expect(near(f.width, 300), `second change, width ${f.width}`).toBe(true)
    expect(between(second[2]!.left, 40, 140), `left ${second[2]!.left}`).toBe(true)
    e.dispose()
  })

  it("LM9: position interrupted mid-flight takes the newest size at once and slides on from where it paints", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const element = makeBox(stage(), 40, 40, 100, 50)
    const handle = register(e, "b", element, { layoutMode: () => "position" })
    await endOfTask()
    fireFrame()
    Object.assign(element.style, { left: "140px", width: "200px" })
    handle.notify()
    await endOfTask()
    const before = run(sk, "b", element, 6).at(-1)!
    Object.assign(element.style, { left: "240px", width: "300px" })
    handle.notify()
    await endOfTask()
    const after = run(sk, "b", element, 10)
    for (const f of after) expect(near(f.width, 300), `width ${f.width}`).toBe(true)
    expect(Math.abs(after[0]!.left - before.left), `left ${before.left} → ${after[0]!.left}`).toBeLessThan(12)
    e.dispose()
  })
})

describe("a Layout mode in a layoutId handover (#42)", () => {
  /** A live twin "old" at (40, 40), 100x50, then "new" at (140, 60), 200x50: a Crossfade. */
  const crossfade = async (oldMode: Projection.LayoutMode, newMode: Projection.LayoutMode) => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const oldEl = makeBox(root, 40, 40, 100, 50)
    register(e, "old", oldEl, { layoutId: "t", layoutMode: () => oldMode })
    await endOfTask()
    fireFrame()
    const newEl = makeBox(root, 140, 60, 200, 50)
    register(e, "new", newEl, { layoutId: "t", layoutMode: () => newMode })
    await endOfTask()
    const frames = Array.from({ length: 12 }, () => {
      fireFrame()
      const lead = painted(sk, "new", newEl)
      const follower = painted(sk, "old", oldEl)
      const opacity = (sk.of("new").at(-1)?.value as { opacity?: number } | undefined)?.opacity
      return { lead, follower, opacity }
    })
    e.dispose()
    return frames
  }

  it("LM10: a position Lead slides at its own size; a position Follower keeps its own size at the Lead's top-left as it fades", async () => {
    const frames = await crossfade("position", "position")
    for (const { lead, follower } of frames) {
      expect(near(lead.width, 200), `lead width ${lead.width}`).toBe(true)
      expect(near(follower.width, 100), `follower width ${follower.width}`).toBe(true)
      expect(near(follower.left, lead.left) && near(follower.top, lead.top), `follower at ${follower.left},${follower.top}, lead at ${lead.left},${lead.top}`).toBe(true)
    }
    expect(between(frames[2]!.lead.left, 40, 140), `lead left ${frames[2]!.lead.left}`).toBe(true)
  })

  it("LM11 (guard): a Follower with mode true takes its Lead's whole box", async () => {
    const frames = await crossfade(true, "position")
    for (const { lead, follower } of frames) expect(near(follower.width, lead.width), `follower ${follower.width}, lead ${lead.width}`).toBe(true)
  })

  it("LM12: a handover crossfades even when the shaped start leaves nothing to move", async () => {
    // "new" sits at old's top-left with another size: under position its start is its own box.
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "old", makeBox(root, 40, 40, 100, 50), { layoutId: "t" })
    await endOfTask()
    fireFrame()
    const newEl = makeBox(root, 40, 40, 200, 50)
    register(e, "new", newEl, { layoutId: "t", layoutMode: () => "position" })
    await endOfTask()
    const opacities = Array.from({ length: 20 }, () => {
      fireFrame()
      return (sk.of("new").at(-1)?.value as { opacity?: number } | undefined)?.opacity
    }).filter((o): o is number => o !== undefined)
    expect(opacities.some((o) => o > 0.05 && o < 0.95), `the Lead fades in: ${opacities.map((o) => o.toFixed(2)).join(" ")}`).toBe(true)
    for (const f of run(sk, "new", newEl, 3)) expect(near(f.width, 200) && near(f.left, 40), `lead ${f.left} w ${f.width}`).toBe(true)
    e.dispose()
  })

  it("LM14: a Follower promoted when its Lead leaves is shaped too: a position one flies home at its own size", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const oldEl = makeBox(root, 40, 40, 100, 50)
    register(e, "old", oldEl, { layoutId: "t", layoutMode: () => "position" })
    await endOfTask()
    fireFrame()
    const newEl = makeBox(root, 140, 60, 200, 50)
    const lead = register(e, "new", newEl, { layoutId: "t" })
    await endOfTask()
    for (let k = 0; k < 60; k++) fireFrame()
    // The Lead leaves: "old" is promoted, and flies from the Lead's box back to its own.
    newEl.remove()
    lead.dispose()
    await endOfTask()
    const frames = run(sk, "old", oldEl, 10)
    for (const f of frames) expect(near(f.width, 100), `width ${f.width}`).toBe(true)
    expect(between(frames[2]!.left, 40, 140), `left ${frames[2]!.left}`).toBe(true)
    e.dispose()
  })

  it("LM13: a Switch seed is shaped too: a position enterer starts at its own size on the leaver's top-left", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const leaverEl = makeBox(root, 40, 40, 100, 50)
    const leaver = register(e, "leaver", leaverEl, { layoutId: "t" })
    await endOfTask()
    fireFrame()
    leaverEl.remove()
    leaver.dispose()
    const enterEl = makeBox(root, 140, 60, 200, 50)
    register(e, "enter", enterEl, { layoutId: "t", layoutMode: () => "position" })
    await endOfTask()
    const first = painted(sk, "enter", enterEl)
    expect(near(first.width, 200), `width ${first.width}`).toBe(true)
    expect(first.left, "from the leaver's top-left").toBeLessThan(50)
    e.dispose()
  })
})
