// The DOM's 3D keys in a Wardic element's types (#887), on Solid 2, checked by the type checker
// (`typecheck:tests`): each element is only type-checked here, never rendered.
//
// - TKT1: `transformPerspective`, the element's own depth, and `scaleZ`, core's third scale (#883), are
//   transform keys: a number or a string in a target, in `style` and in a transition entry, and a number
//   through a ward's read.
// - TKT2: `perspective`, the property that gives an element's children their depth, takes a bare number,
//   drawn in px, as the other lengths do.
// - TKT3: a Batch member's values take `transformPerspective` and `scaleZ`, numbers as its other keys.
import type { WardicBatchValues } from "@wardic/dom/unstable/BatchMembers"
import { ward, wardic } from "@wardic/solid"
import type { Accessor } from "solid-js"
import { describe, expectTypeOf, it } from "vitest"

/** An element, type-checked only: the function is never called. */
const typed = (make: () => unknown): void => void make

const FAST = { type: "tween", duration: 0.1 } as const

describe("the DOM's 3D keys in an element's types (#887)", () => {
  it("TKT1: transformPerspective and scaleZ are transform keys, a number or a string", () => {
    typed(() => (
      <wardic.div
        initial={{ transformPerspective: 300, scaleZ: 1 }}
        animate={{ transformPerspective: 600, scaleZ: 2, rotateY: 30 }}
        whileHover={{ transformPerspective: "40rem" }}
        transition={{ transformPerspective: FAST, scaleZ: FAST }}
        // eslint-disable-next-line solid/style-prop -- Wardic's transform keys in style (ADR-0043) are what this checks
        style={{ transformPerspective: 800, scaleZ: "1.5" }}
      />
    ))
    typed(() => {
      // A transform key reads a number, its identity at rest (WK2), as the DOM's own does.
      const card = ward({ animate: { transformPerspective: 600, scaleZ: 2 } })
      expectTypeOf(card.read("transformPerspective")).toEqualTypeOf<Accessor<number>>()
      expectTypeOf(card.read("scaleZ")).toEqualTypeOf<Accessor<number>>()
    })
  })

  it("TKT2: perspective takes a bare number, drawn in px", () => {
    typed(() => <wardic.div style={{ perspective: 800 }} animate={{ perspective: 1200 }} />)
  })

  it("TKT3: a Batch member's values take transformPerspective and scaleZ", () => {
    const values: WardicBatchValues = { transformPerspective: 600, scaleZ: 2, rotateY: 30 }
    // @ts-expect-error a Batch's values are numbers
    const strings: WardicBatchValues = { transformPerspective: "600px" }
    typed(() => [values, strings])
  })
})
