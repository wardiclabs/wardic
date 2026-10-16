// The Style helpers as `dual` functions over plain records (#132's PR 3, ADR-0041 decision 5):
// `Style.over`, `Style.without` and `Style.heldTouches` against the positional helpers they replaced
// (`mergeStyle`, `fallbackStyle`, `heldTouches` as it was), over a table of cases, key for key and
// in the same key order. Each case's `expected` was recorded from the positional helper on main
// `4c22cfb`, and the table checked both before the positional helpers were removed (cb40fd0).
//
// - SD1: `pipe(animated, over(user), over(base), over(defaults))` gives what `mergeStyle(user, animated, defaults, base)` gave.
// - SD2: `pipe(user, over(base), over(defaults), without(held))` gives what `fallbackStyle(user, held, defaults, base)` gave.
// - SD3: `pipe(style, heldTouches(prev, next))` gives what `heldTouches(prev, next, style)` gave.
// - SD4: a side that's `undefined` leaves the other as it is, the same object (`mergeStyle`'s fast path).
// - SD5: both forms of each give one type and one result.
import * as Style from "@wardic/dom/Style"
import { pipe } from "effect/Function"
import { describe, expect, expectTypeOf, it } from "vitest"

type Input = Style.Input
const X = Style.dragDefaults("x")
const Y = Style.dragDefaults("y")
const FREE = Style.dragDefaults(true)

/** A style's entries, in key order: equal entries are equal keys, values and order. */
const entriesOf = (style: object): ReadonlyArray<readonly [string, unknown]> => Object.entries(style)

interface MergeCase {
  readonly name: string
  readonly user: Input
  readonly animated: Readonly<Record<string, string | number>>
  readonly defaults?: Style.DragDefaults
  readonly base?: object
  /** What `mergeStyle` gave, recorded from it on main `4c22cfb`. */
  readonly expected: ReadonlyArray<readonly [string, unknown]>
}

const MERGES: ReadonlyArray<MergeCase> = [
  {
    name: "no user style", user: undefined, animated: { opacity: 0 },
    expected: [["opacity", 0]],
  },
  {
    name: "no user style, nothing animated", user: undefined, animated: {},
    expected: [],
  },
  {
    name: "a user style under the animated keys", user: { color: "red", opacity: 0.5 }, animated: { opacity: 0 },
    expected: [["color", "red"], ["opacity", 0]],
  },
  {
    name: "CSS text", user: "color: red; background: url(a;b); --x: 1px", animated: { opacity: 0 },
    expected: [["color", "red"], ["background", "url(a;b)"], ["--x", "1px"], ["opacity", 0]],
  },
  {
    name: "empty CSS text", user: "", animated: { opacity: 0 },
    expected: [["opacity", 0]],
  },
  {
    name: "custom properties", user: { "--brand": "red" }, animated: { "--level": 0.4 },
    expected: [["--brand", "red"], ["--level", 0.4]],
  },
  {
    name: "drag defaults (x)", user: { margin: "2px" }, animated: { opacity: 0 }, defaults: X,
    expected: [["touch-action", "pan-y"], ["user-select", "none"], ["-webkit-user-select", "none"], ["-webkit-touch-callout", "none"], ["margin", "2px"], ["opacity", 0]],
  },
  {
    name: "drag defaults (y)", user: undefined, animated: { opacity: 0 }, defaults: Y,
    expected: [["touch-action", "pan-x"], ["user-select", "none"], ["-webkit-user-select", "none"], ["-webkit-touch-callout", "none"], ["opacity", 0]],
  },
  {
    name: "a base only", user: { margin: "2px" }, animated: {}, base: { margin: "1px", padding: "3px" },
    expected: [["margin", "2px"], ["padding", "3px"]],
  },
  {
    name: "defaults < base < user < animated",
    user: { "touch-action": "auto", margin: "2px", opacity: 1 },
    animated: { opacity: 0 },
    defaults: FREE,
    base: { margin: "1px", padding: "3px", "touch-action": "none" },
    expected: [["touch-action", "auto"], ["user-select", "none"], ["-webkit-user-select", "none"], ["-webkit-touch-callout", "none"], ["margin", "2px"], ["padding", "3px"], ["opacity", 0]],
  },
  {
    name: "defaults and a base, no user style", user: undefined, animated: { x: 1 }, defaults: X, base: { position: "relative" },
    expected: [["touch-action", "pan-y"], ["user-select", "none"], ["-webkit-user-select", "none"], ["-webkit-touch-callout", "none"], ["position", "relative"], ["x", 1]],
  },
  {
    name: "user-select over the defaults", user: { "user-select": "text" }, animated: {}, defaults: X,
    expected: [["touch-action", "pan-y"], ["user-select", "text"], ["-webkit-user-select", "text"], ["-webkit-touch-callout", "none"]],
  },
  {
    name: "-webkit-user-select over the defaults", user: { "-webkit-user-select": "text" }, animated: {}, defaults: X,
    expected: [["touch-action", "pan-y"], ["user-select", "text"], ["-webkit-user-select", "text"], ["-webkit-touch-callout", "none"]],
  },
  {
    name: "user-select as CSS text", user: "user-select: text", animated: {}, defaults: X,
    expected: [["touch-action", "pan-y"], ["user-select", "text"], ["-webkit-user-select", "text"], ["-webkit-touch-callout", "none"]],
  },
  {
    name: "both user-select names, apart",
    user: { "user-select": "text", "-webkit-user-select": "all" },
    animated: {},
    defaults: FREE,
    expected: [["touch-action", "none"], ["user-select", "text"], ["-webkit-user-select", "all"], ["-webkit-touch-callout", "none"]],
  },
  {
    name: "user-select over a base alone", user: { "user-select": "text" }, animated: {}, base: { "touch-action": "pan-x" },
    expected: [["touch-action", "pan-x"], ["user-select", "text"], ["-webkit-user-select", "text"]],
  },
  {
    name: "user-select over an empty base", user: { "user-select": "text" }, animated: {}, base: {},
    expected: [["user-select", "text"], ["-webkit-user-select", "text"]],
  },
  {
    name: "user-select with neither", user: { "user-select": "text" }, animated: { opacity: 0 },
    expected: [["user-select", "text"], ["opacity", 0]],
  },
  {
    name: "nothing animated, the held check's merge", user: { opacity: 0.5 }, animated: {}, defaults: Y, base: { "z-index": "0" },
    expected: [["touch-action", "pan-x"], ["user-select", "none"], ["-webkit-user-select", "none"], ["-webkit-touch-callout", "none"], ["z-index", "0"], ["opacity", 0.5]],
  },
]

