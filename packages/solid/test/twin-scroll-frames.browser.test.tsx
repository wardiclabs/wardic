// Shared-layout twins in different scroll frames (#331): a card in a scrolled page and its twin in
// a `position: fixed` frame, or in and out of a scrolled container. Whatever scroll sits between the
// twins' frames, they meet where each one paints, as in Motion. Real frames, read just after each
// paint. The page is scrolled 420 px (or the container, in TF6), so a frame mix-up is that far off.
//
// - TF1: opening across a fixed frame, the card staying (a Crossfade): the detail's first frame is
//   at the card's box, and the card, its Follower, paints at the detail's box every frame after.
// - TF2: the card unmounting as the detail mounts (a Switch): the detail's first frame is at the
//   card's box.
// - TF3: closing the TF1 detail (its Lead leaves; the card is promoted): the card's first frame is
//   at the detail's box, and it lands in its own place.
// - TF4: closing by a Switch, the card mounting as the detail unmounts: the card's first frame is at
//   the detail's box.
// - TF5: closing by a Switch from a detail already detached (the Root frame's fallback, from its
//   last pass's box): the card's first frame is at the detail's box.
// - TF6: twins alive together in and out of a scrolled container (the page unscrolled): the
//   Crossfade's first frame, the Follower and the promotion all meet on screen.
// - TF7: the detail in a fixed frame that scrolls itself (a scroll root with a container's scroll
//   inside it), opened by a Crossfade and closed by a Switch.
// - TF8: a keyed `position: fixed` presence child taken over by its key on a scrolled page starts
//   where its leaver painted (the Root frame read on each side of the take-over).
// - TF9: closing a detail whose fixed frame leaves through a presence, the card staying: the detail,
//   handed back as a leaving Follower, paints at the card's box every frame of its exit.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Easing from "@wardic/core/Easing"
import { identity } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, paintedFrames, until } from "./browser-helpers.ts"

afterEach(() => {
  window.scrollTo(0, 0)
  cleanup()
})

const SCROLL = 420
// Linear, as these tests were written for: Motion's `ease: "linear"` here was never Wardic's (#360), and
// a tween left without an easing has eased out since #357.
const LINEAR = { layout: { type: "tween", duration: 0.6, easing: Easing.linear } } as const
const PAGE = { position: "relative", height: "3000px" } as const
const CARD = { position: "absolute", left: "300px", top: "600px", width: "200px", height: "150px" } as const
const FRAME = { position: "fixed", inset: "0" } as const
const MODAL = { position: "absolute", left: "100px", top: "100px", width: "400px", height: "300px" } as const
/**
 * How far a first frame may be from where it starts: one step of the 0.6 s tween (it has already
 * taken one when the frame paints). A frame mix-up is the scroll off, 420 px.
 */
const FIRST_STEP = 8
/** Where the detail lands on screen: its frame is fixed at the viewport's corner. */
const MODAL_HOME = { left: 100, top: 100 } as const

interface Corner {
  readonly left: number
  readonly top: number
}

const cornerOf = (el: Element): Corner => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top }
}

const expectAt = (actual: Corner, expected: Corner, what: string, within = 1.5): void => {
  expect(Math.abs(actual.left - expected.left), `${what}: left ${actual.left} vs ${expected.left}`).toBeLessThanOrEqual(within)
  expect(Math.abs(actual.top - expected.top), `${what}: top ${actual.top} vs ${expected.top}`).toBeLessThanOrEqual(within)
}

/** Both twins' corners in the next `n` frames, each read just after its paint. */
const pairFrames = (a: () => Element, b: () => Element, n: number): Promise<ReadonlyArray<readonly [Corner, Corner]>> =>
  new Promise((resolve) => {
    const frames: Array<readonly [Corner, Corner]> = []
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      frames.push([cornerOf(a()), cornerOf(b())])
      if (frames.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(frames)
    }
    requestAnimationFrame(post)
  })

