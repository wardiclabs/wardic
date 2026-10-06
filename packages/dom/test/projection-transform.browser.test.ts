import type { Delta, Point } from "@wardic/core"
import { PROJECTION_KEY, Renderer } from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { RendererDomLive } from "../src/renderer.ts"

const renderer = await Effect.runPromise(
  Effect.provide(
    Effect.gen(function* () {
      return yield* Renderer
    }),
    RendererDomLive,
  ),
)

/** Build a Delta from per-axis translate/scale (origin/originPoint unused by the transform builder). */
const delta = (tx: number, ty: number, sx: number, sy: number): Delta => ({
  x: { translate: tx, scale: sx, origin: 0.5, originPoint: 0 },
  y: { translate: ty, scale: sy, origin: 0.5, originPoint: 0 },
})
const treeScale = (x: number, y: number): Point => ({ x, y })
const proj = (d: Delta, ts: Point) => ({ [PROJECTION_KEY]: { delta: d, treeScale: ts } })

describe("RendererDomLive.project — projection branch (ADR-0009)", () => {
  it("a pure translate projection -> translate3d, scale/inverse omitted", () => {
    expect(renderer.project(proj(delta(-50, -20, 1, 1), treeScale(1, 1)))).toEqual({
      transform: "translate3d(-50px, -20px, 0px)",
    })
  })

  it("a scaling projection -> translate3d + element scale", () => {
    expect(renderer.project(proj(delta(50, 50, 2, 2), treeScale(1, 1)))).toEqual({
      transform: "translate3d(50px, 50px, 0px) scale(2, 2)",
    })
  })

  it("treeScale folds in: translate /treeScale, inverse-scale(1/treeScale), element scale(*treeScale)", () => {
    // tx=-50/2=-25, ty=-20/2=-10; inverse scale(0.5,0.5); element scale(1*2,1*2)=scale(2,2)
    expect(renderer.project(proj(delta(-50, -20, 1, 1), treeScale(2, 2)))).toEqual({
      transform: "translate3d(-25px, -10px, 0px) scale(0.5, 0.5) scale(2, 2)",
    })
  })

  it("weaves the element's animated rotate between inverse-scale and element-scale; ignores x (projection owns translate) and multiplies its scale in", () => {
    // x:999 is owned by the projection -> ignored; rotate woven; scale:5 multiplies the
    // element scale (Motion's targetWithTransforms); opacity copied through.
    expect(renderer.project({ ...proj(delta(-50, -20, 1, 1), treeScale(1, 1)), x: 999, scale: 5, rotate: 45, opacity: 0.5 })).toEqual({
      transform: "translate3d(-50px, -20px, 0px) rotate(45deg) scale(5, 5)",
      opacity: 0.5,
    })
  })

  // The element's own scale on a projected node (ADR-0009 *Amendment (Reorder)*): Motion
  // renders a node with the delta to its target with the element's own transforms applied
  // (`transformBox(targetWithTransforms, latestValues)`, create-projection-node.ts:1820-1845
  // at 16c61222c4166bbef5ff6ab0051192faa79fa8c8); about the box centre that multiplies the
  // element scale by `scale x scaleX` (or `scaleY`), delta-apply.ts:18-30.
  it("PT1: the element's own scale multiplies the projection's element scale", () => {
    expect(renderer.project({ ...proj(delta(50, 50, 2, 2), treeScale(1, 1)), scale: 1.5 })).toEqual({
      transform: "translate3d(50px, 50px, 0px) scale(3, 3)",
    })
  })

  it("PT2: scaleX / scaleY scale their own axis, times scale", () => {
    expect(renderer.project({ ...proj(delta(0, 0, 1, 1), treeScale(1, 1)), scale: 2, scaleX: 1.5 })).toEqual({
      transform: "scale(3, 2)",
    })
    expect(renderer.project({ ...proj(delta(0, 0, 1, 1), treeScale(1, 1)), scaleY: 0.5 })).toEqual({
      transform: "scale(1, 0.5)",
    })
  })

  it("PT3: under a tree scale the own scale joins the element term, after the inverse tree scale", () => {
    expect(renderer.project({ ...proj(delta(-50, -20, 1, 1), treeScale(2, 2)), scale: 1.5 })).toEqual({
      transform: "translate3d(-25px, -10px, 0px) scale(0.5, 0.5) scale(3, 3)",
    })
  })

  it("PT4 (guard): an own scale of 1 adds nothing", () => {
    expect(renderer.project({ ...proj(delta(0, 0, 1, 1), treeScale(1, 1)), scale: 1, scaleX: 1 })).toEqual({
      transform: "none",
    })
  })

  // #57 (ADR-0009 *Amendment (#57)*, ADR-0023): a woven term at its Identity is left out, as
  // Motion's projection transform leaves out a falsy rotate or skew
  // (projection/styles/transform.ts:44-50 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8), so a
  // `layout` element whose rotate returned rests at `none`, not `rotate(0deg)`.
  it("PT5: a woven rotate or skew at its identity, and z at 0, are left out", () => {
    expect(renderer.project({ ...proj(delta(0, 0, 1, 1), treeScale(1, 1)), rotate: 0, skewY: 0, z: 0 })).toEqual({
      transform: "none",
    })
    expect(renderer.project({ ...proj(delta(-50, -20, 1, 1), treeScale(1, 1)), rotate: 0, opacity: 0.5 })).toEqual({
      transform: "translate3d(-50px, -20px, 0px)",
      opacity: 0.5,
    })
  })

  it("an identity projection with no woven transform -> 'none'", () => {
    expect(renderer.project(proj(delta(0, 0, 1, 1), treeScale(1, 1)))).toEqual({
      transform: "none",
    })
  })
})
