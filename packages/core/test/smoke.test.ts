import { expect, it } from "@effect/vitest"
// eslint-disable-next-line no-restricted-syntax -- this test is of the root itself
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
  expect("VERSION" in Core).toBe(false)
})

// The four packages are one release group (#559): one version, and each `VERSION` constant is it,
// which `bun run version-packages` writes (1.0.0-rc.1 shipped "0.1.0-alpha.0").
it("the four packages share one version, and each VERSION constant is it", () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8")
  const versionOf = (pkg: string): string => JSON.parse(read(`../../${pkg}/package.json`)).version
  const version = versionOf("core")
  expect(["dom", "solid", "test"].map(versionOf)).toEqual([version, version, version])
  // `@wardic/solid`'s root module is `index.tsx`: it re-exports components.
  const indexes: Record<string, string> = { dom: "index.ts", solid: "index.tsx", test: "index.ts" }
  for (const pkg of ["dom", "solid", "test"]) {
    expect(/^export const VERSION = "([^"]*)"$/m.exec(read(`../../${pkg}/src/${indexes[pkg]}`))?.[1], `@wardic/${pkg}'s VERSION`).toBe(version)
  }
})
