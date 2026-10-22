// Dynamic variants and `custom` on Solid 1 (#277, ADR-0048): a variant that's a function of the
// element's `custom` (Motion's `(custom, current, velocity)`), a target's own transition, and the
// orchestration a variant's transition carries. Real frames.
//
// - DV1: a function variant resolves with the element's `custom`.
// - DV2: a `custom` change re-resolves it, and the value that changed animates.
// - DV3: a resolver is handed the element's values now and their velocities.
// - DV4: a resolver that returns another variant's name resolves to it.
// - DV5: a variant's own transition: each item's `delay` from its index (Motion's staggered list).
// - DV6: `inherit: true` lays it over the element's transition; without it, it replaces it.
// - DV7: a gesture's keys animate on the element's transition, not the base variant's.
// - DV8: `staggerChildren` in a parent variant's own transition staggers its Variant children.
// - DV9: `initial` names a function variant: the element starts where it resolves.
// - DV10: an `animate` map's own transition drives the animation to it.
import { cleanup, render } from "@solidjs/testing-library"
import * as Easing from "@wardic/core/Easing"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import * as Predicate from "effect/Predicate"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** The element's drawn x translation. */
const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** Render `ui` inside a provider; `q` finds a `data-k` element. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

/** Wait until `seconds` have passed since `from` (performance.now() ms). */
const until_ = async (from: number, seconds: number): Promise<void> => {
  while (performance.now() - from < seconds * 1000) await raf()
}

const SNAP = { type: "tween", duration: 0.05 } as const

