// The element's own depth, `transformPerspective` (#887; ADR-0073, *Amendment (#887)*), on Solid 2's page:
// Motion's key, a `perspective()` at the head of the element's transform, in px. Painted values.
//
// - TPB1: an element's depth with a turn paints as CSS's own `perspective(600px) rotateY(30deg)`.
// - TPB2: a `layout` element keeps its depth at the head of the projection's transform through a flight.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"
import { sampleFrames, settle, wait } from "./reorder-scene.tsx"

const BOX: JSX.CSSProperties = { position: "absolute", top: "40px", width: "80px", height: "80px", background: "teal" }

/** An element's painted transform, as a matrix. */
const matrixOf = (el: Element): DOMMatrixReadOnly => new DOMMatrixReadOnly(getComputedStyle(el).transform)

describe("transformPerspective on Solid 2's page (#887)", () => {
  it("TPB1: a depth with a turn paints as CSS's own perspective(600px) rotateY(30deg)", async () => {
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-card initial={false} animate={{ transformPerspective: 600, rotateY: 30 }} style={{ ...BOX, left: "40px" }} />
        <div data-css style={{ ...BOX, left: "200px", transform: "perspective(600px) rotateY(30deg)" }} />
      </WardicProvider>
    ))
    await settle()
    const card = host.querySelector<HTMLElement>("[data-card]")!
    const css = host.querySelector<HTMLElement>("[data-css]")!
    expect(card.style.transform).toBe("perspective(600px) rotateY(30deg)")
    const [drawn, own] = [matrixOf(card).toFloat64Array(), matrixOf(css).toFloat64Array()]
    expect(drawn[11], "its depth: the matrix's perspective term").not.toBe(0)
    drawn.forEach((value, i) => expect(value, `m[${i}]`).toBeCloseTo(own[i] as number, 9))
  })

  it("TPB2: a layout element keeps its depth at the head of the projection's transform through a flight", async () => {
    const [moved, setMoved] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          data-card
          layout
          layoutDependency={moved()}
          transition={{ type: "tween", duration: 0.3 }}
          initial={false}
          animate={{ transformPerspective: 600, rotateY: 30 }}
          style={{ ...BOX, left: Bool.match(moved(), { onTrue: () => "240px", onFalse: () => "40px" }) }}
        />
      </WardicProvider>
    ))
    await settle()
    const card = host.querySelector<HTMLElement>("[data-card]")!
    const s = sampleFrames(() => card.style.transform)
    await raf()
    setMoved(true)
    flush()
    await until(() => card.style.transform.includes("translate3d("), 2000)
    await until(() => card.style.transform === "perspective(600px) rotateY(30deg)", 3000)
    await wait(100)
    const flying = s.stop().filter((f) => f.v.includes("translate3d("))
    expect(flying.length, "frames in flight").toBeGreaterThan(3)
    expect(flying.filter((f) => !f.v.startsWith("perspective(600px) translate3d(")), "each with its depth first").toEqual([])
  })
})
