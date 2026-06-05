import { expect, it } from "@effect/vitest"
import { VERSION } from "@wardic/core"

it("@wardic/core resolves and exposes a version", () => {
  expect(VERSION).toBe("0.1.0-alpha.0")
})
