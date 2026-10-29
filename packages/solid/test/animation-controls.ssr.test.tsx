// Animation controls in a server render (#433's PR 3): no change has been made, so an element given
// them renders its `initial`, and names its own variants, as on the client.
//
// - ACS1: a list given controls renders its `initial`, and its Variant children their own of its name.
// - ACS2: with no `initial`, nothing of the controls is rendered as a value.
import { createAnimationControls, wardic, type WardicVariants } from "@wardic/solid"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr-helpers.ts"

const LIST: WardicVariants = { hidden: { opacity: 0.2 }, visible: { opacity: 1 } }
const ITEM: WardicVariants = { hidden: { x: -40 }, visible: { x: 0 } }

describe("Animation controls in a server render (#433)", () => {
  it("ACS1: a list given controls renders its initial, and its Variant children theirs", () => {
    const controls = createAnimationControls()
    const tags = tagsOf(
      serve(() => (
        <wardic.ul initial="hidden" animate={controls} variants={LIST}>
          <wardic.li variants={ITEM} />
        </wardic.ul>
      )),
    )
    expect(tags.find((t) => t.name === "ul")?.style["opacity"]).toBe("0.2")
    expect(tags.find((t) => t.name === "li")?.style["transform"]).toBe("translateX(-40px)")
  })

  it("ACS2: with no initial, nothing of the controls is rendered", () => {
    const controls = createAnimationControls()
    const html = serve(() => <wardic.div animate={controls} />)
    expect(html).not.toContain("start")
    expect(html).not.toContain("stop")
  })
})
