// Variant name lists in a server render (#297, ADR-0007): the Starting style merges a list's names in
// order, and a Variant child resolves the names it has from the list its parent hands down.
//
// - VS1: `initial` with a list: rendered merged, a later name's winning a key both set.
// - VS2: a Variant child with no `initial` of its own starts from its parent's list, the names it has.
// - VS3: `initial={false}` with an `animate` list: rendered at the merged `animate`.
// - VS4: an Appear animation to an `animate` list ends where the list merges, a later name's key winning.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import { renderToString } from "solid-js/web"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr-helpers.ts"

const CARD: WardicVariants = { hidden: { opacity: 0, x: 10 }, left: { x: -40 }, shown: { opacity: 1, x: 0 }, wide: { scale: 2 } }

describe("variant name lists in a server render (#297)", () => {
  it("VS1: initial with a list: rendered merged, a later name winning a key both set", () => {
    const div = tagsOf(serve(() => <wardic.div variants={CARD} initial={["hidden", "left"]} animate="shown" />)).find((t) => t.name === "div")
    expect(div?.style["opacity"]).toBe("0")
    expect(div?.style["transform"]).toBe("translateX(-40px)")
  })

  it("VS2: a Variant child starts from its parent's list, the names it has", () => {
    const label: WardicVariants = { hidden: { opacity: 0.25 } }
    const tags = tagsOf(
      serve(() => (
        <wardic.div variants={CARD} initial={["hidden", "left"]} animate={["shown", "wide"]}>
          <wardic.span variants={label} />
        </wardic.div>
      )),
    )
    expect(tags.find((t) => t.name === "span")?.style["opacity"]).toBe("0.25")
  })

  it("VS3: initial={false} with an animate list: rendered at the merged animate", () => {
    const div = tagsOf(serve(() => <wardic.div variants={CARD} initial={false} animate={["shown", "wide"]} />)).find((t) => t.name === "div")
    expect(div?.style["opacity"]).toBe("1")
    expect(div?.style["transform"]).toBe("scale(2)")
  })

  it("VS4: an Appear animation to an animate list ends where the list merges", () => {
    const variants: WardicVariants = { low: { opacity: 0, x: 0 }, near: { opacity: 1, x: 10 }, far: { x: 30 } }
    const html = renderToString(() => (
      <html>
        <head>
          <title>t</title>
        </head>
        <body>
          <WardicProvider env={DomLive}>
            <wardic.div variants={variants} initial="low" animate={["near", "far"]} />
          </WardicProvider>
        </body>
      </html>
    ))
    const css = /<style data-wardic-appear[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ""
    expect(css, "an Appear rule").toContain("@keyframes")
    expect(css, "far's x, the later name's").toContain("translateX(30px)")
    expect(css, "not near's").not.toContain("translateX(10px)")
  })
})
