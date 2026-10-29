// Animation controls in a Solid 2 server render (#433's PR 3): the Solid 1 binding's
// (`../animation-controls.ssr.test.tsx`).
//
// - ACS1 (Solid 2): a list given controls renders its `initial`, and its Variant children theirs.
import { createAnimationControls, wardic, type WardicVariants } from "@wardic/solid/unstable/v2"
import { expect, it } from "vitest"
import { serve, tagsOf } from "./ssr.ts"

const LIST: WardicVariants = { hidden: { opacity: 0.2 }, visible: { opacity: 1 } }
const ITEM: WardicVariants = { hidden: { x: -40 }, visible: { x: 0 } }

it("ACS1 (Solid 2): a list given controls renders its initial, and its Variant children theirs", () => {
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
