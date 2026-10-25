// Appear animations, the Solid binding's server half (#48, ADR-0044): an element whose whole mount
// animation the server knows plays it in CSS from first paint; the provider writes every rule and
// timing into a `<style>` in the head once the render is done.
//
// - AR1: a qualifying element gets `animation: var(--wardic-aN)`, and the head its rule and timing.
// - AR2: the provider's `appear={false}` and an element's own turn it off; so does `initial={false}`.
// - AR3: an element the server can't play keeps its Starting style alone: an animate-only key, a
//   value the DOM reads (`auto`, `var()`), an easing with no name, its own `animation`, a length in
//   two units.
// - AR4: reduced motion: `"user"` adds the reduced rules under the media query; `"always"` and
//   `"never"` write one set.
// - AR5: a Variant child's stagger: `delayChildren` plus its place, in render order, by `from` and
//   `staggerDirection`, as the client works it out.
// - AR6: `when`: a child starts once its parent settles; a parent once its last child does; a start
//   that depends on an element with no rule has none.
// - AR7: a forever-repeating tween: an `infinite` cycle, its own delay in `animation-delay`; one with
//   no `type` is a tween too (ADR-0051).
// - AR8: the markup's hydration keys are the same with or without it.
// - AR18 (#357): with no transition, a key samples the DOM's Default transition: an opacity's 0.3 s ease.
// - AR9: a render with no `</head>` drops the style, and its elements keep their Starting style.
// - AR10: a component wrap passes its `animation` through `style`.
// - AR11: a spec's key doesn't hang on its keys' order; an easing with no name gives none.
// - AR12 (#245): an svg-inner element's attributes play as CSS; a group whose rules write SVG
//   geometry is defined, whole, under one `@supports`, its reduced block too; one that writes none
//   isn't; `width` still keeps its Starting style.
// - AR14 (#245): a stream's late chunk brings its own rules: one keyless `<style>` after its first
//   root, with the rules the head didn't send and the chunk's slots; a late Variant child of a
//   group the shell led is timed as a fresh mount (stagger among the late ones); a group led in
//   the chunk as in the shell; the head holds none of the chunk's slots.
// - AR13 (#245, #363): a layout node plays, drawn through its projection at rest as the client draws
//   it: its Starting style and its rule draw its own `x` and `y` on the projection's translate, with
//   its rotate and opacity, and its rule is named apart from a plain element's.
// - AR15 (#277): a target's own transition times its Appear animation: an `animate` map's, and a
//   dynamic variant's resolved with `custom` (its delay from the item's index, held in its rule).
// - AR20 (#359): a spring set by time plays for its duration: a duration spring's rule ends at it.
// - AR16 (#301): a transition's entries time each key in the rule: a fast `opacity` entry lands a
//   fifth of the way through a rule the slow own fields set the length of.
// - AR17 (#301): a value's own transition beside a forever repeat has no rule, as one CSS cycle can't
//   hold both: an entry that repeats under own fields that don't, and own fields that repeat beside
//   an entry that doesn't, or beside `default` driving every key. A `layout` entry alone leaves the
//   cycle playing.
import { DomLive } from "@wardic/dom"
import * as Appear from "@wardic/dom/Appear"
import * as Easing from "@wardic/core/Easing"
import { createWard, wardic, WardicProvider, type WardicTransition, type WardicVariants } from "@wardic/solid"
import { createResource, For, type JSX, Suspense } from "solid-js"
import { renderToStream, renderToString } from "solid-js/web"
import { describe, expect, it } from "vitest"
import { tagsOf } from "./ssr-helpers.ts"
import { keyOf } from "../src/appear.ts"
import * as Option from "effect/Option"

/** A whole document with a head, as SolidStart renders it, and `ui` under a provider. */
const page = (ui: () => JSX.Element, provider: { readonly appear?: boolean; readonly reducedMotion?: "user" | "always" | "never" } = {}): string =>
  renderToString(() => (
    <html>
      <head>
        <title>t</title>
      </head>
      <body>
        <WardicProvider env={DomLive} {...provider}>
          {ui()}
        </WardicProvider>
      </body>
    </html>
  ))

