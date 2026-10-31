// `transformTemplate` on a server, Solid 2 (#443): Solid 1's TTS cases on `@solidjs/web`.
//
// - TTSV1: the Starting style is drawn through it: a transform key, none, a layout node at rest, a
//   routed `style` key, and a ward's config key.
// - TTSV2: an Appear rule's stops are drawn through it, its rule named apart from the same mount's
//   with no template.
import { DomLive } from "@wardic/dom"
import * as Appear from "@wardic/dom/Appear"
import { ward, wardic, type WardicTransformTemplate, WardicProvider } from "@wardic/solid/unstable/v2"
import { type JSX, renderToString } from "@solidjs/web"
import { describe, expect, it } from "vitest"
import { tagsOf } from "./ssr.ts"

/** A whole document with a head, as a start-mode app renders it, and `ui` under a provider. */
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

describe("transformTemplate on a server, Solid 2 (#443)", () => {
  it("TTSV1: the Starting style is drawn through it", () => {
    const Card = () => {
      const card = ward({ initial: { x: 15 }, transformTemplate: rotated })
      return <div data-k="ward" {...card()} />
    }
    const html = page(() => (
      <>
        <wardic.div data-k="key" initial={{ x: 10 }} transformTemplate={rotated} />
        <wardic.div data-k="none" initial={{ opacity: 0 }} transformTemplate={rotated} />
        <wardic.div data-k="layout" layout initial={{ y: 40 }} transformTemplate={rotated} />
        <wardic.div data-k="routed" style={{ x: 5 }} transformTemplate={rotated} />
        <Card />
      </>
    ))
    const style = (k: string) => tagsOf(html).find((t) => t.attrs["data-k"] === k)?.style
    expect(style("key")?.transform).toBe("rotate(10deg) translateX(10px)")
    expect(style("none")?.transform, "with no transform key").toBe("rotate(10deg)")
    expect(style("layout")?.transform, "a layout node at rest, as at a plain render").toBe("rotate(10deg) translateY(40px)")
    expect(style("routed")?.transform, "a routed style key").toBe("rotate(10deg) translateX(5px)")
    expect(style("ward")?.transform, "a ward's config key").toBe("rotate(10deg) translateX(15px)")
  })

  it("TTSV2: an Appear rule's stops are drawn through it, named apart from the same mount's with none", () => {
    const html = page(() => (
      <>
        <wardic.div data-k="t" initial={{ x: 20 }} animate={{ x: 0 }} transformTemplate={rotated} />
        <wardic.div data-k="plain" initial={{ x: 20 }} animate={{ x: 0 }} />
      </>
    ))
    const css = headCss(html)
    const name = (k: string) => ruleNameOf(css, tagsOf(html).find((t) => t.attrs["data-k"] === k)?.style.animation)
    const body = (k: string) => new RegExp(`@keyframes ${name(k)}\\{(.*?\\})\\}`).exec(css)?.[1] ?? ""
    expect(name("t").startsWith(Appear.PREFIX)).toBe(true)
    expect(body("t")).toMatch(/^0%\{transform:rotate\(10deg\) translateX\(20px\)\}/)
    expect(body("t")).toMatch(/100%\{transform:rotate\(10deg\)\}$/)
    expect(name("t")).not.toBe(name("plain"))
  })
})
