// `transformTemplate` on a server, Solid 1 (#443): what it returns is the element's transform in the
// markup, and in its Appear animation's rule.
//
// - TTS1: the Starting style is drawn through it: a transform key, none, a layout node at rest (as at
//   a plain render, its keys in Motion's units), and a routed `style` key.
// - TTS2: an Appear rule's stops are drawn through it. A templated rule is named by its stops: apart
//   from the same mount with no template, and shared by two templates that draw the same.
import { DomLive } from "@wardic/dom"
import * as Appear from "@wardic/dom/Appear"
import { wardic, type WardicTransformTemplate, WardicProvider } from "@wardic/solid"
import type { JSX } from "solid-js"
import { renderToString } from "solid-js/web"
import { describe, expect, it } from "vitest"
import { tagsOf } from "./ssr-helpers.ts"

/** A whole document with a head, as SolidStart renders it, and `ui` under a provider. */
const page = (ui: () => JSX.Element): string =>
  renderToString(() => (
    <html>
      <head>
        <title>t</title>
      </head>
      <body>
        <WardicProvider env={DomLive}>{ui()}</WardicProvider>
      </body>
    </html>
  ))

/** The head's Appear style, or "". */
const headCss = (html: string): string => /<style data-wardic-appear[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ""

/** The rule name an element's inline animation plays, through the head's `:root` timing. */
const ruleNameOf = (css: string, animation: string | undefined): string => {
  const property = /var\((--wardic-a\d+)\)/.exec(animation ?? "")?.[1] ?? ""
  return new RegExp(`${property}:([^ ;}]*)`).exec(css)?.[1] ?? ""
}

const rotated: WardicTransformTemplate = (_, generated) => `rotate(10deg) ${generated}`.trim()
const centred: WardicTransformTemplate = (_, generated) => `translate(-50%, -50%) ${generated}`.trim()

describe("transformTemplate on a server, Solid 1 (#443)", () => {
  it("TTS1: the Starting style is drawn through it", () => {
    const html = page(() => (
      <>
        <wardic.div data-k="key" initial={{ x: 10 }} transformTemplate={rotated} />
        <wardic.div data-k="none" initial={{ opacity: 0 }} transformTemplate={rotated} />
        <wardic.div data-k="layout" layout initial={{ y: 40 }} transformTemplate={rotated} />
        <wardic.div data-k="routed" style={{ x: 5 }} transformTemplate={rotated} />
        <wardic.div data-k="plain" initial={{ x: 10 }} />
      </>
    ))
    const style = (k: string) => tagsOf(html).find((t) => t.attrs["data-k"] === k)?.style
    expect(style("key")?.transform).toBe("rotate(10deg) translateX(10px)")
    expect(style("none")?.transform, "with no transform key").toBe("rotate(10deg)")
    expect(style("none")?.opacity).toBe("0")
    expect(style("layout")?.transform, "a layout node at rest, as at a plain render").toBe("rotate(10deg) translateY(40px)")
    expect(style("routed")?.transform, "a routed style key").toBe("rotate(10deg) translateX(5px)")
    expect(style("plain")?.transform, "none without one").toBe("translateX(10px)")
  })

  it("TTS2: an Appear rule's stops are drawn through it, its rule named by them", () => {
    const html = page(() => (
      <>
        <wardic.div data-k="a" initial={{ x: 20 }} animate={{ x: 0 }} transformTemplate={centred} />
        <wardic.div data-k="b" initial={{ x: 20 }} animate={{ x: 0 }} transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`.trim()} />
        <wardic.div data-k="c" initial={{ x: 20 }} animate={{ x: 0 }} transformTemplate={rotated} />
        <wardic.div data-k="plain" initial={{ x: 20 }} animate={{ x: 0 }} />
      </>
    ))
    const css = headCss(html)
    const name = (k: string) => ruleNameOf(css, tagsOf(html).find((t) => t.attrs["data-k"] === k)?.style.animation)
    const body = (k: string) => new RegExp(`@keyframes ${name(k)}\\{(.*?\\})\\}`).exec(css)?.[1] ?? ""
    for (const k of ["a", "b", "c", "plain"]) expect(name(k).startsWith(Appear.PREFIX), k).toBe(true)
    expect(body("a")).toMatch(/^0%\{transform:translate\(-50%, ?-50%\) translateX\(20px\)\}/)
    expect(body("a")).toMatch(/100%\{transform:translate\(-50%, ?-50%\)\}$/)
    expect(body("c")).toMatch(/^0%\{transform:rotate\(10deg\) translateX\(20px\)\}/)
    expect(body("plain")).toMatch(/^0%\{transform:translateX\(20px\)\}/)
    expect(name("b"), "two templates that draw the same share a rule").toBe(name("a"))
    expect(new Set([name("a"), name("c"), name("plain")]).size, "named apart").toBe(3)
  })
})
