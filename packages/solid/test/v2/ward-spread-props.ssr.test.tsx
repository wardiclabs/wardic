// A ward spread hands the element its props alone on a server too (#495): Solid 2's server `merge`
// also calls a function source.
//
// - WPS1: `wardic.input`'s `name`, and a plain element's beside `{...card}`, render as given.
import type { JSX } from "@solidjs/web"
import { ward, wardic } from "@wardic/solid/unstable/v2"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr.ts"

describe("a ward spread on a server (#495)", () => {
  it("WPS1: wardic.input's name, and a plain element's beside {...card}, render as given", () => {
    const Field = (): JSX.Element => {
      const card = ward({ initial: { opacity: 0 } })
      return <input name="phone" {...card} />
    }
    const inputs = tagsOf(
      serve(() => (
        <>
          <wardic.input name="email" />
          <Field />
        </>
      )),
    ).filter((t) => t.name === "input")
    expect(inputs.map((t) => t.attrs.name)).toEqual(["email", "phone"])
    expect(inputs[1]?.style.opacity).toBe("0")
  })
})
