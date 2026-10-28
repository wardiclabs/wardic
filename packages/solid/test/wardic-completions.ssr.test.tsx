// Completion inside a Wardic element's transitions, its keys inferred from its targets (#305,
// ADR-0049), asked of TypeScript's language service as an editor asks it (`language-service.ts`).
// Solid 2's are CI1–CI5.
//
// - IC1: a `wardic.*` element's `transition`: the keys it animates, `default`, `layout`, its options;
//   no other value's name.
// - IC2: a target's own: the element's keys, `default` and the options; no `layout`.
// - IC3: an element Variant children can join: every value's name.
// - IC4: inside a target, a variant and `style`: every value's name. The inferred keys never narrow
//   them: while an editor completes inside one, TS infers the keys without it.
// - IC5: `createWard`'s `transition`, a value or an accessor, as an element's; its targets and
//   `viewport` as ever.
import { beforeAll, describe, expect, it } from "vitest"
import { completionsIn } from "./language-service.ts"

const SOURCE = `import { createWard, wardic } from "@wardic/solid"
export const element = () => <wardic.div initial={{ opacity: 0 }} animate={{ x: 10 }} transition={{ type: "tween", /*IC1*/ }} />
export const target = () => <wardic.div animate={{ opacity: 1, transition: { /*IC2*/ } }} whileHover={{ x: 4 }} />
export const parent = () => <wardic.ul variants={{ shown: {} }} animate="shown" transition={{ /*IC3*/ }} />
export const values = () => <wardic.div animate={{ /*IC4a*/ }} variants={{ open: { /*IC4b*/ } }} style={{ /*IC4c*/ }} />
export const ward = () => createWard({ initial: { opacity: 0 }, animate: { x: 10 }, transition: { /*IC5a*/ } })
export const accessor = () => createWard(() => ({ animate: { x: 10 }, transition: { /*IC5b*/ } }))
export const wardValues = () => createWard({ animate: { /*IC5c*/ }, viewport: { /*IC5d*/ } })
`

let offered: (marker: string) => ReadonlyArray<string>

beforeAll(() => {
  offered = completionsIn("tsconfig.test.json", "test/__wardic-completions__.tsx", SOURCE)
})

describe("completion inside a Wardic element's transitions (#305)", () => {
  it("IC1: an element's transition offers the keys it animates, default, layout and its options", () => {
    const names = offered("/*IC1*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "x", "default", "layout", "duration", "delay"]))
    expect(names).not.toContain("scale")
    expect(names).not.toContain("background-color")
    expect(names.length, "no other value's name").toBeLessThan(40)
  }, 60_000)

  it("IC2: a target's own transition offers the element's keys and default, no layout", () => {
    const names = offered("/*IC2*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "x", "default", "stiffness", "inherit"]))
    expect(names).not.toContain("scale")
    expect(names).not.toContain("layout")
  }, 60_000)

  it("IC3: a Variant parent's transition offers every value's name", () => {
    expect(offered("/*IC3*/")).toEqual(expect.arrayContaining(["scale", "background-color", "staggerChildren", "layout"]))
  }, 60_000)

  it("IC4: inside a target, a variant and style, every value's name", () => {
    for (const marker of ["/*IC4a*/", "/*IC4b*/", "/*IC4c*/"]) expect(offered(marker), marker).toEqual(expect.arrayContaining(["opacity", "x", "background-color"]))
  }, 60_000)

  it("IC5: createWard's transition, a value or an accessor, as an element's", () => {
    const names = offered("/*IC5a*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "x", "default", "layout", "duration"]))
    expect(names).not.toContain("scale")
    const accessor = offered("/*IC5b*/")
    expect(accessor).toEqual(expect.arrayContaining(["x", "default", "layout"]))
    expect(accessor).not.toContain("opacity")
    expect(offered("/*IC5c*/")).toEqual(expect.arrayContaining(["opacity", "x", "background-color"]))
    expect(offered("/*IC5d*/")).toEqual(["amount", "margin", "once", "root"])
  }, 60_000)
})
