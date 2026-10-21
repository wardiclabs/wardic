// `wardic.<tag>` and `wardic.create` on Solid 2 (#209), as the Solid 1 binding's wardic-create and
// wardic-component tests pin them (their `whileHover` cases wait for Solid 2's gestures, PR 3):
//
// - WC1–WC3: the element, its class and style, its seed and animation, no motion prop in the DOM,
//   the user's ref with the ward's.
// - WC4: a mixed target (CSS keys and transform keys).
// - WC5: the proxy: one component per tag, `create`, nothing for a symbol; no directive (Solid 2 has none).
// - WC6–WC8: tracked props: `animate` Retargets on a flip, `initial` is read once, a static one animates.
// - WC9–WC10: a reactive user `style` on a key Wardic doesn't animate, alone and beside one it does.
// - WCC1–WCC3: `wardic.create(Component)`: the forwarded element animates, the user's ref gets it,
//   and a component that never forwards its ref is a clear error.
// - WC11: `onAnimationStart` / `onAnimationComplete` aren't motion props on Solid 2 (#257: its async
//   value replaces them): `onAnimationStart` is the DOM's CSS `animationstart` event, and an
//   animation of the ward's calls neither.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicValues } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import type { JSX } from "@solidjs/web"
import { createSignal, Errored, flush } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

/** Wait for `el`'s opacity to reach `target`; whether it passed through a value in between. */
const animatesTo = async (el: HTMLElement, target: number): Promise<boolean> => {
  let sawMid = false
  await until(() => {
    const v = opacityOf(el)
    if (v > 0.01 && Math.abs(v - target) > 0.02) sawMid = true
    return Math.abs(v - target) <= 0.02
  })
  return sawMid
}

describe("wardic.<tag>: the element and the merge policy", () => {
  it("WC1: passes class and style through, seeds initial opacity, and animates toward animate", async () => {
    let el: HTMLDivElement | undefined
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} class="card" style={{ color: "red" }}>
          x
        </wardic.div>
      </WardicProvider>
    ))
    expect(el!.tagName).toBe("DIV")
    expect(el!.className).toBe("card")
    expect(el!.style.color).toBe("red")
    expect(opacityOf(el!)).toBe(0)
    expect(await animatesTo(el!, 1)).toBe(true)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
    expect(el!.style.color).toBe("red")
  })

  it("WC2: no motion prop reaches the DOM", () => {
    let el: HTMLDivElement | undefined
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileFocus={{ opacity: 0.5 }} variants={{}} transition={{ type: "tween", duration: 1 }} />
      </WardicProvider>
    ))
    for (const name of ["initial", "animate", "whilefocus", "variants", "transition"]) expect(el!.hasAttribute(name)).toBe(false)
  })

  it("WC3: the user's ref gets the element, which the ward drives", () => {
    let userRefEl: HTMLElement | undefined
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLElement) => (userRefEl = node)} initial={{ opacity: 0.4 }}>
          x
        </wardic.div>
      </WardicProvider>
    ))
    expect(userRefEl).toBeInstanceOf(HTMLElement)
    expect(opacityOf(userRefEl!)).toBe(0.4)
  })

  it("WC4: a mixed target: CSS keys and transform keys", async () => {
    let el: HTMLDivElement | undefined
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => (el = node)}
          initial={{ opacity: 0, x: 0, scale: 1, "background-color": "#000" }}
          animate={{ opacity: 0.5, x: 100, scale: 1.1, "background-color": "#fff" }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))
    expect(opacityOf(el!)).toBe(0)
    await animatesTo(el!, 0.5)
    expect(opacityOf(el!)).toBeCloseTo(0.5, 1)
    expect(el!.style.transform).toContain("translateX")
    expect(el!.style.transform).toContain("scale")
    // @ts-expect-error scale is number | string, not boolean
    const badValue: WardicValues = { scale: true }
    void badValue
  })
})

describe("wardic.<tag>: Motion's animation callbacks are Solid 1's (#257)", () => {
  it("WC11: onAnimationStart is the DOM's animationstart event, and the ward's animation calls neither", async () => {
    let el: HTMLDivElement | undefined
    const calls: Array<string> = []
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => (el = node)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: "tween", duration: 0.1 }}
          onAnimationStart={(event: AnimationEvent) => calls.push(`start ${event.animationName}`)}
          onAnimationEnd={(event: AnimationEvent) => calls.push(`end ${event.animationName}`)}
        />
      </WardicProvider>
    ))
    expect(await animatesTo(el!, 1)).toBe(true)
    for (let i = 0; i < 3; i++) await raf()
    expect(calls, "the ward's own animation calls neither").toEqual([])
    el!.dispatchEvent(new AnimationEvent("animationstart", { animationName: "pulse", bubbles: true }))
    expect(calls).toEqual(["start pulse"])
  })
})

