// Appear animations on a server, the Foldkit binding (#794, PR 2; ADR-0044; ADR-0071 decision 35 and
// its *Amendment (#794)*): the walk at the `w.Provider()` element's build samples each qualifying
// element's mount animation into a CSS rule, the element's style names its slot, and the provider
// element renders the rules in a chunk `<style>` as its first child, which the client moves into the
// head before it hydrates (PR 3). The grill's S5–S8, SA1–SA5 here since PR 1's review took S5.
//
// - SA1: a qualifying element's `animation: var(--wardic-a<path>)`, the slot named by its index path
//   under the Provider element (Q9), the Provider element's own the empty path; the chunk is the
//   Provider element's first child, with the rule and each slot's timing; without `w.Provider()`, the
//   Starting style alone, no chunk, and one development word (Q4).
// - SA2: what keeps its Starting style alone (ADR-0044, decision 4): an easing with no name, a key with
//   no `Initial`, `w.Appear(false)`, a child a presence holds at its `Animate`, a style with its own
//   `animation`; `Wardic.make({ appear: false })` samples nothing and renders no chunk. A Live value
//   beside a playing key keeps its value at the Starting style, and the key plays.
// - SA3: `Wardic.make({ nonce })`: the chunk's `<style>` carries it (#618); none without.
// - SA4: `Wardic.make({ appear: "explain" })` says, at Warning, why each element that doesn't play waits
//   for the JavaScript, naming its tag and keys (#585); `true`, or no `appear`, says nothing.
// - SA5: a Variant child's stagger through the walk (ADR-0007): `delayChildren` plus its place, from the
//   parent's `Transition`; `w.Config` down the walk: the parent's `reducedMotion: "never"` writes one
//   set, a child's own `"user"` a reduced timing of its own, a child's `skipAnimations` a rule of no
//   length with its stagger dropped (#468).
// - SA6: a second `w.Provider()` in a render (Q4): nested, the walk above drops its chunk, so the rules
//   are the outer's and the paths the view's; beside the first, both render, their slots colliding;
//   either way one development word.
import * as Easing from "@wardic/core/Easing"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Atom from "effect/reactivity/Atom"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Html, HtmlBuilder } from "foldkit/html"
import { describe, expect, it } from "vitest"
import * as Appear from "@wardic/dom/Appear"
import { DomLive } from "@wardic/dom"
import type * as Ward from "@wardic/foldkit/Ward"
import * as Wardic from "@wardic/foldkit/Wardic"
import { delayOf, propertyOf, said, styleCss, timing } from "../../solid/test/appear-markup.ts"
import { type Message, rendered, startingOf, styleOf, type Tag, tagsOf } from "./ssr.ts"

type W = Wardic.Html<Message, never>
type View = (w: W, h: HtmlBuilder<Message>) => Html

/** The HTML of `view` under a Handle made with `options`, no Features: a server never mounts, so `w.Presence` needs none here. */
const html = (view: View, options: Omit<Wardic.MakeOptions<never>, "env" | "features"> = {}): Promise<string> => rendered(Wardic.make<never>({ env: DomLive, ...options }), view)

/** The chunk's CSS in `html`, or "". */
const chunkCss = (html: string): string => styleCss(html, Appear.CHUNK_ATTRIBUTE)

/** How many chunk `<style>`s `html` carries. */
const chunks = (html: string): number => Arr.length(Array.from(html.matchAll(new RegExp(`<style ${Appear.CHUNK_ATTRIBUTE}`, "g"))))

/** Development's word on more than one `w.Provider()` in a server render. */
const MANY_PROVIDERS =
  "wardic.appear: more than one w.Provider() in a server render: the Appear rules of one collide with another's, and a nested one's are dropped for the one above it. Give w.Provider() once, on the topmost w.* element."

/** The tag right after the one with `id`, in document order. */
const after = (html: string, id: string): Tag | undefined => {
  const tags = tagsOf(html)
  const at = tags.findIndex((tag) => tag.attrs.id === id)
  return tags[at + 1]
}

