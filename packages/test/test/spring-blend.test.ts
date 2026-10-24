import type * as Frame from "@wardic/core/Frame"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import { TestClock, testLayer } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

// `springBlend` (ADR-0024 decision 5): a spring's string keys follow the spring. One spring with the
// transition's options runs on a 0→100 progress from rest, and each key is blended through the
// registry at progress / 100, as Motion runs a spring on a string (motion-dom
// animation/JSAnimation.ts:132-148 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8). A unit string
// overshoots; the DOM's colours hold at their target past 1 (culori clamps; `@wardic/dom`'s
// `colors.node.test.ts`). Each call starts from rest: no velocity.

const ticks = TestClock.frames(400, 1 / 60)

const blend = (from: Values.Values, to: Values.Values, options?: Machine.SpringOptions) =>
  Stream.runCollect(Machine.springBlend(from, to, options).pipe(Effect.map(Machine.toStream), Stream.unwrap)).pipe(
    Effect.provide(testLayer(ticks)),
    Effect.map((frames) => Array.from(frames) as ReadonlyArray<Frame.Frame<Values.Values>>),
  )
/** The reference: a numeric key springing 0 → 100 with the same options. */
const reference = (options: Machine.SpringOptions = {}) =>
  Stream.runCollect(Machine.toStream(Machine.springValues({ x: 100 }, options, { x: 0 }, { x: 0 }))).pipe(
    Effect.provide(testLayer(ticks)),
    Effect.map((frames) => (Array.from(frames) as ReadonlyArray<Frame.MultiPhysics>).map((f) => f.value.x!)),
  )

// SB1–SB3, on a colour, are the DOM's since #160 (ADR-0036): `@wardic/dom`'s `colors.node.test.ts`.

it.effect("SB4: a unit string overshoots like a numeric key", () =>
  Effect.gen(function* () {
    const frames = yield* blend({ w: "10px" }, { w: "100px" }, { stiffness: 100, damping: 5 })
    const widths = frames.map((f) => Number.parseFloat(String(f.value.w)))
    expect(Math.max(...widths)).toBeGreaterThan(110)
    expect(frames.at(-1)?.value.w).toBe("100px")
  }),
)

it.effect("SB6: a Discrete pair switches on the first frame past the delay", () =>
  Effect.gen(function* () {
    const now = yield* blend({ overflow: "visible" }, { overflow: "hidden" })
    expect(now.map((f) => f.value.overflow).every((v) => v === "hidden")).toBe(true)
    const delayed = yield* blend({ overflow: "visible" }, { overflow: "hidden" }, { delay: 0.1 })
    for (let i = 0; i < 5; i++) expect(delayed[i]!.value.overflow, `frame ${i}`).toBe("visible")
    expect(delayed.at(-1)?.value.overflow).toBe("hidden")
  }),
)

it.effect("SB7: rest thresholds apply to the 0–100 progress, as to a numeric key travelling 100", () =>
  Effect.gen(function* () {
    const options = { restDelta: 1, restSpeed: 1 }
    expect((yield* blend({ w: "0px" }, { w: "100px" }, options)).length).toBe((yield* reference(options)).length)
  }),
)

it.effect("SB8: it starts from rest whatever the options say: from and velocity don't move the progress", () =>
  Effect.gen(function* () {
    const plain = yield* blend({ w: "0px" }, { w: "100px" })
    const seeded = yield* blend({ w: "0px" }, { w: "100px" }, { from: 50, velocity: 1000 })
    expect(seeded).toEqual(plain)
  }),
)

it.effect("SB9: a key missing from `from` starts at its target", () =>
  Effect.gen(function* () {
    const frames = yield* blend({}, { w: "100px" })
    expect(frames.every((f) => f.value.w === "100px")).toBe(true)
  }),
)
