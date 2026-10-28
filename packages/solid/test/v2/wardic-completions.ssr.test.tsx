// Completion inside a Wardic element's transitions on Solid 2, its keys inferred from its targets
// (#305, ADR-0049), asked of TypeScript's language service as an editor asks it
// (`language-service.ts`). Solid 1's are IC1–IC5; a ward's own, WC1–WC5.
//
// - CI1: a `wardic.*` element's `transition`: the keys it animates, `default`, `layout`, its options;
//   no other value's name.
// - CI2: a target's own: the element's keys, `default` and the options; no `layout`.
// - CI3: an element Variant children can join: every value's name.
// - CI4: inside a target, a variant and `style`: every value's name.
// - CI5: a wrapped component's (`wardic.create(Component)`), as an element's.
import { beforeAll, describe, expect, it } from "vitest"
import { completionsIn } from "../language-service.ts"

const SOURCE = `import type { JSX } from "@solidjs/web"
import { wardic } from "@wardic/solid/unstable/v2"
declare function Card(props: { readonly title: string; readonly ref?: JSX.Ref<HTMLElement> }): JSX.Element
const WardicCard = wardic.create(Card)
export const element = () => <wardic.div initial={{ opacity: 0 }} animate={{ x: 10 }} transition={{ type: "tween", /*CI1*/ }} />
export const target = () => <wardic.div animate={{ opacity: 1, transition: { /*CI2*/ } }} whileHover={{ x: 4 }} />
export const parent = () => <wardic.ul variants={{ shown: {} }} animate="shown" transition={{ /*CI3*/ }} />
export const values = () => <wardic.div animate={{ /*CI4a*/ }} variants={{ open: { /*CI4b*/ } }} style={{ /*CI4c*/ }} />
export const wrapped = () => <WardicCard title="a" initial={{ opacity: 0 }} animate={{ x: 10 }} transition={{ /*CI5*/ }} />
`

let offered: (marker: string) => ReadonlyArray<string>

beforeAll(() => {
  offered = completionsIn("tsconfig.v2.json", "test/v2/__wardic-completions__.tsx", SOURCE)
})

describe("completion inside a Wardic element's transitions on Solid 2 (#305)", () => {
  it("CI1: an element's transition offers the keys it animates, default, layout and its options", () => {
    const names = offered("/*CI1*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "x", "default", "layout", "duration", "delay"]))
    expect(names).not.toContain("scale")
    expect(names).not.toContain("background-color")
    expect(names.length, "no other value's name").toBeLessThan(40)
  }, 60_000)

  it("CI2: a target's own transition offers the element's keys and default, no layout", () => {
    const names = offered("/*CI2*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "x", "default", "stiffness", "inherit"]))
    expect(names).not.toContain("scale")
    expect(names).not.toContain("layout")
  }, 60_000)

  it("CI3: a Variant parent's transition offers every value's name", () => {
    expect(offered("/*CI3*/")).toEqual(expect.arrayContaining(["scale", "background-color", "staggerChildren", "layout"]))
  }, 60_000)

  it("CI4: inside a target, a variant and style, every value's name", () => {
    for (const marker of ["/*CI4a*/", "/*CI4b*/", "/*CI4c*/"]) expect(offered(marker), marker).toEqual(expect.arrayContaining(["opacity", "x", "background-color"]))
  }, 60_000)

  it("CI5: a wrapped component's transition, as an element's", () => {
    const names = offered("/*CI5*/")
    expect(names).toEqual(expect.arrayContaining(["opacity", "x", "default", "layout"]))
    expect(names).not.toContain("scale")
  }, 60_000)
})
