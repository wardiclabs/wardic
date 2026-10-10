import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import { testLayer } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

// `display` and `visibility` (ADR-0024 decision 4): a pair from any other value to `none` or
// `hidden` switches on the leg's last frame, the one with `done: true`; every other pair of theirs
// is a Discrete pair and switches at the leg's first frame (decision 3). By key, not by value:
// `overflow: hidden` and `pointer-events: none` switch at the first frame. Motion's
// `mixVisibility` (motion-dom utils/mix/visibility.ts:1-14 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8),
// reached only by these two keys (animation/utils/can-animate.ts:36).

const quarter = [0.25, 0.25, 0.25, 0.25]

/** The values one key takes over a 1 s linear tween, frame by frame. */
const run = (from: Values.Values, to: Values.Values, ticks: ReadonlyArray<number> = quarter, delay?: number) =>
  Stream.runCollect(
    Machine.animateValues(from, to, { duration: 1, easing: Easing.linear, ...(delay !== undefined ? { delay } : {}) }).pipe(
      Effect.map(Machine.toStream),
      Stream.unwrap,
    ),
  ).pipe(
    Effect.provide(testLayer(ticks)),
    Effect.map((frames) => Array.from(frames) as ReadonlyArray<Frame.Frame<Values.Values>>),
  )
const of = (frames: ReadonlyArray<Frame.Frame<Values.Values>>, key: string) => frames.map((f) => f.value[key])

it.effect("DV1: display block → none switches on the last frame only", () =>
  Effect.gen(function* () {
    const frames = yield* run({ display: "block" }, { display: "none" })
    expect(of(frames, "display")).toEqual(["block", "block", "block", "none"])
    expect(frames.at(-1)?.done).toBe(true)
  }),
)

it.effect("DV2: display none → block switches on the first frame", () =>
  Effect.gen(function* () {
    expect(of(yield* run({ display: "none" }, { display: "block" }), "display")).toEqual(["block", "block", "block", "block"])
  }),
)

it.effect("DV3: visibility visible → hidden switches on the last frame, hidden → visible on the first", () =>
  Effect.gen(function* () {
    expect(of(yield* run({ visibility: "visible" }, { visibility: "hidden" }), "visibility")).toEqual([
      "visible",
      "visible",
      "visible",
      "hidden",
    ])
    expect(of(yield* run({ visibility: "hidden" }, { visibility: "visible" }), "visibility")).toEqual([
      "visible",
      "visible",
      "visible",
      "visible",
    ])
  }),
)

it.effect("DV4: the rule is by key: overflow → hidden and pointer-events → none switch on the first frame", () =>
  Effect.gen(function* () {
    const frames = yield* run({ overflow: "visible", "pointer-events": "auto" }, { overflow: "hidden", "pointer-events": "none" })
    expect(of(frames, "overflow")).toEqual(["hidden", "hidden", "hidden", "hidden"])
    expect(of(frames, "pointer-events")).toEqual(["none", "none", "none", "none"])
  }),
)

it.effect("DV5: display between two visible values (block → flex) switches on the first frame", () =>
  Effect.gen(function* () {
    expect(of(yield* run({ display: "block" }, { display: "flex" }), "display")).toEqual(["flex", "flex", "flex", "flex"])
  }),
)

it.effect("DV6: a delay holds both: none → block after it, block → none at the leg's end", () =>
  Effect.gen(function* () {
    const ticks = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25]
    expect(of(yield* run({ display: "none" }, { display: "block" }, ticks, 0.5), "display")).toEqual([
      "none",
      "none",
      "block",
      "block",
      "block",
      "block",
    ])
    expect(of(yield* run({ display: "block" }, { display: "none" }, ticks, 0.5), "display")).toEqual([
      "block",
      "block",
      "block",
      "block",
      "block",
      "none",
    ])
  }),
)

it.effect("DV7: beside a fading opacity, display turns none on the frame opacity reaches 0", () =>
  Effect.gen(function* () {
    const frames = yield* run({ display: "block", opacity: 1 }, { display: "none", opacity: 0 })
    expect(of(frames, "opacity")).toEqual([0.75, 0.5, 0.25, 0])
    expect(of(frames, "display")).toEqual(["block", "block", "block", "none"])
  }),
)
