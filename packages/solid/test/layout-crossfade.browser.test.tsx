// `layoutCrossfade={false}` on Solid 1 (#442, Motion's prop), in a real browser: a `layoutId` handover
// onto the twin with it doesn't crossfade. The twin it takes over from is hidden as the handover
// starts, and it moves at its own opacity. Only the twin that becomes the Lead reads it; a Switch, its
// twin already gone, blends as ever.
//
// - LC1: beside a live twin: the new Lead flies from its twin's box at full opacity every frame, and
//   the twin is hidden from the handover's first frame.
// - LC2: under `<AnimatePresence>`, only the new Lead's counts: the modal (crossfading) fades in as it
//   opens; closing, the thumbnail (`false`) takes over at full opacity, the leaving modal hidden at
//   once and removed at its exit's end.
// - LC3: read at each handover: toggled from `false` to `true`, the next handover crossfades.
// - LC4: a Switch blends its opacity from the twin that went, as ever.
// - LC5: a handover that doesn't fade isn't crossfading for its descendants (Motion's `hasOpacityCrossfade`):
//   a twin inside it crossfades on its own.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { leftOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .ind{position:absolute;top:0;width:100px;height:40px}
  .ind.a{left:20px}
  .ind.b{left:300px}
`
const styled = () => <style>{CSS}</style>

/** The opacity the projection wrote: a Follower's factor, a Lead's own times its fade. */
const op = (el: HTMLElement): number => Number(el.style.opacity || "1")

const FLY = { type: "tween", duration: 0.5 } as const

/** Each frame until `done`, `read()` after it. */
const watch = async <A,>(read: () => A, done: () => boolean): Promise<ReadonlyArray<A>> => {
  const seen: Array<A> = []
  await until(() => {
    seen.push(read())
    return done()
  }, 3000)
  return seen
}

describe("layoutCrossfade on Solid 1 (#442)", () => {
  it("LC1: beside a live twin, the new Lead flies from its twin's box at full opacity, the twin hidden from the first frame", async () => {
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        {styled()}
        <div data-root style={{ position: "relative" }}>
          <wardic.div data-a class="ind a" layoutId="lc1" transition={FLY} />
          <Show when={open()}>
            <wardic.div data-b class="ind b" layoutId="lc1" layoutCrossfade={false} transition={FLY} />
          </Show>
        </div>
      </WardicProvider>
    ))
    const base = leftOf(container.querySelector("[data-root]") as HTMLElement)
    const a = container.querySelector("[data-a]") as HTMLElement
    await raf()
    await raf()
    setOpen(true)
    await raf()
    const b = container.querySelector("[data-b]") as HTMLElement
    expect(leftOf(b) - base, "from its twin's box").toBeLessThan(200)
    const frames = await watch(
      () => ({ a: op(a), b: op(b), left: leftOf(b) - base }),
      () => Math.abs(leftOf(b) - base - 300) < 1,
    )
    expect(frames.some((f) => f.left > 60 && f.left < 260), "it flew").toBe(true)
    expect(Math.min(...frames.map((f) => f.b)), "the Lead at full opacity throughout").toBeGreaterThan(0.99)
    expect(Math.max(...frames.map((f) => f.a)), "its twin hidden throughout").toBeLessThan(0.01)
  })

  it("LC2: only the new Lead's counts: the modal fades in as it opens; closing onto the thumbnail, no crossfade", async () => {
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        {styled()}
        <div data-root style={{ position: "relative" }}>
          <wardic.div data-thumb class="ind a" layoutId="lc2" layoutCrossfade={false} transition={FLY} />
          <AnimatePresence>
            <Show when={open()}>
              <wardic.div data-modal class="ind b" layoutId="lc2" exit={{ opacity: 0 }} transition={FLY} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    const base = leftOf(container.querySelector("[data-root]") as HTMLElement)
    const thumb = container.querySelector("[data-thumb]") as HTMLElement
    await raf()
    await raf()
    setOpen(true)
    await until(() => container.querySelector("[data-modal]") instanceof HTMLElement)
    const modal = container.querySelector("[data-modal]") as HTMLElement
    const opening = await watch(
      () => op(modal),
      () => Math.abs(leftOf(modal) - base - 300) < 1,
    )
    expect(opening.some((o) => o > 0.05 && o < 0.95), "the modal, crossfading, faded in").toBe(true)
    await raf()
    setOpen(false)
    await raf()
    const closing = await watch(
      () => ({ thumb: op(thumb), modal: op(modal), connected: modal.isConnected }),
      () => !modal.isConnected,
    )
    const whileThere = closing.filter((f) => f.connected)
    expect(whileThere.length, "the modal stayed for its exit").toBeGreaterThan(5)
    expect(Math.max(...whileThere.map((f) => f.modal)), "the leaving modal hidden at once").toBeLessThan(0.01)
    expect(Math.min(...closing.map((f) => f.thumb)), "the thumbnail at full opacity throughout").toBeGreaterThan(0.99)
    expect(leftOf(thumb) - base).toBeCloseTo(20, 0)
  })

  it("LC3: read at each handover: toggled to true, the next handover crossfades", async () => {
    const [open, setOpen] = createSignal(false)
    const [fades, setFades] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        {styled()}
        <div data-root style={{ position: "relative" }}>
          <wardic.div data-a class="ind a" layoutId="lc3" transition={FLY} />
          <Show when={open()}>
            <wardic.div data-b class="ind b" layoutId="lc3" layoutCrossfade={fades()} transition={FLY} />
          </Show>
        </div>
      </WardicProvider>
    ))
    const base = leftOf(container.querySelector("[data-root]") as HTMLElement)
    await raf()
    await raf()
    setOpen(true)
    await raf()
    let b = container.querySelector("[data-b]") as HTMLElement
    const first = await watch(
      () => op(b),
      () => Math.abs(leftOf(b) - base - 300) < 1,
    )
    expect(Math.min(...first), "no crossfade").toBeGreaterThan(0.99)
    setOpen(false)
    await raf()
    await raf()
    setFades(true)
    setOpen(true)
    await raf()
    b = container.querySelector("[data-b]") as HTMLElement
    const second = await watch(
      () => op(b),
      () => Math.abs(leftOf(b) - base - 300) < 1,
    )
    expect(second.some((o) => o > 0.05 && o < 0.95), "now it crossfades").toBe(true)
  })

  it("LC4: a Switch blends its opacity from the twin that went, as ever", async () => {
    const [second, setSecond] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        {styled()}
        <div data-root style={{ position: "relative" }}>
          <Show when={second()} fallback={<wardic.div data-a class="ind a" layoutId="lc4" animate={{ opacity: 0.4 }} transition={FLY} />}>
            <wardic.div data-b class="ind b" layoutId="lc4" layoutCrossfade={false} transition={FLY} />
          </Show>
        </div>
      </WardicProvider>
    ))
    const base = leftOf(container.querySelector("[data-root]") as HTMLElement)
    await until(() => op(container.querySelector("[data-a]") as HTMLElement) < 0.41)
    await raf()
    setSecond(true)
    await raf()
    const b = container.querySelector("[data-b]") as HTMLElement
    const frames = await watch(
      () => ({ opacity: Number(getComputedStyle(b).opacity), left: leftOf(b) - base }),
      () => Math.abs(leftOf(b) - base - 300) < 1,
    )
    const flying = frames.filter((f) => f.left > 40 && f.left < 280)
    expect(flying.length, "it flew").toBeGreaterThan(3)
    expect(flying.some((f) => f.opacity > 0.45 && f.opacity < 0.95), "blended from 0.4 to its own 1").toBe(true)
  })

  it("LC5: a twin inside a handover that doesn't fade crossfades on its own", async () => {
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        {styled()}
        <div data-root style={{ position: "relative" }}>
          <wardic.div class="ind a" layoutId="lc5" transition={FLY} style={{ height: "80px" }}>
            <wardic.div layoutId="lc5-inner" transition={FLY} style={{ width: "40px", height: "20px" }} />
          </wardic.div>
          <Show when={open()}>
            <wardic.div class="ind b" layoutId="lc5" layoutCrossfade={false} transition={FLY} style={{ height: "80px" }}>
              <wardic.div data-inner layoutId="lc5-inner" transition={FLY} style={{ width: "60px", height: "30px" }} />
            </wardic.div>
          </Show>
        </div>
      </WardicProvider>
    ))
    await raf()
    await raf()
    setOpen(true)
    await raf()
    const inner = container.querySelector("[data-inner]") as HTMLElement
    const frames = await watch(
      () => op(inner),
      () => op(inner) > 0.99,
    )
    expect(frames.some((o) => o > 0.05 && o < 0.95), "the inner twin faded in on its own").toBe(true)
  })
})

