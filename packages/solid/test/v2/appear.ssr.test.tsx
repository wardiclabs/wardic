// Appear animations on Solid 2, the server half (#209 PR 4a, ADR-0044, ADR-0045): the Solid 1
// binding's AR cases (`../appear.ssr.test.tsx`) on `@solidjs/web`. The head's `<style>` goes through
// the head registry (`useHead`, registered on the server only); a late `<Loading>` chunk's rules
// stream with the chunk as a head patch, which Solid's own `$df` appends to the head when the chunk
// lands, where Solid 1 needed a `<style>` in the chunk and `Appear.adoptChunks`.
//
// - AR1: a qualifying element gets `animation: var(--wardic-aN)`, and the head its rule and timing.
// - AR2: the provider's `appear={false}` and an element's own turn it off; so does `initial={false}`.
// - AR3: an element the server can't play keeps its Starting style alone.
// - AR4: reduced motion: `"user"` adds the reduced rules under the media query; `"always"` and
//   `"never"` write one set.
// - AR5: a Variant child's stagger: `delayChildren` plus its place, by `from` and `staggerDirection`.
// - AR6: `when`: a child starts once its parent settles; a parent once its last child does.
// - AR7: a forever-repeating tween: an `infinite` cycle, its own delay in `animation-delay`.
// - AR8: the markup's hydration keys are the same with or without it: the provider's head
//   registration, made on the server only, takes no id.
// - AR9: a render with no `</head>` and no `onHead` drops the style; its elements keep their
//   Starting style.
// - AR10: a component wrap and a kept ward's spread pass their animation through `style`.
// - AR12: SVG attributes play as CSS; a group writing geometry is defined whole under one `@supports`.
// - AR13 (#363): a layout node plays, its own `x` and `y` drawn on its projection in its Starting style and its rule.
// - AR14: a stream's late chunk brings its own rules as a head patch: the rules the head didn't send
//   and the chunk's slots; the shell group's late children staggered among themselves from 0; a
//   group led in the chunk as in the shell; the head holding none of the chunk's slots. An element
//   whose own component ran in the shell pass (only its children pend) is the shell's: Solid 2 runs
//   a `<Loading>` subtree's components then, where Solid 1 re-rendered a `Suspense` subtree whole.
// - AR15: a late chunk of kept wards alone brings its rules too (Solid 1 left them at their
//   Starting style: only `wardic.*` could render the chunk's `<style>`).
// - AR16: no element plays: the head gets no `<style>` at all.
// - AR17 (#301): a transition's entries time each key in the rule: a fast `opacity` entry lands a
//   fifth of the way through a rule the slow own fields set the length of.
// - AR18 (#257 item 1): a ward whose `animate` reads an async memo, under `<Loading>`: its region
//   streams once the data is in (a server waits for it and renders the component again), its rule
//   running from `initial` to the fetched target.
// - AR19 (#257 item 1): a key setup fixes, still loading on a server, is the client's error too, and
//   so is a pending `animate` with `initial={false}`.
// - AR20 (#434): a `WardicConfig`'s transition times the rule of an element with none of its own;
//   one with its own keeps it, and an inner config with `inherit: true` lays its delay over it.
import { DomLive } from "@wardic/dom"
import * as Appear from "@wardic/dom/Appear"
import * as Easing from "@wardic/core/Easing"
import { ward, wardic, WardicConfig, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import { type JSX, renderToStream, renderToString } from "@solidjs/web"
import * as Option from "effect/Option"
import { createMemo, Errored, For, Loading, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { keyOf } from "../../src/appear.ts"
import { tagsOf } from "./ssr.ts"

type ProviderProps = { readonly appear?: boolean; readonly reducedMotion?: "user" | "always" | "never" }

/** A whole document with a head, as a start-mode app renders it, and `ui` under a provider. */
const page = (ui: () => JSX.Element, provider: ProviderProps = {}): string =>
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

/**
 * The head patches a streamed write carries (`_$HY.hp[id] = [[op, key, tag, attrs, text], …]`, which
 * `$df` applies when its chunk lands): each Appear `<style>`'s text.
 */
const appearPatches = (write: string): ReadonlyArray<string> =>
  [...write.matchAll(/\(_\$HY\.hp=_\$HY\.hp\|\|\{\}\)\["[^"]+"\]=(\[\[[\s\S]*?\]\]);/g)].flatMap((m) =>
    (JSON.parse(m[1]!) as ReadonlyArray<ReadonlyArray<unknown>>)
      .filter((patch) => patch[2] === "style" && Object.hasOwn((patch[3] ?? {}) as object, "data-wardic-appear"))
      .map((patch) => String(patch[4])))

const rise = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } } as const

describe("Appear animations on a server, on Solid 2 (#48, ADR-0044)", () => {
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
        {/* eslint-disable-next-line solid/style-prop -- a string style is what this element checks */}
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
    const Card = () => {
      const card = ward(rise)
      return <aside {...card} />
    }
    const ui = () => (
      <>
        <wardic.ul initial="hidden" animate="shown" variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}>
          <wardic.li variants={{ hidden: { x: -10 }, shown: { x: 0 } }} />
          <wardic.li variants={{ hidden: { x: -10 }, shown: { x: 0 } }} />
        </wardic.ul>
        <Card />
        <For each={[0, 1]}>{() => <wardic.p {...rise} />}</For>
      </>
    )
    const keys = (html: string) => [...html.matchAll(/_hk=([^\s>"]+)/g)].map((m) => m[1])
    const on = keys(page(ui))
    expect(on.length, "the markup has keys").toBeGreaterThan(3)
    expect(on).toEqual(keys(page(ui, { appear: false })))
  })

  it("AR9: a render with no </head> and no onHead drops the style; its elements keep their Starting style", () => {
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

  it("AR10: a component wrap and a kept ward's spread pass their animation through style", () => {
    const Card = (p: { readonly ref?: JSX.Ref<HTMLElement>; readonly style?: JSX.CSSProperties | string }) => <article ref={p.ref} style={p.style} />
    const WCard = wardic.create(Card)
    const Spread = () => {
      const card = ward(rise)
      return <aside {...card} />
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
    const [plain, media = ""] = css.split("@media (prefers-reduced-motion: reduce)")
    const guarded = (text: string) => /@supports \(cx:0px\) and \(r:0px\)\{:root\{([^}]*)\}\}/.exec(text)?.[1] ?? ""
    for (const name of ["g", "circle", "path"]) {
      expect(property(name), name).not.toBe("")
      expect(guarded(plain!), name).toContain(`${property(name)}:`)
      expect(guarded(media), `${name} reduced`).toContain(`${property(name)}:`)
    }
    const rect = tagsOf(html).find((t) => t.name === "rect" && t.attrs["data-k"] === undefined)
    const rectProperty = propertyOf(rect?.style.animation)
    expect(rectProperty).not.toBe("")
    expect(guarded(plain!)).not.toContain(rectProperty)
    expect(/(?:^|\})(:root\{[^}]*\})/.exec(plain!)?.[1]).toContain(`${rectProperty}:`)
    const sized = tagsOf(html).find((t) => t.attrs["data-k"] === "sized")
    expect(timing(css, propertyOf(sized?.style.animation)).normal).toBe("")
  })

  it("AR13: a layout node plays, drawn through its projection at rest, its own translate on top (#245, #363)", () => {
    const entrance = { initial: { opacity: 0, y: 40, rotate: 10 }, animate: { opacity: 1, y: 0, rotate: 0 } } as const
    const Card = (p: { readonly ref?: JSX.Ref<HTMLElement>; readonly style?: JSX.CSSProperties | string }) => <article ref={p.ref} style={p.style} />
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
    for (const k of ["layout", "shared"]) {
      expect(div(k)?.style.transform, k).toBe("translate3d(0px, 40px, 0px) rotate(10deg)")
      expect(div(k)?.style.opacity, k).toBe("0")
    }
    expect(div("plain")?.style.transform).toBe("translateY(40px) rotate(10deg)")
    const article = tagsOf(html).find((t) => t.name === "article")
    expect(article?.style.transform, "a component wrap's too").toBe("translate3d(0px, 40px, 0px) rotate(10deg)")
    const wrapName = timing(css, propertyOf(article?.style.animation)).normal.split(" ")[0]!
    expect(new RegExp(`@keyframes ${wrapName}\\{(.*?\\})\\}`).exec(css)?.[1], "its rule draws the same").toBe(ruleOf("layout").body)
    const layout = ruleOf("layout")
    expect(layout.body.startsWith("0%{transform:translate3d(0px, 40px, 0px) rotate(10deg);opacity:0}"), layout.body).toBe(true)
    expect(ruleOf("shared").name, "a layoutId node's too").toBe(layout.name)
    const plain = ruleOf("plain")
    expect(plain.body.startsWith("0%{transform:translateY(40px) rotate(10deg);opacity:0}"), plain.body).toBe(true)
    expect(plain.name, "named apart: the client's spec names it the same").not.toBe(layout.name)
    expect(div("slide")?.style.transform).toBe("translate3d(-30px, 0px, 0px)")
    expect(ruleOf("slide").body.startsWith("0%{transform:translate3d(-30px, 0px, 0px)}"), ruleOf("slide").body).toBe(true)
    expect(ruleOf("slide").body, "it slides home").toContain("100%{transform:none}")
  })

  /** Stream `ui` as a document under a provider, each write as the stream sent it. */
  const stream = (ui: () => JSX.Element): Promise<ReadonlyArray<string>> => {
    const writes: Array<string> = []
    return new Promise((resolve) => {
      renderToStream(() => (
        <html>
          <head>
            <title>t</title>
          </head>
          <body>
            <WardicProvider env={DomLive}>{ui()}</WardicProvider>
          </body>
        </html>
      )).pipe({ write: (v) => void writes.push(v), end: () => resolve(writes) })
    })
  }

  /** A value an async memo gives after `ms`, read under `<Loading>`. */
  const after = <A,>(ms: number, value: A) =>
    createMemo(async () => {
      await new Promise((r) => setTimeout(r, ms))
      return value
    })

  it("AR14: a stream's late chunk brings its own rules as a head patch (#245)", async () => {
    const items = { hidden: { opacity: 0, y: 20 }, shown: { opacity: 1, y: 0 } }
    const writes = await stream(() => {
      const data = after(20, [0, 1, 2])
      const later = after(60, "later")
      return (
        <>
          <wardic.h1 data-k="title" {...rise} />
          <wardic.ul
            data-k="list"
            initial="hidden"
            animate="shown"
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
            transition={{ type: "tween", duration: 0.3, staggerChildren: 0.1, when: "beforeChildren" }}
          >
            <wardic.li data-k="shell" variants={items} />
            <Loading fallback={<li>loading</li>}>
              <For each={data()}>{(i) => <wardic.li data-k={`late${i}`} variants={items} />}</For>
              {/* Made by the data, so made late: a component that reads none runs in the shell pass. */}
              <Show when={data()}>
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
              </Show>
            </Loading>
          </wardic.ul>
          <Loading fallback={<p>loading</p>}>
            <wardic.p data-k="second" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
              {later()}
            </wardic.p>
          </Loading>
        </>
      )
    })
    const shell = writes[0]!
    const chunks = writes.slice(1).filter((w) => w.includes("<template"))
    expect(chunks, "two chunks").toHaveLength(2)
    const chunk = chunks.find((w) => w.includes('data-k="late0"'))!
    const second = chunks.find((w) => w.includes('data-k="second"'))!
    expect(chunk.includes("<style"), "no <style> in the chunk's markup").toBe(false)
    const [css = ""] = appearPatches(chunk)
    expect(appearPatches(chunk), "one Appear head patch a chunk").toHaveLength(1)
    const head = headCss(shell)
    // An element whose own component ran in the shell is the shell's, though its markup streams
    // later: Solid 2 runs a `<Loading>` subtree's components in the shell pass and holds only the
    // pending reads (here the `<p>`'s text). Its rule and timing are in the head; its CSS starts when
    // its chunk is inserted. The chunk brings no patch of its own.
    const secondTag = tagsOf(second).find((t) => t.attrs["data-k"] === "second")
    expect(timing(head, propertyOf(secondTag?.style.animation)).normal, "the second chunk's element, in the head").not.toBe("")
    expect(appearPatches(second), "nothing new in its chunk").toEqual([])
    const tag = (k: string) => tagsOf(chunk).find((t) => t.attrs["data-k"] === k) ?? tagsOf(shell).find((t) => t.attrs["data-k"] === k)
    const late = (k: string) => timing(css, propertyOf(tag(k)?.style.animation))
    // The late title shares the shell title's rule: not sent again.
    const titleRule = timing(head, propertyOf(tag("title")?.style.animation)).normal.split(" ")[0]!
    expect(late("late-title").normal.split(" ")[0]).toBe(titleRule)
    expect(css).not.toContain(`@keyframes ${titleRule}{`)
    // The shell's group: its own child waits for the leader; its late children are a fresh mount
    // from the chunk's landing, staggered among themselves.
    expect(delayOf(timing(head, propertyOf(tag("shell")?.style.animation)).normal), "the shell child waits").toBeGreaterThan(0.29)
    expect(["late0", "late1", "late2"].map((k) => delayOf(late(k).normal))).toEqual([0, 0.1, 0.2])
    expect(["late0", "late1", "late2"].map((k) => late(k).reduced), "the reduced block too").not.toContain("")
    // A group led in the chunk, as in the shell: its items, each in a plain wrapper, are timed together.
    expect(["own0", "own1"].map((k) => delayOf(late(k).normal))).toEqual([0, 0.05])
    // The head holds the shell's slots only.
    expect(timing(head, propertyOf(tag("shell")?.style.animation)).normal).not.toBe("")
    for (const k of ["late0", "late-title", "own0"]) expect(timing(head, propertyOf(tag(k)?.style.animation)).normal, k).toBe("")
  })

  it("AR15: a late chunk of kept wards alone brings its rules too", async () => {
    const Card = (props: { readonly k: string }) => {
      const card = ward(rise)
      return <aside {...card} data-k={props.k} />
    }
    const writes = await stream(() => {
      const data = after(20, ["a", "b"])
      return (
        <Loading fallback={<p>loading</p>}>
          <For each={data()}>{(k) => <Card k={k} />}</For>
        </Loading>
      )
    })
    const chunk = writes.slice(1).find((w) => w.includes('data-k="a"'))!
    const patches = appearPatches(chunk)
    expect(patches.filter((css) => css !== ""), "one style with the chunk's rules").toHaveLength(1)
    for (const k of ["a", "b"]) {
      const aside = tagsOf(chunk).find((t) => t.attrs["data-k"] === k)
      expect(timing(patches[0]!, propertyOf(aside?.style.animation)).normal, k).not.toBe("")
    }
  })

  it("AR16: no element plays: the head gets no <style> at all", () => {
    const html = page(() => <wardic.div animate={{ opacity: 1 }} />)
    expect(html).not.toContain("data-wardic-appear")
  })

  it("AR17: a transition's entries time each key in the rule (#301)", () => {
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

  it("AR18: a ward's animate from an async memo: its region streams once the data is in, its rule to the fetched target (#257 item 1)", async () => {
    const Card = () => {
      const x = after(20, 100)
      const card = ward({ initial: { x: 0, opacity: 0 }, animate: () => ({ x: x(), opacity: 1 }), transition: { type: "tween", duration: 0.3 } })
      return <div {...card} data-k="card" />
    }
    const writes = await stream(() => (
      <Loading fallback={<p>loading</p>}>
        <Card />
      </Loading>
    ))
    expect(writes[0], "not in the shell: its region waits").not.toContain('data-k="card"')
    const chunk = writes.slice(1).find((w) => w.includes('data-k="card"'))!
    expect(chunk, "in a late chunk").toBeDefined()
    const css = appearPatches(chunk).join("")
    const div = tagsOf(chunk).find((t) => t.attrs["data-k"] === "card")
    const name = timing(css, propertyOf(div?.style.animation)).normal.split(" ")[0]!
    const body = new RegExp(`@keyframes ${name}\\{(.*?\\})\\}`).exec(css)?.[1] ?? ""
    expect(body, "from initial").toContain("0%{transform:none;opacity:0}")
    expect(body, "to the fetched target").toContain("100%{transform:translateX(100px);opacity:1}")
  })

  it("AR19: a key setup fixes, still loading on a server, is the client's error", () => {
    const Card = () => {
      const layout = after(20, true as const)
      const card = ward({ animate: { x: 100 }, layout: () => layout() })
      return <div {...card} data-k="card" />
    }
    const html = renderToString(() => (
      <WardicProvider env={DomLive}>
        <Errored fallback={(err) => <p data-err>{String((err() as Error).message)}</p>}>
          <Card />
        </Errored>
      </WardicProvider>
    ))
    expect(html).toContain("ward(config): `layout` was still loading when the ward was made.")
    // So is a pending `animate` a ward would start at.
    const Starting = () => {
      const x = after(20, 100)
      const card = ward({ initial: false, animate: () => ({ x: x() }) })
      return <div {...card} data-k="card" />
    }
    const starting = renderToString(() => (
      <WardicProvider env={DomLive}>
        <Errored fallback={(err) => <p data-err>{String((err() as Error).message)}</p>}>
          <Starting />
        </Errored>
      </WardicProvider>
    ))
    expect(starting).toContain("with `initial={false}` a ward starts there")
  })

  it("AR20: a WardicConfig's transition times an element with none of its own; inherit: true lays its delay over it (#434)", () => {
    const rise = { initial: { opacity: 0 }, animate: { opacity: 1 } } as const
    const html = page(() => (
      <WardicConfig transition={{ type: "tween", duration: 1.5, ease: Easing.linear }}>
        <wardic.div data-k="config" {...rise} />
        <wardic.div data-k="own" {...rise} transition={{ type: "tween", duration: 0.2, ease: Easing.linear }} />
        <WardicConfig transition={{ inherit: true, delay: 0.25 }}>
          <wardic.div data-k="inherits" {...rise} />
        </WardicConfig>
      </WardicConfig>
    ))
    const css = headCss(html)
    const tag = (k: string) => tagsOf(html).find((t) => t.attrs["data-k"] === k)
    const animationOf = (k: string): string => timing(css, propertyOf(tag(k)?.style.animation)).normal
    expect(animationOf("config"), "the config's 1.5 s").toMatch(/ 1\.5s linear 0s /)
    expect(animationOf("own"), "its own 0.2 s").toMatch(/ 0\.2s linear 0s /)
    expect(animationOf("inherits"), "the outer 1.5 s after its 0.25 s, held in the rule").toMatch(/ 1\.75s linear 0s /)
  })
})