const scrollPage = async (y: number): Promise<void> => {
  window.scrollTo(0, y)
  await afterPaint()
  expect(window.scrollY, "the page scrolled").toBe(y)
}

/** Wait for `el` to come to rest at `at`, from after a paint: before it, a twin just mounted reads at its own box. */
const settledAt = async (el: () => Element, at: Corner, what: string): Promise<void> => {
  await afterPaint()
  await until(() => {
    const c = cornerOf(el())
    return Math.abs(c.left - at.left) < 1 && Math.abs(c.top - at.top) < 1
  }, 3000)
  expectAt(cornerOf(el()), at, what, 1)
}

/**
 * A card in the page and its detail in a fixed frame, sharing a `layoutId`. `keepCard` keeps the
 * card mounted while the detail is open (a Crossfade), or swaps it out (a Switch). `frame` wraps the
 * detail; `around` wraps the card.
 */
const mountCardAndDetail = (opts: {
  readonly keepCard: boolean
  readonly frame?: (detail: JSX.Element) => JSX.Element
  readonly around?: (card: JSX.Element) => JSX.Element
}) => {
  const [open, setOpen] = createSignal(false)
  const frame = UndefinedOr.match(opts.frame, { onUndefined: () => (detail: JSX.Element) => <div style={FRAME}>{detail}</div>, onDefined: identity })
  const around = UndefinedOr.match(opts.around, { onUndefined: () => (card: JSX.Element) => card, onDefined: identity })
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={PAGE}>
        {around(
          <div style={PAGE}>
            <Show when={opts.keepCard || !open()}>
              <wardic.div data-card layoutId="product" transition={LINEAR} style={CARD} />
            </Show>
          </div>,
        )}
      </div>
      <Show when={open()}>{frame(<wardic.div data-detail layoutId="product" transition={LINEAR} style={MODAL} />)}</Show>
    </WardicProvider>
  ))
  const card = (): HTMLElement => container.querySelector<HTMLElement>("[data-card]")!
  const detail = (): HTMLElement => container.querySelector<HTMLElement>("[data-detail]")!
  return { setOpen, card, detail }
}

