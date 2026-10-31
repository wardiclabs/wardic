// A Transform template in `project` (#443, Motion's `transformTemplate`): the element's whole
// transform, from its values and the transform Wardic would draw, called in Motion's four places
// (motion-dom 14.6 `build-transform.mjs`, `create-projection-node.mjs`).
//
// - TP1: at a plain render, its transform keys in Motion's units (`x: "10px"`, `rotate: "45deg"`,
//   `scale: 1.5`), at their identity too, and the transform Wardic would draw; `""` when every key
//   is at its identity. `pathRotation` is drawn and not handed over, as Motion's is.
// - TP2: with no transform key it's still called, `({}, "")`: what it returns is always the transform.
// - TP3: the template key never reaches the patch, on either path, and the other keys project as ever.
// - TP4: while a projection moves the element, every value as it is and the projection's transform.
// - TP5: a projection that moves nothing draws as a plain render: `({}, "")` with no transform key,
//   Motion's once a projection ends, so a template is never handed `none`.
// - TP6: `heldTransformOf`, a Measure pass's hold: every value as it is and `""`; `""` with no template.
import * as Projection from "@wardic/core/Projection"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import { describe, expect, it } from "vitest"

const AXIS = { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }
/** A projection moving `tx` px across and scaling `sx`, under no tree scale. */
const projection = (tx: number, sx = 1): Projection.Value => ({
  delta: { x: { ...AXIS, translate: tx, scale: sx }, y: AXIS },
  treeScale: { x: 1, y: 1 },
})

/** A template that records what it's handed and draws `centred generated`. */
const recording = () => {
  const calls: Array<readonly [Readonly<Record<string, string | number>>, string]> = []
  const template: DomRenderer.TransformTemplate = (values, generated) => {
    calls.push([{ ...values }, generated])
    return `translate(-50%, -50%) ${generated}`.trim()
  }
  return { calls, template }
}

describe("a Transform template at a plain render (#443)", () => {
  it("TP1: its keys in Motion's units, at their identity too, and the transform Wardic would draw", () => {
    const { calls, template } = recording()
    const patch = DomRenderer.project({ x: 10, y: 0, scale: 1.5, rotate: 45, pathRotation: 30, [DomRenderer.TEMPLATE_KEY]: template })
    expect(calls).toEqual([[{ x: "10px", y: "0px", scale: 1.5, rotate: "45deg" }, "translateX(10px) scale(1.5) rotate(45deg) rotate(30deg)"]])
    expect(patch.transform).toBe("translate(-50%, -50%) translateX(10px) scale(1.5) rotate(45deg) rotate(30deg)")
    // A string as it is.
    DomRenderer.project({ x: "50%", [DomRenderer.TEMPLATE_KEY]: template })
    expect(calls[1]).toEqual([{ x: "50%" }, "translateX(50%)"])
    // Every key at its identity: `""`, where the plain render writes `none`.
    DomRenderer.project({ x: 0, scale: 1, [DomRenderer.TEMPLATE_KEY]: template })
    expect(calls[2]).toEqual([{ x: "0px", scale: 1 }, ""])
  })

  it("TP2: with no transform key it's still called, ({}, \"\"), and its result is the transform", () => {
    const { calls, template } = recording()
    expect(DomRenderer.project({ opacity: 0.5, [DomRenderer.TEMPLATE_KEY]: template })).toEqual({ transform: "translate(-50%, -50%)", opacity: 0.5 })
    expect(calls).toEqual([[{}, ""]])
    // Without one, no transform is written (ADR-0023).
    expect(DomRenderer.project({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
  })

  it("TP3: the template key never reaches the patch; the other keys project as ever", () => {
    const { template } = recording()
    const plain = DomRenderer.project({ width: 100, backgroundColor: "red", [DomRenderer.TEMPLATE_KEY]: template })
    expect(plain).toEqual({ transform: "translate(-50%, -50%)", width: "100px", backgroundColor: "red" })
    const projected = DomRenderer.project({ width: 100, [Projection.KEY]: projection(20), [DomRenderer.TEMPLATE_KEY]: template })
    expect(Object.keys(projected).sort()).toEqual(["transform", "width"])
  })
})

describe("a Transform template on a projected element (#443)", () => {
  it("TP4: while a projection moves it, every value as it is and the projection's transform", () => {
    const { calls, template } = recording()
    const patch = DomRenderer.project({ x: 10, rotate: 45, opacity: 0.5, [Projection.KEY]: projection(20, 2), [DomRenderer.TEMPLATE_KEY]: template })
    const generated = DomRenderer.project({ x: 10, rotate: 45, opacity: 0.5, [Projection.KEY]: projection(20, 2) }).transform
    expect(calls).toEqual([[{ x: 10, rotate: 45, opacity: 0.5 }, generated]])
    expect(generated).toBe("translate3d(30px, 0px, 0px) rotate(45deg) scale(2, 1)")
    expect(patch.transform).toBe(`translate(-50%, -50%) ${generated}`)
  })

  it("TP5: a projection that moves nothing draws as a plain render: ({}, \"\") with no transform key, never none", () => {
    const { calls, template } = recording()
    expect(DomRenderer.project({ opacity: 1, [Projection.KEY]: Projection.AT_REST, [DomRenderer.TEMPLATE_KEY]: template }).transform).toBe("translate(-50%, -50%)")
    expect(calls[0]).toEqual([{}, ""])
    // Its own keys, as at a plain render.
    DomRenderer.project({ x: 10, [Projection.KEY]: Projection.AT_REST, [DomRenderer.TEMPLATE_KEY]: template })
    expect(calls[1]).toEqual([{ x: "10px" }, "translateX(10px)"])
    // A handover's rotation moves it.
    DomRenderer.project({ [Projection.KEY]: { ...Projection.AT_REST, rotate: 10 }, [DomRenderer.TEMPLATE_KEY]: template })
    expect(calls[2]).toEqual([{}, "rotate(10deg)"])
  })

  it("TP6: a Measure pass holds it at its template's with every value and \"\"; \"\" with no template", () => {
    const { calls, template } = recording()
    expect(DomRenderer.heldTransformOf({ x: 10, opacity: 0.5, [Projection.KEY]: projection(20), [DomRenderer.TEMPLATE_KEY]: template })).toBe("translate(-50%, -50%)")
    expect(calls).toEqual([[{ x: 10, opacity: 0.5 }, ""]])
    expect(DomRenderer.heldTransformOf({ x: 10 })).toBe("")
  })
})
