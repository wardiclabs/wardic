// Layout animations under reduced motion (ADR-0029), against a fake ProjectionSink with every
// Refresh frame fired by hand. The system's `reducedMotion` is read when a layout animation
// starts: under it, the progress spring starts at 1 and at rest, so the node lands on its new box
// at once (every write is identity) and settles on its first step. A node's
// `respectReducedMotion: () => false` animates anyway, and a drag's release isn't reduced.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type { RegisterNodeOptions } from "../src/index.ts"
import {
  clearStages,
  el,
  type Engine,
  endOfTask,
  fireFrame,
  fireFrames,
  makeEngine,
  makeSink,
  stage,
  stubFrames,
  unstubFrames,
  type Write,
} from "./projection-harness.ts"

beforeEach(stubFrames)
afterEach(() => {
  unstubFrames()
  clearStages()
})

const isIdentity = (w: Write): boolean =>
  Math.abs(w.tx) < 1e-6 && Math.abs(w.ty) < 1e-6 && Math.abs(w.sx - 1) < 1e-6 && Math.abs(w.sy - 1) < 1e-6

/** A 100×50 box at `left`, registered and measured once. */
const mount = async (e: Engine, id: string, left: number, extra: Partial<RegisterNodeOptions> = {}) => {
  const element = el(stage(), `position:absolute;left:${left}px;top:0;width:100px;height:50px`)
  const handle = e.system.register({ id, element, springOptions: () => ({}), ...extra })
  await endOfTask()
  fireFrame()
  return { element, handle }
}

/** Move `element` to `left`, run the Measure pass, and fire `frames` frames: the writes for `id` since the move. */
const moveTo = async (
  sk: ReturnType<typeof makeSink>,
  node: Awaited<ReturnType<typeof mount>>,
  id: string,
  left: number,
  frames = 6,
): Promise<ReadonlyArray<Write>> => {
  const before = sk.of(id).length
  node.element.style.left = `${left}px`
  node.handle.notify()
  await endOfTask()
  fireFrames(frames)
  return sk.of(id).slice(before)
}

describe("layout animations under reduced motion (ADR-0029)", () => {
  it("RM1: a box move lands at once: every write is identity, and the node settles within its first Refresh frame", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink, { reducedMotion: () => true })
    const node = await mount(e, "a", 0)
    const writes = await moveTo(sk, node, "a", 200)
    expect(writes.length, "the pass writes the node").toBeGreaterThan(0)
    expect(writes.every(isIdentity), "no FLIP: identity from the first write").toBe(true)
    // Settled: further frames write nothing.
    const settled = sk.of("a").length
    fireFrames(3)
    expect(sk.of("a").length).toBe(settled)
    e.dispose()
  })

  it("RM2: without it, the same move FLIPs from the old box over several frames", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const node = await mount(e, "a", 0)
    const writes = await moveTo(sk, node, "a", 200)
    expect(writes[0]!.tx, "starts near the old box").toBeLessThan(-150)
    expect(writes.filter((w) => !isIdentity(w)).length, "moving for several frames").toBeGreaterThan(3)
    e.dispose()
  })

  it("RM3: the system's reducedMotion is read when each layout animation starts", async () => {
    const sk = makeSink()
    let reduced = true
    const e = makeEngine(sk.sink, { reducedMotion: () => reduced })
    const node = await mount(e, "a", 0)
    expect((await moveTo(sk, node, "a", 200)).every(isIdentity)).toBe(true)
    reduced = false
    const writes = await moveTo(sk, node, "a", 0)
    expect(writes[0]!.tx, "the next move animates").toBeGreaterThan(150)
    e.dispose()
  })

  it("RM4: a node's respectReducedMotion: () => false animates anyway", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink, { reducedMotion: () => true })
    const node = await mount(e, "a", 0, { respectReducedMotion: () => false })
    const writes = await moveTo(sk, node, "a", 200)
    expect(writes[0]!.tx).toBeLessThan(-150)
    e.dispose()
  })

  it("RM5: a crossfade's new Lead lands on its own box at once instead of FLIPping from its twin's", async () => {
    for (const reduced of [false, true]) {
      const sk = makeSink()
      const e = makeEngine(sk.sink, { reducedMotion: () => reduced })
      await mount(e, "a", 0, { layoutId: "card" })
      // A twin mounts 300 px right while the first is still live: it becomes the Lead.
      const twin = el(stage(), "position:absolute;left:300px;top:0;width:100px;height:50px")
      e.system.register({ id: "b", element: twin, springOptions: () => ({}), layoutId: "card" })
      await endOfTask()
      fireFrames(2)
      const first = sk.of("b")[0]!
      if (reduced) expect(isIdentity(first), "reduced: at its own box").toBe(true)
      else expect(first.tx, "animated: from its twin's box").toBeLessThan(-250)
      e.dispose()
      clearStages()
    }
  })

  it("RM6: a drag's release still returns to its slot through the spring: it continues the gesture", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink, { reducedMotion: () => true })
    const node = await mount(e, "a", 0)
    node.handle.dragStart()
    node.handle.dragMove({ x: 100, y: 0 })
    await endOfTask()
    fireFrame()
    const before = sk.of("a").length
    node.handle.dragEnd()
    await endOfTask()
    fireFrame()
    const writes = sk.of("a").slice(before)
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.at(-1)!.tx, "between the drag target and the slot").toBeGreaterThan(0.1)
    expect(writes.at(-1)!.tx).toBeLessThan(99.9)
    e.dispose()
  })
})
