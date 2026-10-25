// A plain (non-Wardic) `<AnimatePresence>` child on Solid 1 (#392, ADR-0048 Amendment (#392)): it
// runs the exits of the Wardic elements inside it and hands back their twins, staying until they've
// ended, as Motion's presence child does; with nothing inside it to wait for, it goes at once. Real frames.
//
// - PN1: a Wardic element inside it runs its exit; the child stays until it ends; `onExitComplete` after.
// - PN2: Wardic elements inside it with no exit: it goes at once.
// - PN3: a Variant child inside it exits on the name its Wardic parent hands down.
// - PN4: a `layoutId` twin inside it hands back (a crossfade with its other twin); the child stays for it.
// - PN5: `popLayout`: popped where it was while the exit inside it runs; a `layout` sibling slides in.
// - PN6: `mode="wait"`: the entering child waits until the exit inside the plain one has ended.
// - PN7: a hook's hold and an exit inside one plain child: it stays until both have ended.
// - PN8: the presence unmounted mid-exit: the plain child goes with it.
// - PN9: `popLayout`: a plain child held only by a hook is popped too.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, usePresence, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41

const TWEEN = { type: "tween", duration: 0.3 } as const

/** A presence around one child; `close` takes it out; `drop` unmounts the presence; `q` finds a `data-k`. */
const mountOne = (child: () => JSX.Element, outside: () => JSX.Element = () => null) => {
  const [open, setOpen] = createSignal(true)
  const [shown, setShown] = createSignal(true)
  let completes = 0
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {outside()}
      <Show when={shown()}>
        <AnimatePresence onExitComplete={() => completes++}>
          <Show when={open()}>{child()}</Show>
        </AnimatePresence>
      </Show>
    </WardicProvider>
  ))
  return {
    q: (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!,
    close: () => setOpen(false),
    drop: () => setShown(false),
    completes: () => completes,
  }
}

/** A presence in `mode` around a `<For>` of children made by `item`. */
const mountList = (start: ReadonlyArray<string>, mode: PresenceMode, item: (k: string) => JSX.Element) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative" }}>
        <AnimatePresence mode={mode}>
          <For each={items()}>{item}</For>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  return {
    q: (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!,
    setItems,
  }
}

