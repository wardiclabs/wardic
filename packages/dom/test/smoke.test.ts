// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest"
import { VERSION } from "@wardic/dom"

it("@wardic/dom resolves and exposes a version", () => {
  expect(VERSION).toBe("0.1.0-alpha.0")
})

it("happy-dom environment is active with document and window globals", () => {
  expect(typeof document).not.toBe("undefined")
  expect(typeof window).not.toBe("undefined")

  const el = document.createElement("div")
  el.style.width = "42px"
  document.body.appendChild(el)

  expect(el.tagName).toBe("DIV")
  expect(el.style.width).toBe("42px")
  expect(document.body.contains(el)).toBe(true)
})
