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
// - AR7: a forever-repeating tween: an `infinite` cycle, its own delay in `animation-delay`.
// - AR8: the markup's hydration keys are the same with or without it.
// - AR9: a render with no `</head>` drops the style, and its elements keep their Starting style.
// - AR10: a component wrap passes its `animation` through `style`.
// - AR11: a spec's key doesn't hang on its keys' order; an easing with no name gives none.
// - AR12 (#245): an svg-inner element's attributes play as CSS; a group whose rules write SVG
//   geometry is defined, whole, under one `@supports`, its reduced block too; one that writes none
//   isn't; `width` still keeps its Starting style.
// - AR13 (#245): a layout node plays, drawn through its projection at rest as the client draws it:
//   its Starting style and its rule leave its own `x` and `y` out, keep its rotate and opacity, and
//   its rule is named apart from a plain element's.
import { DomLive } from "@wardic/dom"
import * as Appear from "@wardic/dom/Appear"
import * as Easing from "@wardic/core/Easing"
import { createWard, wardic, WardicProvider } from "@wardic/solid"
import type { JSX } from "solid-js"
import { renderToString } from "solid-js/web"
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
        <wardic.div {...rise} transition={{ type: "tween", easing: anonymous }} />
        <wardic.div {...rise} style={own} />
        <wardic.div {...rise} transition={{ type: "tween", easing: Easing.cubicBezier(0.4, 0, 0.2, 1) }} />
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
    const delays = (transition: Record<string, unknown>) => {
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
    const at = (from: Record<string, number>, to: Record<string, number>, easing: (t: number) => number = Easing.linear) =>
      keyOf({ tag: "div", from, to, transition: { type: "tween", duration: 0.3, easing }, reduced: false, layout: false })
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

  it("AR13: a layout node plays, its own x and y left out of its Starting style and its rule (#245)", () => {
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
    // The Starting style: the rotate and opacity, no translate, as the client's first commit draws it.
    for (const k of ["layout", "shared"]) {
      expect(div(k)?.style.transform, k).toBe("rotate(10deg)")
      expect(div(k)?.style.opacity, k).toBe("0")
    }
    expect(div("plain")?.style.transform).toBe("translateY(40px) rotate(10deg)")
    const article = tagsOf(html).find((t) => t.name === "article")
    expect(article?.style.transform, "a component wrap's too").toBe("rotate(10deg)")
    const wrapName = timing(css, propertyOf(article?.style.animation)).normal.split(" ")[0]!
    expect(new RegExp(`@keyframes ${wrapName}\\{(.*?\\})\\}`).exec(css)?.[1], "its rule draws the same").toBe(ruleOf("layout").body)
    // Its rule: the same, every stop.
    const layout = ruleOf("layout")
    expect(layout.body.startsWith("0%{transform:rotate(10deg);opacity:0}"), layout.body).toBe(true)
    expect(layout.body).not.toContain("translate")
    expect(ruleOf("shared").name, "a layoutId node's too").toBe(layout.name)
    const plain = ruleOf("plain")
    expect(plain.body.startsWith("0%{transform:translateY(40px) rotate(10deg);opacity:0}"), plain.body).toBe(true)
    expect(plain.name, "named apart: the client's spec names it the same").not.toBe(layout.name)
    // Only its own x animating: nothing it draws moves, one stop at rest.
    expect(div("slide")?.style.transform).toBe("none")
    expect(ruleOf("slide").body).toBe("0%,100%{transform:none}")
  })
})
