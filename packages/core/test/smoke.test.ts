import { expect, it } from "@effect/vitest"
import * as Core from "@wardic/core"
import { readFileSync } from "node:fs"

it("@wardic/core's root is its modules, each a namespace, and nothing else (ADR-0028, decision 2)", () => {
  const exports = Object.entries(Core)
  expect(exports.length).toBeGreaterThan(20)
  for (const [name, module] of exports) {
    expect(name, "a module's name is PascalCase").toMatch(/^[A-Z][A-Za-z]+$/)
    expect(typeof module, `${name} is a namespace`).toBe("object")
  }
  expect(Core.Machine.isMachine(Core.Machine.tween(0, 1, { duration: 1 }))).toBe(true)
})

it("@wardic/core's version is its package.json's: the root exports no VERSION", () => {
  const corePackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  expect(corePackage.version).toBe("0.1.0-alpha.0")
  expect("VERSION" in Core).toBe(false)
})
