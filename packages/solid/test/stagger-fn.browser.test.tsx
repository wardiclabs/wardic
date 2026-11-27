// `delayChildren: stagger()` on Solid 2 (#436): Solid 1's SG1–SG4, through `wardic.*`.
//
// - SGV1: `stagger(0.25, { from: "last" })` staggers the Variant children by index, from the last.
// - SGV2 (#979 row 43): a `delayChildren` function that throws for one child gives that child no delay, the
//   others theirs, and Solid goes on; reported once a run of throws for that child, again after a clean call.
import { DomLive } from "@wardic/dom"
import { stagger, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"

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

  it("SGV2: a delayChildren function that throws for one child gives it no delay, the others theirs; reported once a run (#979)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [on, setOn] = createSignal(false)
    let broken = true
    const delayChildren = (i: number): number => {
      if (Bool.and(broken, i === 1)) throw new Error("its delayChildren broke")
      return i * 0.2
    }
    const { host } = mount(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.ul
          initial="hidden"
          animate={Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })}
          variants={{ hidden: {}, shown: {} }}
          transition={{ delayChildren }}
          style={{ "list-style": "none" }}
        >
          <For each={[0, 1, 2]}>{() => <wardic.li variants={ITEM} style={BOX} />}</For>
        </wardic.ul>
      </WardicProvider>
    ))
    for (let i = 0; i < 3; i++) await raf()
    const items = Array.from(host.querySelectorAll("li"))
    const failed = (): number => errorsNamed(logs, "wardic.stagger: a delayChildren function failed").length
    setOn(true)
    for (let i = 0; i < 4; i++) await raf()
    expect(xOf(items[1]!), "the child it threw for starts at once").toBeGreaterThan(0)
    expect(xOf(items[2]!), "its sibling waits out its 0.4 s").toBe(0)
    for (let i = 0; i < 60; i++) await raf()
    expect(items.map(xOf), "every child landed").toEqual([100, 100, 100])
    expect(failed(), "once").toBe(1)
    expect(errorsNamed(logs, "wardic.stagger: a delayChildren function failed")[0]!.annotations).toMatchObject({ index: 1 })
    // Still throwing at the next change: the same run.
    setOn(false)
    for (let i = 0; i < 60; i++) await raf()
    expect(failed(), "not again").toBe(1)
    // A clean call ends the run; the next throw is reported.
    broken = false
    setOn(true)
    for (let i = 0; i < 60; i++) await raf()
    broken = true
    setOn(false)
    for (let i = 0; i < 60; i++) await raf()
    expect(items.map(xOf), "back").toEqual([0, 0, 0])
    expect(failed(), "again after a clean call").toBe(2)
    expect(reports.every((message) => message === "its delayChildren broke")).toBe(true)
  })
})
