// Completion inside a ward's transitions (#301's PR 2, ADR-0049), asked of TypeScript's language
// service as an editor asks it: a transition offers the keys it drives, `default`, and its options,
// and none of the other values' names. The checks alone (TK1–TK7) can't show it: an editor completes
// from the contextual type, which a wider type in the parameter would fill with every name.
//
// - WC1: the element's `transition`: the keys the element animates, `default` and `layout`.
// - WC2: a target's own: the keys it sets and `default`, no `layout`.
// - WC3: a Variant parent's `transition`: every value's name, as its Variant children may animate any.
// - WC4: the config's keys, and a target's values (`animate`'s, a variant's, a gesture's). A value or
//   an accessor (#259's per-key config) left a union of both, and an editor nothing to complete
//   inside it: before #301's PR 2 only the config's keys completed.
import * as path from "node:path"
import ts from "typescript"
import { beforeAll, describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")
const FILE = path.join(ROOT, "test/v2/__ward-completions__.tsx")

const SOURCE = `import { ward } from "@wardic/solid/unstable/v2"
export const element = () => ward({ initial: { opacity: 0 }, animate: { x: 10 }, transition: { type: "tween", /*WC1*/ } })
export const target = () => ward({ animate: { opacity: 1, transition: { /*WC2*/ } } })
export const parent = () => ward({ variants: { shown: {} }, animate: "shown", transition: { /*WC3*/ } })
export const keys = () => ward({ /*WC4a*/ })
export const values = () => ward({ animate: { /*WC4b*/ }, variants: { open: { /*WC4c*/ } }, whileHover: { /*WC4d*/ } })
`

let service: ts.LanguageService

beforeAll(() => {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, "tsconfig.v2.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
  if (config === undefined) throw new Error("tsconfig.v2.json didn't parse")
  const rootNames = [FILE, path.join(ROOT, "babel-modules.d.ts")]
  service = ts.createLanguageService(
    {
      getScriptFileNames: () => rootNames,
      getScriptVersion: () => "1",
      getScriptSnapshot: (file) => {
        if (file === FILE) return ts.ScriptSnapshot.fromString(SOURCE)
        if (!ts.sys.fileExists(file)) return undefined
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(file) ?? "")
      },
      getCurrentDirectory: () => ROOT,
      getCompilationSettings: () => config.options,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (file) => file === FILE || ts.sys.fileExists(file),
      readFile: (file) => {
        if (file === FILE) return SOURCE
        return ts.sys.readFile(file)
      },
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    },
    ts.createDocumentRegistry(),
  )
}, 60_000)

/** The names offered at `marker`. */
const offered = (marker: string): ReadonlyArray<string> => {
  const at = SOURCE.indexOf(marker)
  expect(at, marker).toBeGreaterThan(0)
  return (service.getCompletionsAtPosition(FILE, at, {})?.entries ?? []).map((entry) => entry.name.replace(/^"(.*)"$/, "$1"))
}

describe("completion inside a ward's transitions (#301)", () => {
  it("WC1: the element's transition offers the keys it animates, default and layout", () => {
    const names = offered("/*WC1*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "x", "default", "layout", "duration", "delay"]))
    expect(names).not.toContain("scale")
    expect(names).not.toContain("background-color")
    expect(names.length, "no other value's name").toBeLessThan(40)
  }, 60_000)

  it("WC2: a target's own transition offers the keys it sets and default, no layout", () => {
    const names = offered("/*WC2*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "default", "stiffness", "inherit"]))
    expect(names).not.toContain("x")
    expect(names).not.toContain("layout")
  }, 60_000)

  it("WC3: a Variant parent's transition offers every value's name", () => {
    const names = offered("/*WC3*/")
    expect(names).toEqual(expect.arrayContaining(["scale", "background-color", "staggerChildren", "layout"]))
  }, 60_000)

  it("WC4: the config's keys, and a target's values", () => {
    expect(offered("/*WC4a*/")).toEqual(expect.arrayContaining(["animate", "variants", "transition", "whileHover", "onUpdate"]))
    for (const marker of ["/*WC4b*/", "/*WC4c*/", "/*WC4d*/"]) expect(offered(marker), marker).toEqual(expect.arrayContaining(["opacity", "x", "background-color"]))
  }, 60_000)
})
