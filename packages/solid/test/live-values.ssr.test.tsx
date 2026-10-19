// Live values and transform keys in `style` in a server render (#130, ADR-0043, ADR-0021): the
// Starting style carries their values, under `initial`'s, and the rest of `style` as it is. An
// accessor is called, an Atom read for its own value; nothing runs.
//
// - LF12: a wardic.div renders a transform key and a Live value, `initial` over them, and drops a
//   `transform` string for the keys.
// - LF13: a createWard spread renders an Atom's value, and `ward.value` reads where a key rests.
import { createWard, wardic } from "@wardic/solid"
import { Atom } from "effect/reactivity"
import type { JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

/** The first `name` tag in `html`. */
const first = (html: string, name: string): Tag | undefined => tagsOf(html).find((t) => t.name === name)

describe("Live values in a server render (#130)", () => {
  it("LF12: a wardic.div renders a transform key and a Live value, `initial` over them, and drops a `transform` string", () => {
    const div = first(
      serve(() => <wardic.div style={{ color: "red", transform: "rotate(9deg)", x: 40, scale: 2, opacity: () => 0.3 }} initial={{ scale: 1.5 }} />),
      "div",
    )
    expect(div?.style["transform"]).toBe("translateX(40px) scale(1.5)")
    expect(div?.style["opacity"]).toBe("0.3")
    expect(div?.style["color"]).toBe("red")
    expect(div?.style["scale"], "never the CSS property").toBeUndefined()
  })

  it("LF13: a createWard spread renders an Atom's own value, and ward.value reads where a key rests", () => {
    const y = Atom.make(12)
    let read: Array<unknown> = []
    function Spread(): JSX.Element {
      const ward = createWard({ initial: { opacity: 0.5 } })
      const props = ward({ style: { y, rotate: 10 } })
      read = [ward.value("y")(), ward.value("opacity")(), ward.value("scale")()]
      return <section {...props} />
    }
    const section = first(serve(() => <Spread />), "section")
    expect(section?.style["transform"]).toBe("translateY(12px) rotate(10deg)")
    expect(read).toEqual([12, 0.5, 1])
  })
})