/** The inline `animation` of the element with `id`, or none. */
const animationOf = (html: string, id: string): string | undefined => UndefinedOr.map(styleOf(html, id), (style) => style.animation)

/** The rule name an `animation` value names: its first word. */
const ruleOf = (animation: string): string => Option.getOrElse(Arr.head(animation.split(" ")), () => "")

const rise = (w: W): ReadonlyArray<Ward.Attribute> => [w.Initial({ opacity: 0, y: 20 }), w.Animate({ opacity: 1, y: 0 })]

describe("Appear animations on a server, the Foldkit binding (#794)", () => {
  it("SA1: a qualifying element names its slot by its path; the Provider element's first child is the chunk with the rules", async () => {
    const view: View = (w, h) =>
      w.div([h.Id("root"), w.Provider(), ...rise(w)], [
        w.h1([h.Id("title"), ...rise(w)], ["title"]),
        h.ul([], [
          w.li([h.Id("item"), ...rise(w)], ["item"]),
          "text",
          w.li([h.Id("still"), w.Animate({ opacity: 1 })], ["still"]),
        ]),
      ])
    const page = await html(view)
    const chunk = after(page, "root")
    expect(UndefinedOr.map(chunk, (tag) => tag.name), "the chunk is the Provider element's first child").toBe("style")
    expect(UndefinedOr.map(chunk, (tag) => tag.attrs[Appear.CHUNK_ATTRIBUTE]), "marked as a chunk, which the client adopts").toBe("")
    const css = chunkCss(page)
    expect(propertyOf(animationOf(page, "root")), "the Provider element's own slot: the empty path").toBe("--wardic-a")
    expect(propertyOf(animationOf(page, "title")), "the first child's").toBe("--wardic-a0")
    expect(propertyOf(animationOf(page, "item")), "through a plain element, by index").toBe("--wardic-a1-0")
    expect(animationOf(page, "still"), "nothing moves: no slot").toBeUndefined()
    expect(styleOf(page, "title"), "the Starting style stays beside the animation").toMatchObject({ opacity: "0", transform: "translateY(20px)" })
    const title = timing(css, "--wardic-a0")
    expect(title.normal, "the slot's timing in the chunk").not.toBe("")
    expect(css, "the rule the timing names").toContain(`@keyframes ${ruleOf(title.normal)}`)
    expect(timing(css, "--wardic-a1-0").normal, "the item's slot, after the text child").not.toBe("")
    expect(title.reduced, "the user's preference: a reduced timing too").not.toBe("")

    const alone: View = (w, h) => h.div([], [w.h1([h.Id("title"), ...rise(w)], ["title"])])
    const words = await said(() => html(alone))
    const without = await html(alone)
    expect(styleOf(without, "title"), "without w.Provider(): the Starting style alone").toEqual({ opacity: "0", transform: "translateY(20px)" })
    expect(chunkCss(without), "and no chunk").toBe("")
    expect(words, "one development word").toEqual(["wardic.appear: a w.* element rendered on a server with no w.Provider() above it keeps its Starting style until the script runs: its Appear animation needs the Provider element, which renders the rules. Put w.Provider() on the topmost w.* element."])
  })

  it("SA2: what keeps its Starting style alone; appear: false renders no chunk; a Live value stays beside a playing key", async () => {
    const view: View = (w, h) =>
      w.div([h.Id("root"), w.Provider()], [
        w.div([h.Id("unnamed"), ...rise(w), w.Transition({ type: "tween", ease: (t) => t * t })], ["unnamed"]),
        w.div([h.Id("own-value"), w.Animate({ opacity: 0.5 })], ["own value"]),
        w.div([h.Id("off"), ...rise(w), w.Appear(false)], ["off"]),
        w.ul([h.Id("held"), w.Presence({ initial: false })], [w.li([h.Id("held-child"), ...rise(w)], ["held"])]),
        w.div([h.Id("veto"), ...rise(w), h.Style({ animation: "spin 1s infinite" })], ["veto"]),
        w.div([h.Id("live"), ...rise(w), w.Style({ x: Atom.make(40) })], ["live"]),
      ])
    const page = await html(view)
    const css = chunkCss(page)
    // An easing with no name takes a slot as it enters, and the write finds no rule for it: the slot is never
    // defined, so its `var()` resolves to nothing and the element keeps its Starting style (Solid's AR3).
    expect(animationOf(page, "unnamed"), "an easing with no name: a slot taken as it enters").toMatch(/^var\(--wardic-a/)
    expect(timing(css, propertyOf(animationOf(page, "unnamed"))).normal, "never defined").toBe("")
    expect(startingOf(page, "unnamed"), "its Starting style alone").toEqual({ opacity: "0", transform: "translateY(20px)" })
    expect(animationOf(page, "own-value"), "a key starting from the element's own value").toBeUndefined()
    expect(animationOf(page, "off"), "w.Appear(false)").toBeUndefined()
    expect(animationOf(page, "held-child"), "held at its Animate: nothing plays").toBeUndefined()
    expect(styleOf(page, "held-child"), "at its Animate").toEqual({ opacity: "1", transform: "none" })
    expect(animationOf(page, "veto"), "its own animation kept").toBe("spin 1s infinite")
    expect(propertyOf(animationOf(page, "live")), "a Live value beside a playing key: the key plays").toMatch(/^--wardic-a/)
    expect(styleOf(page, "live"), "the Atom's value at the Starting style").toMatchObject({ opacity: "0" })
    expect(UndefinedOr.map(styleOf(page, "live"), (style) => style.transform), "with the y it starts from").toContain("translateX(40px)")
    const off = await html(view, { appear: false })
    expect(chunkCss(off), "appear: false: no rules").toBe("")
    expect(animationOf(off, "live"), "and no slot").toBeUndefined()
    expect(UndefinedOr.map(after(off, "root"), (tag) => tag.name), "and no chunk child").toBe("div")
  })

  it("SA3: Wardic.make({ nonce }): the chunk carries it; none without (#618)", async () => {
    const view: View = (w, h) => w.div([h.Id("root"), w.Provider()], [w.p([h.Id("p"), ...rise(w)], ["p"])])
    const withNonce = await html(view, { nonce: "n0nce" })
    expect(UndefinedOr.map(after(withNonce, "root"), (tag) => tag.attrs.nonce), "the chunk's nonce").toBe("n0nce")
    expect(chunkCss(withNonce), "with its rules").not.toBe("")
    const without = await html(view)
    expect(UndefinedOr.map(after(without, "root"), (tag) => tag.attrs.nonce), "none without").toBeUndefined()
  })

  it("SA4: appear: \"explain\" says why each element that doesn't play waits, naming it; true, or no appear, says nothing (#585)", async () => {
    const view: View = (w, h) =>
      w.div([h.Id("root"), w.Provider()], [
        w.h1([...rise(w)], ["plays"]),
        w.div([w.Animate({ opacity: 0.5 })], ["own value"]),
        w.div([w.Initial({ width: "10px" }), w.Animate({ width: "50%" })], ["two shapes"]),
        w.div([...rise(w), h.Style({ animation: "spin 1s infinite" })], ["veto"]),
      ])
    expect(await said(() => html(view, { appear: "explain" }))).toEqual([
      "wardic.appear: <div> (opacity) waits for the JavaScript: opacity starts from the element's own value (no initial)",
      "wardic.appear: <div> (width) waits for the JavaScript: width's start and target don't take one shape",
      "wardic.appear: <div> (opacity, y) waits for the JavaScript: its own style sets an animation",
    ])
    expect(await said(() => html(view)), "nothing without it").toEqual([])
    expect(await said(() => html(view, { appear: true })), "nor with true").toEqual([])
  })

  it("SA5: a Variant child's stagger through the walk: delayChildren plus its place; w.Config down the walk: the parent's reducedMotion \"never\", a child's own \"user\" and skipAnimations (ADR-0007, #434, #468)", async () => {
    const ITEM = { hidden: { opacity: 0, y: 20 }, shown: { opacity: 1, y: 0, transition: { type: "tween" as const, duration: 0.3, ease: Easing.linear } } }
    const view: View = (w, h) =>
      w.ul([h.Id("list"), w.Provider(), w.Variants({ hidden: {}, shown: {} }), w.Initial("hidden"), w.Animate("shown"), w.Transition({ delayChildren: 0.2, staggerChildren: 0.1 }), w.Config({ reducedMotion: "never" })], [
        w.li([h.Id("a"), w.Variants(ITEM)], ["a"]),
        w.li([h.Id("b"), w.Variants(ITEM), w.Config({ reducedMotion: "user" })], ["b"]),
        w.li([h.Id("c"), w.Variants(ITEM), w.Config({ skipAnimations: true })], ["c"]),
        w.li([h.Id("d"), w.Variants(ITEM)], ["d"]),
      ])
    const page = await html(view)
    const css = chunkCss(page)
    const at = (id: string): { readonly normal: string; readonly reduced: string } => timing(css, propertyOf(animationOf(page, id)))
    expect(delayOf(at("a").normal), "delayChildren").toBeCloseTo(0.2, 9)
    expect(delayOf(at("b").normal), "plus its place").toBeCloseTo(0.3, 9)
    expect(delayOf(at("d").normal), "the fourth's place").toBeCloseTo(0.5, 9)
    expect(at("a").normal, "a tween of 0.3 s").toMatch(/ 0\.3s linear /)
    expect(at("a").reduced, "the parent's never: one set, no reduced timing").toBe("")
    expect(at("b").reduced, "its own w.Config user under the parent's never: a reduced timing of its own").not.toBe("")
    expect(delayOf(at("c").normal), "skipAnimations: lands at once, its stagger dropped").toBe(0)
    expect(at("c").normal, "a rule of no length").toMatch(/ 0s linear 0s /)
  })

  it("SA6: a second w.Provider() in a render: nested, its chunk is dropped for the one above, whose paths stay the view's; beside the first, both render and the word says so", async () => {
    const nested: View = (w, h) =>
      w.div([h.Id("outer"), w.Provider()], [
        w.section([h.Id("inner"), w.Provider()], [w.p([h.Id("deep"), ...rise(w)], ["deep"])]),
        w.p([h.Id("next"), ...rise(w)], ["next"]),
      ])
    const words = await said(() => html(nested))
    const page = await html(nested)
    expect(UndefinedOr.map(after(page, "outer"), (tag) => tag.name), "the outer's chunk first").toBe("style")
    expect(UndefinedOr.map(after(page, "inner"), (tag) => tag.attrs.id), "the inner's chunk dropped: its first child is its own").toBe("deep")
    expect(propertyOf(animationOf(page, "deep")), "named by the outer's walk: the view's path").toBe("--wardic-a0-0")
    expect(propertyOf(animationOf(page, "next"))).toBe("--wardic-a1")
    expect(chunks(page), "one chunk").toBe(1)
    expect(timing(chunkCss(page), "--wardic-a0-0").normal, "the deep one's timing in the outer's chunk").not.toBe("")
    expect(words, "the word").toEqual([MANY_PROVIDERS])

    const siblings: View = (w, h) =>
      h.div([], [
        w.section([h.Id("first"), w.Provider()], [w.p([h.Id("a"), ...rise(w)], ["a"])]),
        w.section([h.Id("second"), w.Provider()], [w.p([h.Id("b"), ...rise(w)], ["b"])]),
      ])
    expect(await said(() => html(siblings)), "beside each other: the word").toEqual([MANY_PROVIDERS])
    expect(chunks(await html(siblings)), "each renders its own, their slots colliding").toBe(2)
  })
})
