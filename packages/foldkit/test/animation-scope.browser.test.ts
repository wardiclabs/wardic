// The Animation scope on Foldkit (#798, PR 2; #433, Motion's `useAnimate` scope): `AnimationScope.make()`
// at the root, `w.AnimationScope(scope)` on one `w.*` element, `scope` an option on `Wardic.animate`'s
// forms, through the harness's actions, a Command per action.
//
// - C1: a selector with a scope finds the scope's elements alone; without one, the document's.
// - C2: the scope's element's release stops the animations started in the scope where they are, each
//   awaiting Command then succeeding with `landed: false`.
// - C3: without a scope, a selector resolves under the `w.Provider()` element: an element outside it isn't found.
// - C4: a scope whose element isn't mounted finds nothing: `AnimationFailed` with the selector.
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import * as AnimationScope from "@wardic/foldkit/AnimationScope"
import * as Wardic from "@wardic/foldkit/Wardic"
import { until } from "../../solid/test/browser-helpers.ts"
import { type ActionsMessage, BOX, boxOf, doneOf, type Embedded, embedActions, frames, translateXOf } from "./harness.ts"

const wardic = Wardic.make({ env: DomLive })
type W = Wardic.Html<ActionsMessage, never>

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

/** Embed `view` with `actions`, on the Handle's resources. */
const drive = (view: (on: boolean, h: HtmlBuilder<ActionsMessage>, w: W) => Html, actions: Record<string, Effect.Effect<string, never, Wardic.Wardic>>): Embedded<string> => {
  const held = embedActions((on, h) => view(on, h, wardic.html(h)), actions, wardic.resources)
  app = held
  return held
}

/** A list `#id` of two `.item` boxes, `#id-0` and `#id-1`, on `attributes`. */
const list = (h: HtmlBuilder<ActionsMessage>, w: W, id: string, attributes: ReadonlyArray<ReturnType<W["Provider"]>> = []): Html =>
  w.ul([h.Id(id), ...attributes], [0, 1].map((i) => h.li([h.Id(`${id}-${i}`), h.Class("item"), h.Style(BOX)])))

const FAST = { duration: 0.1 } as const

describe("The Animation scope on Foldkit (#798)", () => {
  it("C1: a selector with a scope finds the scope's elements alone; without one, the document's", async () => {
    const scope = AnimationScope.make()
    const held = drive((_on, h, w) => h.div([], [list(h, w, "one", [w.AnimationScope(scope)]), list(h, w, "two")]), {
      scoped: ended(Wardic.animate(".item", { x: 50 }, { ...FAST, scope })),
      all: ended(Wardic.animate(".item", { x: 100 }, FAST)),
    })
    const one = await boxOf(held, "one-0")
    const two = await boxOf(held, "two-0")
    await frames(2)
    expect(scope.element(), "the scope's element").toBe(held.container.querySelector("#one"))
    held.send("scoped")
    await until(() => doneOf(held).includes("scoped:landed:true"), 2000, "the scoped animation lands")
    expect(translateXOf(one), "inside the scope").toBeCloseTo(50, 0)
    expect(translateXOf(two), "outside it, untouched").toBeCloseTo(0, 1)
    held.send("all")
    await until(() => doneOf(held).includes("all:landed:true"), 2000, "the unscoped animation lands")
    expect(translateXOf(two), "the document's").toBeCloseTo(100, 0)
  })

  it("C2: the scope's element's release stops the animations started in it, their Commands ending with landed: false", async () => {
    const scope = AnimationScope.make()
    const held = drive(
      (on, h, w) =>
        h.div([], [
          ...Bool.match(on, { onTrue: () => [], onFalse: () => [w.div([h.Id("owner"), w.AnimationScope(scope), h.Style(BOX)])] }),
          h.div([h.Id("far"), h.Style(BOX)]),
        ]),
      {
        // A subject outside the scope, started in it: an element, since a selector resolves inside the scope.
        far: ended(Effect.suspend(() => Wardic.animate(app!.container.querySelector("#far")!, { x: 200 }, { duration: 1, ease: "linear", scope }))),
      },
    )
    const far = await boxOf(held, "far")
    await boxOf(held, "owner")
    await frames(2)
    held.send("far")
    await until(() => translateXOf(far) > 20, 2000, "it moves")
    held.send("toggle")
    await until(() => held.container.querySelector("#owner") === null, 2000, "the scope's element left")
    await until(() => doneOf(held).includes("far:landed:false"), 2000, "the Command ended without landing")
    expect(scope.element(), "the scope's element cleared").toBeUndefined()
    await frames(1)
    const at = translateXOf(far)
    await frames(8)
    expect(translateXOf(far), "stopped where it was").toBeCloseTo(at, 2)
    expect(at).toBeLessThan(150)
  })

  it("C3: without a scope a selector resolves under the w.Provider() element: an element outside it isn't found", async () => {
    const held = drive((_on, h, w) => h.div([], [w.div([h.Id("app"), w.Provider()], [h.div([h.Id("in"), h.Class("item"), h.Style(BOX)])]), h.div([h.Id("out"), h.Class("item"), h.Style(BOX)])]), {
      go: ended(Wardic.animate(".item", { x: 50 }, FAST)),
    })
    const inside = await boxOf(held, "in")
    const outside = await boxOf(held, "out")
    await frames(2)
    held.send("go")
    await until(() => doneOf(held).includes("go:landed:true"), 2000, "lands")
    expect(translateXOf(inside)).toBeCloseTo(50, 0)
    expect(translateXOf(outside), "outside the Provider element: not found").toBeCloseTo(0, 1)
  })

  it("C4: a scope whose element isn't mounted finds nothing", async () => {
    const scope = AnimationScope.make()
    const held = drive((_on, h, w) => list(h, w, "one"), {
      go: ended(Wardic.animate(".item", { x: 50 }, { ...FAST, scope })),
    })
    await boxOf(held, "one-0")
    expect(scope.element()).toBeUndefined()
    held.send("go")
    await until(() => doneOf(held).includes("go:missing:.item"), 2000, "fails with the selector")
  })
})
