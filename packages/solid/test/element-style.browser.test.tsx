// An element's `style` as the flush gate switches it (ADR-0034; `src/element-style.ts`), on
// `Style.over` and `Style.without` (#132's PR 3): a Reorder item's layering, where a base style
// (its `touch-action`) sits between the drag defaults and the user's style.
//
// - ES1: before the first commit, the Starting style over the user's, over the base, over the drag
//   defaults: the user's `touch-action` wins over the base's, and the base's over the defaults'.
// - ES2: from the first commit, the user's over the base and the defaults, without the keys the
//   gate holds, and without the Starting style.
// - ES3: a change of the keys the gate holds re-runs `style` only when it takes or lets go of a
//   key the element's style sets: the base's or the defaults' as much as the user's.
import * as Style from "@wardic/dom/Style"
import { createMemo, createRoot, createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { AtomRegistry } from "effect/reactivity"
import { createElementStyle } from "../src/element-style.ts"
import { createLiveStyle } from "../src/live-style.ts"

/** An element's style over `user`, a base and x-axis drag defaults, and how often `style` has run. */
const elementStyle = (user: object) =>
  createRoot((dispose) => {
    const [userStyle] = createSignal<object | undefined>(user)
    const es = createElementStyle({
      userStyle,
      starting: { opacity: 0 },
      startingWith: (routed) => ({ opacity: 0, ...routed }),
      live: createLiveStyle({ registry: AtomRegistry.make }),
      defaults: Style.dragDefaults("x"),
      base: () => ({ "touch-action": "pan-x", position: "relative", "-webkit-touch-callout": "default" }),
    })
    let runs = 0
    const style = createMemo(() => {
      runs++
      return es.style(userStyle()) as Record<string, unknown>
    })
    const commit = (): void => es.hooks.beforeFirstCommit?.()
    const held = (keys: ReadonlyArray<string>): void => es.hooks.onHeld?.(keys)
    return { style, commit, held, runs: () => runs, dispose }
  })

describe("an element's style, switched by its flush sink (ADR-0034, #132's PR 3)", () => {
  it("ES1: before the first commit, the Starting style over the user's, over the base, over the defaults", () => {
    const e = elementStyle({ "touch-action": "auto", color: "red" })
    expect(e.style()).toMatchObject({
      opacity: 0,
      color: "red",
      "touch-action": "auto",
      position: "relative",
      "-webkit-touch-callout": "default",
      "user-select": "none",
    })
    e.dispose()
  })

  it("ES2: from the first commit, the user's over the base and the defaults, without the held keys or the Starting style", () => {
    const e = elementStyle({ "touch-action": "auto", color: "red" })
    e.commit()
    e.held(["opacity", "color"])
    const style = e.style()
    expect(style).toMatchObject({ "touch-action": "auto", position: "relative", "user-select": "none" })
    expect("opacity" in style, "the Starting style's key goes").toBe(false)
    expect("color" in style, "a held key goes").toBe(false)
    e.dispose()
  })

  it("ES3: a held-keys change re-runs style only when it touches a key the style sets, the base's too", () => {
    const e = elementStyle({ color: "red" })
    e.commit()
    e.style()
    const runs = e.runs()
    e.held(["opacity", "transform"])
    e.style()
    expect(e.runs(), "keys no layer sets: style isn't re-run").toBe(runs)
    e.held(["opacity", "transform", "position"])
    expect("position" in e.style(), "the base's key, now held, goes").toBe(false)
    expect(e.runs(), "a key the base sets re-runs it").toBe(runs + 1)
    e.held(["opacity", "transform", "position", "userSelect"])
    expect("user-select" in e.style(), "the defaults' key, now held, goes").toBe(false)
    expect(e.runs(), "a key the defaults set re-runs it").toBe(runs + 2)
    e.dispose()
  })
})
