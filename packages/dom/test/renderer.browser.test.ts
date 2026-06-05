import { Renderer } from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { flip } from "@wardic/core"
import { RendererDomLive } from "../src/renderer.ts"

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
    expect(renderer.project({ x: 10, y: 0 })).toEqual({
      transform: "translateX(10px) translateY(0px)",
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

      expect(el.style.transform).toBe("translateX(10px) translateY(0px)")
      expect(el.style.opacity).toBe("0.5")
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
