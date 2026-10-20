// Sensors on Solid 2 (#209 PR 3's Q1): each a ref that's also its reading, in real events. And the
// bridges they stand on.
//
// - SN1: `createHover`, given to `ref`: its reading flips on enter and back on leave.
// - SN2: beside a ward in a ref array: the ward animates and the sensor reads, on one element.
// - SN3: `createPress` flips on a press and back on its release.
// - SN4: `createFocus` follows focus and blur.
// - SN5: `createDrag` gives a drag's samples, `null` before the first.
// - SN6: given another element, a sensor follows that one, not the first.
// - SN7: disposed with its owner, a sensor reads nothing more.
// - SN8: `createReducedMotion` follows the user's preference.
// - SN9: `fromAtom` follows an Atom; `streamToSignal` a core Stream.
// - SN10: `createInView` is `true` for an element in the viewport, `false` for one below it.
import { DomLive } from "@wardic/dom"
import {
  createDrag,
  createFocus,
  createHover,
  createInView,
  createPress,
  createReducedMotion,
  fromAtom,
  streamToSignal,
  useWardicRuntime,
  ward,
  WardicProvider,
} from "@wardic/solid/unstable/v2"
import * as Schedule from "effect/Schedule"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/reactivity"
import { createSignal, flush, Show } from "solid-js"
import { commands } from "vitest/browser"
import { describe, expect, it } from "vitest"
import "../browser-commands.ts"
import { retryGesture, until } from "../browser-helpers.ts"
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

