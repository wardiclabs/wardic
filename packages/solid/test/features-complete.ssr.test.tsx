// The Complete element on a server render (#511, ADR-0067 decision 2): it brings every Feature, so
// with none given it registers `colors`' spaces itself, and its Appear rule blends an `oklch()`
// entrance in sRGB, as before the split. A file of its own: culori's registry is the process's.
import { DomLive } from "@wardic/dom"
import * as Color from "@wardic/dom/Color"
import { wardic, WardicProvider } from "@wardic/solid"
import { renderToString } from "solid-js/web"
import { expect, it } from "vitest"

it("FC1: wardic.div registers every colour space on a server, with no Feature given", () => {
  expect(Color.spacesRegistered()).toBe(false)
  const html = renderToString(() => (
    <html>
      <head>
        <title>t</title>
      </head>
      <body>
        <WardicProvider env={DomLive}>
          <wardic.div initial={{ "background-color": "oklch(0.5 0.1 200)" }} animate={{ "background-color": "oklch(0.7 0.3 100)" }} transition={{ type: "tween", duration: 0.4 }} />
        </WardicProvider>
      </body>
    </html>
  ))
  expect(Color.spacesRegistered()).toBe(true)
  const css = /<style data-wardic-appear[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ""
  expect(css).toContain("rgb(")
  expect(css).not.toContain("oklch(0.6")
})
