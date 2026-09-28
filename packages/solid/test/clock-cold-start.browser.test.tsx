// Regression: an animation that starts the Clock from idle (a Cold start) must move
// as soon as one that joins a running Clock (issue #14). It used to hold two extra
// frames: the Clock was acquired inside frame K's gate flush, so its first tick came
// in K+1 and the gate painted it in K+2 (ADR-0006's one-frame latency), and that
// first tick carried dt = 0. The fix delivers a Priming tick with the nominal dt at
// the end of the subscribing task, and runs the Refresh frame loop without the
// Effect scheduler (ADR-0017).
//
// Since #2 a layout change is measured in a Measure pass at the end of the task that
// made it, and the pass's Priming step takes the animation's first step there too
// (ADR-0018): on a Cold start that step is the Clock's Priming tick, on a ticking
// Clock the projection engine takes it itself. A layout FLIP triggered from a task
// therefore moves on the 1st painted frame, cold or warm.
//
// How a frame is read: `paintedFrames` samples each box just after its paint (a
// rAF posts a message; the handler reads). A read inside a rAF callback depends on
// callback order, which is exactly what a Cold start changes. Every trigger runs in
// a task after a paint (`afterPaint`), where a click lands, so the first sample is
// the first frame painted after the trigger.
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

/** A layout box that jumps 200px right when `moved()` flips, plus an optional background spring. */
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

/**
 * The first painted frame has already moved one step: more than 1px, and less than
 * 10% of the 200px move (one nominal step of the default spring from rest is about
 * 2.4%). The origin itself is never painted.
 */
const expectMovesOnFirstFrame = (frames: ReadonlyArray<DOMRect>, origin: number): void => {
  expect(frames[0]!.left - origin).toBeGreaterThan(1)
  expect(frames[0]!.left - origin).toBeLessThan(20)
}

it("Cold start: a layout FLIP with nothing else animating moves on the 1st painted frame", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => <FlipStage env={DomLive} moved={moved} />)
  const box = container.querySelector("[data-box]") as HTMLElement
  for (let i = 0; i < 3; i++) await raf()
  await afterPaint()
  const origin = box.getBoundingClientRect().left

  setMoved(true)
  expectMovesOnFirstFrame(await paintedFrames(box, 2), origin)
})

it("warm start: a layout FLIP while another spring runs also moves on the 1st painted frame", async () => {
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
  expectMovesOnFirstFrame(await paintedFrames(box, 2), origin)
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
  expectMovesOnFirstFrame(frames, origin)
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

it("retargeting the only running spring mid-motion paints no doubled or frozen step", async () => {
  // `useWardic` interrupts the old spring before the new one subscribes, so with
  // nothing else animating the Clock has no subscriber for a moment. It must stay
  // warm through that (its loop ends only at a Refresh frame that finds nobody):
  // restarting cold froze a frame before #14, and after the Priming tick landed it
  // doubled a step instead (the new spring's first value overwrote the old one's
  // unpainted value in the gate).
  const [x, setX] = createSignal(0)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div class="cs-stage">
        <wardic.div data-dot class="cs-dot" animate={{ x: x() }} transition={{ stiffness: 20, damping: 8 }} />
      </div>
    </WardicProvider>
  ))
  const dot = container.querySelector("[data-dot]") as HTMLElement
  for (let i = 0; i < 3; i++) await raf()
  setX(600)
  for (let i = 0; i < 12; i++) await raf() // well into the motion: ~17px a frame
  await afterPaint()
  const before = await paintedFrames(dot, 3)

  setX(800) // the retarget, from a task after a paint
  const after = await paintedFrames(dot, 3)
  const lefts = [...before, ...after].map((box) => box.left)
  const steps = lefts.slice(1).map((left, i) => left - lefts[i]!)
  // steps[2] spans the retarget; its neighbours are ordinary frames.
  expect(steps[2]! / steps[1]!).toBeGreaterThan(0.6) // not frozen (was 0)
  expect(steps[2]! / steps[1]!).toBeLessThan(1.6) // not doubled (was 2)
})
