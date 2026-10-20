// A ward's gestures on Solid 2 (#209 PR 3a), in real events: `whileHover`, `whileTap`, and the
// recognizers behind them, each started the first time its target is set (#87, ADR-0040), as the
// Solid 1 binding's recognizers-when-wanted tests pin it. A recording Tracer counts each
// recognizer's span, one per start.
//
// - GE1: `whileHover` on a wardic.div: entering animates to it, leaving returns.
// - GE2: `whileTap` through a kept ward: a press animates to it, its release returns.
// - GE3: neither set: neither recognizer starts, and the element still animates.
// - GE4: `whileHover` set after mount starts hover once; unset and set again, it isn't started twice.
// - GE5: a ward moved to another element leaves its gesture behind: the hover state and the first
//   element's recognizer go with it.
import { DomLive } from "@wardic/dom"
import { ward, wardic, type WardConfig, type WardicEnv, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import * as Layer from "effect/Layer"
import * as Tracer from "effect/Tracer"
import { type Accessor, createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const mouse = { pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true } as const
const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

/** A recording Tracer, merged into the Environment: how many spans of a name it made. */
const recording = () => {
  const names: Array<string> = []
  const tracer = Tracer.make({
    span: (options) => {
      names.push(options.name)
      return new Tracer.NativeSpan(options)
    },
  })
  return { env: Layer.mergeAll(DomLive, Layer.succeed(Tracer.Tracer, tracer)) as WardicEnv, count: (name: string) => names.filter((n) => n === name).length }
}

/** Dispatch `event` on `el` each frame until `done()`, then check it was reached. */
const takes = async (el: Element, event: () => Event, done: () => boolean, what: string): Promise<void> => {
  await until(() => {
    el.dispatchEvent(event())
    return done()
  })
  expect(done(), what).toBe(true)
}

/** One element with a kept ward on `config`, in a provider over `env`. */
const box = (env: WardicEnv, config: Accessor<WardConfig>) => {
  let el!: HTMLElement
  const [shown, setShown] = createSignal(true)
  const Box = () => {
    const card = ward(config)
    return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} style={{ width: "40px", height: "40px" }} />
  }
  mount(() => <WardicProvider env={env}>{Bool.match(shown(), { onTrue: () => <Box />, onFalse: () => null })}</WardicProvider>)
  return { el: () => el, hide: () => (setShown(false), flush()) }
}

describe("a ward's gestures on Solid 2", () => {
  it("GE1: whileHover on a wardic.div: entering animates to it, leaving returns", async () => {
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} style={{ width: "40px", height: "40px" }} />
      </WardicProvider>
    ))
    await until(() => Math.abs(opacityOf(el) - 0.2) < 0.01)
    await takes(el, () => new PointerEvent("pointerenter", mouse), () => opacityOf(el) > 0.3, "hover takes")
    await until(() => opacityOf(el) >= 0.99)
    expect(opacityOf(el)).toBeGreaterThan(0.99)
    el.dispatchEvent(new PointerEvent("pointerleave", mouse))
    await until(() => Math.abs(opacityOf(el) - 0.2) < 0.001)
    expect(opacityOf(el)).toBeCloseTo(0.2, 2)
  })

  it("GE2: whileTap through a kept ward: a press animates to it, its release returns", async () => {
    const b = box(DomLive, () => ({ initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, whileTap: { opacity: 1 } }))
    await until(() => Math.abs(opacityOf(b.el()) - 0.2) < 0.01)
    await takes(b.el(), () => new PointerEvent("pointerdown", { ...mouse, button: 0, buttons: 1 }), () => opacityOf(b.el()) > 0.3, "press takes")
    b.el().dispatchEvent(new PointerEvent("pointerup", { ...mouse, button: 0, buttons: 0 }))
    await until(() => Math.abs(opacityOf(b.el()) - 0.2) < 0.001)
    expect(opacityOf(b.el())).toBeCloseTo(0.2, 2)
  })

  it("GE3: with neither set, neither recognizer starts, and the element still animates", async () => {
    const { env, count } = recording()
    const b = box(env, () => ({ initial: { opacity: 0 }, animate: { opacity: 1 } }))
    await until(() => opacityOf(b.el()) >= 0.99)
    expect(opacityOf(b.el())).toBeGreaterThan(0.99)
    b.el().dispatchEvent(new PointerEvent("pointerenter", mouse))
    for (let i = 0; i < 3; i++) await raf()
    expect(count("wardic.hover")).toBe(0)
    expect(count("wardic.press")).toBe(0)
  })

  it("GE4: whileHover set after mount starts hover once; unset and set again, it isn't started twice", async () => {
    const { env, count } = recording()
    const [hoverable, setHoverable] = createSignal(false)
    const b = box(env, () => ({ initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, ...Bool.match(hoverable(), { onTrue: () => ({ whileHover: { opacity: 1 } }), onFalse: () => ({}) }) }))
    await until(() => Math.abs(opacityOf(b.el()) - 0.2) < 0.01)
    expect(count("wardic.hover"), "not wanted yet").toBe(0)
    setHoverable(true)
    flush()
    for (let i = 0; i < 2; i++) await raf()
    expect(count("wardic.hover"), "started once it appears").toBe(1)
    await takes(b.el(), () => new PointerEvent("pointerenter", mouse), () => opacityOf(b.el()) > 0.3, "hover takes")
    setHoverable(false)
    flush()
    setHoverable(true)
    flush()
    for (let i = 0; i < 2; i++) await raf()
    expect(count("wardic.hover"), "kept, not started again").toBe(1)
    expect(count("wardic.press"), "never wanted").toBe(0)
  })

  it("GE5: a ward moved to another element leaves its gesture behind: the hover state and the first element's recognizer", async () => {
    const { env, count } = recording()
    const [second, setSecond] = createSignal(false)
    let a!: HTMLElement
    let b!: HTMLElement
    const Box = () => {
      const card = ward({ animate: { opacity: 0.2 }, whileHover: { opacity: 1 }, style: { width: "40px", height: "40px" } })
      return (
        <Show when={second()} fallback={<div {...card} ref={[card, (n: HTMLElement) => (a = n)]} />}>
          <div {...card} ref={[card, (n: HTMLElement) => (b = n)]} />
        </Show>
      )
    }
    mount(() => (
      <WardicProvider env={env}>
        <Box />
      </WardicProvider>
    ))
    await takes(a, () => new PointerEvent("pointerenter", mouse), () => opacityOf(a) > 0.3, "hover takes")
    setSecond(true)
    flush()
    // The second element starts where the first was, and settles at `animate`: it isn't hovered.
    await until(() => Math.abs(opacityOf(b) - 0.2) < 0.001)
    expect(opacityOf(b), "the second element isn't hovered").toBeCloseTo(0.2, 2)
    // The first element hovered again, after it's gone: its recognizer was interrupted.
    for (let i = 0; i < 10; i++) {
      a.dispatchEvent(new PointerEvent("pointerenter", mouse))
      await raf()
    }
    expect(opacityOf(b), "the first element's recognizer is gone").toBeCloseTo(0.2, 2)
    expect(count("wardic.hover"), "a recognizer on each element").toBe(2)
  })
})
