// Features on a server render (#511, ADR-0067), the Solid 2 binding, as `../features.ssr.test.tsx` is
// on Solid 1's. A server builds no runtime, so a Feature's `server` part is what it does there:
// `colors` registers its spaces, as the render's Appear animations read colours. culori's registry is
// the process's, so the cases run in order. A Complete element's registration is
// `features-complete.ssr.test.tsx`'s, a file of its own.
// - FV1, a Slim element with no `colors`: its `oklch()` entrance is read as a complex value, its
//   numbers blended as written into its Appear rule. A lazy `LazyWardic` loads nothing on a server.
// - FV2, a provider's `colors`, given at once, registers its spaces as the render starts: the rule
//   blends in sRGB.
import { DomLive } from "@wardic/dom"
import * as Color from "@wardic/dom/Color"
import { colors, type FeaturesProp, LazyWardic, w, WardicProvider } from "@wardic/solid/unstable/v2"
import { type JSX, renderToString } from "@solidjs/web"
import { describe, expect, it } from "vitest"

/** A whole document with a head, `ui` under a provider with `features`. */
const page = (ui: () => JSX.Element, features?: FeaturesProp): string =>
  renderToString(() => (
    <html>
      <head>
        <title>t</title>
      </head>
      <body>
        <WardicProvider env={DomLive} features={features}>
          {ui()}
        </WardicProvider>
      </body>
    </html>
  ))

/** The head's Appear style, or "". */
const headCss = (html: string): string => /<style data-wardic-appear[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ""

const ENTRANCE = { initial: { "background-color": "oklch(0.5 0.1 200)" }, animate: { "background-color": "oklch(0.7 0.3 100)" }, transition: { type: "tween", duration: 0.4 } } as const

describe("Features on a server render (#511), Solid 2", () => {
  it("FV1: with no colors, a Slim element's oklch() entrance blends as written; a lazy load loads nothing", () => {
    expect(Color.spacesRegistered()).toBe(false)
    const slim = headCss(page(() => <w.div {...ENTRANCE} />))
    expect(slim).toContain("oklch(0.6")
    expect(slim).not.toContain("rgb(")
    const lazy = headCss(page(() => <LazyWardic features={() => Promise.resolve([colors])}><w.div {...ENTRANCE} /></LazyWardic>))
    expect(lazy).toBe(slim)
    expect(Color.spacesRegistered()).toBe(false)
  })

  it("FV2: a provider's colors registers its spaces as the render starts", () => {
    const css = headCss(page(() => <w.div {...ENTRANCE} />, [colors]))
    expect(Color.spacesRegistered()).toBe(true)
    expect(css).toContain("rgb(")
    expect(css).not.toContain("oklch(0.6")
  })
})
