// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { type Accessor, createSignal, type JSX } from "solid-js"
import { useWardic, WardicProvider } from "@wardic/solid"

/**
 * Hand-driven requestAnimationFrame (mirrors packages/dom/test/clock.test.ts and
 * gate.test.tsx). CRUCIAL for this spine: BOTH loops use requestAnimationFrame —
 *   - the Clock's rAF loop (drives `springValues` / `animateValues` ticks), and
 *   - the gate's flush rAF (projects the merged value-map into the style signal).
 * So `fireFrame` fires ALL currently-pending callbacks (a snapshot taken before
 * firing, so callbacks scheduled *by* this frame run on the NEXT fireFrame), and
 * each fired callback advances absolute time by a fixed dt — letting the spring
 * settle and the gate flush deterministically without real timers.
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

/**
 * Fire every callback pending at the moment of the call, at absolute timestamp
 * `t` (ms). Callbacks that reschedule (the Clock loop, the gate) enqueue for the
 * NEXT fireFrame — so a sequence of fireFrame(0), fireFrame(16), ... advances
 * both loops one synchronized step per call.
 */
const fireFrame = (t: number): void => {
  const batch = [...pending.values()]
  pending.clear()
  for (const cb of batch) cb(t)
}

/**
 * Yield a macrotask turn. The Effect fibers (Clock subscription, stream
 * consumers) advance on the runtime's scheduler, which needs a real task turn
 * to drain — a microtask (`Promise.resolve`) is NOT enough to let a forked
 * fiber subscribe to the Clock and schedule its first rAF.
 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Let the spine fibers subscribe (Clock rAF gets scheduled) after mount. Call
 * once before driving frames.
 */
const settle = (): Promise<void> => tick()

/**
 * Drive `count` frames at a fixed ~16ms cadence, draining the runtime scheduler
 * between frames so forked fibers advance. Enough frames let a default spring
 * settle to its target.
 */
const drive = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    fireFrame(i * 16)
    await tick()
  }
}

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
    // No frame fired: the style is the projected SSR initial.
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

  // Step 21e: `initial` at the HOOK boundary is a STATIC value/name (per-field
  // accessors live at the component layer now). A static map seeds the projected
  // initial synchronously at mount — no engine, no frame.
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
  it("moves opacity 0 -> 1 across fired frames and settles near 1", async () => {
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

    // Pre-mount/first paint seed is the initial.
    expect(opacityOf(ward!().style)).toBe(0)

    // Let the spine fibers subscribe (Clock rAF scheduled) before firing frames.
    await settle()
    // Drive frames: the Clock loop ticks the spring, the gate flushes the
    // projected value into the style signal. Mid-flight, opacity is between 0
    // and 1 and increasing toward the target.
    await drive(8)
    const mid = opacityOf(ward!().style)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)

    // Enough frames for the default spring to settle near 1.
    await drive(80)
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
        // Use ward()'s merge API: the user ref is merged with ward's spine ref.
        return <div {...ward({ ref: (node) => (el = node) })}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    })

    // Settle at the base 0.2 first.
    await settle()
    await drive(80)
    expect(opacityOf(ward!().style)).toBeCloseTo(0.2, 1)

    // pointerenter -> hovered() flips, the override target gains opacity 1. The
    // recognizer fiber attaches its listener asynchronously, so re-dispatch
    // inside waitFor (draining the scheduler) until the spine moves toward 1.
    await waitFor(
      async () => {
        el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1 }))
        await drive(10)
        expect(opacityOf(ward!().style)).toBeGreaterThan(0.2)
      },
      { timeout: 2000 },
    )
    await drive(80)
    expect(opacityOf(ward!().style)).toBeCloseTo(1, 1)

    // pointerleave -> revert toward the base.
    el!.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1 }))
    await drive(80)
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

    // Pre-mount seed is the initial (one-shot).
    expect(opacityOf(ward!().style)).toBe(0)

    // open() is false: animate target is opacity 0 — settles at 0.
    await settle()
    await drive(40)
    expect(opacityOf(ward!().style)).toBeCloseTo(0, 1)

    // Flip the signal: cfg() recomputes, target() changes to opacity 1, the
    // override-stack memo drives a Retarget. Drive frames and assert it moves.
    setOpen(true)
    await drive(8)
    const mid = opacityOf(ward!().style)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)

    await drive(80)
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
          // `initial` references a signal, but useWardic reads initial via
          // untrack(cfg) ONCE at setup — changing the signal must not re-seed.
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

    // The pre-mount seed is the initial resolved once at setup (0.3).
    expect(opacityOf(ward!().style)).toBe(0.3)

    // Settle at the base animate (also 0.3 at setup).
    await settle()
    await drive(40)
    expect(opacityOf(ward!().style)).toBeCloseTo(0.3, 1)

    // Flip the seed signal. animate IS reactive -> spine retargets toward 0.9.
    // The point under test: the SEED (style at frame 0 / the Snapshot origin)
    // was 0.3, NOT re-seeded to 0.9 — so the value must MOVE from 0.3 (it does
    // not jump). We assert the mid-flight value is strictly between 0.3 and 0.9,
    // proving the spring departed from the once-seeded origin, not a re-seed.
    setSeed(0.9)
    await drive(4)
    const mid = opacityOf(ward!().style)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.9)

    await drive(80)
    expect(opacityOf(ward!().style)).toBeCloseTo(0.9, 1)
  })
})