describe("a plain presence child on Solid 1 (#392)", () => {
  it("PN1: a Wardic element inside it runs its exit; the child stays until it ends", async () => {
    const one = mountOne(() => (
      <div data-k="frame">
        <wardic.article data-k="panel" exit={{ opacity: 0 }} transition={TWEEN}>
          x
        </wardic.article>
      </div>
    ))
    await frames(3)
    const frame = one.q("frame")
    const panel = one.q("panel")
    one.close()
    await raf()
    expect(frame.isConnected, "the plain child stays").toBe(true)
    let mid = false
    await until(() => {
      const o = opacityOf(panel)
      if (Math.min(o, 1 - o) > 0.1 && frame.isConnected) mid = true
      return !frame.isConnected
    }, 3000)
    expect(mid, "the panel faded while the child stayed").toBe(true)
    expect(frame.isConnected, "gone once the exit ended").toBe(false)
    expect(one.completes(), "onExitComplete once, after").toBe(1)
  })

  it("PN2: Wardic elements inside it with no exit: it goes at once", async () => {
    const one = mountOne(() => (
      <div data-k="frame">
        <wardic.span animate={{ opacity: 1 }}>x</wardic.span>
      </div>
    ))
    await frames(3)
    const frame = one.q("frame")
    one.close()
    expect(frame.isConnected, "gone in the same update").toBe(false)
    expect(one.completes()).toBe(1)
  })

  it("PN3: a Variant child inside it exits on the name its Wardic parent hands down", async () => {
    const parent: WardicVariants = { shown: { opacity: 1 }, gone: { opacity: 1 } }
    const kid: WardicVariants = { shown: { x: 0 }, gone: { x: 80, transition: TWEEN } }
    const one = mountOne(() => (
      <div data-k="frame">
        <wardic.div variants={parent} initial="shown" animate="shown" exit="gone">
          <wardic.span data-k="kid" style={{ display: "inline-block" }} variants={kid}>
            x
          </wardic.span>
        </wardic.div>
      </div>
    ))
    await frames(3)
    const frame = one.q("frame")
    const kidEl = one.q("kid")
    one.close()
    let moved = false
    await until(() => {
      if (xOf(kidEl) > 10 && frame.isConnected) moved = true
      return !frame.isConnected
    }, 3000)
    expect(moved, "the Variant child ran \"gone\"").toBe(true)
  })

  it("PN4: a layoutId twin inside it hands back; the child stays for the crossfade", async () => {
    const box = (size: number): JSX.CSSProperties => ({ width: `${size}px`, height: `${size}px` })
    const one = mountOne(
      () => (
        <div data-k="frame" style={{ position: "fixed", left: "300px", top: "200px" }}>
          <wardic.div data-k="detail" layoutId="twin" style={box(200)} />
        </div>
      ),
      () => <wardic.div data-k="card" layoutId="twin" style={box(50)} />,
    )
    await frames(60)
    const frame = one.q("frame")
    const detail = one.q("detail")
    const card = one.q("card")
    one.close()
    const start = performance.now()
    let detailFading = false
    let cardFading = false
    await until(() => {
      const d = opacityOf(detail)
      const c = opacityOf(card)
      if (Math.min(d, 1 - d) > 0.1 && frame.isConnected) detailFading = true
      if (Math.min(c, 1 - c) > 0.1) cardFading = true
      return !frame.isConnected
    }, 3000)
    expect(detailFading, "the leaving twin faded out").toBe(true)
    expect(cardFading, "its other twin faded in").toBe(true)
    expect(performance.now() - start, "the child stayed for the handover").toBeGreaterThan(200)
    expect(opacityOf(card)).toBe(1)
  })

  it("PN5: popLayout: popped where it was while the exit inside it runs; a layout sibling slides in", async () => {
    const list = mountList(["a", "b", "c"], "popLayout", (k) => (
      <Show
        when={k === "c"}
        fallback={
          <div data-k={k} style={{ height: "40px" }}>
            <wardic.span exit={{ opacity: 0 }} transition={TWEEN}>
              {k}
            </wardic.span>
          </div>
        }
      >
        <wardic.div data-k={k} layout style={{ height: "40px" }} />
      </Show>
    ))
    await frames(5)
    const b = list.q("b")
    const c = list.q("c")
    const bTop = b.getBoundingClientRect().top
    const cWas = c.getBoundingClientRect().top
    list.setItems(["a", "c"])
    expect(getComputedStyle(b).position, "out of the flow").toBe("absolute")
    expect(b.getBoundingClientRect().top, "where it was").toBe(bTop)
    // The Measure pass runs at the end of the task: c's slide starts from the next frame.
    await raf()
    let slid = false
    await until(() => {
      const top = c.getBoundingClientRect().top
      if (top < cWas - 1 && top > bTop + 1) slid = true
      return Math.abs(top - bTop) < 0.5
    }, 3000)
    expect(slid, "c slid into b's place").toBe(true)
    await until(() => !b.isConnected, 3000)
    expect(b.isConnected).toBe(false)
  })

  it("PN6: wait: the entering child waits until the exit inside the plain one has ended", async () => {
    const list = mountList(["a"], "wait", (k) => (
      <div data-k={k}>
        <wardic.span exit={{ opacity: 0 }} transition={TWEEN}>
          {k}
        </wardic.span>
      </div>
    ))
    await frames(3)
    const a = list.q("a")
    list.setItems(["b"])
    await frames(3)
    expect(a.isConnected, "a exits").toBe(true)
    expect(list.q("b"), "b waits").toBeNull()
    await until(() => !a.isConnected, 3000)
    await until(() => list.q("b") !== null, 1000)
    expect(list.q("b"), "b in once a has gone").not.toBeNull()
  })

  it("PN7: a hook's hold and an exit inside one plain child: it stays until both have ended", async () => {
    let release: (() => void) | undefined
    const Held = (): JSX.Element => {
      let el!: HTMLDivElement
      usePresence(() => el, (safeToRemove) => {
        release = safeToRemove
      })
      return (
        <div ref={el} data-k="frame">
          <wardic.span data-k="inner" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.1 }}>
            x
          </wardic.span>
        </div>
      )
    }
    const one = mountOne(() => <Held />)
    await frames(3)
    const frame = one.q("frame")
    const inner = one.q("inner")
    one.close()
    await until(() => opacityOf(inner) < 0.01, 2000)
    expect(opacityOf(inner), "the exit inside it ran").toBeLessThan(0.01)
    await frames(5)
    expect(frame.isConnected, "held after the exit ended").toBe(true)
    release?.()
    await raf()
    expect(frame.isConnected, "gone once released").toBe(false)
  })

  it("PN8: the presence unmounted mid-exit: the plain child goes with it", async () => {
    const one = mountOne(() => (
      <div data-k="frame">
        <wardic.span exit={{ opacity: 0 }} transition={{ type: "tween", duration: 1 }}>
          x
        </wardic.span>
      </div>
    ))
    await frames(3)
    const frame = one.q("frame")
    one.close()
    await frames(3)
    expect(frame.isConnected, "exiting").toBe(true)
    one.drop()
    await raf()
    expect(frame.isConnected, "gone with its presence").toBe(false)
  })

  it("PN9: popLayout: a plain child held only by a hook is popped too", async () => {
    let release: (() => void) | undefined
    const Held = (props: { readonly k: string }): JSX.Element => {
      let el!: HTMLDivElement
      usePresence(() => el, (safeToRemove) => {
        release = safeToRemove
      })
      return <div ref={el} data-k={props.k} style={{ height: "40px" }} />
    }
    const list = mountList(["a", "b", "c"], "popLayout", (k) => <Held k={k} />)
    await frames(3)
    const b = list.q("b")
    const bTop = b.getBoundingClientRect().top
    list.setItems(["a", "c"])
    expect(getComputedStyle(b).position, "out of the flow").toBe("absolute")
    await raf()
    expect(list.q("c").getBoundingClientRect().top, "c at b's place").toBe(bTop)
    release?.()
  })
})