/** The head's Appear style, or "". */
const headCss = (html: string): string => /<style data-wardic-appear[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ""

/** The custom property an element's inline animation names. */
const propertyOf = (animation: string | undefined): string => /var\((--wardic-a\d+)\)/.exec(animation ?? "")?.[1] ?? ""

/** The `:root` value of `property` in `css`, outside the media block, and inside it. */
const timing = (css: string, property: string): { readonly normal: string; readonly reduced: string } => {
  if (property === "") return { normal: "", reduced: "" }
  const [plain, media = ""] = css.split("@media (prefers-reduced-motion: reduce)")
  const value = (text: string | undefined) => new RegExp(`${property}:([^;}]*)`).exec(text ?? "")?.[1] ?? ""
  return { normal: value(plain), reduced: value(media) }
}

/** The delay, in seconds, of an `animation` value: `name 1s linear 0.25s 1 both`. */
const delayOf = (animation: string): number => Number(/s linear (-?[\d.]+)s/.exec(animation)?.[1] ?? Number.NaN)

const rise = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } } as const

describe("Appear animations on a server (#48, ADR-0044)", () => {
  it("AR1: a qualifying element gets animation: var(--wardic-aN), and the head its rule and timing", () => {
    const html = page(() => <wardic.div {...rise} />)
    const div = tagsOf(html).find((t) => t.name === "div")
    expect(div?.style.opacity, "its Starting style stays").toBe("0")
    const property = propertyOf(div?.style.animation)
    expect(property).toMatch(/^--wardic-a\d+$/)
    const css = headCss(html)
    const animation = timing(css, property).normal
    const name = animation.split(" ")[0]!
    expect(name.startsWith(Appear.PREFIX)).toBe(true)
    expect(css).toContain(`@keyframes ${name}{0%{transform:translateY(20px);opacity:0}`)
    expect(animation).toMatch(new RegExp(`^${name} [\\d.]+s linear 0s 1 forwards$`))
    expect(html.indexOf("<style data-wardic-appear"), "in the head").toBeLessThan(html.indexOf("</head>"))
  })

  it("AR2: the provider's appear={false} and an element's own turn it off; so does initial={false}", () => {
    const off = page(() => <wardic.div {...rise} />, { appear: false })
    expect(headCss(off)).toBe("")
    expect(tagsOf(off).find((t) => t.name === "div")?.style.animation).toBeUndefined()
    const html = page(() => (
      <>
        <wardic.div {...rise} appear={false} />
        <wardic.div initial={false} animate={{ opacity: 1 }} />
        <wardic.div {...rise} />
      </>
    ))
    const divs = tagsOf(html).filter((t) => t.name === "div")
    expect(divs.map((d) => d.style.animation === undefined)).toEqual([true, true, false])
  })

  it("AR3: an element the server can't play keeps its Starting style alone", () => {
    const anonymous = (t: number) => t * t
    const own = { animation: "spin 1s infinite" }
    const html = page(() => (
      <>
        <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1, color: "red" }} />
        <wardic.div initial={{ height: "0px" }} animate={{ height: "auto" }} />
        <wardic.div initial={{ color: "red" }} animate={{ color: "var(--brand)" }} />
        <wardic.div {...rise} transition={{ type: "tween", ease: anonymous }} />
        <wardic.div {...rise} style={own} />
        <wardic.div {...rise} transition={{ type: "tween", ease: Easing.cubicBezier(0.4, 0, 0.2, 1) }} />
        <wardic.div initial={{ width: "10px" }} animate={{ width: "50%" }} />
        <wardic.div {...rise} style="color: red; animation: spin 1s infinite" />
        <wardic.div initial={{ "background-color": "#000" }} animate={{ "background-color": "#fff" }} />
      </>
    ))
    const divs = tagsOf(html).filter((t) => t.name === "div")
    const css = headCss(html)
    const plays = divs.map((d) => timing(css, propertyOf(d.style.animation)).normal !== "")
    // The last, a colour pair, plays: its digits aren't two units.
    expect(plays).toEqual([false, false, false, false, false, true, false, false, true])
    expect(divs[4]?.style.animation, "its own animation stays").toBe("spin 1s infinite")
    expect(divs[7]?.style.animation, "a CSS-text style's own too").toBe("spin 1s infinite")
    // Only the two that play have their timing in the head: an element ruled out leaves its slot undefined.
    expect(css.split("@media")[0]!.match(/--wardic-a\d+:/g), css).toHaveLength(2)
  })

  it("AR4: reduced motion: user adds the reduced rules under the media query; always and never write one set", () => {
    const at = (reducedMotion: "user" | "always" | "never") => {
      const html = page(() => <wardic.div {...rise} />, { reducedMotion })
      const div = tagsOf(html).find((t) => t.name === "div")
      return timing(headCss(html), propertyOf(div?.style.animation))
    }
    const user = at("user")
    expect(user.normal).not.toBe("")
    expect(user.reduced).not.toBe("")
    expect(user.reduced.split(" ")[0], "a rule of its own: y snapped").not.toBe(user.normal.split(" ")[0])
    const always = at("always")
    expect(always.reduced).toBe("")
    expect(always.normal.split(" ")[0]).toBe(user.reduced.split(" ")[0])
    const never = at("never")
    expect(never.reduced).toBe("")
    expect(never.normal.split(" ")[0]).toBe(user.normal.split(" ")[0])
  })

  it("AR5: a Variant child's stagger: delayChildren plus its place, by from and staggerDirection", () => {
    const variants = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const delays = (transition: WardicTransition) => {
      const html = page(() => (
        <wardic.ul initial="hidden" animate="shown" variants={variants} transition={transition}>
          <wardic.li variants={variants} />
          <wardic.li variants={variants} />
          <wardic.li variants={variants} />
        </wardic.ul>
      ))
      const css = headCss(html)
      return tagsOf(html).filter((t) => t.name === "li").map((li) => delayOf(timing(css, propertyOf(li.style.animation)).normal))
    }
    expect(delays({ staggerChildren: 0.1, delayChildren: 0.05 })).toEqual([0.05, 0.15, 0.25])
    expect(delays({ staggerChildren: 0.1, from: "last" })).toEqual([0.2, 0.1, 0])
    expect(delays({ staggerChildren: 0.1, staggerDirection: -1 })).toEqual([0.2, 0.1, 0])
    expect(delays({ staggerChildren: 0.1, from: "center" })).toEqual([0.1, 0, 0.1])
  })

  it("AR6: when: a child starts once its parent settles, a parent once its last child does", () => {
    const variants = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const tween = { type: "tween", duration: 0.5 } as const
    const run = (when: "beforeChildren" | "afterChildren", childAppear = true) => {
      const html = page(() => (
        <wardic.section initial="hidden" animate="shown" variants={variants} transition={{ ...tween, when, staggerChildren: 0.1 }}>
          <wardic.p variants={variants} transition={tween} />
          <wardic.p variants={variants} transition={tween} appear={childAppear} />
        </wardic.section>
      ))
      const css = headCss(html)
      const [section, ...ps] = tagsOf(html).filter((t) => t.name === "section" || t.name === "p")
      return {
        parent: timing(css, propertyOf(section?.style.animation)).normal,
        children: ps.map((p) => timing(css, propertyOf(p.style.animation)).normal),
      }
    }
    const before = run("beforeChildren")
    expect(delayOf(before.parent)).toBe(0)
    // The parent's 0.5 s tween settles a 60 Hz frame after it arrives, as the client's does.
    expect(before.children.map(delayOf).map((d) => Math.round(d * 1000) / 1000)).toEqual([0.517, 0.617])
    const after = run("afterChildren")
    expect(after.children.map(delayOf)).toEqual([0, 0.1])
    expect(Math.round(delayOf(after.parent) * 1000) / 1000, "after the last child settles").toBe(0.617)
    const held = run("afterChildren", false)
    expect(held.parent, "a child with no rule: the parent has none either").toBe("")
  })

  it("AR7: a forever-repeating tween plays an infinite cycle, its own delay in animation-delay", () => {
    const html = page(() => (
      <wardic.div initial={{ rotate: 0 }} animate={{ rotate: 360 }} transition={{ type: "tween", duration: 1, repeat: Number.POSITIVE_INFINITY, delay: 0.3 }} />
    ))
    const div = tagsOf(html).find((t) => t.name === "div")
    const animation = timing(headCss(html), propertyOf(div?.style.animation)).normal
    expect(animation).toMatch(/ 2s linear 0\.3s infinite forwards$/)
    // No `type`: a repeat makes it a tween (ADR-0051), so it repeats for ever too.
    const untyped = page(() => <wardic.div initial={{ rotate: 0 }} animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: 0.3 }} />)
    const spin = tagsOf(untyped).find((t) => t.name === "div")
    expect(timing(headCss(untyped), propertyOf(spin?.style.animation)).normal).toMatch(/ 2s linear 0\.3s infinite forwards$/)
  })

  it("AR18: with no transition, each key samples the DOM's Default transition (ADR-0051)", () => {
    const html = page(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />)
    const animation = timing(headCss(html), propertyOf(tagsOf(html).find((t) => t.name === "div")?.style.animation)).normal
    expect(animation, "an opacity's 0.3 s ease, as the client runs it").toMatch(/ 0\.3s linear 0s 1 forwards$/)
  })

  it("AR8: the markup's hydration keys are the same with or without it", () => {
    const ui = () => (
      <wardic.ul initial="hidden" animate="shown" variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}>
        <wardic.li variants={{ hidden: { x: -10 }, shown: { x: 0 } }} />
        <wardic.li variants={{ hidden: { x: -10 }, shown: { x: 0 } }} />
      </wardic.ul>
    )
    const keys = (html: string) => [...html.matchAll(/data-hk="([^"]+)"/g)].map((m) => m[1])
    expect(keys(page(ui))).toEqual(keys(page(ui, { appear: false })))
  })

  it("AR9: a render with no </head> drops the style; its elements keep their Starting style", () => {
    const html = renderToString(() => (
      <WardicProvider env={DomLive}>
        <wardic.div {...rise} />
      </WardicProvider>
    ))
    expect(headCss(html)).toBe("")
    expect(tagsOf(html)[0]?.style.animation, "an undefined custom property: no animation plays").toMatch(/^var\(--wardic-a\d+\)$/)
  })

  it("AR11: a spec's key: the same whatever its keys' order; none for an easing with no name", () => {
    const at = (from: Record<string, number>, to: Record<string, number>, ease: (t: number) => number = Easing.linear) =>
      keyOf({ tag: "div", from, to, transition: { type: "tween", duration: 0.3, ease }, reduced: false, layout: false })
    expect(at({ opacity: 0, y: 20 }, { opacity: 1, y: 0 })).toEqual(at({ y: 20, opacity: 0 }, { y: 0, opacity: 1 }))
    expect(Option.isSome(at({ x: 0 }, { x: 1 }, Easing.easeOutCubic))).toBe(true)
    expect(Option.isNone(at({ x: 0 }, { x: 1 }, (t) => t * t))).toBe(true)
  })

  it("AR10: a component wrap and a createWard spread pass their animation through style", () => {
    const Card = (p: { readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties }) => <article ref={p.ref} style={p.style} />
    const WCard = wardic.create(Card)
    const Spread = () => {
      const ward = createWard(rise)
      return <aside {...ward()} />
    }
    const html = page(() => (
      <>
        <WCard {...rise} />
        <Spread />
      </>
    ))
    const css = headCss(html)
    for (const name of ["article", "aside"]) {
      const tag = tagsOf(html).find((t) => t.name === name)
      expect(timing(css, propertyOf(tag?.style.animation)).normal, name).not.toBe("")
    }
  })

  it("AR12: SVG attributes play as CSS; a group writing geometry is defined whole under one @supports (#245)", () => {
    const html = page(() => (
      <svg>
        <wardic.g initial="hidden" animate="shown" variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }} transition={{ staggerChildren: 0.1 }}>
          <wardic.circle variants={{ hidden: { cx: 0, r: 4 }, shown: { cx: 50, r: 20 } }} />
          <wardic.path d="M0 0L10 10" variants={{ hidden: { pathLength: 0 }, shown: { pathLength: 1 } }} />
        </wardic.g>
        <wardic.rect width={10} height={10} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        <wardic.rect data-k="sized" width={0} height={10} initial={{ width: "0px" }} animate={{ width: "10px" }} />
      </svg>
    ))
    const css = headCss(html)
    const tag = (name: string) => tagsOf(html).find((t) => t.name === name)
    const property = (name: string) => propertyOf(tag(name)?.style.animation)
    const circle = tag("circle")
    expect(circle?.attrs.cx, "its Starting style stays an attribute").toBe("0")
    expect(circle?.attrs.r).toBe("4")
    expect(css).toMatch(/@keyframes wardic-\w+\{0%\{cx:0px;r:4px\}/)
    expect(css).toMatch(/@keyframes wardic-\w+\{0%\{stroke-dasharray:0 1;stroke-dashoffset:0\}/)
    // The group, the circle's leader and the path beside it too, under the circle's condition.
    const [plain, media = ""] = css.split("@media (prefers-reduced-motion: reduce)")
    const guarded = (text: string) => /@supports \(cx:0px\) and \(r:0px\)\{:root\{([^}]*)\}\}/.exec(text)?.[1] ?? ""
    for (const name of ["g", "circle", "path"]) {
      expect(property(name), name).not.toBe("")
      expect(guarded(plain!), name).toContain(`${property(name)}:`)
      expect(guarded(media), `${name} reduced`).toContain(`${property(name)}:`)
    }
    // The rect writes no geometry: defined with no condition.
    const rect = tagsOf(html).find((t) => t.name === "rect" && t.attrs["data-k"] === undefined)
    const rectProperty = propertyOf(rect?.style.animation)
    expect(rectProperty).not.toBe("")
    expect(guarded(plain!)).not.toContain(rectProperty)
    expect(/(?:^|\})(:root\{[^}]*\})/.exec(plain!)?.[1]).toContain(`${rectProperty}:`)
    // `width` can't be guarded: the rect keeps its Starting style.
    const sized = tagsOf(html).find((t) => t.attrs["data-k"] === "sized")
    expect(timing(css, propertyOf(sized?.style.animation)).normal).toBe("")
  })

  it("AR13: a layout node plays, drawn through its projection at rest, its own translate on top (#245, #363)", () => {
    const entrance = { initial: { opacity: 0, y: 40, rotate: 10 }, animate: { opacity: 1, y: 0, rotate: 0 } } as const
    const Card = (p: { readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties }) => <article ref={p.ref} style={p.style} />
    const WCard = wardic.create(Card)
    const html = page(() => (
      <>
        <WCard layout {...entrance} />
        <wardic.div data-k="layout" layout {...entrance} />
        <wardic.div data-k="shared" layoutId="card" {...entrance} />
        <wardic.div data-k="plain" {...entrance} />
        <wardic.div data-k="slide" layout initial={{ x: -30 }} animate={{ x: 0 }} />
      </>
    ))
    const css = headCss(html)
    const div = (k: string) => tagsOf(html).find((t) => t.attrs["data-k"] === k)
    const ruleOf = (k: string) => {
      const name = timing(css, propertyOf(div(k)?.style.animation)).normal.split(" ")[0]!
      return { name, body: new RegExp(`@keyframes ${name}\\{(.*?\\})\\}`).exec(css)?.[1] ?? "" }
    }
    // The Starting style: its own y on its projection at rest, the rotate and opacity, as the client's
    // first commit draws it (#363).
    for (const k of ["layout", "shared"]) {
      expect(div(k)?.style.transform, k).toBe("translate3d(0px, 40px, 0px) rotate(10deg)")
      expect(div(k)?.style.opacity, k).toBe("0")
    }
    expect(div("plain")?.style.transform).toBe("translateY(40px) rotate(10deg)")
    const article = tagsOf(html).find((t) => t.name === "article")
    expect(article?.style.transform, "a component wrap's too").toBe("translate3d(0px, 40px, 0px) rotate(10deg)")
    const wrapName = timing(css, propertyOf(article?.style.animation)).normal.split(" ")[0]!
    expect(new RegExp(`@keyframes ${wrapName}\\{(.*?\\})\\}`).exec(css)?.[1], "its rule draws the same").toBe(ruleOf("layout").body)
    // Its rule: the same, every stop.
    const layout = ruleOf("layout")
    expect(layout.body.startsWith("0%{transform:translate3d(0px, 40px, 0px) rotate(10deg);opacity:0}"), layout.body).toBe(true)
    expect(ruleOf("shared").name, "a layoutId node's too").toBe(layout.name)
    const plain = ruleOf("plain")
    expect(plain.body.startsWith("0%{transform:translateY(40px) rotate(10deg);opacity:0}"), plain.body).toBe(true)
    expect(plain.name, "named apart: the client's spec names it the same").not.toBe(layout.name)
    // Only its own x animating: it slides, as the client draws it (#363).
    expect(div("slide")?.style.transform).toBe("translate3d(-30px, 0px, 0px)")
    expect(ruleOf("slide").body.startsWith("0%{transform:translate3d(-30px, 0px, 0px)}"), ruleOf("slide").body).toBe(true)
    expect(ruleOf("slide").body, "it slides home").toContain("100%{transform:none}")
  })

  it("AR14: a stream's late chunk brings its own rules, after its first root, keyless (#245)", async () => {
    const items = { hidden: { opacity: 0, y: 20 }, shown: { opacity: 1, y: 0 } }
    const writes: Array<string> = []
    await new Promise<void>((resolve) => {
      renderToStream(() => {
        const [data] = createResource(() => new Promise<Array<number>>((r) => setTimeout(() => r([0, 1, 2]), 20)))
        const [later] = createResource(() => new Promise<string>((r) => setTimeout(() => r("later"), 60)))
        return (
          <html>
            <head>
              <title>t</title>
            </head>
            <body>
              <WardicProvider env={DomLive}>
                <wardic.h1 data-k="title" {...rise} />
                <wardic.ul
                  data-k="list"
                  initial="hidden"
                  animate="shown"
                  variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
                  transition={{ type: "tween", duration: 0.3, staggerChildren: 0.1, when: "beforeChildren" }}
                >
                  <wardic.li data-k="shell" variants={items} />
                  <Suspense fallback={<li>loading</li>}>
                    <For each={data()}>{(i) => <wardic.li data-k={`late${i}`} variants={items} />}</For>
                    <wardic.h1 data-k="late-title" {...rise} />
                    <wardic.ol initial="hidden" animate="shown" variants={{ hidden: {}, shown: {} }} transition={{ staggerChildren: 0.05 }}>
                      <For each={[0, 1]}>
                        {(i) => (
                          <div>
                            <wardic.li data-k={`own${i}`} variants={items} />
                          </div>
                        )}
                      </For>
                    </wardic.ol>
                  </Suspense>
                </wardic.ul>
                <Suspense fallback={<p>loading</p>}>
                  <wardic.p data-k="second" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
                    {later()}
                  </wardic.p>
                </Suspense>
              </WardicProvider>
            </body>
          </html>
        )
      }).pipe({ write: (v: string) => void writes.push(v), end: () => resolve() } as unknown as { write: (v: string) => void; end: () => void })
    })
    const shell = writes[0]!
    const chunks = writes.slice(1).filter((w) => w.includes("<template"))
    expect(chunks, "two chunks, one a boundary").toHaveLength(2)
    const chunk = chunks.find((w) => w.includes('data-k="late0"'))!
    // The later chunk has its own style: its element is its root too.
    const second = chunks.find((w) => w.includes('data-k="second"'))!
    const secondCss = /<style data-wardic-appear-chunk>([\s\S]*?)<\/style>/.exec(second)?.[1] ?? ""
    const secondTag = tagsOf(second).find((t) => t.attrs["data-k"] === "second")
    expect(timing(secondCss, propertyOf(secondTag?.style.animation)).normal, "the later chunk's own style").not.toBe("")
    expect(chunk, "the chunk came after the shell").toBeDefined()
    const head = headCss(shell)
    const styles = [...chunk.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)]
    expect(styles, "one style a chunk").toHaveLength(1)
    const [, attributes, css] = styles[0]!
    expect(attributes, "server text: no hydration key").toBe(` ${Appear.CHUNK_ATTRIBUTE}`)
    expect(chunk.indexOf("<style"), "after its first root").toBeGreaterThan(chunk.indexOf('data-k="late0"'))
    const tag = (k: string) => tagsOf(chunk).find((t) => t.attrs["data-k"] === k) ?? tagsOf(shell).find((t) => t.attrs["data-k"] === k)
    const late = (k: string) => timing(css!, propertyOf(tag(k)?.style.animation))
    // The late title shares the shell title's rule: not sent again.
    const titleRule = timing(head, propertyOf(tag("title")?.style.animation)).normal.split(" ")[0]!
    expect(late("late-title").normal.split(" ")[0]).toBe(titleRule)
    expect(css).not.toContain(`@keyframes ${titleRule}{`)
    // The shell's group: its own child waits for the leader (`beforeChildren`); its late children are
    // a fresh mount from the chunk's landing, staggered among themselves, waiting on no one.
    expect(delayOf(timing(head, propertyOf(tag("shell")?.style.animation)).normal), "the shell child waits").toBeGreaterThan(0.29)
    expect(["late0", "late1", "late2"].map((k) => delayOf(late(k).normal))).toEqual([0, 0.1, 0.2])
    expect(["late0", "late1", "late2"].map((k) => late(k).reduced), "the reduced block too").not.toContain("")
    // A group led in the chunk, as in the shell: its items, each in a plain wrapper, are timed together
    // (the chunk's root is the group's leader, not each item).
    expect(["own0", "own1"].map((k) => delayOf(late(k).normal))).toEqual([0, 0.05])
    // The head holds the shell's slots only.
    expect(timing(head, propertyOf(tag("shell")?.style.animation)).normal).not.toBe("")
    for (const k of ["late0", "late-title", "own0"]) expect(timing(head, propertyOf(tag(k)?.style.animation)).normal, k).toBe("")
  })

  it("AR15: a target's own transition times its Appear animation, a dynamic variant's with custom (#277)", () => {
    const html = page(() => (
      <>
        <wardic.div data-k="map" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { type: "tween", duration: 0.7, ease: Easing.linear } }} />
        <wardic.div data-k="fn" custom={2} variants={ITEM} initial="hidden" animate="visible" />
      </>
    ))
    const css = headCss(html)
    const animationOf = (k: string): string => timing(css, propertyOf(tagsOf(html).find((t) => t.attrs["data-k"] === k)?.style.animation)).normal
    expect(animationOf("map"), "the map's own 0.7 s").toMatch(/ 0\.7s linear 0s /)
    // Its own delay is held in its rule: 2 × 0.25 s still, then its 0.3 s.
    expect(animationOf("fn"), "the variant's 0.5 s delay and 0.3 s").toMatch(/ 0\.8s linear 0s /)
  })

  it("AR19: a named ease plays on its curve, and its rule is keyed by the name (#360)", () => {
    const html = page(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, ease: "easeIn" }} />)
    const css = headCss(html)
    const animation = timing(css, propertyOf(tagsOf(html).find((t) => t.name === "div")?.style.animation)).normal
    expect(animation, "a 1 s rule").toMatch(/ 1s linear 0s /)
    const name = animation.split(" ")[0]!
    const rule = new RegExp(`@keyframes ${name}\\{((?:[\\d.]+%\\{[^}]*\\})*)\\}`).exec(css)?.[1] ?? ""
    const stops = Array.from(rule.matchAll(/([\d.]+)%\{[^}]*opacity:([\d.]+)/g), (m) => ({ at: Number(m[1]) / 100, opacity: Number(m[2]) }))
    expect(stops.length, "sampled").toBeGreaterThan(3)
    for (const stop of stops) expect(stop.opacity, `at ${stop.at}`).toBeCloseTo(Easing.easeIn(stop.at), 2)
  })

  it("AR20: a duration spring's rule moves until its duration, on its target, and settles at it (#359)", () => {
    const variants = { hidden: { x: 0 }, shown: { x: 100 } }
    const spring = { type: "spring", duration: 0.8, bounce: 0.4 } as const
    const html = page(() => (
      <wardic.section initial="hidden" animate="shown" variants={variants} transition={{ ...spring, when: "beforeChildren" }}>
        <wardic.p variants={variants} transition={spring} />
      </wardic.section>
    ))
    const css = headCss(html)
    const [section, p] = tagsOf(html).filter((t) => t.name === "section" || t.name === "p")
    const animation = timing(css, propertyOf(section?.style.animation)).normal
    // Its rule ends at the last frame it's drawn moving: past 0.7 s, by 0.8 s.
    const seconds = Number(/ ([\d.]+)s linear/.exec(animation)?.[1])
    expect(seconds).toBeGreaterThan(0.7)
    expect(seconds).toBeLessThanOrEqual(0.8)
    const name = animation.split(" ")[0]!
    const rule = new RegExp(`@keyframes ${name}\\{(.*?)\\}\\}`).exec(css)?.[1] ?? ""
    expect(rule.endsWith("100%{transform:translateX(100px)"), "ends on 100px").toBe(true)
    const xs = Array.from(rule.matchAll(/translateX\(([\d.-]+)px\)/g), (m) => Number(m[1]))
    expect(Math.max(...xs), "a bounce of 0.4: past 100 on the way").toBeGreaterThan(105)
    // It settles at its 0.8 s (48 frames of 1/60 s), as the client's: the child starts then.
    expect(delayOf(timing(css, propertyOf(p?.style.animation)).normal)).toBeCloseTo(0.8, 9)
  })

  it("AR16: a transition's entries time each key in the rule (#301)", () => {
    const linear = Easing.linear
    const html = page(() => (
      <wardic.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "tween", duration: 1, ease: linear, opacity: { type: "tween", duration: 0.2, ease: linear } }} />
    ))
    const css = headCss(html)
    const animation = timing(css, propertyOf(tagsOf(html).find((t) => t.name === "div")?.style.animation)).normal
    expect(animation, "the own fields' 1 s").toMatch(/ 1s linear 0s /)
    const name = animation.split(" ")[0]!
    const rule = new RegExp(`@keyframes ${name}\\{((?:[\\d.]+%\\{[^}]*\\})*)\\}`).exec(css)?.[1] ?? ""
    const stops = Array.from(rule.matchAll(/([\d.]+)%\{([^}]*)\}/g), (m) => ({ at: Number(m[1]), body: m[2]! }))
    const faded = stops.find((stop) => /opacity:1(;|$)/.test(stop.body))
    expect(faded?.at, "opacity lands at its entry's 0.2 s").toBeGreaterThan(17)
    expect(faded?.at, "opacity lands at its entry's 0.2 s").toBeLessThan(23)
    expect(faded?.body, "y still on its way").toMatch(/translateY\((1[0-9]|[5-9])\.?[\d]*px\)/)
  })

  it("AR17: a value's own transition beside a forever repeat has no rule; a layout entry alone plays (#301)", () => {
    const quick = { type: "tween", duration: 0.3, ease: Easing.linear } as const
    const html = page(() => (
      <>
        <wardic.div data-k="entry" {...rise} transition={{ ...quick, opacity: { ...quick, repeat: Number.POSITIVE_INFINITY } }} />
        <wardic.div data-k="own" {...rise} transition={{ ...quick, repeat: Number.POSITIVE_INFINITY, opacity: quick }} />
        <wardic.div data-k="default" {...rise} transition={{ ...quick, repeat: Number.POSITIVE_INFINITY, default: quick }} />
        <wardic.div data-k="layout" {...rise} transition={{ ...quick, repeat: Number.POSITIVE_INFINITY, layout: quick }} />
      </>
    ))
    const css = headCss(html)
    const animationOf = (k: string): string => timing(css, propertyOf(tagsOf(html).find((t) => t.attrs["data-k"] === k)?.style.animation)).normal
    expect(animationOf("entry"), "an entry that repeats: no rule").toBe("")
    expect(animationOf("own"), "own fields that repeat beside an entry: no rule").toBe("")
    expect(animationOf("default"), "own fields that repeat, every key on default: no rule").toBe("")
    expect(animationOf("layout"), "a layout entry alone: the cycle plays").toMatch(/ 0\.6s linear 0s infinite /)
  })
})

/** A list item's dynamic variant (#277): its delay from its index, `custom`. */
const ITEM: WardicVariants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({ opacity: 1, transition: { type: "tween", duration: 0.3, ease: Easing.linear, delay: i * 0.25 } }),
}
