// Regression: an animation that starts the Clock from idle (a Cold start) must move
// as soon as one that joins a running Clock (issue #14). It used to hold two extra
// frames: the Clock was acquired inside frame K's gate flush, so its first tick came
// in K+1 and the gate painted it in K+2 (ADR-0006's one-frame latency), and that
// first tick carried dt = 0. The fix delivers a Priming tick with the nominal dt at
// the end of the subscribing task, and runs the Refresh frame loop without the
// Effect scheduler (ADR-0017).
//
// How a frame is read: `paintedFrames` samples each box just after its paint (a
// rAF posts a message; the handler reads). A read inside a rAF callback depends on
// callback order, which is exactly what a Cold start changes. Every trigger runs in
// a task after a paint (`afterPaint`), where a click lands, so the first sample is
// the frame the gate's pass runs in.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicEnv, WardicProvider } from "@wardic/solid"
import * as Layer from "effect/Layer"
import * as Scheduler from "effect/Scheduler"
import { createSignal } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { afterPaint, paintedFrames, raf } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .cs-stage{position:relative;width:600px;height:200px}
  .cs-box{position:absolute;top:0;left:0;width:100px;height:100px}
  .cs-box.moved{left:200px}
  .cs-dot{position:absolute;top:150px;left:0;width:20px;height:20px}
`

/** A layout box that jumps 200px right when `moved()` flips, plus an optional driver dot. */
const FlipStage = (props: { env: WardicEnv; moved: () => boolean; drive?: () => number }) => (
  <WardicProvider env={props.env}>
    <style>{CSS}</style>
    <div class="cs-stage">
      <wardic.div data-box class="cs-box" classList={{ moved: props.moved() }} layout layoutDependency={props.moved()} />
      {props.drive !== undefined && (
        // A soft spring toward a far target keeps the Clock ticking for seconds.
        <wardic.div class="cs-dot" animate={{ x: props.drive() }} transition={{ stiffness: 4, damping: 1 }} />
      )}
    </div>
  </WardicProvider>
)

/** Frame K (the gate's pass) paints the origin; frame K+1 has moved toward the destination. */
const expectMovesOnSecondFrame = (frames: ReadonlyArray<DOMRect>, origin: number): void => {
  expect(Math.abs(frames[0]!.left - origin)).toBeLessThanOrEqual(1)
  expect(frames[1]!.left - origin).toBeGreaterThan(1)
  expect(frames[1]!.left - origin).toBeLessThan(200)
}

it("Cold start: a layout FLIP with nothing else animating moves on the 2nd painted frame", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => <FlipStage env={DomLive} moved={moved} />)
  const box = container.querySelector("[data-box]") as HTMLElement
  for (let i = 0; i < 3; i++) await raf()
  await afterPaint()
  const origin = box.getBoundingClientRect().left

  setMoved(true)
  expectMovesOnSecondFrame(await paintedFrames(box, 2), origin)
})

it("warm start: a layout FLIP while another spring runs still moves on the 2nd painted frame", async () => {
  const [moved, setMoved] = createSignal(false)
  const [drive, setDrive] = createSignal(0)
  const { container } = render(() => <FlipStage env={DomLive} moved={moved} drive={drive} />)
  const box = container.querySelector("[data-box]") as HTMLElement
  for (let i = 0; i < 3; i++) await raf()
  setDrive(2000)
  for (let i = 0; i < 10; i++) await raf()
  await afterPaint()
  const origin = box.getBoundingClientRect().left

  setMoved(true)
  expectMovesOnSecondFrame(await paintedFrames(box, 2), origin)
})

it("Cold start on a setTimeout(0) Effect scheduler (real-browser timing): same frames, and no scheduler dispatch", async () => {
  // The harness's `setImmediate` polyfill is microtask-backed; a real browser has
  // none, so Effect falls back to setTimeout(0). The scheduler must reach the
  // Clock's build (its RcRef captures the build context), so it is provided INTO
  // DomLive rather than merged beside it.
  let dispatches = 0
  const timeoutScheduler = new Scheduler.MixedScheduler("async", (task) => {
    dispatches++
    const timer = setTimeout(task, 0)
    return () => clearTimeout(timer)
  })
  const env: WardicEnv = DomLive.pipe(Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, timeoutScheduler)))
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => <FlipStage env={env} moved={moved} />)
  const box = container.querySelector("[data-box]") as HTMLElement
  for (let i = 0; i < 3; i++) await raf()
  await afterPaint()
  const origin = box.getBoundingClientRect().left
  const before = dispatches

  setMoved(true)
  const frames = await paintedFrames(box, 6)
  expectMovesOnSecondFrame(frames, origin)
  expect(dispatches - before).toBe(0) // the Refresh frame loop never touches the scheduler
})

it("Cold start: a useWardic spring set from a task moves on the 1st painted frame", async () => {
  const [go, setGo] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div class="cs-stage">
        <wardic.div data-dot class="cs-dot" animate={{ x: go() ? 200 : 0 }} />
      </div>
    </WardicProvider>
  ))
  const dot = container.querySelector("[data-dot]") as HTMLElement
  for (let i = 0; i < 3; i++) await raf()
  await afterPaint()
  const origin = dot.getBoundingClientRect().left

  setGo(true)
  const [first] = await paintedFrames(dot, 1)
  expect(first!.left - origin).toBeGreaterThan(1)
  expect(first!.left - origin).toBeLessThan(200)
})
