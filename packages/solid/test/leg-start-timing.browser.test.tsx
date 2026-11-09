// A leg started after its frame's tick, before its paint, moves in that frame (#680, ADR-0027
// *Amendment (#680)*). The Frame loop's Late window runs from a tick's first step until a microtask the
// tick queues at its end. A run added in it takes its Late step there, at the tick's dt, and the hooks run
// again, so the gate paints that step in the frame. Before #680 the frame painted the leg's origin and
// the next one took its first step. Solid 1's effects run at the write, so a start a callback in the tick
// makes is in the window. App code in a later rAF callback isn't, and still paints its origin first.
// Real frames.
//
// - LS1: a leg an `onAnimationComplete` callback starts moves in the frame the first leg lands in.
// - LS2: a `when: "beforeChildren"` child moves in the frame its parent lands in.
// - LS3: `mode="wait"`: the entering child is drawn moving in its first frame on the page.
// - LS4: a change from a task: a single first step at the next frame, as before (no doubling).
// - LS5: a change in a later rAF callback paints its origin first, as before.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { type Accessor, createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, expectMovedFirst, frameNow, leftOf, paintedFrames, paintedFramesFromHere, paintedReads, raf, readOf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .ls-stage{position:relative;width:700px;height:300px}
  .ls-box{position:absolute;top:0;left:0;width:40px;height:40px}
