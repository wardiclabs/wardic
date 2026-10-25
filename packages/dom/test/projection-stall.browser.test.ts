// A layout animation through a stall (#23, ADR-0017 *Amendment (#23)*), checked against a fake
// ProjectionSink with every Refresh frame fired by hand (`projection-harness.ts`). The projection pass
// clamps its own `dt` at `MAX_DT`, as core's steps do (`stall.test.ts`), so:
// - ST1: a stall up to `MAX_DT` paints the flight where its unstalled frames would have at that wall
//   time, as Motion's time-based layout animation does, and it lands on time;
// - ST2: a longer stall advances it `MAX_DT`: its frames are a 500 ms stall's, and it lands 1.5 s later.
import { describe, expect, it } from "@effect/vitest"
import * as Easing from "@wardic/core/Easing"
import { afterEach, beforeEach } from "vitest"
import { clearStages, el, endOfTask, fireFrame, fireFrameAfter, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

const F = 1000 / 60

/**
 * A node moved 200 px on a linear 1 s layout tween, through Refresh frames `ms` apart: its x
 * translate after each, and the wall time, ms, of the first frame it's at rest on its new box.
 */
const flight = async (plan: ReadonlyArray<number>) => {
  const sk = makeSink()
  const e = makeEngine(sk.sink)
  const box = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
  const node = e.system.register({ id: "a", element: box, transition: () => Option.some({ type: "tween", duration: 1, ease: Easing.linear }) })
  await endOfTask()
  fireFrame()
  box.style.left = "200px"
  node.notify()
  await endOfTask()
  const txs: Array<number> = []
  let wall = 0
  let landed = Number.POSITIVE_INFINITY
  for (const ms of plan) {
    fireFrameAfter(ms)
    wall += ms
    const tx = sk.of("a").at(-1)?.tx ?? 0
    txs.push(tx)
    if (tx === 0 && landed === Number.POSITIVE_INFINITY) landed = wall
  }
  e.dispose()
  clearStages()
  return { txs, landed }
}

const frames = (n: number): Array<number> => Array.from({ length: n }, () => F)

describe("a layout animation through a stall (#23)", () => {
  for (const stallMs of [50, 200, 500]) {
    it(`ST1: a ${stallMs} ms stall paints it where its frames would have, and it lands on time`, async () => {
      const k = Math.round(stallMs / F)
      const withStall = await flight([...frames(6), stallMs, ...frames(90)])
      const without = await flight(frames(6 + k + 90))
      expect(withStall.txs[6], "the stall's frame, px").toBeCloseTo(without.txs[6 + k - 1]!, 6)
      expect(withStall.landed, "lands at the same wall time, ms").toBeCloseTo(without.landed, 6)
      expect(withStall.txs.at(-1)).toBe(0)
    })
  }

  it("ST2: a 2,000 ms stall paints a 500 ms one's frames, and lands 1.5 s later", async () => {
    const long = await flight([...frames(6), 2000, ...frames(60)])
    const capped = await flight([...frames(6), 500, ...frames(60)])
    // Frame by frame: the second flight runs on later timestamps, so its dts round differently, by 1e-13.
    expect(long.txs.length).toBe(capped.txs.length)
    for (const [i, tx] of long.txs.entries()) expect(tx, `frame ${i}`).toBeCloseTo(capped.txs[i]!, 6)
    expect(long.landed - 1500, "lands 1.5 s later, ms").toBeCloseTo(capped.landed, 6)
    expect(long.txs[6], "the stall's frame: 0.6 s into the 1 s flight").toBeLessThan(-50)
  })
})
