// The DOM's Measured pairs batch (#430, ADR-0059), through its port, `@wardic/dom/unstable/DomValues`'
// `measuredPairs`: one page-wide batch at the end of the task, its writes and reads apart.
//
// - MB1 (#979, row 8; ADR-0074): a request whose write throws (an exit's Transform template, the only
//   app code a batch calls) is its own: its pairs are left unread, its asker told once, and every other
//   request is measured, every style the batch wrote put back.
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as DomValues from "@wardic/dom/unstable/DomValues"
import * as Option from "effect/Option"
import { afterEach, describe, expect, it } from "vitest"

afterEach(() => {
  document.body.querySelectorAll("[data-mb-stage]").forEach((el) => el.remove())
})

/** A 100 × 40 box on a stage of its own, its content 80 px tall. */
const box = (): HTMLElement => {
  const stage = document.createElement("div")
  stage.dataset.mbStage = ""
  stage.style.cssText = "position:relative;width:400px"
  const el = document.createElement("div")
  el.style.cssText = "width:100px;height:40px;overflow:hidden"
  const content = document.createElement("div")
  content.style.height = "80px"
  el.append(content)
  stage.append(el)
  document.body.append(stage)
  return el
}

/** Every microtask queued so far, and the batch's among them, has run. */
const endOfTask = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** What an exit draws through a Transform template that throws, under the renderer's key (#443). */
const drawnThroughThrowing = {
  [DomRenderer.TEMPLATE_KEY]: (): string => {
    throw new Error("template failed")
  },
} as unknown as Values.Values

describe("the Measured pairs batch (#430)", () => {
  it("MB1 (#979, row 8): a request whose write throws leaves its pairs unread and tells its asker once; every other request is measured, every style put back", async () => {
    const told: Record<string, Array<unknown>> = { starts: [], targets: [], mixed: [], b: [], c: [] }
    const tell = (name: string) => (defect: unknown) => void told[name]!.push(defect)
    // B, asked first: its target written inline before the requests that throw.
    const b = box()
    const bPairs = DomValues.measuredPairs.measure(b, { height: { from: 40, to: "auto" } }, {}, tell("b"))
    // Two exits drawn through a Transform template that throws: one at the translate's start, one at its target.
    const starts = box()
    const startsPairs = DomValues.measuredPairs.measure(starts, { x: { from: "50%", to: 0 } }, drawnThroughThrowing, tell("starts"))
    const targets = box()
    const targetsPairs = DomValues.measuredPairs.measure(targets, { x: { from: 0, to: "50%" } }, drawnThroughThrowing, tell("targets"))
    // One whose height reads before its translate's target throws: the whole request is left unread.
    const mixed = box()
    const mixedPairs = DomValues.measuredPairs.measure(mixed, { height: { from: "auto", to: 0 }, x: { from: 0, to: "50%" } }, drawnThroughThrowing, tell("mixed"))
    // C, asked last: a translate to a percentage.
    const c = box()
    const cPairs = DomValues.measuredPairs.measure(c, { x: { from: 0, to: "50%" } }, {}, tell("c"))
    await endOfTask()

    expect(Option.map(bPairs.height!.measured(), ({ fromPx, toPx }) => ({ fromPx, toPx })), "B, measured").toEqual(Option.some({ fromPx: 40, toPx: 80 }))
    expect(Option.map(cPairs.x!.measured(), ({ fromPx, toPx }) => ({ fromPx, toPx })), "C, measured").toEqual(Option.some({ fromPx: 0, toPx: 50 }))
    expect(startsPairs.x!.measured(), "unread: it switches").toEqual(Option.none())
    expect(targetsPairs.x!.measured(), "unread: it switches").toEqual(Option.none())
    expect(mixedPairs.height!.measured(), "every pair of a request that threw, unread").toEqual(Option.none())
    expect(mixedPairs.x!.measured(), "unread").toEqual(Option.none())
    expect(b.style.height, "B's height, put back").toBe("40px")
    expect(c.style.transform, "C's transform, put back").toBe("")
    expect(starts.style.transform, "nothing left on a request that threw").toBe("")
    expect(targets.style.transform, "nothing left on a request that threw").toBe("")
    expect(told.starts!.map((d) => (d as Error).message), "told once").toEqual(["template failed"])
    expect(told.targets!.map((d) => (d as Error).message), "told once").toEqual(["template failed"])
    expect(told.mixed!.map((d) => (d as Error).message), "told once").toEqual(["template failed"])
    expect(told.b, "B told nothing").toEqual([])
    expect(told.c, "C told nothing").toEqual([])
  })
})