describe("shared-layout twins in different scroll frames (#331)", () => {
  it("TF1: opening across a fixed frame, the card staying: the detail starts at the card, the card follows it", async () => {
    const twins = mountCardAndDetail({ keepCard: true })
    await scrollPage(SCROLL)
    const cardBox = cornerOf(twins.card())
    expectAt(cardBox, { left: 300, top: 600 - SCROLL }, "the card, scrolled")
    twins.setOpen(true)
    const frames = await pairFrames(twins.detail, twins.card, 8)
    expectAt(frames[0]![0], cardBox, "the detail's first frame", FIRST_STEP)
    frames.forEach(([detail, card], i) => expectAt(card, detail, `frame ${i}: the card where the detail is`))
    await settledAt(twins.detail, MODAL_HOME, "the detail lands")
    expectAt(cornerOf(twins.card()), MODAL_HOME, "the card, following, lands there too")
  })

  it("TF2: the card unmounting as the detail mounts (a Switch): the detail starts at the card", async () => {
    const twins = mountCardAndDetail({ keepCard: false })
    await scrollPage(SCROLL)
    const cardBox = cornerOf(twins.card())
    twins.setOpen(true)
    const frames = await paintedFrames(twins.detail(), 3)
    expectAt(frames[0]!, cardBox, "the detail's first frame", FIRST_STEP)
    await settledAt(twins.detail, MODAL_HOME, "the detail lands")
  })

  it("TF3: closing the detail, the card staying: the card starts at the detail and lands home", async () => {
    const twins = mountCardAndDetail({ keepCard: true })
    await scrollPage(SCROLL)
    const cardBox = cornerOf(twins.card())
    twins.setOpen(true)
    await settledAt(twins.detail, MODAL_HOME, "the detail lands")
    await afterPaint()
    twins.setOpen(false)
    const frames = await paintedFrames(twins.card(), 3)
    expectAt(frames[0]!, MODAL_HOME, "the card's first frame", FIRST_STEP)
    await settledAt(twins.card, cardBox, "the card lands home")
  })

  it("TF4: closing by a Switch, the card mounting as the detail goes: the card starts at the detail", async () => {
    const twins = mountCardAndDetail({ keepCard: false })
    await scrollPage(SCROLL)
    const cardBox = cornerOf(twins.card())
    twins.setOpen(true)
    await settledAt(twins.detail, MODAL_HOME, "the detail lands")
    await afterPaint()
    twins.setOpen(false)
    const frames = await paintedFrames(twins.card(), 3)
    expectAt(frames[0]!, MODAL_HOME, "the card's first frame", FIRST_STEP)
    await settledAt(twins.card, cardBox, "the card lands home")
  })

  it("TF5: closing by a Switch from a detail already detached: the card starts at the detail", async () => {
    // The Root frame's fallback: the detail leaves the DOM before its node is disposed, so its seed
    // comes from its last pass's box, in a frame without the page's scroll, which it has to put in.
    const twins = mountCardAndDetail({ keepCard: false })
    await scrollPage(SCROLL)
    twins.setOpen(true)
    await settledAt(twins.detail, MODAL_HOME, "the detail lands")
    await afterPaint()
    twins.detail().remove()
    twins.setOpen(false)
    const frames = await paintedFrames(twins.card(), 3)
    expectAt(frames[0]!, MODAL_HOME, "the card's first frame", FIRST_STEP)
  })

  it("TF6: twins alive together in and out of a scrolled container meet on screen", async () => {
    let scroller: HTMLDivElement | undefined
    const twins = mountCardAndDetail({
      keepCard: true,
      // The detail sits in the page, not fixed: only the container's scroll is between the two.
      frame: (detail) => <div style={{ position: "absolute", left: "0", top: "0", width: "600px", height: "500px" }}>{detail}</div>,
      around: (card) => (
        <div ref={scroller} style={{ position: "absolute", left: "0", top: "0", width: "800px", height: "800px", overflow: "auto" }}>
          {card}
        </div>
      ),
    })
    scroller!.scrollTop = SCROLL
    await afterPaint()
    expect(scroller!.scrollTop, "the container scrolled").toBe(SCROLL)
    const cardBox = cornerOf(twins.card())
    expectAt(cardBox, { left: 300, top: 600 - SCROLL }, "the card, scrolled")
    twins.setOpen(true)
    const frames = await pairFrames(twins.detail, twins.card, 8)
    expectAt(frames[0]![0], cardBox, "the detail's first frame", FIRST_STEP)
    frames.forEach(([detail, card], i) => expectAt(card, detail, `frame ${i}: the card where the detail is`))
    await settledAt(twins.detail, MODAL_HOME, "the detail lands")
    await afterPaint()
    twins.setOpen(false)
    const closing = await paintedFrames(twins.card(), 3)
    expectAt(closing[0]!, MODAL_HOME, "closing: the card's first frame", FIRST_STEP)
    await settledAt(twins.card, cardBox, "the card lands home")
  })

  it("TF7: a fixed frame that scrolls itself: opened by a Crossfade, closed by a Switch", async () => {
    // The detail sits 100 px further down a fixed panel scrolled 100 px: it paints at the same spot,
    // with a container's scroll inside the scroll root and the page's outside it.
    let panel: HTMLDivElement | undefined
    const [open, setOpen] = createSignal(false)
    const [keep, setKeep] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={PAGE}>
          <Show when={keep()}>
            <wardic.div data-card layoutId="product" transition={LINEAR} style={CARD} />
          </Show>
        </div>
        <div ref={panel} style={{ ...FRAME, overflow: "auto" }}>
          <div style={{ position: "relative", height: "3000px" }}>
            <Show when={open()}>
              <wardic.div data-detail layoutId="product" transition={LINEAR} style={{ ...MODAL, top: "200px" }} />
            </Show>
          </div>
        </div>
      </WardicProvider>
    ))
    const card = (): HTMLElement => container.querySelector<HTMLElement>("[data-card]")!
    const detail = (): HTMLElement => container.querySelector<HTMLElement>("[data-detail]")!
    panel!.scrollTop = 100
    await scrollPage(SCROLL)
    // The fixed panel covers the page: scrolling the window still works, as the page is taller.
    expect(panel!.scrollTop, "the panel scrolled").toBe(100)
    const cardBox = cornerOf(card())
    setOpen(true)
    const frames = await pairFrames(detail, card, 8)
    expectAt(frames[0]![0], cardBox, "the detail's first frame", FIRST_STEP)
    frames.forEach(([d, c], i) => expectAt(c, d, `frame ${i}: the card where the detail is`))
    await settledAt(detail, MODAL_HOME, "the detail lands")
    await afterPaint()
    setKeep(false)
    await afterPaint()
    setKeep(true)
    setOpen(false)
    const closing = await paintedFrames(card(), 3)
    expectAt(closing[0]!, MODAL_HOME, "closing: the card's first frame", FIRST_STEP)
    await settledAt(card, cardBox, "the card lands home")
  })

  it("TF9: a detail leaving through a presence, the card staying: the leaving detail follows the card", async () => {
    const [open, setOpen] = createSignal(false)
    const EXIT = { type: "tween", duration: 0.6, easing: Easing.linear } as const
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={PAGE}>
          <wardic.div data-card layoutId="product" transition={LINEAR} style={CARD} />
        </div>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.div style={FRAME} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
              <wardic.div data-detail layoutId="product" transition={LINEAR} style={MODAL} />
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const card = (): HTMLElement => container.querySelector<HTMLElement>("[data-card]")!
    const detail = (): HTMLElement => container.querySelector<HTMLElement>("[data-detail]")!
    await scrollPage(SCROLL)
    setOpen(true)
    await settledAt(detail, MODAL_HOME, "the detail lands")
    await afterPaint()
    const leaving = detail()
    setOpen(false)
    const frames = await pairFrames(() => leaving, card, 8)
    expect(leaving.isConnected, "still leaving").toBe(true)
    expectAt(frames[0]![1], MODAL_HOME, "the card's first frame", FIRST_STEP)
    frames.forEach(([d, c], i) => expectAt(d, c, `frame ${i}: the leaving detail where the card is`))
  })

  it("TF8: a keyed fixed presence child taken over on a scrolled page starts where its leaver painted", async () => {
    const SLOW = { type: "tween", duration: 0.6, easing: Easing.linear } as const
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "toast"])
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={PAGE} />
        <AnimatePresence>
          <For each={items()}>
            {(id) => {
              // Where it sits as it mounts, kept as it leaves: the toast below "a", or on top.
              const top = `${40 + items().indexOf(id) * 60}px`
              return (
              <wardic.div
                key={id}
                layout
                data-item={id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={SLOW}
                style={{ position: "fixed", left: "40px", top, width: "200px", height: "40px" }}
              />
              )
            }}
          </For>
        </AnimatePresence>
      </WardicProvider>
    ))
    const toasts = (): Array<HTMLElement> => Array.from(container.querySelectorAll<HTMLElement>('[data-item="toast"]'))
    await scrollPage(SCROLL)
    await until(() => Number(toasts()[0]!.style.opacity) >= 0.99, 3000)
    // Mid-exit, it's taken over by its key from where it paints, at the top of the stack.
    setItems(["a"])
    await until(() => Number(toasts()[0]!.style.opacity) < 0.7, 3000)
    await afterPaint()
    const leaverBox = cornerOf(toasts()[0]!)
    expectAt(leaverBox, { left: 40, top: 100 }, "the leaver, fixed")
    setItems(["toast", "a"])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    const frames = await paintedFrames(toasts()[0]!, 2)
    expectAt(frames[0]!, leaverBox, "the newcomer's first frame", FIRST_STEP)
  })
})
