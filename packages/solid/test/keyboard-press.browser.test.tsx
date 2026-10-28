// Keyboard presses on Solid 1 (#427, ADR-0056), with the browser's own keys: Enter and Space on a
// focused Wardic element press it, as a pointer does. Solid 2's are KB7–KB10.
//
// - KB1: Enter held turns `whileTap` on and its release turns it off; `onTapStart` hears the keydown
//   and `onTap` the keyup, the info's `input` the keyboard's and its point the element's centre.
// - KB2: Space presses too: on a pressable `div`, taken, so the page doesn't scroll; on a native
//   button, left alone, so its own click still fires beside the tap.
// - KB3: a blur cancels a keyboard press: `onTapCancel` with the blur's event, and the key's release
//   taps nothing.
// - KB4: a pressable element that doesn't take focus is made focusable (Motion's press): a `div` with
//   only `onTap` gets `tabindex="0"`; a button, a given `tabindex` and an element with no press are
//   left as they are.
// - KB5: only the element's own keys press: Enter on a button inside a pressable card presses the
//   button's, not the card; in a pressable text field, Space types and Enter presses.
// - KB6: on a Reorder item, Enter and Space are the reorder's: the lift is no press, and the item's
//   `whileTap` stays off.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { Reorder, wardic, type WardicPressInfo, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { scaleOf } from "./base-values-harness.ts"
import { until } from "./browser-helpers.ts"
import { resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

const BOX = { width: "80px", height: "80px", background: "teal" } as const

/** `box`, at (100, 100) on the page, settled; its element. */
const mount = async (box: (ref: (n: HTMLElement) => void) => JSX.Element): Promise<HTMLElement> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "100px", left: "100px", height: "3000px" }}>{box((n) => setEl(n))}</div>
    </WardicProvider>
  ))
  await settle()
  return el()!
}

const r = (n: number): number => Math.round(n)

/** A call: its name, the event's type, and the info's input and point. */
const seen = (name: string, event: Event, info: WardicPressInfo): string => `${name} ${event.type} ${info.input} ${r(info.point.x)},${r(info.point.y)}`

/** `el`'s centre in the viewport. */
const centre = (el: Element): string => {
  const box = el.getBoundingClientRect()
  return `${r(box.left + box.width / 2)},${r(box.top + box.height / 2)}`
}

