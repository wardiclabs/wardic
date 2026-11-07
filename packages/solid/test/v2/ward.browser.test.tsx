// `ward(config)` on Solid 2 (#209): a ref carrying its props, over the Solid 1 binding's spine. Its
// forms (a kept ward spread, a ref), its Starting style, its animation in real frames, a reactive
// config, and a config change that resolves the same target. The inline spread's error is pinned in
// ward-tracked.browser.test.tsx (a throw halts Solid 2's reactivity for the page).
//
// - W1: a kept ward, spread, renders the Starting style before any frame, then animates to
//   `animate`; the ward is the element's ref.
// - W2: a ward made in a `<For>` callback, spread: the same, per item.
// - W3: `ref={ward(config)}`, inline: it animates once mounted.
// - W4: `ref={[card, myRef]}`: the user's ref gets the element too.
// - W5: a key's accessor Retargets on a change; a `style` change, resolving the same target, doesn't (#259).
// - W6: the props a spread applies are `ref`, `style` and attributes only: `read`, `atom` and `Provider` aren't.
// - W7: unmounting a ward ends its legs: an endless tween leaves the Frame loop with nothing running.
// - W8: a ward with variants of its own, whose `when` gate reads its config: a `style` change in
//   that config still doesn't Retarget.
import * as FrameLoop from "@wardic/core/FrameLoop"
import { DomLive } from "@wardic/dom"
import { WardicProvider, ward } from "@wardic/solid/unstable/v2"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Metric from "effect/Metric"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

/** The opacity the gate last committed onto `el`. */
const opacity = (el: Element | null | undefined): number => Number((el as HTMLElement).style.opacity)

describe("ward(config) on Solid 2", () => {
  it("W1: a kept ward, spread, renders the Starting style before any frame, then animates to animate", async () => {
    let card: ReturnType<typeof ward> | undefined
    const Card = () => {
      card = ward({ initial: { opacity: 0.2 }, animate: { opacity: 0.8 } })
      return <div {...card} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    const el = host.firstElementChild as HTMLElement
    expect(el.style.opacity).toBe("0.2")
    expect(card!.ref).toBe(card)
    await until(() => Math.abs(opacity(el) - 0.8) < 0.001)
    expect(opacity(el)).toBeCloseTo(0.8, 2)
  })

  it("W2: a ward made in a <For> callback, spread: the same, per item", async () => {
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <For each={[0.3, 0.6]}>
          {(to) => {
            const item = ward({ initial: { opacity: 0 }, animate: { opacity: to } })
            return <li {...item} />
          }}
        </For>
      </WardicProvider>
    ))
    const [a, b] = Array.from(host.querySelectorAll("li"))
    expect(a!.style.opacity).toBe("0")
    await until(() => Math.abs(opacity(a) - 0.3) < 0.001 && Math.abs(opacity(b) - 0.6) < 0.001)
    expect(opacity(a)).toBeCloseTo(0.3, 2)
    expect(opacity(b)).toBeCloseTo(0.6, 2)
  })

  it("W3: ref={ward(config)} animates once mounted", async () => {
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div ref={ward({ initial: { opacity: 0 }, animate: { opacity: 1 } })} />
      </WardicProvider>
    ))
    const el = host.firstElementChild as HTMLElement
    await until(() => opacity(el) > 0.99)
    expect(opacity(el)).toBeGreaterThan(0.99)
  })

  it("W4: ref={[card, myRef]}: the user's ref gets the element too", async () => {
    let mine: HTMLElement | undefined
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div ref={[ward({ animate: { opacity: 0.5 } }), (el: HTMLElement) => (mine = el)]} />
      </WardicProvider>
    ))
    const el = host.firstElementChild as HTMLElement
    expect(mine).toBe(el)
    await until(() => Math.abs(opacity(el) - 0.5) < 0.001)
    expect(opacity(el)).toBeCloseTo(0.5, 2)
  })

  it("W5: a key's accessor Retargets on a change; a style change resolving the same target doesn't", async () => {
    const [open, setOpen] = createSignal(false)
    const [color, setColor] = createSignal("red")
    let retargets = 0
    const Card = () => {
      const card = ward({
        initial: { opacity: 0 },
        animate: () => ({ opacity: Number(open()) }),
        style: () => ({ color: color() }),
        onUpdate: () => {
          retargets++
        },
      })
      return <div {...card} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    const el = host.firstElementChild as HTMLElement
    await raf()
    await raf()
    expect(opacity(el)).toBe(0)
    setOpen(true)
    flush()
    // Settled exactly: a style change re-renders `style`, and moves nothing.
    await until(() => opacity(el) === 1)
    await raf()
    await raf()
    const before = retargets
    setColor("blue")
    flush()
    await raf()
    await raf()
    expect(el.style.color).toBe("blue")
    expect(retargets).toBe(before)
  })

  it("W6: a spread applies ref, style and attributes only", () => {
    let card: ReturnType<typeof ward> | undefined
    const Card = () => {
      card = ward({ initial: { opacity: 0 } })
      return <div {...card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    expect(Object.keys(card!).sort()).toEqual(["ref", "style"])
    expect(typeof card!.read).toBe("function")
    expect(typeof card!.atom).toBe("function")
    expect(typeof card!.Provider).toBe("function")
  })

  it("W7: unmounting a ward ends its legs: an endless tween leaves the Frame loop with nothing running", async () => {
    // Read through the loop's metrics, which the provider is given (#518).
    const running = (): number | undefined =>
      (Effect.runSync(Metric.snapshot).find((m) => m.id === "wardic_frameloop_animations")?.state as Metric.GaugeState<number> | undefined)?.value
    const [shown, setShown] = createSignal(true)
    let el!: HTMLElement
    const Card = () => {
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { type: "tween", duration: 0.4, repeat: Infinity } })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={Layer.mergeAll(DomLive, FrameLoop.layerMetrics)}>
        <Show when={shown()}>
          <Card />
        </Show>
      </WardicProvider>
    ))
    await until(() => Number(el.style.opacity) > 0.2)
    expect(running()).toBeGreaterThan(0)
    setShown(false)
    flush()
    await until(() => running() === 0, 1000)
    expect(running()).toBe(0)
  })

  it("W8: a ward with variants of its own: a style change in its config doesn't Retarget", async () => {
    const [color, setColor] = createSignal("red")
    let commits = 0
    let el!: HTMLElement
    const Card = () => {
      const card = ward({
        initial: "hidden",
        animate: "shown",
        variants: { hidden: { opacity: 0 }, shown: { opacity: 1 } },
        transition: { when: "beforeChildren" as const },
        style: () => ({ color: color() }),
        onUpdate: () => {
          commits++
        },
      })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "1")
    await raf()
    await raf()
    const before = commits
    setColor("blue")
    flush()
    await raf()
    await raf()
    expect(el.style.color).toBe("blue")
    expect(commits).toBe(before)
  })
})
