// `layoutCrossfade={false}` on Solid 2 (#442): Solid 1's LC1 and LC2, the prop given to the element,
// and as a ward config key.
//
// - LCV1: beside a live twin, the new Lead flies from its twin's box at full opacity, the twin hidden
//   from the first frame.
// - LCV2: `ward({ layoutCrossfade: false })` on the thumbnail, under `<AnimatePresence>`: the modal
//   crossfades in as it opens; closing onto the thumbnail, no crossfade.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const CSS = `
  .ind{position:absolute;top:0;width:100px;height:40px}
  .ind.a{left:20px}
  .ind.b{left:300px}
`
const FLY = { type: "tween", duration: 0.5 } as const

const op = (el: HTMLElement): number => Number(el.style.opacity || "1")
const leftOf = (el: Element): number => el.getBoundingClientRect().left

const watch = async <A,>(read: () => A, done: () => boolean): Promise<ReadonlyArray<A>> => {
  const seen: Array<A> = []
  await until(() => {
    seen.push(read())
    return done()
  }, 3000)
  return seen
}

describe("layoutCrossfade on Solid 2 (#442)", () => {
  it("LCV1: beside a live twin, the new Lead flies at full opacity, its twin hidden from the first frame", async () => {
    const [open, setOpen] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div data-root style={{ position: "relative" }}>
          <wardic.div data-a class="ind a" layoutId="lcv1" transition={FLY} />
          <Show when={open()}>
            <wardic.div data-b class="ind b" layoutId="lcv1" layoutCrossfade={false} transition={FLY} />
          </Show>
        </div>
      </WardicProvider>
    ))
    const base = leftOf(host.querySelector("[data-root]")!)
    const a = host.querySelector<HTMLElement>("[data-a]")!
    await raf()
    await raf()
    setOpen(true)
    flush()
    await raf()
    const b = host.querySelector<HTMLElement>("[data-b]")!
    expect(leftOf(b) - base, "from its twin's box").toBeLessThan(200)
    const frames = await watch(
      () => ({ a: op(a), b: op(b), left: leftOf(b) - base }),
      () => Math.abs(leftOf(b) - base - 300) < 1,
    )
    expect(frames.some((f) => f.left > 60 && f.left < 260), "it flew").toBe(true)
    expect(Math.min(...frames.map((f) => f.b)), "the Lead at full opacity throughout").toBeGreaterThan(0.99)
    expect(Math.max(...frames.map((f) => f.a)), "its twin hidden throughout").toBeLessThan(0.01)
  })

  it("LCV2: ward({ layoutCrossfade: false }) on the thumbnail: the modal crossfades in; closing onto the thumbnail, no crossfade", async () => {
    const [open, setOpen] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div data-root style={{ position: "relative" }}>
          {(() => {
            const thumb = ward({ layoutId: "lcv2", layoutCrossfade: false, transition: FLY })
            return <div data-thumb class="ind a" {...thumb} />
          })()}
          <AnimatePresence>
            <Show when={open()}>
              <wardic.div data-modal class="ind b" layoutId="lcv2" exit={{ opacity: 0 }} transition={FLY} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    const base = leftOf(host.querySelector("[data-root]")!)
    const thumb = host.querySelector<HTMLElement>("[data-thumb]")!
    await raf()
    await raf()
    setOpen(true)
    flush()
    await until(() => host.querySelector("[data-modal]") instanceof HTMLElement)
    const modal = host.querySelector<HTMLElement>("[data-modal]")!
    const opening = await watch(
      () => op(modal),
      () => Math.abs(leftOf(modal) - base - 300) < 1,
    )
    expect(opening.some((o) => o > 0.05 && o < 0.95), "the modal, crossfading, faded in").toBe(true)
    await raf()
    setOpen(false)
    flush()
    await raf()
    const closing = await watch(
      () => ({ thumb: op(thumb), modal: op(modal), connected: modal.isConnected }),
      () => !modal.isConnected,
    )
    const whileThere = closing.filter((f) => f.connected)
    expect(whileThere.length, "the modal stayed for its exit").toBeGreaterThan(5)
    expect(Math.max(...whileThere.map((f) => f.modal)), "the leaving modal hidden at once").toBeLessThan(0.01)
    expect(Math.min(...closing.map((f) => f.thumb)), "the thumbnail at full opacity throughout").toBeGreaterThan(0.99)
  })
})
