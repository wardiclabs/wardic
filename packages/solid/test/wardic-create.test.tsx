// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { createSignal, type JSX } from "solid-js"
import { create, wardic, WardicProvider, type WardicValues } from "@wardic/solid"

/**
 * Deterministic rAF + macrotask settle harness — identical strategy to
 * use-wardic.test.tsx: BOTH the Clock's rAF loop and the gate's flush rAF are
 * hand-driven, and forked Effect fibers drain on a real macrotask turn.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number

beforeEach(() => {
  pending = new Map()
  nextId = 1
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const fireFrame = (t: number): void => {
  const batch = [...pending.values()]
  pending.clear()
  for (const cb of batch) cb(t)
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const settle = (): Promise<void> => tick()

const drive = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    fireFrame(i * 16)
    await tick()
  }
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

describe("wardic.create — element rendering + merge policy", () => {
  it("passes class + static style through, seeds initial opacity, and animates toward animate", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          class="card"
          style={{ color: "red" }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))

    // Element rendered with the user's class and static style preserved.
    expect(el!.tagName).toBe("DIV")
    expect(el!.className).toBe("card")
    expect(el!.style.color).toBe("red")
    // The initial opacity is present synchronously (SSR-correct seed, pre-frame).
    expect(opacityOf(el!)).toBe(0)

    // Drive frames: opacity animates toward 1.
    await settle()
    await drive(8)
    const mid = opacityOf(el!)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)

    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
    // Static color survived the animated-style merge (animated keys win, others kept).
    expect(el!.style.color).toBe("red")
  })

  it("does NOT leak motion props to the DOM", () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
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
        <wardic.div
          ref={(node: HTMLElement) => {
            userRefEl = node
          }}
          initial={{ opacity: 0.4 }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))
    // The user's ref received the live element...
    expect(userRefEl).toBeInstanceOf(HTMLElement)
    // ...and ward drove the same element (its initial style is present).
    expect(opacityOf(userRefEl!)).toBe(0.4)
  })
})

describe("wardic.create — WardicValues typing (CSS + transform shorthands)", () => {
  it("typechecks + animates a mixed target (opacity/backgroundColor via CSS, x/scale via transform)", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          initial={{ opacity: 0, x: 0, scale: 1, "background-color": "#000" }}
          // Mixed CSS props (opacity/background-color) + transform shorthands (x/scale).
          // This object MUST typecheck against WardicValues (JSX.CSSProperties &
          // transform shorthands) — both at the props level and the config level.
          // NOTE: JSX.CSSProperties == csstype.PropertiesHyphen, so the CSS key is
          // hyphenated (`background-color`, not `backgroundColor`).
          animate={{ opacity: 0.5, x: 100, scale: 1.1, "background-color": "#fff" }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))

    // Seeded opacity from initial (SSR-correct, pre-frame).
    expect(opacityOf(el!)).toBe(0)

    await settle()
    await drive(80)

    // opacity moved toward 0.5 (CSS path).
    expect(opacityOf(el!)).toBeCloseTo(0.5, 1)
    // x + scale flowed through the grouped `transform` string (transform path).
    expect(el!.style.transform).toContain("translateX")
    expect(el!.style.transform).toContain("scale")
  })

  it("rejects a clearly-invalid value (// @ts-expect-error) — type-level only", () => {
    // TYPE-LEVEL spot-check (never rendered): WardicValues narrows. A transform
    // shorthand is `number | string`, so a boolean is rejected; and because
    // JSX.CSSProperties (== csstype.PropertiesHyphen) only has a `-${string}`
    // index signature (CSS custom props / vendor prefixes), an arbitrary non-
    // hyphen key is ALSO rejected. We assert both via a typed binding rather than
    // by rendering (rendering would run the spine; this is purely a compile gate).
    // @ts-expect-error scale is number | string, not boolean
    const _badValue: WardicValues = { scale: true }
    // @ts-expect-error notARealCssProp is not a CSS key nor a transform shorthand
    const _badKey: WardicValues = { notARealCssProp: 1 }
    expect(true).toBe(true)
  })
})

describe("wardic proxy", () => {
  it("caches components per tag (wardic.div === wardic.div)", () => {
    expect(wardic.div).toBe(wardic.div)
    expect(wardic.span).toBe(wardic.span)
    expect(wardic.div).not.toBe(wardic.span)
  })

  it("exposes create as a callable", () => {
    expect(typeof wardic.create).toBe("function")
    expect(wardic.create).toBe(create)
  })

  it("returns undefined for symbol access", () => {
    const sym = Symbol("nope")
    expect((wardic as unknown as Record<symbol, unknown>)[sym]).toBeUndefined()
  })
})

describe("wardic.create — component arg", () => {
  it("returns a component (no longer throws — see wardic-component.test.tsx)", () => {
    const SomeComponent = (): JSX.Element => null
    expect(typeof create(SomeComponent)).toBe("function")
  })
})

describe("wardic.div — whileHover", () => {
  it("animates toward whileHover on pointerenter", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 0.2 }}
          whileHover={{ opacity: 1 }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))

    // Settle at the base 0.2 first.
    await settle()
    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(0.2, 1)

    // pointerenter -> hovered() flips; the recognizer attaches asynchronously,
    // so re-dispatch inside waitFor (draining the scheduler) until it moves.
    await waitFor(
      async () => {
        el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1 }))
        await drive(10)
        expect(opacityOf(el!)).toBeGreaterThan(0.2)
      },
      { timeout: 2000 },
    )
    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })
})

describe("wardic.div — tracked-value motion props (Solid prop reactivity)", () => {
  // Step 21f: motion props are plain VALUES, not accessors. Solid's reactive prop
  // getters already make a component prop tracked — reading `motion.animate`
  // inside motionToConfig's config accessor subscribes to the signals backing the
  // prop. So a TRACKED EXPRESSION (NOT a function) retargets when its signal flips.
  it("animate as a tracked expression retargets when its signal flips", async () => {
    let el: HTMLDivElement | undefined
    let setOpen: (v: boolean) => void = () => {}
    render(() => {
      const [open, setOpenSig] = createSignal(false)
      setOpen = setOpenSig
      return (
        <WardicProvider env={DomLive}>
          <wardic.div
            ref={(node: HTMLDivElement) => {
              el = node
            }}
            initial={{ opacity: 0 }}
            // A TRACKED EXPRESSION, not a function: reading open() here happens
            // inside the prop getter, so motionToConfig's accessor tracks it.
            animate={open() ? { opacity: 1 } : { opacity: 0 }}
          >
            x
          </wardic.div>
        </WardicProvider>
      )
    })

    // open() false: animate is { opacity: 0 } — settles at 0.
    await settle()
    await drive(40)
    expect(opacityOf(el!)).toBeCloseTo(0, 1)

    // Flip the signal: the prop getter yields the new value, the config accessor
    // recomputes, target() changes to 1, the override-stack memo drives a Retarget.
    setOpen(true)
    await drive(8)
    const mid = opacityOf(el!)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)

    await drive(80)
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
          <wardic.div
            ref={(node: HTMLDivElement) => {
              el = node
            }}
            // initial as a tracked value: read by the hook via untrack(cfg) ONCE
            // at mount — seeds the current seed() (0.4) and never re-seeds.
            initial={{ opacity: seed() }}
            animate={{ opacity: 0.4 }}
          >
            x
          </wardic.div>
        </WardicProvider>
      )
    })

    // The tracked-value initial seeded the projected style at mount (pre-frame).
    expect(opacityOf(el!)).toBe(0.4)

    await settle()
    await drive(40)
    expect(opacityOf(el!)).toBeCloseTo(0.4, 1)

    // Flip the seed signal. animate is a STATIC 0.4 and initial was read once at
    // mount — initial is the seed, not a live target, so no re-seed / no move.
    setSeed(0.9)
    await drive(40)
    expect(opacityOf(el!)).toBeCloseTo(0.4, 1)
  })

  it("a static animate prop still animates", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))

    // Seeded from the static initial (pre-frame).
    expect(opacityOf(el!)).toBe(0)

    await settle()
    await drive(8)
    const mid = opacityOf(el!)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)

    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })
})
