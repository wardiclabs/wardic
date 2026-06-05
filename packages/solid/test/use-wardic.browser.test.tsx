// useWardic tests in a REAL browser. The old happy-dom version hand-drove BOTH
// rAF loops (Clock + gate) at a fixed cadence and asserted exact values at a
// calibrated frame count. Here the engine runs in REAL time: synchronous SSR/seed
// assertions stay (they hold before any frame), and every animation asserts a
// robust invariant (departs the seed, passes through, settles near target) by
// polling real frames. `ward().style` is the projected style object (no layout
// dependency), so those reads are identical to before — only the driver changed.
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DomLive } from "@wardic/dom"
import { type Accessor, createSignal, type JSX } from "solid-js"
import { useWardic, WardicProvider } from "@wardic/solid"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const opacityOf = (style: JSX.CSSProperties): number => Number(style.opacity)

describe("useWardic — SSR/initial", () => {
  it("renders the projected initial style synchronously (before any frame)", () => {
    let ward: ReturnType<typeof useWardic> | undefined
    render(() => {
      function C() {
        ward = useWardic({ initial: { opacity: 0 } })
        return <div {...ward()}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })
    expect(ward!().style).toEqual({ opacity: 0 })
  })

  it("resolves a string initial against variants", () => {
    let ward: ReturnType<typeof useWardic> | undefined
    render(() => {
      function C() {
        ward = useWardic({ initial: "hidden", variants: { hidden: { opacity: 0.25 } } })
        return <div {...ward()}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })
    expect(ward!().style).toEqual({ opacity: 0.25 })
  })

  it("seeds the projected style from a static initial map at mount", () => {
    let ward: ReturnType<typeof useWardic> | undefined
    render(() => {
      function C() {
        ward = useWardic({ initial: { opacity: 0.4 } })
        return <div {...ward()}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })
    expect(opacityOf(ward!().style)).toBe(0.4)
  })
})

describe("useWardic — animate", () => {
  it("moves opacity 0 -> 1 across real frames and settles near 1", async () => {
    let ward: ReturnType<typeof useWardic> | undefined
    render(() => {
      function C() {
        ward = useWardic({ initial: { opacity: 0 }, animate: { opacity: 1 } })
        return <div {...ward()}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })
    expect(opacityOf(ward!().style)).toBe(0) // pre-frame seed

    let sawMid = false
    await until(() => {
      const v = opacityOf(ward!().style)
      if (v > 0.01 && v < 0.99) sawMid = true
      return v >= 0.99
    })
    expect(sawMid).toBe(true) // animated through (not an instant jump)
    expect(opacityOf(ward!().style)).toBeCloseTo(1, 1)
  })
})

describe("useWardic — whileHover", () => {
  it("animates toward whileHover on pointerenter and reverts on pointerleave", async () => {
    let ward: ReturnType<typeof useWardic> | undefined
    let el: HTMLElement | undefined
    render(() => {
      function C() {
        ward = useWardic({
          initial: { opacity: 0.2 },
          animate: { opacity: 0.2 },
          whileHover: { opacity: 1 },
        })
        return <div {...ward({ ref: (node) => (el = node) })}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })

    await until(() => opacityOf(ward!().style) <= 0.25 && opacityOf(ward!().style) >= 0.15) // settle base 0.2
    expect(opacityOf(ward!().style)).toBeCloseTo(0.2, 1)

    // The recognizer attaches its listener asynchronously; re-dispatch each frame
    // until the hover override departs the base.
    await until(() => {
      el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
      return opacityOf(ward!().style) > 0.3
    })
    await until(() => opacityOf(ward!().style) >= 0.99)
    expect(opacityOf(ward!().style)).toBeCloseTo(1, 1)

    el!.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, bubbles: true }))
    await until(() => opacityOf(ward!().style) <= 0.25)
    expect(opacityOf(ward!().style)).toBeCloseTo(0.2, 1)
  })
})

describe("useWardic — reactive config (Accessor)", () => {
  it("retargets when a signal the accessor config depends on flips", async () => {
    let ward: ReturnType<typeof useWardic> | undefined
    let setOpen: (v: boolean) => void = () => {}
    render(() => {
      function C() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig
        ward = useWardic(() => ({
          initial: { opacity: 0 },
          animate: { opacity: open() ? 1 : 0 },
        }))
        return <div {...ward()}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })
    expect(opacityOf(ward!().style)).toBe(0) // pre-frame seed

    await raf()
    await until(() => opacityOf(ward!().style) <= 0.05) // settles at 0 (open false)
    expect(opacityOf(ward!().style)).toBeCloseTo(0, 1)

    setOpen(true) // target -> 1; override-stack drives a Retarget
    let sawMid = false
    await until(() => {
      const v = opacityOf(ward!().style)
      if (v > 0.01 && v < 0.99) sawMid = true
      return v >= 0.99
    })
    expect(sawMid).toBe(true)
    expect(opacityOf(ward!().style)).toBeCloseTo(1, 1)
  })

  it("initial is read once at setup — a signal in initial does NOT re-seed", async () => {
    let ward: ReturnType<typeof useWardic> | undefined
    let setSeed: (v: number) => void = () => {}
    render(() => {
      function C() {
        const [seed, setSeedSig] = createSignal(0.3)
        setSeed = setSeedSig
        ward = useWardic(() => ({
          initial: { opacity: seed() },
          animate: { opacity: seed() },
        }))
        return <div {...ward()}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })
    expect(opacityOf(ward!().style)).toBe(0.3) // seed read once at setup

    await raf()
    await until(() => Math.abs(opacityOf(ward!().style) - 0.3) <= 0.05) // base 0.3
    expect(opacityOf(ward!().style)).toBeCloseTo(0.3, 1)

    // animate IS reactive -> retargets toward 0.9, but the SEED was 0.3 (not
    // re-seeded): the value MOVES from 0.3 through the range (no jump-reseed).
    setSeed(0.9)
    let sawMid = false
    await until(() => {
      const v = opacityOf(ward!().style)
      if (v > 0.31 && v < 0.89) sawMid = true
      return v >= 0.89
    })
    expect(sawMid).toBe(true)
    expect(opacityOf(ward!().style)).toBeCloseTo(0.9, 1)
  })
})

describe("useWardic — teardown", () => {
  it("unmount tears down: no further style writes after unmount", async () => {
    let el: HTMLElement | undefined
    const dispose = render(() => {
      function C() {
        const ward = useWardic({ initial: { opacity: 0 }, animate: { opacity: 1 } })
        return <div {...ward({ ref: (node) => (el = node) })}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    }).unmount

    // Catch the spring mid-flight (writes are happening).
    await until(() => {
      const v = Number(el!.style.opacity)
      return v > 0.05 && v < 0.95
    })
    const moving = Number(el!.style.opacity)
    expect(moving).toBeGreaterThan(0)
    expect(moving).toBeLessThan(1)

    dispose() // fibers interrupt + gate unregister via onCleanup
    const atUnmount = el!.style.opacity

    // Many more real frames must NOT advance the frozen opacity.
    for (let i = 0; i < 20; i++) await raf()
    expect(el!.style.opacity).toBe(atUnmount)
  })
})

describe("useWardic — ward({ ref, style }) merge API", () => {
  it("merges the user ref + static style with ward's animated style", async () => {
    let el: HTMLElement | undefined
    const userRefSpy = vi.fn<(node: HTMLElement) => void>((node) => {
      el = node
    })
    render(() => {
      function C() {
        const ward = useWardic({ initial: { opacity: 0 }, animate: { opacity: 1 } })
        return <div {...ward({ ref: userRefSpy, style: { height: "100px" } })}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })

    expect(userRefSpy).toHaveBeenCalledTimes(1)
    expect(userRefSpy.mock.calls[0]![0]).toBeInstanceOf(HTMLElement)
    expect(el!.style.height).toBe("100px")
    expect(Number(el!.style.opacity)).toBe(0) // animated seed pre-frame

    let sawMid = false
    await until(() => {
      const v = Number(el!.style.opacity)
      if (v > 0.01 && v < 0.99) sawMid = true
      return v >= 0.99
    })
    expect(sawMid).toBe(true)
    expect(Number(el!.style.opacity)).toBeCloseTo(1, 1)
    expect(el!.style.height).toBe("100px") // static style survived the merge
  })
})

// Type-only assertion: `ward()` is spreadable (ref + JSX.CSSProperties style).
const _typecheck = (w: () => { ref: (el: HTMLElement) => void; style: JSX.CSSProperties }): void => void w
void (_typecheck as (w: Accessor<{ ref: (el: HTMLElement) => void; style: JSX.CSSProperties }>) => void)
