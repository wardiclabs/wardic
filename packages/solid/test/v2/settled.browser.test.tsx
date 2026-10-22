// A ward's landings on Solid 2 (#257, ADR-0046): `settled()`, an async value ready from its first
// read and pending while a Retarget runs, and `next("settled")`, a promise of the next landing.
//
// - SE1: before the first landing `settled()` is `undefined`, read under `<Loading>` with no fallback
//   shown; the entrance is pending from the first frame, then lands with its definition, target and
//   gestures, the element at its value.
// - SE2: a variant change: pending while it runs, the last landing kept meanwhile, then the variant's name.
// - SE3: `next("settled")` waits for the next landing after the call: a Retarget the next interrupts
//   doesn't land it, the next one does.
// - SE4: a hover's landing has the hover on and its values; the return's has none.
// - SE5: a pending `next` rejects with an `AbortError` at the ward's disposal; one asked after, at once.
// - SE6: a Retarget with nothing to animate lands at once: never pending, `next` resolved.
// - SE7: a first read during the entrance isn't pending: `<Loading>` shows its content, then the read
//   pends and lands.
// - SE8: a bare read with no `<Loading>` at all: the page mounts and the entrance lands (Solid's dev
//   build warns of the read, as of any async read outside one; pending at its first read, it would
//   have held the root's mount for good).
// - SE9: `settled` and `next` aren't props a spread applies.
// - SE10: a Reorder item's keyboard lift (ADR-0037) lands with its `whileDrag` on, as `drag`; its drop with none.
import { DomLive } from "@wardic/dom"
import { reorderGroup, reorderItem, type Ward, ward, type WardConfig, type WardSettled, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, flush, For, isPending, Loading, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "../browser-commands.ts"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const TWEEN = { type: "tween", duration: 0.15 } as const
// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" } as const

const opacity = (el: Element | null | undefined): number => Number((el as HTMLElement).style.opacity)

/** Mount `ui` with a ward made from `config` in a component under the provider. */
const mountCard = (config: WardConfig, ui: (card: Ward) => JSX.Element) => {
  let card!: Ward
  const Card = (): JSX.Element => {
    card = ward(config)
    return ui(card)
  }
  const mounted = mount(() => (
    <WardicProvider env={DomLive}>
      <Card />
    </WardicProvider>
  ))
  return { ...mounted, card }
}

/** What a reader shows: the landing's definition, and whether it's pending. */
const shown = (card: Ward): string =>
  `${JSON.stringify(card.settled()?.definition)} ${Bool.match(isPending(() => card.settled()), { onTrue: () => "pending", onFalse: () => "idle" })}`

/** Swallow one Solid diagnostic code for the rest of the test: the console's warns and errors, before the diagnostics gate sees them. */
const swallow = (code: string): { readonly seen: () => number; readonly restore: () => void } => {
  const warn = console.warn
  const error = console.error
  let seen = 0
  const filter =
    (to: (...args: Array<unknown>) => void) =>
    (...args: Array<unknown>): void => {
      const message = String(args[0])
      if (message.startsWith(`[${code}]`)) seen++
      if (message.includes(`[${code}]`)) return
      to(...args)
    }
  console.warn = filter(warn)
  console.error = filter(error)
  return {
    seen: () => seen,
    restore: () => {
      console.warn = warn
      console.error = error
    },
  }
}

describe("a ward's landings on Solid 2 (#257)", () => {
  it("SE1: undefined before the first landing, pending from the first frame, then the entrance's landing", async () => {
    let el: HTMLElement | undefined
    const { host, card } = mountCard({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN, style: BOX }, (card) => (
      <>
        <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
        <Loading fallback={<p>fallback</p>}>
          <p>{shown(card)}</p>
        </Loading>
      </>
    ))
    const landed = card.next("settled")
    await raf()
    expect(host.querySelector("p")!.textContent, "content at once, pending through the entrance").toBe("undefined pending")
    const landing = await landed
    expect(opacity(el), "the element is at its value when it lands").toBe(1)
    expect(landing).toEqual({ definition: { opacity: 1 }, target: { opacity: 1 }, gestures: { hover: false, tap: false, drag: false, inView: false, focus: false } })
    flush()
    await raf()
    expect(host.querySelector("p")!.textContent).toBe('{"opacity":1} idle')
    expect(card.settled()).toEqual(landing)
  })

  it("SE2: a variant change: pending while it runs, the last landing kept, then the variant's name", async () => {
    const [open, setOpen] = createSignal(false)
    const config: WardConfig = {
      variants: { open: { opacity: 1 }, shut: { opacity: 0.2 } },
      initial: "shut",
      animate: () => Bool.match(open(), { onTrue: () => "open", onFalse: () => "shut" }),
      transition: TWEEN,
      style: BOX,
    }
    const { host, card } = mountCard(config, (card) => (
      <>
        <div {...card} />
        <Loading fallback={<p>fallback</p>}>
          <p>{shown(card)}</p>
        </Loading>
      </>
    ))
    await card.next("settled")
    await raf()
    expect(host.querySelector("p")!.textContent).toBe('"shut" idle')
    setOpen(true)
    flush()
    await raf()
    expect(host.querySelector("p")!.textContent, "the last landing kept while it runs").toBe('"shut" pending')
    const landing = await card.next("settled")
    expect(landing.definition).toBe("open")
    expect(landing.target).toEqual({ opacity: 1 })
    await raf()
    expect(host.querySelector("p")!.textContent).toBe('"open" idle')
  })

  it("SE3: next waits for the next landing after the call: an interrupted Retarget doesn't land it", async () => {
    const [to, setTo] = createSignal(1)
    const { card } = mountCard({ initial: { opacity: 0 }, animate: () => ({ opacity: to() }), transition: { type: "tween", duration: 0.4 }, style: BOX }, (card) => <div {...card} />)
    const landed = card.next("settled")
    for (let i = 0; i < 4; i++) await raf()
    setTo(0.5)
    const landing = await landed
    expect(landing.target, "the interrupted entrance never landed").toEqual({ opacity: 0.5 })
  })

  it("SE4: a hover's landing has the hover on and its values; the return's has none", async () => {
    let el: HTMLElement | undefined
    const { card } = mountCard(
      { variants: { rest: { opacity: 0.2 } }, initial: "rest", animate: "rest", whileHover: { opacity: 1 }, transition: TWEEN, style: BOX },
      (card) => <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />,
    )
    expect((await card.next("settled")).definition).toBe("rest")
    const hovered = card.next("settled")
    // The recognizer attaches its listener asynchronously: re-dispatch until the hover's Retarget starts.
    let landing: WardSettled | undefined
    void hovered.then((l) => (landing = l))
    await until(() => {
      el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
      return opacity(el) > 0.3
    }, 2000)
    await hovered
    expect(landing).toEqual({ definition: { opacity: 1 }, target: { opacity: 1 }, gestures: { hover: true, tap: false, drag: false, inView: false, focus: false } })
    const returned = card.next("settled")
    el!.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, bubbles: true }))
    expect(await returned).toEqual({ definition: { opacity: 0.2 }, target: { opacity: 0.2 }, gestures: { hover: false, tap: false, drag: false, inView: false, focus: false } })
  })

  it("SE5: a pending next rejects with an AbortError at the ward's disposal; one asked after, at once", async () => {
    const { card, unmount } = mountCard({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { type: "tween", duration: 1 }, style: BOX }, (card) => <div {...card} />)
    await raf()
    const pending = card.next("settled")
    unmount()
    const reason = await pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(reason).toBeInstanceOf(DOMException)
    expect((reason as DOMException).name).toBe("AbortError")
    const after = await card.next("settled").then(
      () => "resolved",
      (error: unknown) => (error as DOMException).name,
    )
    expect(after).toBe("AbortError")
  })

  it("SE6: a Retarget with nothing to animate lands at once: never pending, next resolved", async () => {
    const [name, setName] = createSignal("idle")
    const { host, card } = mountCard({ variants: { idle: {}, still: {} }, animate: () => name(), transition: { type: "spring", stiffness: 700, damping: 50 }, style: BOX }, (card) => (
      <>
        <div {...card} />
        <Loading fallback={<p>fallback</p>}>
          <p>{shown(card)}</p>
        </Loading>
      </>
    ))
    await raf()
    expect(host.querySelector("p")!.textContent).toBe('"idle" idle')
    const landed = card.next("settled")
    setName("still")
    flush()
    expect(host.querySelector("p")!.textContent, "landed in the change's own flush").toBe('"still" idle')
    expect((await landed).definition).toBe("still")
  })

  it("SE7: a first read during the entrance isn't pending: Loading shows its content, then the read pends and lands", async () => {
    const [show, setShow] = createSignal(false)
    const { host, card } = mountCard({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { type: "tween", duration: 0.3 }, style: BOX }, (card) => (
      <>
        <div {...card} />
        <Loading fallback={<p>fallback</p>}>
          <Show when={show()}>
            <p>{shown(card)}</p>
          </Show>
        </Loading>
      </>
    ))
    await raf()
    await raf()
    setShow(true)
    flush()
    expect(host.querySelector("p")!.textContent, "no fallback: the first read is ready").toBe("undefined idle")
    await raf()
    expect(host.querySelector("p")!.textContent, "then pending: the entrance is in flight").toBe("undefined pending")
    await card.next("settled")
    await raf()
    expect(host.querySelector("p")!.textContent).toBe('{"opacity":1} idle')
  })

  it("SE8: with no Loading at all, the page mounts and the entrance lands", async () => {
    const warning = swallow("ASYNC_OUTSIDE_LOADING_BOUNDARY")
    try {
      let el: HTMLElement | undefined
      const { host } = mountCard({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN, style: BOX }, (card) => (
        <>
          <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
          <p>{JSON.stringify(card.settled()?.definition)}</p>
        </>
      ))
      expect(host.querySelector("p"), "the root mounted").not.toBeNull()
      await until(() => host.querySelector("p")!.textContent === '{"opacity":1}', 2000)
      expect(host.querySelector("p")!.textContent).toBe('{"opacity":1}')
      expect(opacity(el)).toBe(1)
      expect(warning.seen(), "Solid's dev build warns of the read").toBeGreaterThan(0)
    } finally {
      warning.restore()
    }
  })

  it("SE10: a Reorder item's keyboard lift lands with drag on; its drop with none", async () => {
    const [values, setValues] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const rows = new Map<string, Ward>()
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const list = reorderGroup({ values, onReorder: setValues, style: { "list-style": "none", margin: "120px 0 0 120px", padding: "0", width: "200px" } })
          return (
            <ul {...list}>
              <For each={values()}>
                {(value) => {
                  const row = reorderItem(list, { value, whileDrag: { scale: 1.05 }, transition: TWEEN, style: { height: "40px" } })
                  rows.set(value, row)
                  return (
                    <li {...row} data-value={value}>
                      {value}
                    </li>
                  )
                }}
              </For>
            </ul>
          )
        })()}
      </WardicProvider>
    ))
    for (let i = 0; i < 4; i++) await raf()
    const row = rows.get("a")!
    host.querySelector<HTMLElement>('[data-value="a"]')!.focus()
    const lifted = row.next("settled")
    await commands.realKey("press", "Space")
    expect(await lifted).toEqual({ definition: { scale: 1.05 }, target: { scale: 1.05 }, gestures: { hover: false, tap: false, drag: true, inView: false, focus: false } })
    const dropped = row.next("settled")
    await commands.realKey("press", "Space")
    expect((await dropped).gestures).toEqual({ hover: false, tap: false, drag: false, inView: false, focus: false })
  })

  it("SE9: settled and next aren't props a spread applies", () => {
    const { card } = mountCard({ animate: { opacity: 1 } }, (card) => <div {...card} />)
    const keys = Object.keys({ ...card })
    expect(keys).not.toContain("settled")
    expect(keys).not.toContain("next")
  })
})