`

/** The default spring, from rest: its first step is about 2.5% of the move, and its second larger. */
const SPRING = { type: "spring" } as const
/** A short tween, for the leg whose landing starts the next. */
const SHORT = { type: "tween", duration: 0.1 } as const

const Stage = (props: { readonly children: JSX.Element }) => (
  <WardicProvider env={DomLive}>
    <style>{CSS}</style>
    <div class="ls-stage">{props.children}</div>
  </WardicProvider>
)

/** Let the mount settle, then return in a task after a paint. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

const opacityOf = (el: HTMLElement | null): number => {
  if (el === null) return Number.NaN
  return Number(getComputedStyle(el).opacity)
}

/** A soft background spring that keeps the Clock warm, as an animating page does. */
const WarmDot = (props: { readonly to: Accessor<number> }) => (
  <wardic.div class="ls-box" style={{ top: "260px", width: "10px", height: "10px" }} animate={{ x: props.to() }} transition={{ type: "spring", stiffness: 2, damping: 1 }} />
)

/** The first frame painted the origin, and the next one moved. */
const expectOriginFirst = (xs: ReadonlyArray<number>, origin: number): void => {
  expect(Math.abs(xs[0]! - origin), "the first frame painted the origin").toBeLessThanOrEqual(0.01)
  expect(Math.abs(xs[1]! - origin)).toBeGreaterThan(0.01)
}

describe("a leg started in the Late window moves in that frame (#680)", () => {
  it("LS1: a leg an onAnimationComplete callback starts moves in the frame the first leg lands in", async () => {
    const [go, setGo] = createSignal(false)
    const [chained, setChained] = createSignal(false)
    let b!: HTMLDivElement
    let landedAt: number | undefined
    render(() => (
      <Stage>
        <wardic.div
          class="ls-box"
          animate={{ x: Bool.match(go(), { onTrue: () => 40, onFalse: () => 0 }) }}
          transition={SHORT}
          onAnimationComplete={() => {
            if (!go()) return
            landedAt = frameNow()
            setChained(true)
          }}
        />
        <wardic.div ref={b} class="ls-box" style={{ top: "100px" }} animate={{ x: Bool.match(chained(), { onTrue: () => 256, onFalse: () => 0 }) }} transition={SPRING} />
      </Stage>
    ))
    await settle()
    const bFrom = leftOf(b)
    setGo(true)
    const reads = await paintedReads(() => [frameNow(), leftOf(b)] as const, 24)
    const i = readOf(reads, landedAt)
    expect(Math.abs(reads[i - 1]![1] - bFrom), "b waited for a's landing").toBeLessThanOrEqual(0.01)
    expectMovedFirst(reads.slice(i).map(([, bx]) => bx), bFrom, bFrom + 256)
  })

  it('LS2: a when: "beforeChildren" child moves in the frame its parent lands in', async () => {
    const [shown, setShown] = createSignal(false)
    let child!: HTMLDivElement
    let landedAt: number | undefined
    const variants = {
      hidden: { opacity: 0.5 },
      shown: { opacity: 1, transition: { when: "beforeChildren", ...SHORT } },
    } as const
    const childVariants = { hidden: { x: 0 }, shown: { x: 256, transition: SPRING } } as const
    const name = (): "shown" | "hidden" => Bool.match(shown(), { onTrue: () => "shown" as const, onFalse: () => "hidden" as const })
    render(() => (
      <Stage>
        <wardic.div
          initial="hidden"
          animate={name()}
          variants={variants}
          onAnimationComplete={(definition) => {
            if (definition === "shown") landedAt = frameNow()
          }}
        >
          <wardic.div ref={child} class="ls-box" variants={childVariants} />
        </wardic.div>
      </Stage>
    ))
    await settle()
    const from = leftOf(child)
    setShown(true)
    const reads = await paintedReads(() => [frameNow(), leftOf(child)] as const, 24)
    const i = readOf(reads, landedAt)
    expect(Math.abs(reads[i - 1]![1] - from), "the child waited for its parent").toBeLessThanOrEqual(0.01)
    expectMovedFirst(reads.slice(i).map(([, x]) => x), from, from + 256)
  })

  it('LS3: under mode="wait", the entering child is drawn moving in its first frame on the page', async () => {
    const [tab, setTab] = createSignal("a")
    let stage!: HTMLDivElement
    let exitedAt: number | undefined
    render(() => (
      <Stage>
        <div ref={stage}>
          <AnimatePresence mode="wait" onExitComplete={() => (exitedAt = frameNow())}>
            <Show when={tab()} keyed>
              {(t) => (
                <wardic.div data-tab={t} class="ls-box" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SHORT} />
              )}
            </Show>
          </AnimatePresence>
        </div>
      </Stage>
    ))
    await settle()
    setTab("b")
    const reads = await paintedReads(() => [frameNow(), opacityOf(stage.querySelector("[data-tab=b]"))] as const, 24)
    const k = readOf(reads, exitedAt)
    expect(Number.isNaN(reads[k - 1]![1]), "b waited for a's exit").toBe(true)
    expect(Number.isNaN(reads[k]![1]), "b went on the page in the frame a's exit ended").toBe(false)
    expect(reads[k]![1], "b's first frame on the page is drawn one step in, not at its initial").toBeGreaterThan(0)
  })

  it("LS4: a change from a task takes a single first step at the next frame, as before", async () => {
    const [atB, setAtB] = createSignal(false)
    let box!: HTMLDivElement
    render(() => (
      <Stage>
        <wardic.div ref={box} class="ls-box" animate={{ x: Bool.match(atB(), { onTrue: () => 256, onFalse: () => 0 }) }} transition={SPRING} />
      </Stage>
    ))
    await settle()
    const from = leftOf(box)
    setAtB(true)
    const frames = await paintedFrames(box, 3)
    expectMovedFirst(frames.map((f) => f.left), from, from + 256)
  })

  it("LS5: a change in a later rAF callback paints its origin first, as before", async () => {
    const [atB, setAtB] = createSignal(false)
    const [drive, setDrive] = createSignal(0)
    let box!: HTMLDivElement
    render(() => (
      <Stage>
        <wardic.div ref={box} class="ls-box" animate={{ x: Bool.match(atB(), { onTrue: () => 256, onFalse: () => 0 }) }} transition={SPRING} />
        <WarmDot to={drive} />
      </Stage>
    ))
    await settle()
    setDrive(2000) // the Clock's frame is now requested by each previous frame's tick
    for (let i = 0; i < 10; i++) await raf()
    await afterPaint()
    const from = leftOf(box)
    let sampled: Promise<ReadonlyArray<DOMRect>> | undefined
    // Requested in this task, after the Clock's: it runs after the tick, outside the Late window.
    requestAnimationFrame(() => {
      setAtB(true)
      sampled = paintedFramesFromHere(box, 3)
    })
    await until(() => sampled !== undefined)
    expectOriginFirst((await sampled!).map((f) => f.left), from)
  })
})