describe("useWardic — teardown", () => {
  it("unmount tears down: no further style writes after unmount", async () => {
    // Track every style value the spine writes via the live `<div>`'s style
    // attribute (the gate's signal sink feeds JSX `style={...}`), so we observe
    // writes from OUTSIDE the disposed owner.
    let el: HTMLElement | undefined
    const dispose = render(() => {
      function C() {
        const ward = useWardic({ initial: { opacity: 0 }, animate: { opacity: 1 } })
        // ward()'s merge API spreads both the merged ref and the animated style.
        return <div {...ward({ ref: (node) => (el = node) })}>x</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <C />
        </WardicProvider>
      )
    }).unmount

    // Advance a few frames so the spring is mid-flight (writes are happening).
    await settle()
    await drive(6)
    const moving = Number(el!.style.opacity)
    expect(moving).toBeGreaterThan(0)
    expect(moving).toBeLessThan(1)

    // Unmount: spine fibers interrupt + gate unregister fire via onCleanup.
    dispose()
    const atUnmount = el!.style.opacity

    // Firing many more frames must not advance the element's opacity: fibers
    // are interrupted and the element is unregistered from the gate.
    await drive(40)
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

    // The user's ref was invoked with the live element (merged via mergeRefs).
    expect(userRefSpy).toHaveBeenCalledTimes(1)
    expect(userRefSpy.mock.calls[0]![0]).toBeInstanceOf(HTMLElement)

    // The user's static style is preserved on the element from the first render.
    expect(el!.style.height).toBe("100px")
    // ...alongside the animated seed (opacity 0 pre-frame).
    expect(Number(el!.style.opacity)).toBe(0)

    // Drive frames: ward animates opacity toward 1 while height:100px persists.
    await settle()
    await drive(8)
    const mid = Number(el!.style.opacity)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)
    expect(el!.style.height).toBe("100px")

    await drive(80)
    expect(Number(el!.style.opacity)).toBeCloseTo(1, 1)
    expect(el!.style.height).toBe("100px")
  })
})

// Type-only assertion: `ward()` is spreadable (ref + JSX.CSSProperties style).
const _typecheck = (w: () => { ref: (el: HTMLElement) => void; style: JSX.CSSProperties }): void => void w
void (_typecheck as (w: Accessor<{ ref: (el: HTMLElement) => void; style: JSX.CSSProperties }>) => void)
