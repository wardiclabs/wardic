// @vitest-environment happy-dom
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

  it("weaves the element's animated rotate between inverse-scale and element-scale; ignores x/scale (projection owns translate+scale)", () => {
    // x:999 and scale:5 are owned by the projection -> ignored; rotate woven; opacity copied through.
    expect(renderer.project({ ...proj(delta(-50, -20, 1, 1), treeScale(1, 1)), x: 999, scale: 5, rotate: 45, opacity: 0.5 })).toEqual({
      transform: "translate3d(-50px, -20px, 0px) rotate(45deg)",
      opacity: 0.5,
    })
  })

  it("an identity projection with no woven transform -> 'none'", () => {
    expect(renderer.project(proj(delta(0, 0, 1, 1), treeScale(1, 1)))).toEqual({
      transform: "none",
    })
  })
})