describe("sensors on Solid 2: refs that are their readings", () => {
  it("SN1: createHover flips on enter and back on leave", async () => {
    let hovered!: ReturnType<typeof createHover>
    let el!: HTMLElement
    const Box = () => {
      hovered = createHover()
      return <div ref={[hovered, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(hovered()).toBe(false)
    await takes(el, () => new PointerEvent("pointerenter", mouse), () => hovered(), "entered")
    el.dispatchEvent(new PointerEvent("pointerleave", mouse))
    await until(() => (flush(), !hovered()))
    expect(hovered()).toBe(false)
  })

  it("SN2: beside a ward in a ref array, both work on the one element", async () => {
    let hovered!: ReturnType<typeof createHover>
    let el!: HTMLElement
    const Box = () => {
      hovered = createHover()
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 } })
      return <div {...card} ref={[card, hovered, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => Number(el.style.opacity) >= 0.99)
    expect(Number(el.style.opacity)).toBeGreaterThan(0.99)
    await takes(el, () => new PointerEvent("pointerenter", mouse), () => hovered(), "entered")
  })

  it("SN3: createPress flips on a press and back on its release", async () => {
    let pressed!: ReturnType<typeof createPress>
    let el!: HTMLElement
    const Box = () => {
      pressed = createPress()
      return <div ref={[pressed, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await takes(el, () => new PointerEvent("pointerdown", { ...mouse, button: 0, buttons: 1, bubbles: true }), () => pressed(), "pressed")
    el.dispatchEvent(new PointerEvent("pointerup", { ...mouse, button: 0, buttons: 0, bubbles: true }))
    await until(() => (flush(), !pressed()))
    expect(pressed()).toBe(false)
  })

  it("SN4: createFocus follows focus and blur", async () => {
    let focused!: ReturnType<typeof createFocus>
    let el!: HTMLButtonElement
    const Box = () => {
      focused = createFocus()
      return <button ref={[focused, (n: HTMLButtonElement) => (el = n)]}>b</button>
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => {
      el.blur()
      el.focus()
      flush()
      return focused()
    })
    expect(focused()).toBe(true)
    el.blur()
    await until(() => (flush(), !focused()))
    expect(focused()).toBe(false)
  })

  it("SN5: createDrag gives a drag's samples, null before the first", async () => {
    let sample!: ReturnType<typeof createDrag>
    let el!: HTMLElement
    const Box = () => {
      sample = createDrag()
      return <div ref={[sample, (n: HTMLElement) => (el = n)]} style={{ width: "40px", height: "40px" }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(sample()).toBeNull()
    await retryGesture(
      () => {
        el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, buttons: 1, ...mouse }))
        el.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 0, buttons: 1, ...mouse }))
        flush()
      },
      () => el.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 0, buttons: 0, ...mouse })),
      () => (flush(), sample() !== null),
    )
    expect(sample()?.phase).toBe("start")
  })

  it("SN6: given another element, a sensor follows that one, not the first", async () => {
    const hovered = { current: undefined as ReturnType<typeof createHover> | undefined }
    const [second, setSecond] = createSignal(false)
    let a!: HTMLElement
    let b!: HTMLElement
    const Box = () => {
      const sensor = createHover()
      hovered.current = sensor
      return (
        <Show when={second()} fallback={<div ref={[sensor, (n: HTMLElement) => (a = n)]} />}>
          <div ref={[sensor, (n: HTMLElement) => (b = n)]} />
        </Show>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    setSecond(true)
    flush()
    await takes(b, () => new PointerEvent("pointerenter", mouse), () => hovered.current!(), "the second element's hover")
    b.dispatchEvent(new PointerEvent("pointerleave", mouse))
    await until(() => (flush(), !hovered.current!()))
    for (let i = 0; i < 5; i++) {
      a.dispatchEvent(new PointerEvent("pointerenter", mouse))
      await new Promise((r) => requestAnimationFrame(r))
    }
    flush()
    expect(hovered.current!(), "the first element is let go").toBe(false)
  })

  it("SN7: disposed with its owner, a sensor reads nothing more", async () => {
    let hovered!: ReturnType<typeof createHover>
    let el!: HTMLElement
    const [shown, setShown] = createSignal(true)
    const Box = () => {
      hovered = createHover()
      return <div ref={[hovered, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Show when={shown()}>
          <Box />
        </Show>
      </WardicProvider>
    ))
    await takes(el, () => new PointerEvent("pointerenter", mouse), () => hovered(), "entered")
    el.dispatchEvent(new PointerEvent("pointerleave", mouse))
    await until(() => (flush(), !hovered()))
    setShown(false)
    flush()
    for (let i = 0; i < 5; i++) {
      el.dispatchEvent(new PointerEvent("pointerenter", mouse))
      await new Promise((r) => requestAnimationFrame(r))
    }
    flush()
    expect(hovered(), "no recognizer left on the element").toBe(false)
  })

  it("SN8: createReducedMotion follows the user's preference", async () => {
    let reduced!: () => boolean
    const Probe = () => {
      reduced = createReducedMotion()
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Probe />
      </WardicProvider>
    ))
    try {
      await commands.emulateReducedMotion(true)
      await until(() => (flush(), reduced()))
      expect(reduced()).toBe(true)
      await commands.emulateReducedMotion(false)
      await until(() => (flush(), !reduced()))
      expect(reduced()).toBe(false)
    } finally {
      await commands.emulateReducedMotion(false)
    }
  })

  it("SN9: fromAtom follows an Atom; streamToSignal a core Stream", async () => {
    const atom = Atom.make(1)
    let fromIt!: () => number
    let ticks!: () => number
    let registry!: AtomRegistry.AtomRegistry
    const Probe = () => {
      fromIt = fromAtom(atom)
      ticks = streamToSignal(Stream.fromSchedule(Schedule.spaced("10 millis")).pipe(Stream.take(3)), -1)
      registry = useWardicRuntime().runSync(AtomRegistry.AtomRegistry)
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Probe />
      </WardicProvider>
    ))
    expect(fromIt()).toBe(1)
    registry.set(atom, 2)
    flush()
    expect(fromIt()).toBe(2)
    await until(() => (flush(), ticks() === 2))
    expect(ticks()).toBe(2)
  })

  it("SN10: createInView is true for an element in the viewport, false for one below it", async () => {
    let shown!: ReturnType<typeof createInView>
    let below!: ReturnType<typeof createInView>
    const Box = () => {
      shown = createInView()
      below = createInView()
      return (
        <>
          <div ref={shown} style={{ width: "40px", height: "40px" }} />
          <div ref={below} style={{ position: "absolute", top: "5000px", width: "40px", height: "40px" }} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => (flush(), shown()))
    expect(shown()).toBe(true)
    expect(below()).toBe(false)
  })
})
