// A layout node's transitions, decoded by core (#66, ADR-0025 *Amendment (#66)*), checked against a
// fake ProjectionSink with every Refresh frame fired by hand (`projection-harness.ts`). A transition
// core rejects is the app's defect, in that one animation: reported, and the node lands.
//
// - PO1: a layout transition core rejects (a spring's stiffness 0, a tween's negative duration):
//   the node lands on its new box on its first frame, as reduced motion lands it, while a node
//   beside it, on a transition core takes, animates in the same pass.
// - PO2: a drag transition core rejects: the release is reported and lands on the slot.
// - PO3: a layout tween given no duration runs core's 0.3 s, its decode cached by the transition.
import { describe, expect, it } from "@effect/vitest"
import * as Machine from "@wardic/core/Machine"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

/** `id`'s x translate as last written (0 before any). */
const tx = (sk: Sink, id: string): number => sk.of(id).at(-1)?.tx ?? 0

const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

const register = (e: Engine, id: string, element: HTMLElement, transition: ProjectionSystem.LayoutTransition, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some(transition), ...opts })

/** The log lines naming `message`. */
const logged = (e: Engine, message: string) => e.logs.filter((l) => l.message.includes(message))

describe("a layout node's transitions, decoded by core (#66)", () => {
  const rejected: ReadonlyArray<readonly [string, ProjectionSystem.LayoutTransition]> = [
    ["a spring's stiffness 0", { type: "spring", stiffness: 0 }],
    ["a tween's negative duration", { type: "tween", duration: -1 }],
  ]
  for (const [name, transition] of rejected) {
    it(`PO1: ${name}: the node lands on its new box on its first frame, reported; a node beside it animates`, async () => {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      const root = stage()
      const badEl = makeBox(root, 0, 0, 100, 50)
      const goodEl = makeBox(root, 0, 100, 100, 50)
      const bad = register(e, "bad", badEl, transition)
      const good = register(e, "good", goodEl, { type: "spring" })
      await endOfTask()
      fireFrame()
      badEl.style.left = "200px"
      goodEl.style.left = "200px"
      bad.notify()
      good.notify()
      await endOfTask()
      fireFrame()
      expect(tx(sk, "bad"), "landed: no offset from its new box").toBe(0)
      expect(tx(sk, "good"), "still on its way from its old box").toBeLessThan(-100)
      const failed = logged(e, "wardic.projection: layout transition rejected")
      expect(failed).toHaveLength(1)
      e.dispose()
    })
  }

  it("PO2: a drag transition core rejects: the release is reported, and lands on the slot", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const a = register(e, "a", makeBox(root, 0, 0, 100, 50), { type: "spring" }, { dragTransition: () => Option.some({ timeConstant: 0 }) })
    await endOfTask()
    fireFrame()
    a.dragStart()
    a.dragMove({ x: 80, y: 0 })
    fireFrame()
    expect(tx(sk, "a"), "dragged").toBe(80)
    a.dragEnd({ x: 500, y: 0 })
    await endOfTask()
    fireFrame()
    fireFrame()
    expect(tx(sk, "a"), "on its slot").toBe(0)
    expect(logged(e, "wardic.projection: drag transition rejected")).toHaveLength(1)
    e.dispose()
  })

  it("PO3: a layout tween with no duration runs core's 0.3 s", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 0, 0, 100, 50)
    const a = register(e, "a", aEl, { type: "tween" })
    await endOfTask()
    fireFrame()
    aEl.style.left = "300px"
    a.notify()
    await endOfTask()
    // 0.3 s at 60 Hz: on its way at the 17th frame, landed by the 19th.
    const xs = Array.from({ length: 19 }, () => {
      fireFrame()
      return tx(sk, "a")
    })
    expect(Machine.resolveTween({}).seconds).toBe(0.3)
    expect(xs[16], "on its way at 17 frames").toBeLessThan(0)
    expect(xs[18], "landed by 19").toBe(0)
    expect(logged(e, "rejected")).toEqual([])
    e.dispose()
  })
})
