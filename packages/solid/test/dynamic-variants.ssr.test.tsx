// Dynamic variants in a server render (#277, ADR-0048): the Starting style resolves a function
// variant with the element's `custom`, and no values yet.
//
// - DS1: `initial` names a function variant: the server renders where it resolves.
// - DS2: through a `createWard` spread.
import { createWard, wardic, type WardicVariants } from "@wardic/solid"
import type { JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr-helpers.ts"

const SLIDES: WardicVariants = {
  enter: (d: number) => ({ x: d * 100, opacity: 0 }),
  center: { x: 0, opacity: 1 },
}

describe("dynamic variants in a server render (#277)", () => {
  it("DS1: initial names a function variant: rendered where it resolves", () => {
    const div = tagsOf(serve(() => <wardic.div custom={-1} variants={SLIDES} initial="enter" animate="center" />)).find((t) => t.name === "div")
    expect(div?.style["transform"]).toBe("translateX(-100px)")
    expect(div?.style["opacity"]).toBe("0")
  })

  it("DS2: through a createWard spread", () => {
    function Slide(): JSX.Element {
      const ward = createWard({ custom: 1, variants: SLIDES, initial: "enter", animate: "center" })
      return <section {...ward({})} />
    }
    expect(tagsOf(serve(() => <Slide />)).find((t) => t.name === "section")?.style["transform"]).toBe("translateX(100px)")
  })
})
