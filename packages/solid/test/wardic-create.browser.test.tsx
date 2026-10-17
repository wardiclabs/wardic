// wardic.create / wardic.<tag> tests in a REAL browser. Synchronous wiring
// (class/style passthrough, prop no-leak, mergeRefs, proxy caching, type-only
// gates) holds before any frame and is unchanged; spring animations swap the
// stubbed drive(N) for real-rAF invariant polling.
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { createSignal, type JSX } from "solid-js"
import { wardic, WardicProvider, type WardicValues } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

const animatesTo = async (el: HTMLElement, target: number): Promise<boolean> => {
  let sawMid = false
  await until(() => {
    const v = opacityOf(el)
    if (v > 0.01 && Math.abs(v - target) > 0.02) sawMid = true
    return Math.abs(v - target) <= 0.02
  })
  return sawMid
}

describe("wardic.create — element rendering + merge policy", () => {
  it("passes class + static style through, seeds initial opacity, and animates toward animate", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => (el = node)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          class="card"
          style={{ color: "red" }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))

    expect(el!.tagName).toBe("DIV")
    expect(el!.className).toBe("card")
    expect(el!.style.color).toBe("red")
    expect(opacityOf(el!)).toBe(0) // SSR-correct seed, pre-frame

    const sawMid = await animatesTo(el!, 1)
    expect(sawMid).toBe(true)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
    expect(el!.style.color).toBe("red") // static color survived the merge
  })

  it("does NOT leak motion props to the DOM", () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => (el = node)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileFocus={{ opacity: 0.5 }}
          layout
          layoutId="x"
        />
      </WardicProvider>
    ))
    expect(el!.hasAttribute("initial")).toBe(false)
    expect(el!.hasAttribute("animate")).toBe(false)
    expect(el!.hasAttribute("whilefocus")).toBe(false)
    expect(el!.hasAttribute("layout")).toBe(false)
    expect(el!.hasAttribute("layoutid")).toBe(false)
  })

  it("invokes the user ref AND ward's ref (mergeRefs)", () => {
    let userRefEl: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLElement) => (userRefEl = node)} initial={{ opacity: 0.4 }}>
          x
        </wardic.div>
      </WardicProvider>
    ))
    expect(userRefEl).toBeInstanceOf(HTMLElement)
    expect(opacityOf(userRefEl!)).toBe(0.4)
  })
})

describe("wardic.create — WardicValues typing (CSS + transform shorthands)", () => {
  it("typechecks + animates a mixed target (opacity/backgroundColor via CSS, x/scale via transform)", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
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

    expect(opacityOf(el!)).toBe(0) // seeded from initial, pre-frame
    await animatesTo(el!, 0.5)
    expect(opacityOf(el!)).toBeCloseTo(0.5, 1) // CSS path
    expect(el!.style.transform).toContain("translateX") // transform path
    expect(el!.style.transform).toContain("scale")
  })

  it("rejects a clearly-invalid value (// @ts-expect-error) — type-level only", () => {
    // @ts-expect-error scale is number | string, not boolean
    const _badValue: WardicValues = { scale: true }
    // @ts-expect-error notARealCssProp is not a CSS key nor a transform shorthand
    const _badKey: WardicValues = { notARealCssProp: 1 }
    void _badValue
    void _badKey
    expect(true).toBe(true)
  })
})

describe("wardic proxy", () => {
  it("caches components per tag (wardic.div === wardic.div)", () => {
    expect(wardic.div).toBe(wardic.div)
    expect(wardic.span).toBe(wardic.span)
    expect(wardic.div).not.toBe(wardic.span)
  })

  it("exposes create as a callable, and is itself callable: the use:wardic directive (ADR-0042)", () => {
    expect(typeof wardic.create).toBe("function")
    expect(typeof wardic, "called, it's the directive").toBe("function")
    expect(wardic.div, "a component read off the callable is still cached").toBe(wardic.div)
  })

  it("returns undefined for symbol access", () => {
    const sym = Symbol("nope")
    expect((wardic as unknown as Record<symbol, unknown>)[sym]).toBeUndefined()
  })
})

describe("wardic.create — component arg", () => {
  it("returns a component (no longer throws — see wardic-component.browser.test.tsx)", () => {
    const SomeComponent = (): JSX.Element => null
    expect(typeof wardic.create(SomeComponent)).toBe("function")
  })
})

