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

// `core`, `dom` and `test` are one release group (#559), at one version; `@wardic/solid` versions alone
// since its 2.0 (#566). Each `VERSION` constant is its own package's version, which `bun run
// version-packages` writes (1.0.0-rc.1 shipped "0.1.0-alpha.0").
it("core, dom and test share one version, and each VERSION constant is its package's", () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8")
  const versionOf = (pkg: string): string => JSON.parse(read(`../../${pkg}/package.json`)).version
  const version = versionOf("core")
  expect(["dom", "test"].map(versionOf)).toEqual([version, version])
  // `@wardic/solid`'s `VERSION` is its `v1`'s, Solid 1's binding's (#566).
  const modules: Record<string, string> = { dom: "index.ts", solid: "v1/index.tsx", test: "index.ts" }
  for (const pkg of ["dom", "solid", "test"]) {
    expect(/^export const VERSION = "([^"]*)"$/m.exec(read(`../../${pkg}/src/${modules[pkg]}`))?.[1], `@wardic/${pkg}'s VERSION`).toBe(versionOf(pkg))
  }
})
