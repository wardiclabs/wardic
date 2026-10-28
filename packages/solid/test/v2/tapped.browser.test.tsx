// A ward's last tap on Solid 2 (#427, ADR-0056): `card.tapped()`, the press as an async value, as
// `settled()` is the last landing (`settled.browser.test.tsx`).
//
// - TP1: `undefined` before the first tap, and not pending; a pointer's press makes it pending, the
//   read keeping its value; a release on the element resolves it to the tap's event.
// - TP2: a keyboard press too: Enter held pends it, its release resolves it with `input: "keyboard"`
//   and the element's centre, measured at the key: the element moving after doesn't move it.
// - TP3: a cancel keeps the last tap: a release elsewhere, and a blur ending a keyboard press; it's
//   no longer pending after either.
// - TP4: its first read asks for the press, as `next("tap")` does: on a ward with no `whileTap`, the
//   element is made focusable and a tap reaches it.
// - TP5: a reader in JSX beside `isPending` shows "pressed" while a press is held, with no
//   `<Loading>` and no diagnostic (the suite's gate fails on one), and the last tap after.
// - TP6: a press a drag took over keeps the last tap.
// - TP7: a tap before the first read is kept: the first read after it returns it.
// - TP8: a press held at the first read: not pending at that read, pending from a microtask on, as
//   `settled()`'s first read mid-animation is, then the tap.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { type Ward, ward, type WardConfig, WardicProvider, type WardPressInfo } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { flush, isPending } from "solid-js"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX = { width: "80px", height: "80px", "margin-top": "100px", "margin-left": "100px", background: "teal" } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** Mount a `div` spread with a ward made from `config` in a component under the provider; its element and ward. */
const mountCard = async (config: WardConfig, ui: (card: Ward) => JSX.Element = (card) => <div {...card} style={BOX} />) => {
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
  await frames(4)
  return { ...mounted, el: mounted.host.querySelector("div")!, card }
}

const pointer = (at: EventTarget, type: string, x: number, y: number, buttons = 0): void => {
  at.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, buttons, button: 0, bubbles: true }))
}

