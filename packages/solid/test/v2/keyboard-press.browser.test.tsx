// Keyboard presses on Solid 2 (#427, ADR-0056), with the browser's own keys. Solid 1's are KB1–KB6.
//
// - KB7: Enter held turns `whileTap` on; `next("pressStart")` resolves at its keydown and
//   `next("tap")` at its keyup, each with `input: "keyboard"`, the element's centre and the element.
// - KB8: a press event asked for makes a ward's element focusable, as `whileTap` does; a ward with
//   neither leaves it as it is.
// - KB9: a blur cancels a keyboard press: `next("tapCancel")` resolves with the keyboard's input.
// - KB10: a Reorder item's Enter and Space are the reorder's: the lift is no press, and the item's
//   `whileTap` stays off.
// - KB11: `when("tap")` hears a keyboard tap as a pointer's: an effect over it, on a ward with no
//   `whileTap`, makes its element focusable and runs at each tap, Enter's and Space's, with their
//   input.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { Reorder, type Ward, ward, WardicProvider, type WardPressInfo } from "@wardic/solid/unstable/v2"
import { createEffect, createRoot, createSignal, For } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { resetScene } from "./reorder-scene.tsx"

afterEach(resetScene)

const BOX = { width: "80px", height: "80px", background: "teal" } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const r = (n: number): number => Math.round(n)

/** A press's event, as `input x,y` and whether its element is `el`. */
const seen = (info: WardPressInfo, el: Element): string => `${info.input} ${r(info.point.x)},${r(info.point.y)} ${info.element === el}`

/** `el`'s centre in the viewport, as {@link seen} writes a point. */
const centre = (el: Element): string => {
  const box = el.getBoundingClientRect()
  return `${r(box.left + box.width / 2)},${r(box.top + box.height / 2)}`
}

/** The scale `el`'s inline transform draws: 1 with none. */
const scaleOf = (el: HTMLElement): number => {
  const transform = el.style.transform
  if (transform === "" || transform === "none") return 1
  return new DOMMatrix(transform).a
}

/** A ward made under a provider, its element and the ward. */
const mountWard = async (make: () => Ward, body: (card: Ward) => JSX.Element = (card) => <div {...card} style={BOX} />): Promise<{ readonly el: HTMLElement; readonly card: Ward }> => {
  let card!: Ward
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      {(() => {
        card = make()
        return body(card)
      })()}
    </WardicProvider>
  ))
  await frames(4)
  return { el: host.querySelector("div")!, card }
}

describe("keyboard presses on Solid 2 (#427)", () => {
  it("KB7: Enter held turns whileTap on; next(\"pressStart\") at its keydown, next(\"tap\") at its keyup, from the element's centre", async () => {
    const { el, card } = await mountWard(() => ward({ whileTap: { scale: 0.8 }, transition: { type: "tween", duration: 0.1 } }))
    const start = card.next("pressStart")
    const tap = card.next("tap")
    el.focus()
    await userEvent.keyboard("{Enter>}")
    expect(seen(await start, el)).toBe(`keyboard ${centre(el)} true`)
    await until(() => scaleOf(el) < 0.81, 3000)
    expect(scaleOf(el), "whileTap on while Enter is held").toBeLessThan(0.81)
    await userEvent.keyboard("{/Enter}")
    expect(seen(await tap, el)).toBe(`keyboard ${centre(el)} true`)
    await until(() => scaleOf(el) > 0.99, 3000)
    expect(scaleOf(el), "off at its release").toBeGreaterThan(0.99)
  })

  it("KB8: a press event asked for makes the element focusable; a ward with no press leaves it", async () => {
    const asked = await mountWard(() => ward({ animate: { opacity: 1 } }))
    expect(asked.el.getAttribute("tabindex"), "none before a press is asked for").toBeNull()
    void asked.card.next("tap")
    await frames(2)
    expect(asked.el.getAttribute("tabindex")).toBe("0")
    const tapped = asked.card.next("tap")
    asked.el.focus()
    await userEvent.keyboard("{Enter}")
    expect((await tapped).input).toBe("keyboard")
    const plain = await mountWard(() => ward({ whileHover: { scale: 1.1 } }))
    expect(plain.el.getAttribute("tabindex")).toBeNull()
  })

  it("KB9: a blur cancels a keyboard press", async () => {
    let other!: HTMLButtonElement
    const { el, card } = await mountWard(
      () => ward({ whileTap: { scale: 0.9 } }),
      (c) => (
        <>
          <div {...c} style={BOX} />
          <button ref={(n: HTMLButtonElement) => (other = n)}>other</button>
        </>
      ),
    )
    const cancel = card.next("tapCancel")
    el.focus()
    await userEvent.keyboard("{Enter>}")
    other.focus()
    expect(seen(await cancel, el)).toBe(`keyboard ${centre(el)} true`)
    await userEvent.keyboard("{/Enter}")
  })

  it("KB10: a Reorder item's Enter and Space are the reorder's: the lift is no press", async () => {
    const [order, setOrder] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
    let now: ReadonlyArray<string> = ["a", "b", "c"]
    const onReorder = (values: ReadonlyArray<string>): void => {
      now = values
      setOrder(values)
    }
    const items: Record<string, HTMLElement> = {}
    const presses: Array<string> = []
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", top: "100px", left: "100px", width: "120px" }}>
          <Reorder.Group values={order()} onReorder={onReorder} style={{ "list-style": "none", margin: "0", padding: "0" }}>
            <For each={order()}>
              {(value) => (
                <Reorder.Item
                  value={value}
                  ref={(n: HTMLElement) => (items[value] = n)}
                  whileTap={{ scale: 0.8 }}
                  wardRef={(item) => void item.next("pressStart").then(() => presses.push(value), () => {})}
                  style={{ height: "40px", background: "teal" }}
                >
                  {value}
                </Reorder.Item>
              )}
            </For>
          </Reorder.Group>
        </div>
      </WardicProvider>
    ))
    await frames(4)
    items.a!.focus()
    await userEvent.keyboard("[Space]")
    await userEvent.keyboard("{ArrowDown}")
    await userEvent.keyboard("[Space]")
    await until(() => now[0] === "b", 2000)
    expect(now, "the keyboard reorder moved it").toEqual(["b", "a", "c"])
    await frames(4)
    expect(scaleOf(items.a!), "no whileTap").toBeCloseTo(1, 3)
    expect(presses, "no press").toEqual([])
  })

  it("KB11: when(\"tap\") hears a keyboard tap: the effect makes the element focusable and runs at each tap", async () => {
    const heard: Array<string> = []
    const { el, card } = await mountWard(() => ward({ animate: { opacity: 1 } }))
    const dispose = createRoot((done) => {
      createEffect(card.when("tap"), (tap) => {
        heard.push(seen(tap, el))
      })
      return done
    })
    await frames(2)
    expect(el.getAttribute("tabindex"), "asked for, so made focusable").toBe("0")
    el.focus()
    await userEvent.keyboard("{Enter}")
    await until(() => heard.length === 1, 1000)
    await userEvent.keyboard("[Space]")
    await until(() => heard.length === 2, 1000)
    dispose()
    expect(heard).toEqual([`keyboard ${centre(el)} true`, `keyboard ${centre(el)} true`])
  })
})
