import { expect, it } from "@effect/vitest"
import { VERSION } from "@wardic/test"

it("@wardic/test resolves and exposes a version", () => {
  // Its value is the package.json's: core's smoke test checks every VERSION (#559).
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
})
