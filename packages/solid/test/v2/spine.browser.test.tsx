// The shared spine (`src/spine.ts`) through the Solid 2 ward (#209): each feature the Solid 1
// binding's suites pin in depth, once, through `ward()`'s own wiring (its config accessor, its
// effect, its Live-value watches under its owner, its gate sink).
//
// - SP1: a string key blends: a colour from `initial` to `animate`, through colours in between.
// - SP2: a `var()` end blends what it resolves to on the element, and rests as the `var()` (#55).
// - SP3: a key no layer sets any more returns to its Base value: its `style` value (ADR-0022).
// - SP4: an uncalled accessor in `style` is a Live value: followed through the gate, with no run of
//   the element's `style` (#130).
// - SP5: `read(key)` follows what the gate writes, and gives where the key rests outside it.
// - SP6: `onUpdate` hears each committed frame's values (#233).
// - SP7: a transition change alone doesn't Retarget a running tween: it applies from the next
//   change (`sameResolution`, Motion's rule).
import { DomLive } from "@wardic/dom"
import { ward, WardicProvider, type WardicValues } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import type { JSX } from "@solidjs/web"
import { createEffect, createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const TWEEN = { type: "tween", duration: 0.3 } as const

/** A computed colour's channels. */
const rgbOf = (colour: string): ReadonlyArray<number> => /\(([^)]+)\)/.exec(colour)![1]!.split(",").slice(0, 3).map(Number)

/** Mount `Card` under a provider; its element, once mounted, from the `bind` ref it's handed. */
const mountCard = (Card: (props: { readonly bind: (el: HTMLElement) => void }) => JSX.Element) => {
  let el!: HTMLElement
  mount(() => (
    <WardicProvider env={DomLive}>
      <Card bind={(n) => (el = n)} />
    </WardicProvider>
  ))
  return () => el
}

describe("the shared spine, through the Solid 2 ward", () => {
  it("SP1: a string key blends from initial to animate", async () => {
    const el = mountCard(({ bind }) => {
      const card = ward({ initial: { "background-color": "#ff0000" } as WardicValues, animate: { "background-color": "#0000ff" } as WardicValues, transition: TWEEN })
      return <div {...card} ref={[card, bind]} />
    })
    const between: Array<ReadonlyArray<number>> = []
    await until(() => {
      const [r, , b] = rgbOf(getComputedStyle(el()).backgroundColor)
      if (r! > 10 && r! < 245 && b! > 10 && b! < 245) between.push([r!, b!])
      return b === 255 && r === 0
    })
    expect(between.length, "frames in between").toBeGreaterThan(3)
    expect(rgbOf(getComputedStyle(el()).backgroundColor)).toEqual([0, 0, 255])
  })

  it("SP2: a var() end blends what it resolves to on the element, and rests as the var()", async () => {
    let el!: HTMLElement
    const [on, setOn] = createSignal(false)
    const Card = () => {
      const card = ward({
        initial: { "background-color": "#ff0000" } as WardicValues,
        animate: () => Bool.match(on(), { onTrue: () => ({ "background-color": "var(--brand)" }) as WardicValues, onFalse: () => ({ "background-color": "#ff0000" }) as WardicValues }),
        transition: TWEEN,
      })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ "--brand": "#0000ff" }}>
          <Card />
        </div>
      </WardicProvider>
    ))
    await raf()
    await raf()
    setOn(true)
    flush()
    let between = 0
    await until(() => {
      const [r, , b] = rgbOf(getComputedStyle(el).backgroundColor)
      if (r! > 10 && r! < 245 && b! > 10 && b! < 245) between++
      return el.style.backgroundColor === "var(--brand)"
    })
    expect(between, "frames in between").toBeGreaterThan(3)
    expect(el.style.backgroundColor).toBe("var(--brand)")
  })

  it("SP3: a key no layer sets any more returns to its style value", async () => {
    let el!: HTMLElement
    const [dim, setDim] = createSignal(true)
    const Card = () => {
      const card = ward({
        animate: () => Bool.match(dim(), { onTrue: () => ({ opacity: 0.2 }), onFalse: () => ({}) }),
        style: { opacity: 0.8 },
        transition: TWEEN,
      })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "0.2")
    expect(el.style.opacity).toBe("0.2")
    setDim(false)
    flush()
    await until(() => el.style.opacity === "0.8")
    expect(el.style.opacity).toBe("0.8")
  })

  it("SP4: an uncalled accessor in style is followed through the gate, with no run of the element's style", async () => {
    let el!: HTMLElement
    let styleRuns = 0
    const [x, setX] = createSignal(10)
    const Card = () => {
      const card = ward({ style: { x, color: "rgb(255, 0, 0)" } })
      createEffect(
        () => card.style,
        () => {
          styleRuns++
        },
        { defer: true },
      )
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    expect(el.style.transform).toBe("translateX(10px)")
    await raf()
    await raf()
    const runs = styleRuns
    setX(50)
    flush()
    await until(() => el.style.transform === "translateX(50px)")
    expect(el.style.transform).toBe("translateX(50px)")
    setX(70)
    flush()
    await until(() => el.style.transform === "translateX(70px)")
    expect(styleRuns, "no run of style for a Live value's change").toBe(runs)
  })

  it("SP5: read(key) follows what the gate writes, and gives where the key rests outside it", async () => {
    let card!: ReturnType<typeof ward>
    const seen: Array<number> = []
    const Card = () => {
      card = ward({ initial: { x: 0 }, animate: { x: 100 }, transition: TWEEN, style: { opacity: 0.6 } })
      const x = card.read("x")
      createEffect(x, (value) => {
        seen.push(value)
      })
      return <div {...card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    expect(card.read("opacity")()).toBe(0.6)
    await until(() => seen[seen.length - 1] === 100)
    expect(seen.some((v) => v > 0 && v < 100), "values in between").toBe(true)
    expect(seen[seen.length - 1]).toBe(100)
  })

  it("SP6: onUpdate hears each committed frame's values", async () => {
    const heard: Array<number> = []
    const Card = () => {
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN, onUpdate: (latest) => void heard.push(Number(latest.opacity)) })
      return <div {...card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => heard[heard.length - 1] === 1)
    expect(heard.length).toBeGreaterThan(3)
    expect(heard[heard.length - 1]).toBe(1)
  })

  it("SP7: a transition change alone doesn't Retarget a running tween", async () => {
    let el!: HTMLElement
    const [duration, setDuration] = createSignal(0.6)
    const Card = () => {
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: () => ({ type: "tween", duration: duration() }) as const })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    const start = performance.now()
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => Number(el.style.opacity) > 0.3)
    // A Retarget would restart the tween from here on the new 3 s: it would land well after 1 s.
    setDuration(3)
    flush()
    await until(() => el.style.opacity === "1", 3000)
    expect(el.style.opacity).toBe("1")
    expect(performance.now() - start).toBeLessThan(1500)
  })
})
