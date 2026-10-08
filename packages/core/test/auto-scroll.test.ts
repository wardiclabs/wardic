import { AUTO_SCROLL_MAX_SPEED, AUTO_SCROLL_THRESHOLD, autoScrollAxis, autoScrollStep } from "@wardic/core"
import * as Option from "effect/Option"
import { expect, it } from "@effect/vitest"

// Auto-scroll's edge math (ADR-0020, grill decision 16): Motion's algorithm
// (packages/framer-motion/src/components/Reorder/utils/auto-scroll.ts at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8, identical in framer-motion 13.4.6), as a
// pure step. The scroller's visible edges are `start`/`end` in viewport px; `scroll` is
// its offset on the axis; `maxScroll` is read only when an edge activates.

const input = (pointer: number, velocity: number, scroll = 0, maxScroll: () => number = () => 500) => ({
  pointer,
  start: 0,
  end: 200,
  velocity,
  scroll,
  maxScroll,
})

it("AS1: outside both edge zones nothing scrolls and there is no state", () => {
  expect(autoScrollStep(Option.none(), input(100, 5))).toEqual({ amount: 0, state: Option.none() })
  expect(autoScrollStep(Option.none(), input(50, 5))).toEqual({ amount: 0, state: Option.none() })
  expect(autoScrollStep(Option.none(), input(150, 5))).toEqual({ amount: 0, state: Option.none() })
})

it("AS2: moving into an edge zone scrolls by 25 x (1 - d/50)^2 toward that edge and records the limit", () => {
  // 10 px from the end edge: intensity 0.8, amount 25 x 0.64 = 16.
  const end = autoScrollStep(Option.none(), input(190, 5))
  expect(end.amount).toBeCloseTo(16, 9)
  expect(end.state).toEqual(Option.some({ edge: "end", limit: 500 }))
  const start = autoScrollStep(Option.none(), input(10, -5))
  expect(start.amount).toBeCloseTo(-16, 9)
  expect(start.state).toEqual(Option.some({ edge: "start", limit: 500 }))
})

it("AS3: an edge doesn't activate with no velocity or velocity away from it", () => {
  expect(autoScrollStep(Option.none(), input(190, 0))).toEqual({ amount: 0, state: Option.none() })
  expect(autoScrollStep(Option.none(), input(190, -5))).toEqual({ amount: 0, state: Option.none() })
  expect(autoScrollStep(Option.none(), input(10, 5))).toEqual({ amount: 0, state: Option.none() })
})

it("AS4: once an edge is active it keeps scrolling whatever the velocity", () => {
  const active = autoScrollStep(Option.none(), input(190, 5)).state
  expect(autoScrollStep(active, input(195, 0)).amount).toBeCloseTo(25 * 0.9 * 0.9, 9)
  expect(autoScrollStep(active, input(195, -3)).amount).toBeCloseTo(25 * 0.9 * 0.9, 9)
})

it("AS5: scrolling toward the end stops at the limit recorded at activation, which is read once", () => {
  let reads = 0
  const maxScroll = (): number => {
    reads++
    return 300
  }
  const first = autoScrollStep(Option.none(), input(190, 5, 0, maxScroll))
  expect(first.state).toEqual(Option.some({ edge: "end", limit: 300 }))
  expect(reads).toBe(1)
  expect(autoScrollStep(first.state, input(190, 5, 299, maxScroll)).amount).toBeGreaterThan(0)
  const capped = autoScrollStep(first.state, input(190, 5, 300, maxScroll))
  expect(capped.amount).toBe(0)
  expect(capped.state).toEqual(first.state)
  expect(reads).toBe(1)
})

it("AS6: leaving the zone clears the state, and coming back needs velocity toward the edge again", () => {
  const active = autoScrollStep(Option.none(), input(190, 5)).state
  const left = autoScrollStep(active, input(100, 5))
  expect(left).toEqual({ amount: 0, state: Option.none() })
  expect(autoScrollStep(left.state, input(190, 0))).toEqual({ amount: 0, state: Option.none() })
  expect(autoScrollStep(left.state, input(190, 1)).state).toEqual(Option.some({ edge: "end", limit: 500 }))
})

it("AS7: in xy the faster axis scrolls (a tie picks y, as Motion's > does); x and y pass through", () => {
  expect(autoScrollAxis("xy", { x: 300, y: 100 })).toBe("x")
  expect(autoScrollAxis("xy", { x: -300, y: 100 })).toBe("x")
  expect(autoScrollAxis("xy", { x: 100, y: 100 })).toBe("y")
  expect(autoScrollAxis("x", { x: 0, y: 900 })).toBe("x")
  expect(autoScrollAxis("y", { x: 900, y: 0 })).toBe("y")
})

it("AS8: Motion's constants: a 50 px zone and 25 px at most per update", () => {
  expect(AUTO_SCROLL_THRESHOLD).toBe(50)
  expect(AUTO_SCROLL_MAX_SPEED).toBe(25)
})
