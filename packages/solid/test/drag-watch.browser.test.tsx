// The drag track on watches (#379, ADR-0055 *Amendment (#379)*): its samples and grabs are watches in
// the element's watch Scope, each response forked inside its event.
//
// - DW1: a response that fails (here the binding's `setDragging`, thrown at the first gesture's start)
//   is logged at Error and reported once, and the track goes on: the gesture's next move drags, and so
//   does the next gesture (Q4).
import { cleanup, render } from "@solidjs/testing-library"
import { runDragTrack, useWardicGate, useWardicRuntime, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as MutableRef from "effect/MutableRef"
import { afterEach, expect, it } from "vitest"
import { dragTransitionOf } from "../src/drag.tsx"
import { raf } from "./browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"

afterEach(() => {
  cleanup()
})

/** A primary mouse's pointer event at `x`, with `buttons` pressed. */
const pointer = (type: string, x: number, buttons: number): PointerEvent =>
  new PointerEvent(type, { clientX: x, clientY: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true })

it("DW1: a response that fails is logged at Error, reported once, and the track goes on", async () => {
  const logs: Array<Logged> = []
  const reports: Array<string> = []
  const xs: Array<number> = []
  const starts = MutableRef.make(0)
  let el!: HTMLDivElement
  const Track = () => {
    el = (<div style={{ width: "40px", height: "40px" }} />) as HTMLDivElement
    runDragTrack({
      runtime: useWardicRuntime(),
      gate: useWardicGate(),
      id: "dw1",
      element: el,
      snapshot: { values: {}, velocities: {}, drawnAt: {}, now: () => performance.now() },
      recordFrame: (values) => xs.push(Number(values.x)),
      setDragging: (on) => {
        if (Bool.not(on)) return
        MutableRef.increment(starts)
        if (MutableRef.get(starts) === 1) throw new Error("the response broke")
      },
      config: { axis: "x", momentum: false, transition: dragTransitionOf(undefined, undefined) },
    })
    return el
  }
  render(() => (
    <WardicProvider env={envWith({ logs, reports })}>
      <Track />
    </WardicProvider>
  ))
  await raf()
  const drag = (from: number, to: number): void => {
    el.dispatchEvent(pointer("pointerdown", from, 1))
    el.dispatchEvent(pointer("pointermove", from + 20, 1))
    el.dispatchEvent(pointer("pointermove", to, 1))
    el.dispatchEvent(pointer("pointerup", to, 0))
  }
  drag(0, 40)
  expect(errorsNamed(logs, "wardic.drag: a response failed"), "logged at Error once").toHaveLength(1)
  expect(xs, "the gesture's next move dragged, inside its event").toContain(40)
  await raf()
  await raf()
  const before = xs.length
  drag(100, 160)
  expect(xs.length, "the next gesture dragged").toBeGreaterThan(before)
  expect(xs.at(-1), "from where the first rested, 40, plus 60").toBe(100)
  await raf()
  expect(reports).toEqual(["the response broke"])
})