describe("wardic proxy", () => {
  it("WC5: one component per tag, create, nothing for a symbol, and no directive", () => {
    expect(wardic.div).toBe(wardic.div)
    expect(wardic.div).not.toBe(wardic.span)
    expect(typeof wardic.create).toBe("function")
    expect(typeof wardic, "Solid 2 has no directives: wardic isn't callable").toBe("object")
    expect((wardic as unknown as Record<symbol, unknown>)[Symbol("nope")]).toBeUndefined()
  })
})

describe("wardic.<tag>: tracked props", () => {
  it("WC6: animate as a tracked expression retargets when its signal flips", async () => {
    let el: HTMLDivElement | undefined
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => (el = node)}
          initial={{ opacity: 0 }}
          animate={Bool.match(open(), { onTrue: () => ({ opacity: 1 }), onFalse: () => ({ opacity: 0 }) })}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))
    await raf()
    await raf()
    expect(opacityOf(el!)).toBe(0)
    setOpen(true)
    flush()
    expect(await animatesTo(el!, 1)).toBe(true)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })

  it("WC7: initial as a tracked value seeds at mount, read once", async () => {
    let el: HTMLDivElement | undefined
    const [seed, setSeed] = createSignal(0.4)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: seed() }} animate={{ opacity: 0.4 }}>
          x
        </wardic.div>
      </WardicProvider>
    ))
    expect(opacityOf(el!)).toBe(0.4)
    setSeed(0.9)
    flush()
    await until(() => false, 300)
    expect(opacityOf(el!)).toBeCloseTo(0.4, 2)
  })

  it("WC8: a static animate prop animates", async () => {
    let el: HTMLDivElement | undefined
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          x
        </wardic.div>
      </WardicProvider>
    ))
    expect(opacityOf(el!)).toBe(0)
    expect(await animatesTo(el!, 1)).toBe(true)
  })
})

describe("wardic.<tag>: a reactive user style (keys Wardic doesn't animate)", () => {
  it("WC9: a reactive style key is tracked and re-applied", async () => {
    let el: HTMLDivElement | undefined
    const [left, setLeft] = createSignal(10)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: 1 }} animate={{ opacity: 1 }} style={{ position: "absolute", left: `${left()}px` }}>
          x
        </wardic.div>
      </WardicProvider>
    ))
    await raf()
    expect(el!.style.left).toBe("10px")
    expect(el!.style.position).toBe("absolute")
    setLeft(120)
    flush()
    expect(el!.style.left).toBe("120px")
    expect(el!.style.position).toBe("absolute")
  })

  it("WC10: a reactive user key beside an animated one: both hold, through the first commit and after the settle", async () => {
    let el: HTMLDivElement | undefined
    const [left, setLeft] = createSignal(0)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ position: "absolute", left: `${left()}px` }}>
          x
        </wardic.div>
      </WardicProvider>
    ))
    await until(() => Number(el!.style.opacity) > 0.3)
    setLeft(80)
    flush()
    await raf()
    expect(el!.style.left).toBe("80px")
    await until(() => Number(el!.style.opacity) >= 0.99)
    expect(Number(el!.style.opacity)).toBeCloseTo(1, 1)
    expect(el!.style.left).toBe("80px")
  })
})

describe("wardic.create(Component): the ward on the forwarded element", () => {
  it("WCC1: animates the forwarded element's opacity 0 -> 1 over real frames", async () => {
    let el: HTMLElement | undefined
    const Card = (p: { readonly ref?: JSX.Ref<HTMLDivElement> }): JSX.Element => <div ref={[p.ref, (node: HTMLDivElement) => (el = node)]}>card</div>
    const W = wardic.create(Card)
    mount(() => (
      <WardicProvider env={DomLive}>
        <W initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      </WardicProvider>
    ))
    expect(el).toBeInstanceOf(HTMLElement)
    expect(await animatesTo(el!, 1)).toBe(true)
  })

  it("WCC2: the user's ref gets the forwarded element, once", () => {
    let userEl: HTMLElement | undefined
    const userRef = vi.fn<(node: HTMLElement) => void>((node) => {
      userEl = node
    })
    const Card = (p: { readonly ref?: JSX.Ref<HTMLDivElement> }): JSX.Element => <div ref={p.ref}>card</div>
    const W = wardic.create(Card)
    mount(() => (
      <WardicProvider env={DomLive}>
        <W ref={userRef} initial={{ opacity: 0.4 }} />
      </WardicProvider>
    ))
    expect(userRef).toHaveBeenCalledTimes(1)
    expect(userEl).toBeInstanceOf(HTMLElement)
  })

  it("WCC3: a component that never forwards its ref is the actionable ADR-0008 error", async () => {
    const Bad = (): JSX.Element => <div>bad</div>
    const W = wardic.create(Bad)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Errored fallback={(error) => <p>{String(error())}</p>}>
          <W initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        </Errored>
      </WardicProvider>
    ))
    await until(() => host.querySelector("p") !== null)
    expect(host.querySelector("p")?.textContent).toMatch(/did not forward its ref.*props\.ref/)
  })
})
