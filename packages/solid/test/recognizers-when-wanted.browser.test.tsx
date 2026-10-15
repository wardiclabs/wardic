// An element starts its hover and press State recognizers only once it wants them (#87,
// ADR-0040, decision 1): the first time `whileHover` / `whileTap` appears, kept from then on
// (Motion's rule). A recording Tracer in the Environment counts each recognizer's span, one per
// start.
//
// - WW1: an element with neither starts neither, and still animates.
// - WW2: `whileHover` set after mount starts hover once, which then drives the hover target;
//   unset and set again, it isn't started a second time, and still tracks the pointer (it lives with
//   the element, not with the computation that started it). Press is never started.
// - WW3: `whileTap` at mount starts press only, which drives the tap target.
import { cleanup, render } from "@solidjs/testing-library"
import * as Layer from "effect/Layer"
import * as Tracer from "effect/Tracer"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { createSignal } from "solid-js"
import { useWardic, type WardicConfig, type WardicEnv, WardicProvider } from "@wardic/solid"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

/** A recording Tracer, merged into the Environment: the names of the spans it made. */
const recording = () => {
  const names: Array<string> = []
  const tracer = Tracer.make({
    span: (options) => {
      names.push(options.name)
      return new Tracer.NativeSpan(options)
    },
  })
  const count = (name: string): number => names.filter((n) => n === name).length
  return { env: Layer.mergeAll(DomLive, Layer.succeed(Tracer.Tracer, tracer)), count }
}

const opacityOf = (el: HTMLElement | undefined): number => Number(el!.style.opacity)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** One element on `useWardic` with the config `config()` reads, in a provider over `env`. */
const mount = (env: WardicEnv, config: () => WardicConfig): { readonly el: () => HTMLElement | undefined } => {
  let el: HTMLElement | undefined
  render(() => {
    function C() {
      const ward = useWardic(config)
      return <div {...ward({ ref: (node) => (el = node) })} style={{ width: "40px", height: "40px" }} />
    }
    return (
      <WardicProvider env={env}>
        <C />
      </WardicProvider>
    )
  })
  return { el: () => el }
}

describe("State recognizers start when wanted (#87)", () => {
  it("WW1: an element with neither whileHover nor whileTap starts neither recognizer, and still animates", async () => {
    const { env, count } = recording()
    const { el } = mount(env, () => ({ initial: { opacity: 0 }, animate: { opacity: 1 } }))
    await until(() => opacityOf(el()) >= 0.99)
    el()!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
    el()!.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true, isPrimary: true, button: 0 }))
    await frames(3)
    expect(count("wardic.hover")).toBe(0)
    expect(count("wardic.press")).toBe(0)
  })

  it("WW2: whileHover set after mount starts hover once, which then drives it; unset and set again, it isn't started twice", async () => {
    const { env, count } = recording()
    const [hoverable, setHoverable] = createSignal(false)
    const { el } = mount(env, () => ({
      initial: { opacity: 0.2 },
      animate: { opacity: 0.2 },
      ...(hoverable() ? { whileHover: { opacity: 1 } } : {}),
    }))
    await until(() => Math.abs(opacityOf(el()) - 0.2) < 0.01)
    expect(count("wardic.hover"), "not wanted yet").toBe(0)

    setHoverable(true)
    await frames(2)
    expect(count("wardic.hover"), "started once it appears").toBe(1)
    // The recognizer attaches its listener asynchronously: enter each frame until it takes.
    await until(() => {
      el()!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
      return opacityOf(el()) > 0.3
    })
    await until(() => opacityOf(el()) >= 0.99)

    setHoverable(false)
    await frames(2)
    setHoverable(true)
    await frames(2)
    expect(count("wardic.hover"), "kept, not started again").toBe(1)
    expect(count("wardic.press"), "never wanted").toBe(0)
    // Still alive: it lives with the element, not with the computation that started it.
    el()!.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, bubbles: true }))
    await until(() => opacityOf(el()) <= 0.25)
    el()!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
    await until(() => opacityOf(el()) >= 0.99)
  })

  it("WW3: whileTap at mount starts press only, which drives the tap target", async () => {
    const { env, count } = recording()
    const { el } = mount(env, () => ({ initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, whileTap: { opacity: 1 } }))
    await until(() => Math.abs(opacityOf(el()) - 0.2) < 0.01)
    expect(count("wardic.press")).toBe(1)
    expect(count("wardic.hover")).toBe(0)
    await until(() => {
      el()!.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true, isPrimary: true, button: 0 }))
      return opacityOf(el()) > 0.3
    })
  })
})