interface FallbackCase {
  readonly name: string
  readonly user: Input
  readonly held: ReadonlyArray<string>
  readonly defaults?: Style.DragDefaults
  readonly base?: object
  /** What `fallbackStyle` gave, recorded from it on main `4c22cfb`. */
  readonly expected: ReadonlyArray<readonly [string, unknown]>
}

const FALLBACKS: ReadonlyArray<FallbackCase> = [
  {
    name: "held keys left out", user: { opacity: 0.5, color: "red" }, held: ["opacity", "transform"],
    expected: [["color", "red"]],
  },
  {
    name: "a held key by its CSS property", user: { "background-color": "red", width: "4px" }, held: ["backgroundColor"],
    expected: [["width", "4px"]],
  },
  {
    name: "CSS text", user: "color: red; opacity: 0.5", held: ["opacity"],
    expected: [["color", "red"]],
  },
  {
    name: "no user style", user: undefined, held: ["opacity"],
    expected: [],
  },
  {
    name: "no user style, nothing held", user: undefined, held: [],
    expected: [],
  },
  {
    name: "nothing held", user: { color: "red" }, held: [],
    expected: [["color", "red"]],
  },
  {
    name: "held keys from the defaults and a base",
    user: { color: "red" },
    held: ["touch-action", "z-index"],
    defaults: FREE,
    base: { "z-index": "0", position: "relative" },
    expected: [["user-select", "none"], ["-webkit-user-select", "none"], ["-webkit-touch-callout", "none"], ["position", "relative"], ["color", "red"]],
  },
  {
    name: "a custom property by its own name only", user: { "--brand-color": "red", "--brandColor": "blue" }, held: ["--brandColor"],
    expected: [["--brand-color", "red"]],
  },
  {
    name: "user-select over the defaults", user: { "user-select": "text" }, held: ["transform"], defaults: X,
    expected: [["touch-action", "pan-y"], ["user-select", "text"], ["-webkit-user-select", "text"], ["-webkit-touch-callout", "none"]],
  },
  {
    name: "a held user-select", user: { "user-select": "text" }, held: ["userSelect"], defaults: X,
    expected: [["touch-action", "pan-y"], ["-webkit-user-select", "text"], ["-webkit-touch-callout", "none"]],
  },
  {
    name: "a base alone", user: { margin: "2px" }, held: ["margin"], base: { margin: "1px", padding: "3px" },
    expected: [["padding", "3px"]],
  },
]

