import { Renderer } from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { flip, PROJECTION_KEY } from "@wardic/core"
import { RendererDomLive } from "../src/renderer.ts"

/** An identity projection delta + tree-scale, for the @projection opacity tests. */
const IDENTITY_PROJECTION = {
  delta: {
    x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
    y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  },
  treeScale: { x: 1, y: 1 },
}

/**
 * Reach the concrete `project`/`commit` out of the Layer once so the pure
 * assertions don't each have to build an Effect — `project` is pure and
 * `commit` is the only Effect-returning half.
 */
const renderer = await Effect.runPromise(
  Effect.provide(
    Effect.gen(function* () {
      return yield* Renderer
    }),
    RendererDomLive,
  ),
)

describe("RendererDomLive.project (pure)", () => {
  it("groups x/y into a translate transform string in canonical order", () => {
    expect(renderer.project({ x: 10, y: 4 })).toEqual({
      transform: "translateX(10px) translateY(4px)",
    })
  })

  // #57 (ADR-0023): a key at its Identity is left out, so `y: 0` writes nothing beside `x`.
  it("leaves out a translate at its identity beside one that isn't", () => {
    expect(renderer.project({ x: 10, y: 0 })).toEqual({
      transform: "translateX(10px)",
    })
  })

  it("groups scale + rotate with unitless scale and deg rotate", () => {
    expect(renderer.project({ scale: 1.1, rotate: 45 })).toEqual({
      transform: "scale(1.1) rotate(45deg)",
    })
  })

  it("emits funcs in canonical translate -> scale -> rotate order regardless of input order", () => {
    expect(renderer.project({ rotate: 45, scale: 1.1, x: 10 })).toEqual({
      transform: "translateX(10px) scale(1.1) rotate(45deg)",
    })
  })

  it("projects flip output { x, y, scaleX, scaleY } into one transform string", () => {
    const t = flip(
      { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 80, width: 200, height: 80 },
      { x: 50, y: 20, left: 50, top: 20, right: 150, bottom: 60, width: 100, height: 40 },
    )
    // flip => { x: -50, y: -20, scaleX: 2, scaleY: 2 }
    expect(t).toEqual({ x: -50, y: -20, scaleX: 2, scaleY: 2 })
    expect(renderer.project({ ...t })).toEqual({
      transform: "translateX(-50px) translateY(-20px) scaleX(2) scaleY(2)",
    })
  })

  it("keeps opacity unitless and raw", () => {
    expect(renderer.project({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
  })

  it("composes the @projection crossfade factor with user opacity (finalOpacity = user × factor)", () => {
    // user 0.8 × factor 0.5 = 0.4
    expect(
      renderer.project({ opacity: 0.8, [PROJECTION_KEY]: { ...IDENTITY_PROJECTION, opacity: 0.5 } }).opacity,
    ).toBeCloseTo(0.4, 5)
    // no user opacity → the factor alone (1 × 0.25)
    expect(
      renderer.project({ [PROJECTION_KEY]: { ...IDENTITY_PROJECTION, opacity: 0.25 } }).opacity,
    ).toBeCloseTo(0.25, 5)
  })

  it("passes user opacity through untouched when the @projection carries no factor", () => {
    expect(renderer.project({ opacity: 0.7, [PROJECTION_KEY]: IDENTITY_PROJECTION }).opacity).toBe(0.7)
  })

  it("appends px to a numeric length property (width)", () => {
    expect(renderer.project({ width: 100 })).toEqual({ width: "100px" })
  })

  it("passes color-ish string props through verbatim", () => {
    expect(renderer.project({ backgroundColor: "#fff" })).toEqual({
      backgroundColor: "#fff",
    })
  })

  it("respects explicit string transform units", () => {
    expect(renderer.project({ x: "10%" })).toEqual({
      transform: "translateX(10%)",
    })
  })

  it("combines a transform group with a passthrough non-transform key", () => {
    expect(renderer.project({ x: 10, opacity: 0.5 })).toEqual({
      transform: "translateX(10px)",
      opacity: 0.5,
    })
  })
})

describe("RendererDomLive.commit (imperative)", () => {
  it.effect("writes a projected patch onto a happy-dom element's style", () =>
    Effect.gen(function* () {
      const el = document.createElement("div")
      const patch = renderer.project({ x: 10, y: 0, opacity: 0.5 })
      yield* renderer.commit(el, patch)

      expect(el.style.transform).toBe("translateX(10px)")
      expect(el.style.opacity).toBe("0.5")
    }),
  )

  // #57 (ADR-0023 decision 2): back at its identity, the commit writes `none` over the
  // transform before it, so no stale function stays inline.
  it.effect("writes none over a transform once its keys are back at their identity", () =>
    Effect.gen(function* () {
      const el = document.createElement("div")
      yield* renderer.commit(el, renderer.project({ scale: 1.2, x: 4 }))
      expect(el.style.transform).toBe("translateX(4px) scale(1.2)")
      yield* renderer.commit(el, renderer.project({ scale: 1, x: 0 }))
      expect(el.style.transform).toBe("none")
    }),
  )

  it.effect("writes a length px value onto style", () =>
    Effect.gen(function* () {
      const el = document.createElement("div")
      yield* renderer.commit(el, renderer.project({ width: 100 }))
      expect(el.style.width).toBe("100px")
    }),
  )
})
