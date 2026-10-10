// Identity transforms (#57, ADR-0023): `project` leaves out a transform key at its Identity
// (1 for `scale`, `scaleX` and `scaleY`, 0 for the rest) and writes `transform: none` when
// every transform key it's given is at its identity, as Motion's builders do
// (motion-dom build-transform.ts:36-57,86-87 and projection/styles/transform.ts:44-50 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8). Any transform but `none` makes the element a
// stacking context and the containing block of its fixed descendants (CSS Transforms 1, §3).
//
// Expected strings are literal: the point is the markup `project` writes.
import * as BaseValue from "@wardic/core/BaseValue"
import * as Projection from "@wardic/core/Projection"
import { project, splitPatchForTag } from "@wardic/dom"
import { describe, expect, it } from "vitest"

const IDENTITY = { x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }, y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 } }
/** A projection with no layout delta (`tx`, `ty` 0 unless given) and no tree scale. */
const projected = (tx = 0, ty = 0) => ({
  [Projection.KEY]: {
    delta: { x: { ...IDENTITY.x, translate: tx }, y: { ...IDENTITY.y, translate: ty } },
    treeScale: { x: 1, y: 1 },
  },
})

describe("identity transforms: the normal path (ADR-0023)", () => {
  it("IT1: each transform key alone at its identity projects transform: none", () => {
    for (const [key, identity] of Object.entries(BaseValue.TRANSFORM_IDENTITY)) {
      expect(project({ [key]: identity }), key).toEqual({ transform: "none" })
    }
  })

  it("IT2: all fifteen at their identity project none, and the other keys still project", () => {
    expect(project({ ...BaseValue.TRANSFORM_IDENTITY, opacity: 0.5 })).toEqual({ transform: "none", opacity: 0.5 })
  })

  it("IT3: a key at its identity is left out beside one that isn't", () => {
    expect(project({ x: 10, y: 0 })).toEqual({ transform: "translateX(10px)" })
    expect(project({ x: 0, scale: 1.5, rotate: 0, skewX: 10 })).toEqual({ transform: "scale(1.5) skewX(10deg)" })
  })

  it("IT4 (guard): with no transform key, no transform is written", () => {
    expect(project({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
    expect(project({})).toEqual({})
  })

  it("IT5: a string is at its identity when parseFloat gives it (Motion's test)", () => {
    for (const x of ["0px", "0%", "-0px", "0", "0.0em"]) expect(project({ x }), x).toEqual({ transform: "none" })
    for (const rotate of ["0deg", "0turn", "0rad"]) expect(project({ rotate }), rotate).toEqual({ transform: "none" })
    expect(project({ scale: "1", scaleX: "1.0" })).toEqual({ transform: "none" })
  })

  it("IT6 (guard): a string parseFloat doesn't take to the identity is written", () => {
    expect(project({ x: "calc(0px)" })).toEqual({ transform: "translateX(calc(0px))" })
    expect(project({ x: "var(--x)" })).toEqual({ transform: "translateX(var(--x))" })
    expect(project({ scale: "100%" })).toEqual({ transform: "scale(100%)" })
    expect(project({ x: "0.5px" })).toEqual({ transform: "translateX(0.5px)" })
  })

  it("IT7: the test is exact: a value next to its identity is written, -0 is the identity", () => {
    expect(project({ scale: 1.0000001 })).toEqual({ transform: "scale(1.0000001)" })
    expect(project({ x: 0.001 })).toEqual({ transform: "translateX(0.001px)" })
    expect(project({ x: -0 })).toEqual({ transform: "none" })
  })
})

describe("identity transforms: the projection path (ADR-0023 decision 4, ADR-0009)", () => {
  it("IT8: an identity woven rotate or skew is left out: with no delta, none", () => {
    expect(project({ ...projected(), rotate: 0 })).toEqual({ transform: "none" })
    expect(project({ ...projected(), rotateX: 0, rotateY: "0deg", rotateZ: 0, skewX: 0, skewY: "0deg" })).toEqual({ transform: "none" })
  })

  it("IT9: with a delta, the identity woven terms are left out and the rest still woven", () => {
    expect(project({ ...projected(12, 0), rotate: 0 })).toEqual({ transform: "translate3d(12px, 0px, 0px)" })
    expect(project({ ...projected(12, 0), rotate: 10, skewX: 0 })).toEqual({ transform: "translate3d(12px, 0px, 0px) rotate(10deg)" })
  })

  it("IT10: z at its identity, a number or a string, adds no translate3d", () => {
    expect(project({ ...projected(), z: 0 })).toEqual({ transform: "none" })
    expect(project({ ...projected(), z: "0px" })).toEqual({ transform: "none" })
    expect(project({ ...projected(), z: 5 })).toEqual({ transform: "translate3d(0px, 0px, 5px)" })
  })
})

describe("identity transforms: SVG routing (ADR-0023 decision 6, ADR-0014)", () => {
  it("IT11: an svg-inner element's none still takes transform-box and transform-origin", () => {
    expect(splitPatchForTag("circle", project({ scale: 1, opacity: 0.5 }))).toEqual({
      style: { transform: "none", "transform-box": "fill-box", "transform-origin": "50% 50%" },
      attrs: { opacity: "0.5" },
    })
  })
})