describe("keyboard presses on Solid 1 (#427)", () => {
  it("KB1: Enter held turns whileTap on; onTapStart at the keydown and onTap at the keyup, from the element's centre", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={BOX}
        whileTap={{ scale: 0.8 }}
        transition={{ type: "tween", duration: 0.1 }}
        onTapStart={(e, info) => calls.push(seen("tapStart", e, info))}
        onTap={(e, info) => calls.push(seen("tap", e, info))}
        onTapCancel={(e, info) => calls.push(seen("cancel", e, info))}
      />
    ))
    el.focus()
    await userEvent.keyboard("{Enter>}")
    await until(() => scaleOf(el) < 0.81, 3000)
    expect(scaleOf(el), "whileTap on while Enter is held").toBeLessThan(0.81)
    await userEvent.keyboard("{/Enter}")
    await until(() => scaleOf(el) > 0.99, 3000)
    expect(scaleOf(el), "off at its release").toBeGreaterThan(0.99)
    expect(calls).toEqual([`tapStart keydown keyboard ${centre(el)}`, `tap keyup keyboard ${centre(el)}`])
  })

  it("KB2: Space presses; a pressable div takes it, so the page doesn't scroll; a button keeps its own click", async () => {
    const calls: Array<string> = []
    const clicks: Array<string> = []
    const [div, setDiv] = createSignal<HTMLElement>()
    const [button, setButton] = createSignal<HTMLElement>()
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", top: "100px", left: "100px", height: "3000px" }}>
          <wardic.div ref={setDiv} style={BOX} onTap={(e, info) => calls.push(seen("div", e, info))} />
          <wardic.button ref={setButton} onTap={(e, info) => calls.push(seen("button", e, info))} onClick={() => clicks.push("click")}>
            b
          </wardic.button>
        </div>
      </WardicProvider>
    ))
    await settle()
    window.scrollTo(0, 0)
    div()!.focus()
    await userEvent.keyboard("[Space]")
    await wait(150)
    expect(window.scrollY, "the page didn't scroll").toBe(0)
    button()!.focus()
    await userEvent.keyboard("[Space]")
    await until(() => clicks.length > 0, 1000)
    expect(clicks, "the button's own click").toEqual(["click"])
    expect(calls).toEqual([`div keyup keyboard ${centre(div()!)}`, `button keyup keyboard ${centre(button()!)}`])
  })

  it("KB3: a blur cancels a keyboard press, and the key's release taps nothing", async () => {
    const calls: Array<string> = []
    const [other, setOther] = createSignal<HTMLElement>()
    const el = await mount((ref) => (
      <>
        <wardic.div ref={ref} style={BOX} onTapStart={(e, info) => calls.push(seen("tapStart", e, info))} onTap={(e, info) => calls.push(seen("tap", e, info))} onTapCancel={(e, info) => calls.push(seen("cancel", e, info))} />
        <button ref={setOther}>other</button>
      </>
    ))
    el.focus()
    await userEvent.keyboard("{Enter>}")
    other()!.focus()
    await userEvent.keyboard("{/Enter}")
    await wait(50)
    expect(calls).toEqual([`tapStart keydown keyboard ${centre(el)}`, `cancel blur keyboard ${centre(el)}`])
  })

  it("KB4: a pressable element that doesn't take focus is made focusable; the rest are left as they are", async () => {
    const els: Record<string, HTMLElement> = {}
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (els.tap = n)} onTap={() => {}} />
        <wardic.div ref={(n: HTMLElement) => (els.whileTap = n)} whileTap={{ scale: 0.9 }} />
        <wardic.button ref={(n: HTMLElement) => (els.button = n)} whileTap={{ scale: 0.9 }} />
        <wardic.div ref={(n: HTMLElement) => (els.given = n)} tabindex="-1" whileTap={{ scale: 0.9 }} />
        <wardic.div ref={(n: HTMLElement) => (els.none = n)} whileHover={{ scale: 1.1 }} />
      </WardicProvider>
    ))
    await settle()
    expect(Object.entries(els).map(([name, el]) => `${name} ${el.getAttribute("tabindex")}`)).toEqual([
      "tap 0",
      "whileTap 0",
      "button null",
      "given -1",
      "none null",
    ])
  })

  it("KB5: only the element's own keys press it; in a text field, Space types and Enter presses", async () => {
    const calls: Array<string> = []
    const [inner, setInner] = createSignal<HTMLElement>()
    const [field, setField] = createSignal<HTMLInputElement>()
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div style={BOX} onTap={() => calls.push("card")}>
          <wardic.button ref={setInner} onTap={() => calls.push("button")}>
            b
          </wardic.button>
        </wardic.div>
        <wardic.input ref={setField} onTapStart={() => calls.push("field start")} onTap={() => calls.push("field")} />
      </WardicProvider>
    ))
    await settle()
    inner()!.focus()
    await userEvent.keyboard("{Enter}")
    await wait(50)
    expect(calls, "the button's press, not the card's").toEqual(["button"])
    field()!.focus()
    await userEvent.keyboard("[Space]")
    await wait(50)
    expect(field()!.value, "Space typed").toBe(" ")
    expect(calls, "and pressed nothing").toEqual(["button"])
    await userEvent.keyboard("{Enter}")
    await wait(50)
    expect(calls).toEqual(["button", "field start", "field"])
  })

  it("KB6: a Reorder item's Enter and Space are the reorder's: the lift is no press", async () => {
    const calls: Array<string> = []
    const [order, setOrder] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
    const items: Record<string, HTMLElement> = {}
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", top: "100px", left: "100px", width: "120px" }}>
          <Reorder.Group values={order()} onReorder={setOrder} style={{ "list-style": "none", margin: "0", padding: "0" }}>
            <For each={order()}>
              {(value) => (
                <Reorder.Item
                  value={value}
                  ref={(n: HTMLElement) => (items[value] = n)}
                  whileTap={{ scale: 0.8 }}
                  onTapStart={() => calls.push(`tapStart ${value}`)}
                  onTap={() => calls.push(`tap ${value}`)}
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
    await settle()
    items.a!.focus()
    await userEvent.keyboard("[Space]")
    await userEvent.keyboard("{ArrowDown}")
    await userEvent.keyboard("[Space]")
    await until(() => order()[0] === "b", 2000)
    expect(order(), "the keyboard reorder moved it").toEqual(["b", "a", "c"])
    expect(scaleOf(items.a!), "no whileTap").toBeCloseTo(1, 3)
    expect(calls, "no press").toEqual([])
  })
})
