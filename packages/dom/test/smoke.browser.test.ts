import { expect, it } from "@effect/vitest"
import { VERSION } from "@wardic/dom"

it("@wardic/dom resolves and exposes a version", () => {
  // Its value is the package.json's: core's smoke test checks every VERSION (#559).
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
})

it("a real browser environment is active with document and window globals", () => {
  expect(typeof document).not.toBe("undefined")
  expect(typeof window).not.toBe("undefined")

  const el = document.createElement("div")
  el.style.width = "42px"
  document.body.appendChild(el)

  expect(el.tagName).toBe("DIV")
  expect(el.style.width).toBe("42px")
  expect(document.body.contains(el)).toBe(true)

  // Real layout engine: an appended sized element has non-zero geometry (happy-dom
  // reported all-zeros here).
  el.style.height = "10px"
  expect(el.getBoundingClientRect().width).toBeCloseTo(42, 0)
  el.remove()
})
