// Animation controls on Foldkit (#798, PR 1; #433, Motion's `useAnimationControls`): `AnimationControls.make()`
// at the root, `w.Animate(controls)` on any number of `w.*` elements, `AnimationControls.start` an
// Effect a Command runs, `controls.set` and `controls.stop` synchronous. Each fixture is embedded through
// the harness, a Command per action the port names, its landing a Message the view lists.
//
// - AC1: an element given controls stays at its `Initial` until a start; `start(target)` animates it and
//   succeeds at its landing; every element given the controls follows.
// - AC2: `start(name)` names the element's variants: its Variant children follow, staggered by the
//   variant's own orchestration, and the Effect waits for the last of them.
// - AC3: a transition override beats the variant's own transition on the element and its Variant
//   children, and is their orchestration: no stagger.
// - AC4: `set(name)` lands the element and its Variant children at once, with no stagger.
// - AC5: `stop()` ends the animation where it is.
// - AC6: a function definition is called once per element with its `Custom`, not again as a later render
//   has the element resolve again.
// - AC7: an element that unmounts mid-start doesn't hold the Effect; a start that changes nothing succeeds.
// - AC8: interrupting the Effect's fiber stops every element the controls reach where it is.
// - AC9: an element given controls with no variants of its own names its own (Motion's
//   `isControllingVariants`): its Variant children follow the names it's started to.
// - AC10: a later render giving the element other controls warns once in development, and the element
//   keeps the ones it mounted with.
// - AC11: a start reaches a Variant child's own Variant children (the review's find): the grandchildren
//   join the change, so the Effect waits for them and the override is theirs too.
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type { Html, HtmlBuilder } from "foldkit/html"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import * as AnimationControls from "@wardic/foldkit/AnimationControls"
import type * as Ward from "@wardic/foldkit/Ward"
import * as Wardic from "@wardic/foldkit/Wardic"
import { raf, until } from "../../solid/test/browser-helpers.ts"
import { type ActionsMessage, BOX, boxOf, computedOpacityOf, doneOf, type Embedded, embedActions, frames, logged, said, translateXOf, wait } from "./harness.ts"

const wardic = Wardic.make({ env: DomLive })
type W = Wardic.Html<ActionsMessage, never>

/** A fixture's view: the Model's `on`, Foldkit's builder and the Handle's `w`. */
type View = (on: boolean, h: HtmlBuilder<ActionsMessage>, w: W) => Html

let app: Embedded<string> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

/** Embed `view` with `actions` on the Handle (the harness's `embedActions`), kept for the teardown. */
const drive = (view: View, actions: Record<string, Effect.Effect<void>>): Embedded<string> => {
  const held = embedActions((on, h) => view(on, h, wardic.html(h)), actions)
  app = held
  return held
}

const xOf = translateXOf
const opacityOf = computedOpacityOf

/** A list's variants: its own opacity, its children staggered by 0.15 s. */
const LIST: Ward.Config["variants"] = {
  hidden: { opacity: 0.2 },
  visible: { opacity: 1, transition: { duration: 0.1, staggerChildren: 0.15 } },
}

/** An item's variants: sliding in over 0.2 s. */
const ITEM: Ward.Config["variants"] = {
  hidden: { x: -40 },
  visible: { x: 0, transition: { duration: 0.2, ease: "linear" } },
}

/** A controlled list of two items, `#list`, `#i0` and `#i1`. */
const list = (controls: AnimationControls.AnimationControls): View => (_on, h, w) =>
  w.ul([h.Id("list"), w.Initial("hidden"), w.Animate(controls), w.Variants(LIST), h.Style({ listStyle: "none" })], [
    w.li([h.Id("i0"), w.Variants(ITEM), h.Style(BOX)]),
    w.li([h.Id("i1"), w.Variants(ITEM), h.Style(BOX)]),
  ])

