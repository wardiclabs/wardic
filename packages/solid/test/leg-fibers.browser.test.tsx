// An element's legs end at its unmount (#542, ADR-0027 *Amendment (#542)*): each leg is a fiber of the
// provider's runtime, with no set of the element's own, so its dispose ends every leg not landed, by
// its token or by interrupting it. Read through the Frame loop's running-animations gauge, as W7 does
// on Solid 2, with endless tweens: a leg left running stays on the loop. Real frames. The provider is
// given the loop's metrics, which an app opts into (#518).
//
// - LF1: elements unmounted mid-flight leave nothing running on the loop.
// - LF2: so does a child whose leg waits on its parent's `beforeChildren` (#297).
// - LF3: so do an element's Imperative animations (#433).
import { cleanup, render } from "@solidjs/testing-library"
import * as FrameLoop from "@wardic/core/FrameLoop"
import { DomLive } from "@wardic/dom"
import { createAnimate, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Metric from "effect/Metric"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX = { display: "block", width: "20px", height: "20px" } as const
const ENDLESS = { type: "tween", duration: 0.4, repeat: Infinity } as const

/** The runs on the Frame loop at its last tick. */
const running = (): number | undefined =>
  (Effect.runSync(Metric.snapshot).find((m) => m.id === "wardic_frameloop_animations")?.state as Metric.GaugeState<number> | undefined)?.value

/** The DOM's Environment with the loop's metrics, read through `running`. */
const env = Layer.mergeAll(DomLive, FrameLoop.layerMetrics)

/** `ui` under a provider, shown until `hide`. */
const mount = (ui: () => JSX.Element) => {
  const [shown, setShown] = createSignal(true)
  render(() => (
    <WardicProvider env={env}>
      <Show when={shown()}>{ui()}</Show>
    </WardicProvider>
  ))
  return { hide: () => setShown(false) }
}

describe("an element's legs end at its unmount (#542)", () => {
  it("LF1: elements unmounted mid-flight leave nothing running on the loop", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const page = mount(() => <For each={items}>{() => <wardic.div style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={ENDLESS} />}</For>)
    await until(() => running() === 20, 1000)
    page.hide()
    await until(() => running() === 0, 1000)
    expect(running()).toBe(0)
  })

  it("LF2: so does a child whose leg waits on its parent's beforeChildren", async () => {
    // A list's names (#297's PR 2): the child's `visible` leg waits on its gate, its `active` leg runs.
    const parent: WardicVariants = {
      visible: { opacity: 1, transition: { ...ENDLESS, when: "beforeChildren" } },
      hidden: { opacity: 0 },
      active: {},
      inactive: {},
    }
    const child: WardicVariants = { visible: { x: 0 }, hidden: { x: -30 }, active: { scale: 1.5 }, inactive: { scale: 1 } }
    let el!: HTMLElement
    const page = mount(() => (
      <wardic.div variants={parent} initial={["hidden", "inactive"]} animate={["visible", "active"]} style={BOX}>
        <wardic.span ref={(n: HTMLElement) => (el = n)} variants={child} transition={ENDLESS} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await until(() => running() === 3, 1000)
    expect(new DOMMatrix(getComputedStyle(el).transform).m41, "the child's visible leg still waits").toBe(-30)
    page.hide()
    await until(() => running() === 0, 1000)
    expect(running()).toBe(0)
  })

  it("LF3: so do an element's Imperative animations", async () => {
    let el!: HTMLElement
    let start!: () => void
    const Animated = () => {
      const [scope, animate] = createAnimate<HTMLDivElement>()
      start = () => void animate(el, { x: 100 }, ENDLESS)
      return (
        <div ref={scope}>
          <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} />
        </div>
      )
    }
    const page = mount(() => <Animated />)
    await raf()
    start()
    await until(() => running() === 1, 1000)
    page.hide()
    await until(() => running() === 0, 1000)
    expect(running()).toBe(0)
  })
})
