// The Complete element on a server render (#511, ADR-0067 decision 2), the Solid 2 binding: with no
// Feature given, `wardic.div` and `ward()` register `colors`' spaces themselves, and an `oklch()`
// entrance's Appear rule blends in sRGB, as before the split. A file of its own: culori's registry is
// the process's.
import { DomLive } from "@wardic/dom"
import * as Color from "@wardic/dom/Color"
import { ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { type JSX, renderToString } from "@solidjs/web"
import { expect, it } from "vitest"

const ENTRANCE = { initial: { "background-color": "oklch(0.5 0.1 200)" }, animate: { "background-color": "oklch(0.7 0.3 100)" }, transition: { type: "tween", duration: 0.4 } } as const

const cssOf = (ui: () => JSX.Element): string =>
  /<style data-wardic-appear[^>]*>([\s\S]*?)<\/style>/.exec(
    renderToString(() => (
      <html>
        <head>
          <title>t</title>
        </head>
        <body>
          <WardicProvider env={DomLive}>{ui()}</WardicProvider>
        </body>
      </html>
    )),
  )?.[1] ?? ""

it("FC1: wardic.div registers every colour space on a server, with no Feature given", () => {
  expect(Color.spacesRegistered()).toBe(false)
  const css = cssOf(() => <wardic.div {...ENTRANCE} />)
  expect(Color.spacesRegistered()).toBe(true)
  expect(css).toContain("rgb(")
  expect(css).not.toContain("oklch(0.6")
})

it("FC2: so does ward(), the Complete element's spread", () => {
  const Card = (): JSX.Element => <div {...ward(ENTRANCE)} />
  expect(cssOf(() => <Card />)).toContain("rgb(")
})