interface TouchCase {
  readonly name: string
  readonly prev: ReadonlyArray<string>
  readonly next: ReadonlyArray<string>
  readonly style: Readonly<Record<string, unknown>>
  /** What `heldTouches` gave, recorded from it on main `4c22cfb`. */
  readonly expected: boolean
}

const STYLE = { opacity: "0.5", "background-color": "red" }
const TOUCHES: ReadonlyArray<TouchCase> = [
  {
    name: "a key taken the style doesn't set", prev: [], next: ["transform"], style: STYLE,
    expected: false,
  },
  {
    name: "a key taken the style sets", prev: [], next: ["transform", "opacity"], style: STYLE,
    expected: true,
  },
  {
    name: "a key let go of the style sets", prev: ["opacity"], next: [], style: STYLE,
    expected: true,
  },
  {
    name: "a key kept", prev: ["opacity"], next: ["opacity", "transform"], style: STYLE,
    expected: false,
  },
  {
    name: "a key taken by its CSS property", prev: [], next: ["backgroundColor"], style: STYLE,
    expected: true,
  },
  {
    name: "nothing changed", prev: ["opacity"], next: ["opacity"], style: STYLE,
    expected: false,
  },
  {
    name: "a different custom property", prev: [], next: ["--brandColor"], style: { "--brand-color": "red" },
    expected: false,
  },
  {
    name: "the same custom property", prev: [], next: ["--brandColor"], style: { "--brandColor": "blue" },
    expected: true,
  },
  {
    name: "an empty style", prev: ["opacity"], next: ["transform"], style: {},
    expected: false,
  },
]

describe("Style's dual helpers equal the positional ones (#132's PR 3)", () => {
  it.each(MERGES)("SD1: over, $name", ({ user, animated, defaults, base, expected }) => {
    expect(entriesOf(pipe(animated, Style.over(user), Style.over(base), Style.over(defaults)))).toEqual(expected)
  })

  it.each(FALLBACKS)("SD2: over then without, $name", ({ user, held, defaults, base, expected }) => {
    expect(entriesOf(pipe(user, Style.over(base), Style.over(defaults), Style.without(held)))).toEqual(expected)
  })

  it.each(TOUCHES)("SD3: heldTouches, $name", ({ prev, next, style, expected }) => {
    expect(pipe(style, Style.heldTouches(prev, next))).toBe(expected)
  })

  it("SD4: a side that's undefined leaves the other as it is, the same object", () => {
    const animated = { opacity: 0 }
    const user = { color: "red" }
    expect(Style.over(animated, undefined)).toBe(animated)
    expect(Style.over(undefined, user)).toBe(user)
    expect(pipe(animated, Style.over(undefined), Style.over(undefined), Style.over(undefined))).toBe(animated)
    expect(Style.over(undefined, undefined)).toEqual({})
    expect(Style.without(undefined, [])).toEqual({})
  })

  it("SD5: both forms give one type and one result", () => {
    const user = { color: "red", opacity: 1 }
    expectTypeOf(Style.over({ opacity: 0 }, user)).toEqualTypeOf(pipe({ opacity: 0 }, Style.over(user)))
    expectTypeOf(Style.without(user, ["opacity"])).toEqualTypeOf(pipe(user, Style.without(["opacity"])))
    expectTypeOf(Style.heldTouches(user, [], ["opacity"])).toEqualTypeOf(pipe(user, Style.heldTouches([], ["opacity"])))
    expectTypeOf(Style.over({ opacity: 0 }, user)).toEqualTypeOf<Style.Style>()
    expect(Style.over({ opacity: 0 }, user)).toEqual(pipe({ opacity: 0 }, Style.over(user)))
    expect(Style.without(user, ["opacity"])).toEqual(pipe(user, Style.without(["opacity"])))
    expect(Style.heldTouches(user, [], ["opacity"])).toBe(pipe(user, Style.heldTouches([], ["opacity"])))
  })
})
