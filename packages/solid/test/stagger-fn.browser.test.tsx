// `delayChildren: stagger()` on Solid 1 (#436, Motion's): a function `delayChildren` decides each
// Variant child's whole delay from its index and the count. Real frames: each child's start is the
// first frame it moves, timed from the change. Solid 2's are SGV1.
//
// - SG1: `stagger(0.25)` staggers the children by their index; `from: "last"` turns it; a
//   `staggerChildren` and `staggerDirection` beside it aren't read.
// - SG2: `startDelay` and `ease`: each child waits as `stagger()` itself says, Motion's math.
// - SG3: a presence's propagated exits stagger by their exit's `delayChildren: stagger()`.
// - SG4: `createAnimate`'s `delay: stagger()` staggers a selection.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createAnimate, stagger, type WardicAnimate, wardic, WardicProvider, type WardicTransition, type WardicVariants } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

const TWEEN: WardicTransition = { type: "tween", duration: 0.2, ease: "linear" }
// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { display: "block", width: "20px", height: "20px", "margin-left": "120px" } as const
const ITEM: WardicVariants = { hidden: { x: 0 }, shown: { x: 100 } }
// A few frames either side: a start is the first frame a child is seen moving.
const TOLERANCE = 0.07

/** Each element's start: seconds from `t0` to the first frame its x has moved from `from`. */
const startsOf = async (els: ReadonlyArray<Element>, from: number, t0: number, limit = 120): Promise<ReadonlyArray<number>> => {
  const starts = els.map(() => Number.NaN)
  for (let i = 0; i < limit && starts.some(Number.isNaN); i++) {
    await raf()
    const now = (performance.now() - t0) / 1000
    els.forEach((el, k) => {
      if (Bool.and(Number.isNaN(starts[k] as number), Math.abs(xOf(el) - from) > 0.5)) starts[k] = now
    })
  }
  return starts
}

/** A list of three under a provider, its transition `transition`; `show()` turns it on. */
const mountList = (transition: WardicTransition) => {
  const [on, setOn] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <wardic.ul initial="hidden" animate={Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={{ hidden: {}, shown: {} }} transition={transition} style={{ "list-style": "none" }}>
        <For each={[0, 1, 2]}>{() => <wardic.li variants={ITEM} transition={TWEEN} style={BOX} />}</For>
      </wardic.ul>
    </WardicProvider>
  ))
  return { show: () => setOn(true), items: () => Array.from(container.querySelectorAll("li")) }
}

/** Each start, less the first: the stagger between them, whatever a frame's lag on the first. */
const relative = (starts: ReadonlyArray<number>): ReadonlyArray<number> => starts.map((s) => s - Math.min(...starts))

describe("delayChildren: stagger() on Solid 1 (#436)", () => {
  it("SG1: stagger(0.25) staggers by index; from: last turns it; staggerChildren beside it unread", async () => {
    const forward = mountList({ delayChildren: stagger(0.25), staggerChildren: 1, staggerDirection: -1 })
    await frames(3)
    const t0 = performance.now()
    forward.show()
    const starts = relative(await startsOf(forward.items(), 0, t0))
    ;[0, 0.25, 0.5].forEach((want, i) => expect(Math.abs(starts[i]! - want), `child ${i}`).toBeLessThan(TOLERANCE))
    cleanup()
    const turned = mountList({ delayChildren: stagger(0.25, { from: "last" }) })
    await frames(3)
    const t1 = performance.now()
    turned.show()
    const back = relative(await startsOf(turned.items(), 0, t1))
    ;[0.5, 0.25, 0].forEach((want, i) => expect(Math.abs(back[i]! - want), `child ${i} from the last`).toBeLessThan(TOLERANCE))
  })

  it("SG2: startDelay and ease: each child waits as stagger() says, Motion's math", async () => {
    const delays = stagger(0.25, { startDelay: 0.2, ease: "easeIn" })
    const list = mountList({ delayChildren: delays })
    await frames(3)
    const t0 = performance.now()
    list.show()
    const starts = await startsOf(list.items(), 0, t0)
    const want = [0, 1, 2].map((i) => delays(i, 3))
    // Timed from the change: the first child's own lag (a frame or two) is the same for each.
    const lag = (starts[0] as number) - (want[0] as number)
    want.forEach((w, i) => expect(Math.abs(starts[i]! - lag - w), `child ${i}: ${w.toFixed(3)} s`).toBeLessThan(TOLERANCE))
    expect(want[2], "eased across 0.75 s, short of its last linear slot").toBeLessThan(0.2 + 0.5)
    expect(stagger()(2, 5), "Motion's default, 0.1 s a step").toBeCloseTo(0.2, 9)
  })

  it("SG3: a presence's propagated exits stagger by their exit's delayChildren: stagger()", async () => {
    const [shown, setShown] = createSignal(true)
    const leaving: WardicVariants = { shown: { x: 0 }, hidden: { x: 100, transition: TWEEN } }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.ul initial={false} animate="shown" exit="hidden" variants={{ shown: {}, hidden: { transition: { delayChildren: stagger(0.25) } } }} style={{ "list-style": "none" }}>
              <For each={[0, 1, 2]}>{() => <wardic.li variants={leaving} style={BOX} />}</For>
            </wardic.ul>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const items = Array.from(container.querySelectorAll("li"))
    const t0 = performance.now()
    setShown(false)
    const starts = relative(await startsOf(items, 0, t0))
    ;[0, 0.25, 0.5].forEach((want, i) => expect(Math.abs(starts[i]! - want), `child ${i}`).toBeLessThan(TOLERANCE))
  })

  it("SG4: createAnimate's delay: stagger() staggers a selection", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return (
        <ul ref={scope} style={{ "list-style": "none" }}>
          <For each={[0, 1, 2]}>{() => <li style={BOX} />}</For>
        </ul>
      )
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(2)
    const t0 = performance.now()
    void animate("li", { x: 100 }, { type: "tween", duration: 0.2, ease: "linear", delay: stagger(0.25, { from: "last" }) })
    const starts = relative(await startsOf(Array.from(container.querySelectorAll("li")), 0, t0))
    ;[0.5, 0.25, 0].forEach((want, i) => expect(Math.abs(starts[i]! - want), `li ${i}`).toBeLessThan(TOLERANCE))
  })
})
