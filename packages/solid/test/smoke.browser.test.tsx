import { render } from "@solidjs/testing-library"
import { expect, it } from "vitest"

/**
 * Smoke test for the real-browser harness: a real layout engine, so
 * `getBoundingClientRect` reflects actual CSS — the thing happy-dom cannot do.
 * If this passes, the Playwright/Chromium-via-nix setup works end-to-end.
 */
it("real browser: getBoundingClientRect reflects real CSS layout", () => {
  const { container } = render(() => (
    <div
      data-x
      style={{ position: "absolute", left: "30px", top: "20px", width: "100px", height: "50px" }}
    />
  ))
  const el = container.querySelector("[data-x]") as HTMLElement
  const r = el.getBoundingClientRect()
  expect(r.width).toBe(100)
  expect(r.height).toBe(50)
  expect(r.left).toBe(30)
  expect(r.top).toBe(20)
})

it("real browser: a CSS transform composes into getBoundingClientRect", () => {
  // A scaled element's measured box reflects the transform — real composition,
  // which is exactly what the projection engine relies on.
  const { container } = render(() => (
    <div
      data-x
      style={{ position: "absolute", left: "0px", top: "0px", width: "100px", height: "100px", transform: "scale(2)", "transform-origin": "top left" }}
    />
  ))
  const el = container.querySelector("[data-x]") as HTMLElement
  const r = el.getBoundingClientRect()
  expect(r.width).toBe(200) // 100 * scale(2)
  expect(r.height).toBe(200)
})
