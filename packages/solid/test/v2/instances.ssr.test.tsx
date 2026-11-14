// A Wardic instance on a server render (#516, ADR-0067 *Amendment (#516)*), the Solid 2 binding. A server
// builds no runtime and loads nothing lazily; a Feature's `server` part is what it does there. culori's
// registry is the process's, so the cases run in order.
// - INV8: an instance's element renders; a load in its list doesn't start, the render as it would be
//   without it; `colors`, given at once, registers its spaces as the element renders.
import { DomLive } from "@wardic/dom"
import * as Color from "@wardic/dom/Color"
import { colors, createWardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { type JSX, renderToString } from "@solidjs/web"
import { describe, expect, it } from "vitest"

/** A whole document with a head, `ui` under a provider given no Features. */
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

const ENTRANCE = { initial: { "background-color": "oklch(0.5 0.1 200)" }, animate: { "background-color": "oklch(0.7 0.3 100)" }, transition: { type: "tween", duration: 0.4 } } as const

describe("A Wardic instance on a server render (#516), Solid 2", () => {
  it("INV8: its element renders, a load doesn't start, and colors given at once registers its spaces", () => {
    let calls = 0
    const later = createWardic([
      (): Promise<typeof colors> => {
        calls += 1
        return Promise.resolve(colors)
      },
    ])
    const html = page(() => <later.w.div data-k="later" {...ENTRANCE} />)
    expect(html, "its element renders").toContain('data-k="later"')
    expect(calls, "no load on a server").toBe(0)
    expect(Color.spacesRegistered(), "nothing registered").toBe(false)
    expect(headCss(html), "its oklch() entrance blends as written").toContain("oklch(0.6")

    const given = createWardic([colors])
    const css = headCss(page(() => <given.w.div {...ENTRANCE} />))
    expect(Color.spacesRegistered(), "colors' server part ran").toBe(true)
    expect(css).toContain("rgb(")
    expect(css).not.toContain("oklch(0.6")
  })
})
