// Regression: a layout change must never paint at its destination before its FLIP
// starts (issue #2), and a new node's first animation must not hesitate (issue #18).
//
// Before #2 the measure pass ran in the flush gate's next requestAnimationFrame. A
// layout change made after a Refresh frame's gate flush (a ResizeObserver callback,
// a later rAF callback, a Clock tick, an effect inside the gate's own batch()) could
// only be measured in the next frame, so the current one painted the element at its
// destination and the FLIP then pulled it back: a flash. Since #2 every trigger
// queues one Measure pass at the end of its task; the pass has the gate apply what
// it wrote before returning, and a running node whose box didn't change is left alone
// (ADR-0018). The nodes it seeded take their first step at the next tick, painted in that
// frame (ADR-0033). So a change made after the frame's tick paints its origin in that frame
// and moves on the next one.
//
// How a frame is read: post-paint, never inside a rAF callback. `paintedFrames`
// starts from a task (its first box is the next frame's paint); a trigger that runs
// inside a frame's rendering update starts `paintedFramesFromHere` right there, so
// its first box is that frame's paint. Each trigger fires from the execution context
// its layout-lab scenario tests (examples/layout-lab/src/scenarios/).
import { cleanup, render } from "@solidjs/testing-library"
import * as Clock from "@wardic/core/Clock"
import { DomLive } from "@wardic/dom"
import { createWard, useWardicGate, useWardicRuntime, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { type Accessor, createEffect, createSignal, type JSX, on, onCleanup, onMount, Show } from "solid-js"
import { afterEach, expect, it } from "vitest"
import {
  afterPaint,
  type PaintedSample,
  paintedFrames,
  paintedFramesFromHere,
  paintedTimedFrames,
  raf,
  until,
} from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .mp-stage{position:relative;width:700px;height:420px}
  .mp-box{position:absolute;top:0;left:0;width:60px;height:60px}
  .mp-dot{position:absolute;top:380px;left:0;width:20px;height:20px}
`

/** Mount inside a provider with the test stylesheet. */
const Stage = (props: { readonly children: JSX.Element }) => (
  <WardicProvider env={DomLive}>
    <style>{CSS}</style>
    <div class="mp-stage">{props.children}</div>
  </WardicProvider>
)

/** Let the mount's Measure passes and the first observer deliveries run, then return in a task after a paint. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

/**
 * A layout change made after its frame's gate flush: that frame paints the origin
 * (within 1px), never the destination; the next frame has moved, but not all the way.
 */
const expectOriginThenMove = (
  frames: ReadonlyArray<DOMRect>,
  key: "left" | "width",
  origin: number,
  destination: number,
): void => {
  const f0 = frames[0]![key]
  expect(Math.abs(f0 - origin)).toBeLessThanOrEqual(1)
  expect(Math.abs(f0 - destination)).toBeGreaterThan(1)
  const f1 = frames[1]![key]
  expect(Math.abs(f1 - origin)).toBeGreaterThan(1)
  expect(Math.abs(f1 - origin)).toBeLessThan(Math.abs(destination - origin))
}

/** Painted steps (px) between consecutive samples, with `origin` as the sample before the first. */
const stepsFrom = (origin: number, lefts: ReadonlyArray<number>): Array<number> => {
  const xs = [origin, ...lefts]
  return xs.slice(1).map((x, i) => Math.abs(x - xs[i]!))
}

/** The index of the first sample read after `t`. */
const firstAfter = (samples: ReadonlyArray<PaintedSample>, t: number): number => samples.findIndex((s) => s.t > t)

/**
 * The default spring, pinned (ADR-0009 *Amendment (#171)*): its first step, about 2.5% of the move,
 * is this file's measuring stick for "origin, then moved". The default tween's is under a pixel.
 */
const SPRING = { type: "spring" } as const

/** A layout box whose `left` and `layoutDependency` follow `atB`. */
const LayoutBox = (props: {
  readonly atB: Accessor<boolean>
  readonly to: number
  readonly top?: number
  readonly ref: (el: HTMLElement) => void
}) => (
  <wardic.div
    ref={props.ref}
    class="mp-box"
    layout
    transition={SPRING}
    layoutDependency={props.atB()}
    style={{ top: `${props.top ?? 0}px`, left: Bool.match(props.atB(), { onTrue: () => `${props.to}px`, onFalse: () => "0px" }) }}
  />
)

/** A soft background spring that keeps the Clock ticking (and the gate writing) for seconds. */
const WarmDot = (props: { readonly ref?: (el: HTMLElement) => void; readonly to: Accessor<number> }) => (
  <wardic.div ref={props.ref} class="mp-dot" animate={{ x: props.to() }} transition={{ stiffness: 4, damping: 1 }} />
)

it("content growth seen only by the engine's ResizeObserver paints its origin first, never its destination (s2)", async () => {
  const [grown, setGrown] = createSignal(false)
  let box!: HTMLElement
  render(() => (
    <Stage>
      <wardic.div ref={(el) => (box = el)} layout transition={SPRING} style={{ position: "absolute", top: "0px", left: "0px", display: "flex" }}>
        <span style={{ width: "60px", height: "60px", flex: "none" }} />
        <Show when={grown()}>
          <span style={{ width: "120px", height: "60px", flex: "none" }} />
        </Show>
      </wardic.div>
    </Stage>
  ))
  await settle()
  const origin = box.getBoundingClientRect().width
  const frames = paintedFrames(box, 3) // the first box is the next frame's paint
  setGrown(true) // only the engine's ResizeObserver sees this, after that frame's rAF callbacks
  expectOriginThenMove(await frames, "width", origin, origin + 120)
})

it("a layout change from an app ResizeObserver callback paints its origin first (s3)", async () => {
  const [wide, setWide] = createSignal(false)
  const [atB, setAtB] = createSignal(false)
  let box!: HTMLElement
  let driver!: HTMLDivElement
  let armed = false
  let sampled: Promise<ReadonlyArray<DOMRect>> | undefined
  const App = () => {
    const observer = new ResizeObserver(() => {
      if (!armed) return // observe()'s first delivery is not a resize
      armed = false
      setAtB(true) // the layout change, inside the observer callback
      sampled = paintedFramesFromHere(box, 3)
    })
    onMount(() => observer.observe(driver))
    onCleanup(() => observer.disconnect())
    return (
      <>
        <div ref={driver} style={{ position: "absolute", top: "300px", left: "0px", height: "10px", width: Bool.match(wide(), { onTrue: () => "200px", onFalse: () => "50px" }) }} />
        <LayoutBox atB={atB} to={240} ref={(el) => (box = el)} />
      </>
    )
  }
  render(() => (
    <Stage>
      <App />
    </Stage>
  ))
  await settle()
  const origin = box.getBoundingClientRect().left
  armed = true
  setWide(true)
  await until(() => sampled !== undefined)
  expectOriginThenMove(await sampled!, "left", origin, origin + 240)
})

it("a layout change inside a rAF callback that runs after the gate's flush paints its origin first (s4)", async () => {
  const [atB, setAtB] = createSignal(false)
  const [drive, setDrive] = createSignal(0)
  let box!: HTMLElement
  render(() => (
    <Stage>
      <LayoutBox atB={atB} to={240} ref={(el) => (box = el)} />
      <WarmDot to={drive} />
    </Stage>
  ))
  await settle()
  setDrive(2000) // the gate's frame is now requested by each previous frame's Clock tick
  for (let i = 0; i < 10; i++) await raf()
  await afterPaint()
  const origin = box.getBoundingClientRect().left
  let sampled: Promise<ReadonlyArray<DOMRect>> | undefined
  // Requested in this task, after the gate's and the Clock's: it runs after both.
  requestAnimationFrame(() => {
    setAtB(true)
    sampled = paintedFramesFromHere(box, 3)
  })
  await until(() => sampled !== undefined)
  expectOriginThenMove(await sampled!, "left", origin, origin + 240)
})

it("a layout change inside a Clock tick paints its origin first (s5)", async () => {
  const [atB, setAtB] = createSignal(false)
  let box!: HTMLElement
  let armed = false
  let sampled: Promise<ReadonlyArray<DOMRect>> | undefined
  /** Subscribes to Clock.ticks and makes the layout change inside the first tick after arming. */
  const TickTrigger = () => {
    const runtime = useWardicRuntime()
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock
        yield* Stream.runForEach(clock.ticks, () =>
          Effect.sync(() => {
            if (!armed) return
            armed = false
            setAtB(true)
            sampled = paintedFramesFromHere(box, 3)
          }),
        )
      }),
    )
    onCleanup(() => {
      runtime.runFork(Fiber.interrupt(fiber))
    })
    return null
  }
  render(() => (
    <Stage>
      <LayoutBox atB={atB} to={240} ref={(el) => (box = el)} />
      <TickTrigger />
    </Stage>
  ))
  await settle()
  const origin = box.getBoundingClientRect().left
  armed = true
  await until(() => sampled !== undefined)
  expectOriginThenMove(await sampled!, "left", origin, origin + 240)
})

it("a layout change from an effect inside the gate's flush paints its origin first (s8)", async () => {
  const [atB, setAtB] = createSignal(false)
  const [driven, setDriven] = createSignal(false)
  let box!: HTMLElement
  let armed = false
  let sampled: Promise<ReadonlyArray<DOMRect>> | undefined
  /**
   * A driver whose `style` changes only at its first frame's Starting-style switch, which the
   * gate runs inside its flush, in the binding's batch() (ADR-0034): it mounts when armed.
   */
  const Driver = () => {
    const ward = createWard({ initial: { x: 0 }, animate: { x: 256 } })
    createEffect(
      on(
        () => ward().style,
        () => {
          if (!armed) return
          armed = false
          setAtB(true) // still inside the gate's flush
          sampled = paintedFramesFromHere(box, 3)
        },
        { defer: true },
      ),
    )
    return <div {...ward({ style: { position: "absolute", top: "200px", left: "0px", width: "20px", height: "20px" } })} />
  }
  render(() => (
    <Stage>
      <LayoutBox atB={atB} to={240} ref={(el) => (box = el)} />
      <Show when={driven()}>
        <Driver />
      </Show>
    </Stage>
  ))
  await settle()
  const origin = box.getBoundingClientRect().left
  armed = true
  setDriven(true)
  await until(() => sampled !== undefined)
  // The documented D3 edge: this change lands between the frame's gate flush and its
  // Clock tick, so the first move may be about two steps; frame 0 still shows the origin.
  expectOriginThenMove(await sampled!, "left", origin, origin + 240)
})

it("a layout change from an effect inside the gate's flush on an otherwise idle page is measured before the paint (s8, #2's untested case)", async () => {
  const [atB, setAtB] = createSignal(false)
  let box!: HTMLElement
  let armed = false
  let writeOnce: (() => void) | undefined
  let sampled: Promise<ReadonlyArray<DOMRect>> | undefined
  /** One gate write, and nothing else animating: no later gate frame can rescue a stranded pass. */
  const IdleDriver = () => {
    const gate = useWardicGate()
    const [held, setHeld] = createSignal<ReadonlyArray<string>>([])
    // A binding's hook, which the flush runs before the commit (ADR-0034): the effect its
    // signal set runs is inside the gate's flush.
    onCleanup(gate.register("mp-idle-driver", { target: document.createElement("div"), onHeld: (keys) => setHeld(keys) }))
    createEffect(
      on(
        held,
        () => {
          if (!armed) return
          armed = false
          setAtB(true)
          sampled = paintedFramesFromHere(box, 3)
        },
        { defer: true },
      ),
    )
    writeOnce = () => gate.write("mp-idle-driver", { x: 1 })
    return null
  }
  render(() => (
    <Stage>
      <LayoutBox atB={atB} to={240} ref={(el) => (box = el)} />
      <IdleDriver />
    </Stage>
  ))
  await settle()
  const origin = box.getBoundingClientRect().left
  armed = true
  writeOnce!()
  await until(() => sampled !== undefined)
  expectOriginThenMove(await sampled!, "left", origin, origin + 240)
})

it("a newly mounted layoutId twin's animation doesn't hesitate: its 2nd step is larger than its 1st (#18)", async () => {
  const [showB, setShowB] = createSignal(false)
  let a!: HTMLElement
  let b: HTMLElement | undefined
  render(() => (
    <Stage>
      <Show
        when={showB()}
        fallback={<wardic.div ref={(el) => (a = el)} class="mp-box" layoutId="mp-twin" style={{ left: "0px" }} />}
      >
        <wardic.div ref={(el) => (b = el)} class="mp-box" layoutId="mp-twin" style={{ left: "300px" }} />
      </Show>
    </Stage>
  ))
  await settle()
  const origin = a.getBoundingClientRect().left
  setShowB(true) // the switch, from a task
  const frames = await paintedFrames(b!, 6)
  const steps = stepsFrom(
    origin,
    frames.map((f) => f.left),
  )
  const i = steps.findIndex((s) => s > 1)
  // Before the fix the observer's first delivery restarted the spring at zero velocity:
  // steps like 5.1 4.9 10.3; a first animation should accelerate like any other (5.1 10.7 13.7).
  expect(steps[i + 1]!).toBeGreaterThan(steps[i]!)
})

it("a Measure pass for another node leaves a running animation whose box didn't change alone (D6)", async () => {
  const [atA, setAtA] = createSignal(false)
  const [atB, setAtB] = createSignal(false)
  let a!: HTMLElement
  render(() => (
    <Stage>
      <LayoutBox atB={atA} to={200} ref={(el) => (a = el)} />
      <LayoutBox atB={atB} to={200} top={200} ref={() => {}} />
    </Stage>
  ))
  await settle()
  const sampled = paintedTimedFrames(a, 18)
  setAtA(true)
  for (let i = 0; i < 8; i++) await raf()
  await afterPaint()
  const tB = performance.now()
  setAtB(true) // another node moves: a Measure pass runs while A is mid-flight, A's box unchanged
  const samples = await sampled
  const lefts = samples.map((s) => s.box.left)
  // The first read after the trigger can be the previous frame's (its post-paint
  // message may run after the trigger's task), so check three steps from there on.
  const j = firstAfter(samples, tB)
  for (const k of [j, j + 1, j + 2]) {
    const ratio = Math.abs(lefts[k]! - lefts[k - 1]!) / Math.abs(lefts[k - 1]! - lefts[k - 2]!)
    expect(ratio).toBeGreaterThan(0.6) // not restarted at zero velocity (a restart reads about 0.2)
    expect(ratio).toBeLessThan(1.6)
  }
})

it("an unrelated spring keeps even steps through a Measure pass that runs after the frame's gate flush (D2)", async () => {
  const [wide, setWide] = createSignal(false)
  const [atB, setAtB] = createSignal(false)
  const [drive, setDrive] = createSignal(0)
  let dot!: HTMLElement
  let driver!: HTMLDivElement
  let armed = false
  let tPass = 0
  const App = () => {
    const observer = new ResizeObserver(() => {
      if (!armed) return
      armed = false
      tPass = performance.now()
      setAtB(true) // a layout change after the frame's gate flush (the s3 path)
    })
    onMount(() => observer.observe(driver))
    onCleanup(() => observer.disconnect())
    return (
      <>
        <div ref={driver} style={{ position: "absolute", top: "300px", left: "0px", height: "10px", width: Bool.match(wide(), { onTrue: () => "200px", onFalse: () => "50px" }) }} />
        <LayoutBox atB={atB} to={240} ref={() => {}} />
        <WarmDot to={drive} ref={(el) => (dot = el)} />
      </>
    )
  }
  render(() => (
    <Stage>
      <App />
    </Stage>
  ))
  await settle()
  setDrive(2000)
  for (let i = 0; i < 10; i++) await raf()
  const sampled = paintedTimedFrames(dot, 14)
  for (let i = 0; i < 5; i++) await raf()
  await afterPaint()
  armed = true
  setWide(true)
  const samples = await sampled
  const lefts = samples.map((s) => s.box.left)
  const j = firstAfter(samples, tPass) // as in the D6 test, the first read may be the previous frame's
  for (const k of [j, j + 1, j + 2]) {
    const ratio = Math.abs(lefts[k]! - lefts[k - 1]!) / Math.abs(lefts[k - 1]! - lefts[k - 2]!)
    expect(ratio).toBeGreaterThan(0.6) // no frame skipped ahead
    expect(ratio).toBeLessThan(1.6) // and none held
  }
})

/** A `createWard` layout node whose style changes run `onStyle` (inside the gate's apply). */
const WatchedLayoutNode = (props: {
  readonly atB: Accessor<boolean>
  readonly top: number
  readonly onStyle: () => void
  readonly ref: (el: HTMLElement) => void
}) => {
  const ward = createWard(() => ({ layout: true, layoutDependency: props.atB() }))
  createEffect(on(() => ward().style, () => props.onStyle(), { defer: true }))
  return (
    <div
      {...ward({
        ref: props.ref,
        get style(): JSX.CSSProperties {
          return { position: "absolute", top: `${props.top}px`, left: Bool.match(props.atB(), { onTrue: () => "200px", onFalse: () => "0px" }), width: "40px", height: "30px" }
        },
      })}
    />
  )
}

it("a layout change made while a Measure pass flushes is measured in the same pass, before the paint (D5)", async () => {
  const [atA, setAtA] = createSignal(false)
  const [atB, setAtB] = createSignal(false)
  let b!: HTMLElement
  let armed = false
  render(() => (
    <Stage>
      <WatchedLayoutNode
        atB={atA}
        top={0}
        ref={() => {}}
        onStyle={() => {
          if (!armed) return
          armed = false
          setAtB(true) // re-entrant: during the flush of A's seed
        }}
      />
      <LayoutBox atB={atB} to={200} top={100} ref={(el) => (b = el)} />
    </Stage>
  ))
  await settle()
  const origin = b.getBoundingClientRect().left
  armed = true
  const frames = paintedFrames(b, 2)
  setAtA(true)
  const f0 = (await frames)[0]!.left
  expect(Math.abs(f0 - origin)).toBeLessThanOrEqual(20) // on its path, within 10% of the 200px move
  expect(Math.abs(f0 - (origin + 200))).toBeGreaterThan(1) // never at its destination
})

it("a chain of re-entrant layout changes is capped: the first 5 land before the paint, and all 8 finish (D5)", async () => {
  const N = 8
  const signals = Array.from({ length: N }, () => createSignal(false))
  const boxes: Array<HTMLElement> = []
  const armed = Array.from({ length: N }, () => false)
  render(() => (
    <Stage>
      {signals.map(([at], i) => (
        <WatchedLayoutNode
          atB={at}
          top={i * 45}
          ref={(el) => (boxes[i] = el)}
          onStyle={() => {
            if (!armed[i] || i === N - 1) return
            armed[i] = false
            signals[i + 1]![1](true) // node i's flush moves node i + 1
          }}
        />
      ))}
    </Stage>
  ))
  await settle()
  const origins = boxes.map((el) => el.getBoundingClientRect().left)
  armed.fill(true)
  const firstFrames = boxes.map((el) => paintedFrames(el, 1))
  signals[0]![1](true)
  const f0 = await Promise.all(firstFrames)
  for (let i = 0; i < 5; i++) {
    const left = f0[i]![0]!.left
    expect(Math.abs(left - origins[i]!)).toBeLessThanOrEqual(20)
    expect(Math.abs(left - (origins[i]! + 200))).toBeGreaterThan(1)
  }
  await until(() => boxes.every((el, i) => Math.abs(el.getBoundingClientRect().left - (origins[i]! + 200)) < 1), 6000)
  for (let i = 0; i < N; i++) expect(Math.abs(boxes[i]!.getBoundingClientRect().left - (origins[i]! + 200))).toBeLessThan(1)
})
