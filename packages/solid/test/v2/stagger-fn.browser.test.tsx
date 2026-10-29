// `delayChildren: stagger()` on Solid 2 (#436): Solid 1's SG1–SG4, through `wardic.*`.
//
// - SGV1: `stagger(0.25, { from: "last" })` staggers the Variant children by index, from the last.
import { DomLive } from "@wardic/dom"
import { stagger, wardic, WardicProvider, type WardicVariants } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const ITEM: WardicVariants = { hidden: { x: 0 }, shown: { x: 100, transition: { type: "tween", duration: 0.2, ease: "linear" } } }
// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { display: "block", width: "20px", height: "20px", "margin-left": "120px" } as const
const TOLERANCE = 0.07

describe("delayChildren: stagger() on Solid 2 (#436)", () => {
  it("SGV1: stagger(0.25, { from: last }) staggers the Variant children by index, from the last", async () => {
    const [on, setOn] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul
          initial="hidden"
          animate={Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })}
          variants={{ hidden: {}, shown: {} }}
          transition={{ delayChildren: stagger(0.25, { from: "last" }) }}
          style={{ "list-style": "none" }}
        >
          <For each={[0, 1, 2]}>{() => <wardic.li variants={ITEM} style={BOX} />}</For>
        </wardic.ul>
      </WardicProvider>
    ))
    for (let i = 0; i < 3; i++) await raf()
    const items = Array.from(host.querySelectorAll("li"))
    const t0 = performance.now()
    setOn(true)
    const starts = items.map(() => Number.NaN)
    for (let f = 0; f < 120 && starts.some(Number.isNaN); f++) {
      await raf()
      const now = (performance.now() - t0) / 1000
      items.forEach((el, k) => {
        if (Bool.and(Number.isNaN(starts[k] as number), xOf(el) > 0.5)) starts[k] = now
      })
    }
    const first = Math.min(...starts)
    ;[0.5, 0.25, 0].forEach((want, i) => expect(Math.abs(starts[i]! - first - want), `li ${i}`).toBeLessThan(TOLERANCE))
  })
})
