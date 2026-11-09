// A start Solid 2 makes after its frame's tick, before its paint (#680, ADR-0027 *Amendment (#680)*).
// Solid 2 batches every update on a microtask, so what its effects start after a change made in a tick
// runs after the tick, in that frame's microtasks. The Frame loop's Late window runs from a tick's first
// step until a microtask the tick queues at its end. A leg added in it takes its Late step there, and
// a layout change triggered in it is measured by a pass that takes its first step (ADR-0018
// *Amendment (#673)*), so the frame paints them moving. A chain whose own microtask is queued after the
// loop's (an `await` that then sets state) is past the window, and paints its origin first. Real frames.
//
// - LV1: `mode="wait"`: the entering child is drawn moving in its first frame on the page.
// - LV2: a leg an effect on another ward's `settled()` starts moves in the frame that ward lands in.
// - LV3: a leg started after `await next("settled")` is past the window: it paints its origin first.
// - LV4: a layout change an effect on `settled()` makes moves in the frame the ward lands in.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createPresence, type Presence, type Ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createEffect, createRoot, createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { afterPaint, expectMovedFirst, frameNow, leftOf, paintedReads, raf, readOf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const CSS = `
  .lv-stage{position:relative;width:700px;height:300px}
  .lv-box{position:absolute;top:0;left:0;width:40px;height:40px}
`

const SPRING = { type: "spring" } as const
const SHORT = { type: "tween", duration: 0.1 } as const

const Stage = (props: { readonly children: JSX.Element }) => (
  <WardicProvider env={DomLive}>
    <style>{CSS}</style>
    <div class="lv-stage">{props.children}</div>
  </WardicProvider>
)

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

const opacityOf = (el: Element | null): number => {
  if (el === null) return Number.NaN
  return Number(getComputedStyle(el).opacity)
}

/**
 * A ward `a` that moves 40 px on `start`, and a box `b` whose `x` (or, `layout`, whose `left`) follows
 * `chain`. Each test reads `a`'s landings its own way.
 */
const mountChain = (options: { readonly layout?: boolean } = {}) => {
  const [go, setGo] = createSignal(false)
  const [chained, setChained] = createSignal(false)
  let a!: Ward
  let b!: HTMLDivElement
  const to = (on: boolean, value: number): number => Bool.match(on, { onTrue: () => value, onFalse: () => 0 })
  const B = (): JSX.Element =>
    Bool.match(options.layout === true, {
      onTrue: () => <wardic.div ref={b} class="lv-box" layout layoutDependency={chained()} transition={SPRING} style={{ top: "100px", left: `${to(chained(), 256)}px` }} />,
      onFalse: () => <wardic.div ref={b} class="lv-box" style={{ top: "100px" }} animate={{ x: to(chained(), 256) }} transition={SPRING} />,
    })
  mount(() => (
    <Stage>
      <wardic.div class="lv-box" wardRef={(w) => (a = w)} animate={{ x: to(go(), 40) }} transition={SHORT} />
      <B />
    </Stage>
  ))
  const start = (): void => {
    setGo(true)
    flush()
  }
  return { a: () => a, b: () => b, go, start, chain: () => setChained(true) }
}

describe("a start Solid 2 makes in the Late window moves in that frame (#680)", () => {
  it('LV1: under mode="wait", the entering child is drawn moving in its first frame on the page', async () => {
    const [tab, setTab] = createSignal("a")
    let presence!: Presence
    let host!: HTMLDivElement
    let exitedAt: number | undefined
    const Tabs = (): JSX.Element => {
      presence = createPresence()
      return (
        <div ref={host}>
          <AnimatePresence mode="wait" ref={presence}>
            <Show when={tab()} keyed>
              {(t) => <wardic.div data-tab={t} class="lv-box" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SHORT} />}
            </Show>
          </AnimatePresence>
        </div>
      )
    }
    mount(() => (
      <Stage>
        <Tabs />
      </Stage>
    ))
    await settle()
    void presence.next("exitComplete").then(() => (exitedAt = frameNow()))
    setTab("b")
    flush()
    const reads = await paintedReads(() => [frameNow(), opacityOf(host.querySelector("[data-tab=b]"))] as const, 24)
    const k = reads.findIndex(([, b]) => !Number.isNaN(b))
    expect(k, "b went on the page").toBeGreaterThan(0)
    expect(reads[k]![0], "in the frame a's exit ended").toBe(exitedAt)
    expect(reads[k]![1], "b's first frame on the page is drawn one step in, not at its initial").toBeGreaterThan(0)
  })

  it("LV2: a leg an effect on another ward's settled() starts moves in the frame that ward lands in", async () => {
    const chain = mountChain()
    await settle()
    let landedAt: number | undefined
    const dispose = createRoot((done) => {
      createEffect(
        () => [chain.a().settled(), chain.go()] as const,
        ([landing, go]) => {
          // The landing `start` makes, not the mount's at 0, which `settled()` still holds then.
          if (!go || landing?.target["x"] !== 40) return
          landedAt = frameNow()
          chain.chain()
        },
        { defer: true },
      )
      return done
    })
    const from = leftOf(chain.b())
    chain.start()
    const reads = await paintedReads(() => [frameNow(), leftOf(chain.b())] as const, 30)
    dispose()
    const i = readOf(reads, landedAt)
    expect(Math.abs(reads[i - 1]![1] - from), "b waited for a's landing").toBeLessThanOrEqual(0.01)
    expectMovedFirst(reads.slice(i).map(([, x]) => x), from, from + 256)
  })

  it('LV3: a leg started after await next("settled") is past the window: it paints its origin first', async () => {
    const chain = mountChain()
    await settle()
    let landedAt: number | undefined
    const from = leftOf(chain.b())
    chain.start()
    void chain
      .a()
      .next("settled")
      .then(() => {
        landedAt = frameNow()
        chain.chain()
      })
    const reads = await paintedReads(() => [frameNow(), leftOf(chain.b())] as const, 30)
    const i = readOf(reads, landedAt)
    expect(Math.abs(reads[i]![1] - from), "the landing's frame painted b's origin").toBeLessThanOrEqual(0.01)
    expect(Math.abs(reads[i + 1]![1] - from), "and the next one moved").toBeGreaterThan(0.01)
  })

  it("LV4: a layout change an effect on settled() makes moves in the frame the ward lands in", async () => {
    const chain = mountChain({ layout: true })
    await settle()
    let landedAt: number | undefined
    const dispose = createRoot((done) => {
      createEffect(
        () => [chain.a().settled(), chain.go()] as const,
        ([landing, go]) => {
          // The landing `start` makes, not the mount's at 0, which `settled()` still holds then.
          if (!go || landing?.target["x"] !== 40) return
          landedAt = frameNow()
          chain.chain()
        },
        { defer: true },
      )
      return done
    })
    const from = leftOf(chain.b())
    chain.start()
    const reads = await paintedReads(() => [frameNow(), leftOf(chain.b())] as const, 30)
    dispose()
    const i = readOf(reads, landedAt)
    expect(Math.abs(reads[i - 1]![1] - from), "b waited for a's landing").toBeLessThanOrEqual(0.01)
    expectMovedFirst(reads.slice(i).map(([, x]) => x), from, from + 256)
  })
})