const centreOf = (el: Element): { readonly x: number; readonly y: number } => {
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

const r = (n: number): number => Math.round(n)

/** What a read shows: the last tap (its input and point) or none, and whether it's pending. */
const shown = (card: Ward): string => {
  const tap = card.tapped()
  const last = Bool.match(tap === undefined, { onTrue: () => "none", onFalse: () => `${(tap as WardPressInfo).input} ${r((tap as WardPressInfo).point.x)},${r((tap as WardPressInfo).point.y)}` })
  return `${last} ${Bool.match(isPending(() => card.tapped()), { onTrue: () => "pressed", onFalse: () => "idle" })}`
}

/** `shown`, read the way a component reads it: inside a flushed owner, after the microtasks. */
const read = async (card: Ward): Promise<string> => {
  flush()
  await Promise.resolve()
  flush()
  return shown(card)
}

describe("a ward's last tap on Solid 2 (#427)", () => {
  it("TP1: undefined before the first tap; pending through a pointer's press; then the tap", async () => {
    const { el, card } = await mountCard({ whileTap: { scale: 0.9 } })
    expect(card.tapped(), "nothing before the first tap").toBeUndefined()
    expect(isPending(() => card.tapped()), "and not pending").toBe(false)
    const c = centreOf(el)
    pointer(el, "pointerdown", c.x, c.y, 1)
    expect(await read(card), "pressed, the last tap kept").toBe("none pressed")
    pointer(el, "pointerup", c.x + 2, c.y + 1)
    expect(await read(card)).toBe(`pointer ${r(c.x + 2)},${r(c.y + 1)} idle`)
    expect(card.tapped()?.element, "the tap's element").toBe(el)
  })

  it("TP2: a keyboard press pends it, and its release resolves it to the keyboard's tap at the centre", async () => {
    const { el, card } = await mountCard({ whileTap: { scale: 0.9 } })
    void card.tapped()
    el.focus()
    await userEvent.keyboard("{Enter>}")
    expect(await read(card)).toBe("none pressed")
    const c = centreOf(el)
    await userEvent.keyboard("{/Enter}")
    el.style.marginLeft = "300px"
    expect(await read(card), "where it was at the key").toBe(`keyboard ${r(c.x)},${r(c.y)} idle`)
    // A second tap, with nothing read until after the element moves: still where the key was.
    const d = centreOf(el)
    el.focus()
    await userEvent.keyboard("{Enter}")
    el.style.marginLeft = "100px"
    expect(await read(card), "measured at the key, though nothing read it then").toBe(`keyboard ${r(d.x)},${r(d.y)} idle`)
  })

  it("TP3: a cancel keeps the last tap: a release elsewhere, and a blur ending a keyboard press", async () => {
    let other!: HTMLButtonElement
    const { el, card } = await mountCard({ whileTap: { scale: 0.9 } }, (card) => (
      <>
        <div {...card} style={BOX} />
        <button ref={(n: HTMLButtonElement) => (other = n)}>other</button>
      </>
    ))
    const c = centreOf(el)
    pointer(el, "pointerdown", c.x, c.y, 1)
    pointer(el, "pointerup", c.x, c.y)
    const first = await read(card)
    expect(first).toBe(`pointer ${r(c.x)},${r(c.y)} idle`)
    pointer(el, "pointerdown", c.x, c.y, 1)
    expect(await read(card), "pressed again, the first tap kept").toBe(first.replace("idle", "pressed"))
    pointer(document.body, "pointerup", 5, 5)
    expect(await read(card), "a release elsewhere keeps it").toBe(first)
    el.focus()
    await userEvent.keyboard("{Enter>}")
    expect(await read(card)).toBe(first.replace("idle", "pressed"))
    other.focus()
    expect(await read(card), "a blur keeps it").toBe(first)
    await userEvent.keyboard("{/Enter}")
    expect(await read(card), "and the key's release after it taps nothing").toBe(first)
  })

  it("TP4: its first read asks for the press: the element is made focusable, and a tap reaches it", async () => {
    const { el, card } = await mountCard({ animate: { opacity: 1 } })
    expect(el.getAttribute("tabindex"), "no press asked for yet").toBeNull()
    expect(card.tapped()).toBeUndefined()
    await frames(2)
    expect(el.getAttribute("tabindex"), "asked for by the read").toBe("0")
    el.focus()
    await userEvent.keyboard("{Enter}")
    const c = centreOf(el)
    expect(await read(card)).toBe(`keyboard ${r(c.x)},${r(c.y)} idle`)
  })

  it("TP5: a reader in JSX beside isPending shows pressed while a press is held, then the last tap", async () => {
    const { host, el } = await mountCard({ whileTap: { scale: 0.9 } }, (card) => (
      <>
        <div {...card} style={BOX} />
        <p>{shown(card)}</p>
      </>
    ))
    const text = (): string => host.querySelector("p")!.textContent ?? ""
    expect(text()).toBe("none idle")
    const c = centreOf(el)
    pointer(el, "pointerdown", c.x, c.y, 1)
    await until(() => text() === "none pressed", 1000)
    expect(text()).toBe("none pressed")
    pointer(el, "pointerup", c.x, c.y)
    await until(() => text().endsWith("idle"), 1000)
    expect(text()).toBe(`pointer ${r(c.x)},${r(c.y)} idle`)
  })

  it("TP6: a press a drag took over keeps the last tap", async () => {
    const { el, card } = await mountCard({ drag: "x", dragMomentum: false })
    void card.tapped()
    await frames(2)
    const c = centreOf(el)
    pointer(el, "pointerdown", c.x, c.y, 1)
    pointer(el, "pointerup", c.x, c.y)
    const first = await read(card)
    expect(first).toBe(`pointer ${r(c.x)},${r(c.y)} idle`)
    pointer(el, "pointerdown", c.x, c.y, 1)
    for (const k of [1, 2, 3, 4]) {
      await raf()
      pointer(el, "pointermove", c.x + 15 * k, c.y, 1)
    }
    await raf()
    pointer(el, "pointerup", c.x + 60, c.y)
    expect(await read(card), "the drag's press is no tap").toBe(first)
  })

  it("TP7: a tap before the first read is kept", async () => {
    const { el, card } = await mountCard({ whileTap: { scale: 0.9 } })
    const c = centreOf(el)
    pointer(el, "pointerdown", c.x, c.y, 1)
    pointer(el, "pointerup", c.x, c.y)
    await frames(1)
    expect(await read(card)).toBe(`pointer ${r(c.x)},${r(c.y)} idle`)
  })

  it("TP8: a press held at the first read: not pending at that read, pending from a microtask, then the tap", async () => {
    const { el, card } = await mountCard({ whileTap: { scale: 0.9 } })
    const c = centreOf(el)
    pointer(el, "pointerdown", c.x, c.y, 1)
    expect(isPending(() => card.tapped()), "the first read reads the last tap").toBe(false)
    expect(await read(card), "pending from there").toBe("none pressed")
    pointer(el, "pointerup", c.x, c.y)
    expect(await read(card)).toBe(`pointer ${r(c.x)},${r(c.y)} idle`)
  })
})
