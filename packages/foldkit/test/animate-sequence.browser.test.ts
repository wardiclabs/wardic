// `Wardic.animate(sequence, options?)` on Foldkit (#798, PR 2; #433, Motion's `animate(sequence)`): the
// Effect's second form, over dom's sequences, through the harness's actions, a Command per action.
//
// - S1: Segments play one after another, the Effect succeeds with `landed: true` after the last, and
//   interrupting its fiber stops the sequence where it is.
// - S2: `at: "<"` starts a Segment beside the one before, a negative `at` overlaps it, and a label names
//   a time a later Segment starts at.
// - S3: a function Segment is told its value each frame, from 0 to 1, and lands.
// - S4: a sequence none of whose Segments animates anything fails with `AnimationFailed`, its subject
//   "a sequence"; a Segment that finds nothing beside one that does is skipped, and the sequence lands.
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type { Html, HtmlBuilder } from "foldkit/html"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import * as Wardic from "@wardic/foldkit/Wardic"
import { until } from "../../solid/test/browser-helpers.ts"
import { type ActionsMessage, BOX, boxOf, doneOf, type Embedded, embedActions, frames, translateXOf } from "./harness.ts"

const wardic = Wardic.make({ env: DomLive })

let app: Embedded<string> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

/** An animation's end as the action's word: `landed:<bool>`, or `missing:<subject>`. */
const ended = (effect: Effect.Effect<Wardic.AnimationEnd, Wardic.AnimationFailed, Wardic.Wardic>): Effect.Effect<string, never, Wardic.Wardic> =>
  effect.pipe(
    Effect.map((end) => `landed:${end.landed}`),
    Effect.catchTag("AnimationFailed", (failure) => Effect.succeed(`missing:${failure.subject}`)),
  )

/** Embed `view` with the sequences `actions` play, on the Handle's resources. */
const drive = (view: (h: HtmlBuilder<ActionsMessage>) => Html, actions: Record<string, Effect.Effect<string, never, Wardic.Wardic>>): Embedded<string> => {
  const held = embedActions((_on, h) => view(h), actions, wardic.resources)
  app = held
  return held
}

/** Four plain boxes, `#a` to `#d`. */
const boxes = (h: HtmlBuilder<ActionsMessage>): Html => h.div([], ["a", "b", "c", "d"].map((id) => h.div([h.Id(id), h.Style(BOX)])))

const LINEAR = { duration: 0.3, ease: "linear" } as const

describe("Wardic.animate(sequence) on Foldkit (#798)", () => {
  it("S1: Segments one after another, landed after the last; interrupting the fiber stops it where it is", async () => {
    const held = drive(boxes, {
      play: ended(Wardic.animate([["#a", { x: 100 }, LINEAR], ["#b", { x: 100 }, LINEAR]])),
    })
    const a = await boxOf(held, "a")
    const b = await boxOf(held, "b")
    await frames(2)
    const began = performance.now()
    held.send("play")
    await until(() => translateXOf(a) > 20, 2000, "a moves")
    expect(translateXOf(b), "b waits for a's Segment").toBeCloseTo(0, 1)
    await until(() => doneOf(held).includes("play:landed:true"), 3000, "the sequence lands")
    expect(performance.now() - began, "two Segments of 0.3 s").toBeGreaterThan(500)
    expect(translateXOf(a)).toBeCloseTo(100, 0)
    expect(translateXOf(b)).toBeCloseTo(100, 0)
    // Interrupted mid-way: stopped where it is.
    const fiber = Effect.runFork(Wardic.animate([["#c", { x: 200 }, { duration: 1, ease: "linear" }]]).pipe(Effect.provide(wardic.resources)))
    const c = await boxOf(held, "c")
    await until(() => translateXOf(c) > 20, 2000, "c moves")
    await Effect.runPromise(Fiber.interrupt(fiber))
    await frames(1)
    const at = translateXOf(c)
    await frames(8)
    expect(translateXOf(c), "stopped where it was").toBeCloseTo(at, 2)
    expect(at).toBeLessThan(150)
  })

  it("S2: at: < starts beside the Segment before, a negative at overlaps it, and a label names a time", async () => {
    const held = drive(boxes, {
      play: ended(
        Wardic.animate([
          ["#a", { x: 100 }, { duration: 0.4, ease: "linear" }],
          ["#b", { x: 100 }, { duration: 0.4, ease: "linear", at: "<" }],
          "mid",
          ["#c", { x: 100 }, { duration: 0.2, ease: "linear", at: "-0.1" }],
          ["#d", { x: 100 }, { duration: 0.2, ease: "linear", at: "mid" }],
        ]),
      ),
    })
    const a = await boxOf(held, "a")
    const b = await boxOf(held, "b")
    const c = await boxOf(held, "c")
    const d = await boxOf(held, "d")
    await frames(2)
    held.send("play")
    await until(() => translateXOf(a) > 20, 2000, "a moves")
    expect(translateXOf(b), "b beside a from the start").toBeGreaterThan(10)
    expect(Math.abs(translateXOf(a) - translateXOf(b)), "together").toBeLessThan(5)
    expect(translateXOf(c), "c waits for its 0.3 s").toBeCloseTo(0, 1)
    expect(translateXOf(d), "d waits for the label's 0.4 s").toBeCloseTo(0, 1)
    // c starts 0.1 s before a and b end: moving while they still are.
    await until(() => translateXOf(c) > 5, 2000, "c starts")
    expect(translateXOf(a), "a still under way as c starts").toBeLessThan(99)
    await until(() => doneOf(held).includes("play:landed:true"), 3000, "the sequence lands")
    expect(translateXOf(c)).toBeCloseTo(100, 0)
    expect(translateXOf(d)).toBeCloseTo(100, 0)
  })

  it("S3: a function Segment is told its value each frame, from 0 to 1, and lands", async () => {
    const seen: Array<number> = []
    const held = drive(boxes, {
      play: ended(Wardic.animate([[(value: number) => void seen.push(value), { duration: 0.2, ease: "linear" }]])),
    })
    await boxOf(held, "a")
    held.send("play")
    await until(() => doneOf(held).includes("play:landed:true"), 3000, "the sequence lands")
    expect(seen.length).toBeGreaterThan(3)
    expect(seen[0]!).toBeLessThan(0.3)
    expect(seen[seen.length - 1]!).toBeCloseTo(1, 2)
    for (let i = 1; i < seen.length; i++) expect(seen[i]!, `step ${i} on`).toBeGreaterThanOrEqual(seen[i - 1]!)
  })

  it("S4: a sequence that animates nothing fails as a sequence; a Segment finding nothing beside one that does is skipped", async () => {
    const held = drive(boxes, {
      nothing: ended(Wardic.animate([["#nowhere", { x: 100 }, LINEAR], "label"])),
      some: ended(Wardic.animate([["#nowhere", { x: 100 }, LINEAR], ["#a", { x: 100 }, { duration: 0.1 }]])),
    })
    const a = await boxOf(held, "a")
    held.send("nothing")
    await until(() => doneOf(held).includes("nothing:missing:a sequence"), 2000, "nothing fails as a sequence")
    held.send("some")
    await until(() => doneOf(held).includes("some:landed:true"), 3000, "the rest plays")
    expect(translateXOf(a)).toBeCloseTo(100, 0)
  })
})