describe("Animation controls on Foldkit (#798)", () => {
  it("AC1: it stays at Initial until a start; start(target) animates and succeeds at the landing; all given it follow", async () => {
    const controls = AnimationControls.make()
    const held = drive((_on, h, w) => h.div([], [w.div([h.Id("a"), w.Initial({ x: 10 }), w.Animate(controls), h.Style(BOX)]), w.div([h.Id("b"), w.Initial({ x: 10 }), w.Animate(controls), h.Style(BOX)])]), {
      go: AnimationControls.start(controls, { x: 100 }, { duration: 0.3, ease: "linear" }),
    })
    const a = await boxOf(held, "a")
    const b = await boxOf(held, "b")
    await frames(4)
    expect(xOf(a), "at its Initial").toBeCloseTo(10, 3)
    held.send("go")
    await until(() => xOf(a) > 30, 2000, "a moves")
    expect(doneOf(held), "under way").toEqual([])
    expect(xOf(b), "the other too").toBeGreaterThan(30)
    await until(() => doneOf(held).includes("go"), 2000, "the start lands")
    expect(xOf(a)).toBeCloseTo(100, 0)
    expect(xOf(b)).toBeCloseTo(100, 0)
  })

  it("AC2: start(name) names its variants: its Variant children follow, staggered, and the Effect waits for them", async () => {
    const controls = AnimationControls.make()
    const held = drive(list(controls), { visible: AnimationControls.start(controls, "visible") })
    const i0 = await boxOf(held, "i0")
    const i1 = await boxOf(held, "i1")
    const listEl = await boxOf(held, "list")
    await frames(4)
    expect(xOf(i0), "hidden").toBeCloseTo(-40, 1)
    const began = performance.now()
    held.send("visible")
    await until(() => xOf(i0) > -30, 2000, "the first moves")
    expect(xOf(i1), "the second waits its stagger").toBeCloseTo(-40, 1)
    await until(() => xOf(i1) > -39, 2000, "the second moves")
    expect(xOf(i0), "the first ahead").toBeGreaterThan(xOf(i1))
    await until(() => doneOf(held).includes("visible"), 3000, "the start lands")
    expect(performance.now() - began, "the last child's landing: 0.15 s + 0.2 s").toBeGreaterThan(300)
    expect(xOf(i0)).toBeCloseTo(0, 1)
    expect(xOf(i1)).toBeCloseTo(0, 1)
    expect(opacityOf(listEl)).toBeCloseTo(1, 2)
  })

  it("AC3: an override beats the variant's own transition, on the element and its Variant children, and is their orchestration", async () => {
    const controls = AnimationControls.make()
    const held = drive(list(controls), { slow: AnimationControls.start(controls, "visible", { duration: 0.6, ease: "linear" }) })
    const i0 = await boxOf(held, "i0")
    const i1 = await boxOf(held, "i1")
    const listEl = await boxOf(held, "list")
    await frames(4)
    held.send("slow")
    await until(() => xOf(i0) > -30, 2000, "the first moves")
    await frames(2)
    // No stagger: they move together, on the override's 0.6 s, not the item's 0.2 s.
    expect(Math.abs(xOf(i0) - xOf(i1)), "together").toBeLessThan(3)
    await wait(150)
    expect(xOf(i0), "still under way at the item's own 0.2 s").toBeLessThan(-8)
    expect(opacityOf(listEl), "the list on it too").toBeLessThan(0.9)
    await until(() => doneOf(held).includes("slow"), 3000, "the start lands")
    expect(xOf(i1)).toBeCloseTo(0, 1)
  })

  it("AC4: set(name) lands the element and its Variant children at once, with no stagger", async () => {
    const controls = AnimationControls.make()
    const held = drive(list(controls), {
      show: Effect.sync(() => controls.set("visible")),
      hide: Effect.sync(() => controls.set("hidden")),
    })
    const i0 = await boxOf(held, "i0")
    const i1 = await boxOf(held, "i1")
    const listEl = await boxOf(held, "list")
    await frames(4)
    held.send("show")
    await until(() => doneOf(held).includes("show"), 2000, "set ran")
    await frames(3)
    expect(xOf(i0)).toBeCloseTo(0, 1)
    expect(xOf(i1), "no stagger").toBeCloseTo(0, 1)
    expect(opacityOf(listEl)).toBeCloseTo(1, 2)
    held.send("hide")
    await until(() => doneOf(held).includes("hide"), 2000, "set ran again")
    await frames(3)
    expect(xOf(i1)).toBeCloseTo(-40, 1)
    expect(opacityOf(listEl)).toBeCloseTo(0.2, 2)
  })

  it("AC5: stop() ends the animation where it is", async () => {
    const controls = AnimationControls.make()
    const held = drive((_on, h, w) => w.div([h.Id("a"), w.Initial({ x: 0 }), w.Animate(controls), h.Style(BOX)]), {
      go: AnimationControls.start(controls, { x: 200 }, { duration: 1, ease: "linear" }),
      stop: Effect.sync(() => controls.stop()),
    })
    const a = await boxOf(held, "a")
    await frames(4)
    held.send("go")
    await until(() => xOf(a) > 20, 2000, "it moves")
    held.send("stop")
    await until(() => doneOf(held).includes("stop"), 2000, "stop ran")
    await raf()
    const at = xOf(a)
    await frames(8)
    expect(xOf(a), "stopped where it was").toBeCloseTo(at, 3)
    expect(at).toBeLessThan(150)
  })

  it("AC6: a function definition is called once per element with its Custom, not again as a later render resolves it again", async () => {
    const controls = AnimationControls.make()
    let calls = 0
    const held = drive(
      (on, h, w) =>
        h.div([], [0, 1, 2].map((i) => w.div([h.Id(`c${i}`), h.Class(Bool.match(on, { onTrue: () => "on", onFalse: () => "off" })), w.Custom(i), w.Initial({ x: 0 }), w.Animate(controls), h.Style(BOX)]))),
      {
        go: AnimationControls.start(
          controls,
          (i: number, current: Readonly<Record<string, number | string>>) => {
            calls++
            return { x: Number(current.x ?? 0) + i * 50 }
          },
          { duration: 0.1 },
        ),
      },
    )
    const c0 = await boxOf(held, "c0")
    const c1 = await boxOf(held, "c1")
    const c2 = await boxOf(held, "c2")
    await frames(4)
    held.send("go")
    await until(() => doneOf(held).includes("go"), 2000, "the start lands")
    expect(calls, "once per element").toBe(3)
    expect(xOf(c0)).toBeCloseTo(0, 0)
    expect(xOf(c1)).toBeCloseTo(50, 0)
    expect(xOf(c2)).toBeCloseTo(100, 0)
    // Resolved again (another attribute changed): the target it was started to, not the resolver's again.
    held.send("toggle")
    await frames(6)
    expect(calls, "not called again").toBe(3)
    expect(xOf(c2)).toBeCloseTo(100, 0)
  })

  it("AC7: an element that unmounts mid-start doesn't hold the Effect; a start that changes nothing succeeds", async () => {
    const controls = AnimationControls.make()
    const held = drive(
      (on, h, w) =>
        h.div([], [
          w.div([h.Id("w"), w.Initial({ x: 0 }), w.Animate(controls), h.Style(BOX)]),
          ...Bool.match(on, { onTrue: () => [], onFalse: () => [w.div([h.Id("gone"), w.Initial({ x: 0 }), w.Animate(controls), h.Style(BOX)])] }),
        ]),
      {
        go: AnimationControls.start(controls, { x: 60 }, { duration: 0.3 }),
        again: AnimationControls.start(controls, { x: 60 }),
      },
    )
    const kept = await boxOf(held, "w")
    await boxOf(held, "gone")
    await frames(4)
    held.send("go")
    await frames(3)
    held.send("toggle")
    await until(() => held.container.querySelector("#gone") === null, 2000, "the second left")
    await until(() => doneOf(held).includes("go"), 2000, "the start lands without it")
    expect(xOf(kept)).toBeCloseTo(60, 0)
    // The same again: nothing to animate, it succeeds.
    held.send("again")
    await until(() => doneOf(held).includes("again"), 1000, "a start that changes nothing succeeds")
  })

  it("AC8: interrupting the Effect's fiber stops every element the controls reach where it is", async () => {
    const controls = AnimationControls.make()
    const held = drive((_on, h, w) => h.div([], [w.div([h.Id("a"), w.Initial({ x: 0 }), w.Animate(controls), h.Style(BOX)]), w.div([h.Id("b"), w.Initial({ x: 0 }), w.Animate(controls), h.Style(BOX)])]), {})
    const a = await boxOf(held, "a")
    const b = await boxOf(held, "b")
    await frames(4)
    const fiber = Effect.runFork(AnimationControls.start(controls, { x: 200 }, { duration: 1, ease: "linear" }))
    await until(() => xOf(a) > 20, 2000, "it moves")
    await Effect.runPromise(Fiber.interrupt(fiber))
    await raf()
    const atA = xOf(a)
    const atB = xOf(b)
    await frames(8)
    expect(xOf(a), "a stopped where it was").toBeCloseTo(atA, 3)
    expect(xOf(b), "b too").toBeCloseTo(atB, 3)
    expect(atA).toBeLessThan(150)
  })

  it("AC9: with no variants of its own, it names its own: its Variant children follow its names", async () => {
    const controls = AnimationControls.make()
    const held = drive((_on, h, w) => w.ul([h.Id("list"), w.Animate(controls), h.Style({ listStyle: "none" })], [w.li([h.Id("i0"), w.Variants(ITEM), h.Style(BOX)])]), {
      hide: AnimationControls.start(controls, "hidden", { duration: 0.1 }),
      show: AnimationControls.start(controls, "visible", { duration: 0.1 }),
    })
    const i0 = await boxOf(held, "i0")
    await frames(4)
    held.send("hide")
    await until(() => doneOf(held).includes("hide"), 2000, "hidden landed")
    expect(xOf(i0)).toBeCloseTo(-40, 1)
    held.send("show")
    await until(() => doneOf(held).includes("show"), 2000, "visible landed")
    expect(xOf(i0)).toBeCloseTo(0, 1)
  })

  it("AC10: a later render giving other controls warns once in development, and the element keeps the ones it mounted with", async () => {
    const controls = AnimationControls.make()
    const other = AnimationControls.make()
    const held = drive((on, h, w) => w.div([h.Id("a"), w.Initial({ x: 0 }), w.Animate(Bool.match(on, { onTrue: () => other, onFalse: () => controls })), h.Style(BOX)]), {
      go: AnimationControls.start(controls, { x: 100 }, { duration: 0.1 }),
      none: AnimationControls.start(other, { x: 50 }, { duration: 0.1 }),
    })
    const a = await boxOf(held, "a")
    await frames(4)
    const lines = await logged(async () => {
      held.send("toggle")
      await frames(3)
      held.send("toggle")
      await frames(3)
    })
    expect(lines.filter((line) => line.includes("wardic.controls")).length, "once").toBe(1)
    expect(said(lines, "keeps the ones it mounted with")).toBe(true)
    held.send("none")
    await until(() => doneOf(held).includes("none"), 2000, "the other controls reach nothing")
    expect(xOf(a), "the other controls reach it not").toBeCloseTo(0, 1)
    held.send("go")
    await until(() => doneOf(held).includes("go"), 2000, "the mounted controls still reach it")
    expect(xOf(a)).toBeCloseTo(100, 0)
  })

  it("AC11: a start reaches a Variant child's own Variant children, waits for them, and its override is theirs", async () => {
    const controls = AnimationControls.make()
    const GROUP: Ward.Config["variants"] = { hidden: { opacity: 0.5 }, visible: { opacity: 1, transition: { duration: 0.1, staggerChildren: 0.15 } } }
    const held = drive(
      (_on, h, w) =>
        w.ul([h.Id("list"), w.Initial("hidden"), w.Animate(controls), w.Variants(LIST), h.Style({ listStyle: "none" })], [
          w.li([h.Id("group"), w.Variants(GROUP)], [w.span([h.Id("leaf"), w.Variants(ITEM), h.Style({ ...BOX, display: "block" })])]),
        ]),
      {
        show: AnimationControls.start(controls, "visible"),
        slow: AnimationControls.start(controls, "visible", { duration: 0.6, ease: "linear" }),
        hide: Effect.sync(() => controls.set("hidden")),
      },
    )
    const leaf = await boxOf(held, "leaf")
    const group = await boxOf(held, "group")
    await frames(4)
    expect(xOf(leaf), "hidden").toBeCloseTo(-40, 1)
    const began = performance.now()
    held.send("show")
    await until(() => doneOf(held).includes("show"), 3000, "the start lands")
    // One child at each level: no stagger, the grandchild's own 0.2 s past the list's 0.1 s.
    expect(performance.now() - began, "waited for the grandchild's 0.2 s, not the list's 0.1 s").toBeGreaterThan(150)
    expect(xOf(leaf), "the grandchild followed").toBeCloseTo(0, 1)
    expect(opacityOf(group)).toBeCloseTo(1, 2)
    held.send("hide")
    await until(() => doneOf(held).includes("hide"), 2000, "set ran")
    await frames(3)
    expect(xOf(leaf), "set reached it too").toBeCloseTo(-40, 1)
    held.send("slow")
    await until(() => xOf(leaf) > -30, 2000, "the grandchild moves")
    await wait(150)
    expect(xOf(leaf), "on the override's 0.6 s, not its own 0.2 s").toBeLessThan(-8)
    await until(() => doneOf(held).includes("slow"), 3000, "the override's start lands")
    expect(xOf(leaf)).toBeCloseTo(0, 1)
  })
})