describe("dynamic variants on Solid 1 (#277)", () => {
  it("DV1: a function variant resolves with the element's custom", async () => {
    const variants: WardicVariants = { at: (i: number) => ({ x: i * 10 }) }
    const q = mount(() => <wardic.div data-k="a" custom={3} variants={variants} initial={{ x: 0 }} animate="at" transition={SNAP} />)
    await until(() => Math.abs(xOf(q("a")) - 30) < 0.5, 2000)
    expect(xOf(q("a"))).toBeCloseTo(30, 0)
  })

  it("DV2: a custom change re-resolves it, and the value animates", async () => {
    const [i, setI] = createSignal(3)
    const variants: WardicVariants = { at: (n: number) => ({ x: n * 10 }) }
    const q = mount(() => <wardic.div data-k="a" custom={i()} variants={variants} initial={{ x: 0 }} animate="at" transition={SNAP} />)
    await until(() => Math.abs(xOf(q("a")) - 30) < 0.5, 2000)
    setI(5)
    await until(() => Math.abs(xOf(q("a")) - 50) < 0.5, 2000)
    expect(xOf(q("a"))).toBeCloseTo(50, 0)
  })

  it("DV3: a resolver is handed the element's values now and their velocities", async () => {
    const [name, setName] = createSignal("rest")
    const seen: Array<{ readonly current: Readonly<Record<string, number | string>>; readonly velocity: Readonly<Record<string, number>> }> = []
    const variants: WardicVariants = {
      rest: { x: 40 },
      next: (_custom: unknown, current, velocity) => {
        seen.push({ current, velocity })
        return { x: 0 }
      },
    }
    const q = mount(() => <wardic.div data-k="a" variants={variants} initial={{ x: 0 }} animate={name()} />)
    await frames(4)
    setName("next")
    // The Retarget's call: the one handed its values (its variant node also reads the variant's
    // transition through it, with none).
    const at = seen.find((call) => Predicate.isNotUndefined(call.current["x"]))
    expect(at, "called for the Retarget").toBeDefined()
    expect(at!.current["x"], "x mid-flight, its value now").toBeGreaterThan(0)
    expect(at!.current["x"]).toBeLessThan(40)
    expect(at!.velocity["x"], "its velocity, moving toward 40").toBeGreaterThan(0)
    await until(() => Math.abs(xOf(q("a"))) < 0.5, 3000)
  })

  it("DV4: a resolver that returns another variant's name resolves to it", async () => {
    const variants: WardicVariants = { big: { x: 40 }, pick: () => "big" }
    const q = mount(() => <wardic.div data-k="a" variants={variants} initial={{ x: 0 }} animate="pick" transition={SNAP} />)
    await until(() => Math.abs(xOf(q("a")) - 40) < 0.5, 2000)
    expect(xOf(q("a"))).toBeCloseTo(40, 0)
  })

  it("DV5: a variant's own transition: each item's delay from its index", async () => {
    const item: WardicVariants = {
      hidden: { opacity: 0 },
      visible: (i: number) => ({ opacity: 1, transition: { type: "tween", duration: 0.1, delay: i * 0.3 } }),
    }
    const q = mount(() => (
      <ul>
        <For each={[0, 1, 2]}>{(i) => <wardic.li data-k={`i${i}`} custom={i} variants={item} initial="hidden" animate="visible" />}</For>
      </ul>
    ))
    const t0 = performance.now()
    await until_(t0, 0.2)
    expect(opacityOf(q("i0")), "the first, on its way or there").toBeGreaterThan(0.9)
    expect(opacityOf(q("i2")), "the third still waits its 0.6 s").toBe(0)
    await until(() => opacityOf(q("i2")) > 0.99, 2000)
    expect(performance.now() - t0, "the third landed after its delay").toBeGreaterThan(600)
  })

  it("DV6: inherit: true lays it over the element's transition; without it, it replaces it", async () => {
    const linear = { type: "tween", duration: 0.6, easing: Easing.linear } as const
    const own = { to: { x: 100, transition: { inherit: true, delay: 0.2 } } } as const satisfies WardicVariants
    const replaced = { to: { x: 100, transition: { delay: 0.2 } } } as const satisfies WardicVariants
    const q = mount(() => (
      <>
        <wardic.div data-k="merged" variants={own} initial={{ x: 0 }} animate="to" transition={linear} />
        <wardic.div data-k="own" variants={replaced} initial={{ x: 0 }} animate="to" transition={linear} />
      </>
    ))
    const t0 = performance.now()
    await until_(t0, 0.15)
    expect(xOf(q("merged")), "the variant's delay holds it").toBe(0)
    await until_(t0, 0.5)
    // Merged: a linear 0.6 s tween from 0.2 s, so about half way at 0.5 s. Replaced: the default
    // spring from 0.2 s, far past half way by then.
    expect(xOf(q("merged")), "a linear tween, half way").toBeGreaterThan(35)
    expect(xOf(q("merged"))).toBeLessThan(65)
    expect(xOf(q("own")), "the default spring, not the element's tween").toBeGreaterThan(80)
  })

  it("DV7: a gesture's keys animate on the element's transition, not the base variant's", async () => {
    const variants = { rest: { opacity: 1, transition: { type: "tween", duration: 0.1, delay: 5 } } } as const satisfies WardicVariants
    const q = mount(() => <wardic.div data-k="a" variants={variants} initial={{ opacity: 1 }} animate="rest" whileHover={{ scale: 1.5 }} transition={SNAP} style={{ width: "40px", height: "40px" }} />)
    await frames(3)
    const el = q("a")
    const t0 = performance.now()
    // The recognizer attaches its listener asynchronously: re-dispatch until the hover's Retarget starts.
    await until(() => {
      el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
      return new DOMMatrix(getComputedStyle(el).transform).a > 1.4
    }, 1500)
    expect(new DOMMatrix(getComputedStyle(el).transform).a, "scaled on the element's quick tween").toBeGreaterThan(1.4)
    expect(performance.now() - t0, "not held by the variant's 5 s delay").toBeLessThan(1000)
  })

  it("DV8: staggerChildren in a parent variant's own transition staggers its children", async () => {
    const parent = { hidden: {}, show: { opacity: 1, transition: { staggerChildren: 0.3 } } } as const satisfies WardicVariants
    const child: WardicVariants = { hidden: { opacity: 0 }, show: { opacity: 1 } }
    const q = mount(() => (
      <wardic.ul variants={parent} initial="hidden" animate="show" transition={SNAP}>
        <For each={[0, 1, 2]}>{(i) => <wardic.li data-k={`c${i}`} variants={child} transition={SNAP} />}</For>
      </wardic.ul>
    ))
    const t0 = performance.now()
    await until_(t0, 0.25)
    expect(opacityOf(q("c0")), "the first started").toBeGreaterThan(0.5)
    expect(opacityOf(q("c2")), "the third waits its 0.6 s").toBe(0)
    await until(() => opacityOf(q("c2")) > 0.99, 2000)
  })

  it("DV9: initial names a function variant: the element starts where it resolves", async () => {
    const variants: WardicVariants = { enter: (d: number) => ({ x: d * 100 }), center: { x: 0 } }
    const q = mount(() => <wardic.div data-k="a" custom={-1} variants={variants} initial="enter" animate="center" transition={{ type: "tween", duration: 0.4 }} />)
    expect(xOf(q("a")), "starts at -100").toBeCloseTo(-100, 0)
    await until(() => Math.abs(xOf(q("a"))) < 0.5, 2000)
  })

  it("DV10: an animate map's own transition drives the animation to it", async () => {
    const q = mount(() => (
      <wardic.div data-k="a" initial={{ x: 0 }} animate={{ x: 100, transition: { type: "tween", duration: 0.6, easing: Easing.linear } }} />
    ))
    const t0 = performance.now()
    await until_(t0, 0.3)
    expect(xOf(q("a")), "a linear 0.6 s tween, half way, not the default spring").toBeGreaterThan(30)
    expect(xOf(q("a"))).toBeLessThan(70)
  })
})
