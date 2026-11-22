// Sensors given their Subject first, or a ward (#884's PR 2; ADR-0073 decision 18, *Amendment (#884)*'s
// Q6): `createHover(el)` reads `el` from the call on; `createHover(card)` reads the ward's own recognizer,
// which its `when` would start, so nothing listens to its element twice. In real events.
//
// - ST1: `createHover(el)` and `createPress(el)`: given the element first, each reads it, an accessor.
// - ST2: `createHover(card)` follows the ward's hover, with `whileHover` or with none of its own.
// - ST3: `createPress(card)`: true from a press's start to its tap or its cancel.
// - ST4: `createFocus(card)` follows the element the ward is on, and the next one it's given.
// - ST5: `createDrag(card)` gives the ward's own drag's samples, its end among them; `null` before.
// - ST6: `createDrag(el, { axis: "x" })`: the element first, then its options.
import { DomLive } from "@wardic/dom"
import { createDrag, createFocus, createHover, createPress, ward, WardicProvider } from "@wardic/solid"
import type { JSX } from "@solidjs/web"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { retryGesture, until } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"

const mouse = { pointerId: 1, pointerType: "mouse", isPrimary: true } as const

/** Dispatch `event` on `el` each frame until `done()`, then check it was reached. */
const takes = async (el: Element, event: () => Event, done: () => boolean, what: string): Promise<void> => {
  await until(() => {
    el.dispatchEvent(event())
    flush()
    return done()
  })
  expect(done(), what).toBe(true)
}

const BOX = { width: "40px", height: "40px" } as const

const down = (x = 0) => new PointerEvent("pointerdown", { ...mouse, clientX: x, clientY: 0, button: 0, buttons: 1, bubbles: true })
const up = (x = 0) => new PointerEvent("pointerup", { ...mouse, clientX: x, clientY: 0, button: 0, buttons: 0, bubbles: true })

describe("sensors given their Subject or a ward (#884's PR 2)", () => {
  it("ST1: createHover(el) and createPress(el) read the element given first", async () => {
    let hovered!: () => boolean
    let pressed!: () => boolean
    let el!: HTMLElement
    const Box = () => {
      el = (<div style={BOX} />) as HTMLElement
      hovered = createHover(el)
      pressed = createPress(el)
      return el as unknown as JSX.Element
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(hovered()).toBe(false)
    await takes(el, () => new PointerEvent("pointerenter", mouse), () => hovered(), "hovered")
    await takes(el, () => down(), () => pressed(), "pressed")
    el.dispatchEvent(up())
    await until(() => (flush(), !pressed()))
    expect(pressed()).toBe(false)
  })

  it("ST2: createHover(card) follows the ward's own hover, with whileHover and with none", async () => {
    let withWhile!: () => boolean
    let bare!: () => boolean
    let a!: HTMLElement
    let b!: HTMLElement
    const Box = () => {
      const lifting = ward({ whileHover: { scale: 1.1 }, style: BOX })
      const plain = ward({ style: BOX })
      withWhile = createHover(lifting)
      bare = createHover(plain)
      return (
        <>
          <div {...lifting} ref={[lifting, (n: HTMLElement) => (a = n)]} />
          <div {...plain} ref={[plain, (n: HTMLElement) => (b = n)]} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect([withWhile(), bare()]).toEqual([false, false])
    await takes(a, () => new PointerEvent("pointerenter", mouse), () => withWhile(), "the ward with whileHover hovered")
    await takes(b, () => new PointerEvent("pointerenter", mouse), () => bare(), "the ward with none hovered")
    a.dispatchEvent(new PointerEvent("pointerleave", mouse))
    await until(() => (flush(), !withWhile()))
    expect([withWhile(), bare()]).toEqual([false, true])
  })

  it("ST3: createPress(card) is true from a press's start to its tap", async () => {
    let pressed!: () => boolean
    let el!: HTMLElement
    const Box = () => {
      const card = ward({ whileTap: { scale: 0.95 }, style: BOX })
      pressed = createPress(card)
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await takes(el, () => down(), () => pressed(), "pressed")
    el.dispatchEvent(up())
    await until(() => (flush(), !pressed()))
    expect(pressed()).toBe(false)
  })

  it("ST4: createFocus(card) follows the element the ward is on, and the next one it's given", async () => {
    let focused!: () => boolean
    const [second, setSecond] = createSignal(false)
    const Box = () => {
      const card = ward({})
      focused = createFocus(card)
      return (
        <Show when={second()} fallback={<button {...card} ref={card} id="first">a</button>}>
          <button {...card} ref={card} id="second">b</button>
        </Show>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const focusOn = async (id: string): Promise<void> => {
      await until(() => {
        const el = document.getElementById(id) as HTMLButtonElement
        el.blur()
        el.focus()
        flush()
        return focused()
      })
      expect(focused(), `focus on #${id}`).toBe(true)
      ;(document.getElementById(id) as HTMLButtonElement).blur()
      await until(() => (flush(), !focused()))
    }
    await focusOn("first")
    setSecond(true)
    flush()
    await focusOn("second")
  })

  it("ST5: createDrag(card) gives the ward's own drag's samples, its end among them; null before", async () => {
    let sample!: () => ReturnType<ReturnType<typeof createDrag>>
    let el!: HTMLElement
    const Box = () => {
      const card = ward({ drag: "x", style: BOX })
      sample = createDrag(card)
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(sample()).toBeNull()
    await retryGesture(
      () => {
        el.dispatchEvent(down(0))
        el.dispatchEvent(new PointerEvent("pointermove", { ...mouse, clientX: 20, clientY: 0, buttons: 1, bubbles: true }))
        flush()
      },
      () => el.dispatchEvent(up(20)),
      () => (flush(), sample() !== null),
    )
    // Released once it has started: a retry releases only before pressing again.
    el.dispatchEvent(up(20))
    await until(() => (flush(), sample()?.phase === "end"))
    expect(sample()?.phase).toBe("end")
    expect(sample()?.offset.x).toBeGreaterThan(0)
  })

  it("ST6: createDrag(el, { axis: 'x' }) takes the element first, then its options", async () => {
    let sample!: () => ReturnType<ReturnType<typeof createDrag>>
    let el!: HTMLElement
    const Box = () => {
      el = (<div style={BOX} />) as HTMLElement
      sample = createDrag(el, { axis: "x" })
      return el as unknown as JSX.Element
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await retryGesture(
      () => {
        el.dispatchEvent(new PointerEvent("pointerdown", { ...mouse, clientX: 0, clientY: 0, buttons: 1 }))
        el.dispatchEvent(new PointerEvent("pointermove", { ...mouse, clientX: 20, clientY: 15, buttons: 1 }))
        flush()
      },
      () => el.dispatchEvent(new PointerEvent("pointerup", { ...mouse, clientX: 20, clientY: 15, buttons: 0 })),
      () => (flush(), sample() !== null),
    )
    expect(sample()?.offset.y).toBe(0)
  })
})
