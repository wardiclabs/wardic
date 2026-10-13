// A custom property in a server render (#151, ADR-0014 *Amendment (#151)*, ADR-0021): the
// Starting style writes it under its own name, and on an svg-inner tag as a style property,
// never an attribute.
import { useWardic, wardic, type WardicValues } from "@wardic/solid"
import type { JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

/** The first `name` tag in `html`. */
const first = (html: string, name: string): Tag | undefined => tagsOf(html).find((t) => t.name === name)

const START = { "--brandLevel": 0.4 } as WardicValues

describe("a custom property in a server render (#151)", () => {
  it("CS1: a wardic.div renders it under its own name", () => {
    const div = first(serve(() => <wardic.div initial={START} />), "div")
    expect(div?.style["--brandLevel"]).toBe("0.4")
    expect(div?.style["--brand-level"]).toBeUndefined()
  })

  it("CS2: a useWardic spread renders it under its own name", () => {
    function Spread(): JSX.Element {
      const ward = useWardic({ initial: START })
      return <section {...ward({})} />
    }
    expect(first(serve(() => <Spread />), "section")?.style["--brandLevel"]).toBe("0.4")
  })

  it("CS3: an svg-inner tag renders it as a style property, not an attribute", () => {
    const circle = first(serve(() => <svg><wardic.circle r={10} initial={{ ...START, cx: 20 } as WardicValues} /></svg>), "circle")
    expect(circle?.style["--brandLevel"]).toBe("0.4")
    expect(circle?.attrs["--brand-level"]).toBeUndefined()
    expect(circle?.attrs["cx"], "an SVG attribute key is still an attribute").toBe("20")
  })
})