describe("wardic.div — whileHover", () => {
  it("animates toward whileHover on pointerenter", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => (el = node)}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 0.2 }}
          whileHover={{ opacity: 1 }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))

    await until(() => Math.abs(opacityOf(el!) - 0.2) <= 0.05) // settle base
    expect(opacityOf(el!)).toBeCloseTo(0.2, 1)

    await until(() => {
      el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
      return opacityOf(el!) > 0.3
    })
    await until(() => opacityOf(el!) >= 0.99)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })
})

describe("wardic.div — tracked-value motion props (Solid prop reactivity)", () => {
  it("animate as a tracked expression retargets when its signal flips", async () => {
    let el: HTMLDivElement | undefined
    let setOpen: (v: boolean) => void = () => {}
    render(() => {
      const [open, setOpenSig] = createSignal(false)
      setOpen = setOpenSig
      return (
        <WardicProvider env={DomLive}>
          <wardic.div
            ref={(node: HTMLDivElement) => (el = node)}
            initial={{ opacity: 0 }}
            animate={Bool.match(open(), { onTrue: () => ({ opacity: 1 }), onFalse: () => ({ opacity: 0 }) })}
          >
            x
          </wardic.div>
        </WardicProvider>
      )
    })

    await until(() => opacityOf(el!) <= 0.05) // open false -> settles at 0
    expect(opacityOf(el!)).toBeCloseTo(0, 1)

    setOpen(true)
    const sawMid = await animatesTo(el!, 1)
    expect(sawMid).toBe(true)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })

  it("initial as a tracked value seeds at mount (read once, no mid-life re-seed)", async () => {
    let el: HTMLDivElement | undefined
    let setSeed: (v: number) => void = () => {}
    render(() => {
      const [seed, setSeedSig] = createSignal(0.4)
      setSeed = setSeedSig
      return (
        <WardicProvider env={DomLive}>
          <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: seed() }} animate={{ opacity: 0.4 }}>
            x
          </wardic.div>
        </WardicProvider>
      )
    })

    expect(opacityOf(el!)).toBe(0.4) // tracked-value seed at mount
    await until(() => Math.abs(opacityOf(el!) - 0.4) <= 0.05)
    expect(opacityOf(el!)).toBeCloseTo(0.4, 1)

    // animate is static 0.4 + initial read once -> no re-seed / no move.
    setSeed(0.9)
    await until(() => false, 600)
    expect(opacityOf(el!)).toBeCloseTo(0.4, 1)
  })

  it("a static animate prop still animates", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLDivElement) => (el = node)} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          x
        </wardic.div>
      </WardicProvider>
    ))

    expect(opacityOf(el!)).toBe(0)
    const sawMid = await animatesTo(el!, 1)
    expect(sawMid).toBe(true)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })
})

describe("wardic.div — reactive user `style` prop (non-animated keys)", () => {
  it("tracks a reactive `style` prop on a non-animated key and re-applies it on change", async () => {
    let el: HTMLDivElement | undefined
    let setLeft: (v: number) => void = () => {}
    render(() => {
      const [left, setLeftSig] = createSignal(10)
      setLeft = setLeftSig
      return (
        <WardicProvider env={DomLive}>
          <wardic.div
            ref={(node: HTMLDivElement) => (el = node)}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            // `left` is NOT an animated key — it lives only in the user style. A
            // reactive read here must be tracked (was frozen at setup before the fix).
            style={{ position: "absolute", left: `${left()}px` }}
          >
            x
          </wardic.div>
        </WardicProvider>
      )
    })
    await raf()
    expect(el!.style.left).toBe("10px")
    expect(el!.style.position).toBe("absolute")

    setLeft(120)
    await raf()
    expect(el!.style.left).toBe("120px") // reactive user style tracked + re-applied
    expect(el!.style.position).toBe("absolute") // other user keys preserved
  })

  it("a reactive user key coexists with the animated key (animated wins, user key tracked)", async () => {
    let el: HTMLDivElement | undefined
    let setLeft: (v: number) => void = () => {}
    render(() => {
      const [left, setLeftSig] = createSignal(0)
      setLeft = setLeftSig
      return (
        <WardicProvider env={DomLive}>
          <wardic.div
            ref={(node: HTMLDivElement) => (el = node)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ position: "absolute", left: `${left()}px` }}
          >
            x
          </wardic.div>
        </WardicProvider>
      )
    })
    // opacity (animated) climbs while left (user style) is independently reactive.
    await until(() => Number(el!.style.opacity) > 0.3)
    setLeft(80)
    await raf()
    expect(el!.style.left).toBe("80px")
    await until(() => Number(el!.style.opacity) >= 0.99)
    expect(Number(el!.style.opacity)).toBeCloseTo(1, 1) // animated key unaffected
    expect(el!.style.left).toBe("80px") // user key still applied after settle
  })
})
