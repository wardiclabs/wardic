// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"

/**
 * Drag (whileDrag + pluggable release) tests — subtask 22c.
 *
 * DESIGN under test (ADR-0004): on a drag-enabled `wardic.div`, `x`/`y` are
 * DIRECT-SET by the pointer (1:1, NOT sprung) while the spring spine keeps
 * driving every OTHER key + `whileDrag`; ownership of `x`/`y` returns to the
 * spring once the release settles.
 *
 * Deterministic rAF + monotonic clock harness — identical strategy to
 * layout-flip.test.tsx / animate-presence.test.tsx: BOTH the Clock's rAF loop and
 * the gate's flush rAF are hand-driven, and forked Effect fibers drain on a real
 * macrotask turn. The absolute clock is MONOTONIC (never reset between drive()
 * calls) so a late-subscribing release spring never sees a negative dt.
 *
 * The DomLive InputSource reads `clientX`/`clientY` + `pointerId` and derives
 * velocity from `event.timeStamp` (NOT the Clock — see packages/dom/src/input.ts).
 * happy-dom does NOT populate `timeStamp` from our scripted values, so release
 * velocity is non-deterministic; FOLLOW/clamp/axis facts are velocity-INDEPENDENT
 * (they read `offset`, not velocity), and the fling tests assert direction /
 * continuation / settle rather than an exact px.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number
let clock: number

beforeEach(() => {
  pending = new Map()
  nextId = 1
  clock = 0
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
    clock += 16
    fireFrame(clock)
    await tick()
  }
}

/** Parse `translateX(Npx)` out of a committed `transform` string (0 if absent). */
const translateXOf = (el: HTMLElement): number => {
  const m = /translateX\(([-\d.]+)px\)/.exec(el.style.transform)
  return m ? Number(m[1]) : 0
}

/** Parse `translateY(Npx)` out of a committed `transform` string (0 if absent). */
const translateYOf = (el: HTMLElement): number => {
  const m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform)
  return m ? Number(m[1]) : 0
}

/** Parse `scale(N)` out of a committed `transform` string (1 if absent). */
const scaleOf = (el: HTMLElement): number => {
  const m = /scale\(([-\d.]+)\)/.exec(el.style.transform)
  return m ? Number(m[1]) : 1
}

const down = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerdown", { clientX: x, clientY: y, buttons: 1, pointerId: 1 })
const move = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, pointerId: 1 })
const up = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerup", { clientX: x, clientY: y, buttons: 0, pointerId: 1 })

/**
 * Grab `el` and drag the pointer to `(x, y)`, retrying the down+move dispatch +
 * a gate flush until the direct-set lands in the committed transform. The
 * recognizer fiber attaches its DOM listener asynchronously (forked on the
 * runtime), so a single dispatch can be dropped before the listener is live —
 * `waitFor` re-dispatches until the gesture starts and the flush commits.
 * Re-dispatching `down` while already owned is ignored by the recognizer, so the
 * retry is safe.
 */
const dragTo = async (el: HTMLElement, x: number, y: number): Promise<void> => {
  await waitFor(async () => {
    el.dispatchEvent(down(0, 0))
    el.dispatchEvent(move(x, y))
    await drive(2)
    // At least one followed axis must have landed (velocity-independent).
    const moved = translateXOf(el) !== 0 || translateYOf(el) !== 0
    expect(moved).toBe(true)
  })
}

describe("drag — (a) FOLLOW", () => {
  it("direct-sets translateX to the dragged offset after a flush", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag />
      </WardicProvider>
    ))
    await settle()

    // Drag to x=50: offset.x = 50 (down at 0). Velocity-independent FOLLOW.
    await dragTo(el!, 50, 0)
    expect(translateXOf(el!)).toBeCloseTo(50, 0)
  })
})

describe("drag — (b) whileDrag", () => {
  it("animates scale toward whileDrag while held, returns toward base after release", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLElement) => (el = node)}
          drag
          animate={{ scale: 1 }}
          whileDrag={{ scale: 1.1 }}
          dragMomentum={false}
        />
      </WardicProvider>
    ))
    await settle()

    await dragTo(el!, 20, 0)
    // The whileDrag scale is driven by the spring (NOT stripped). Drive frames so
    // it climbs toward 1.1.
    await drive(40)
    expect(scaleOf(el!)).toBeGreaterThan(1)

    // Release: dragging() flips false, whileDrag deactivates, scale springs back
    // toward the base (1).
    el!.dispatchEvent(up(20, 0))
    await drive(60)
    expect(scaleOf(el!)).toBeCloseTo(1, 1)
  })
})

describe("drag — (c) axis lock", () => {
  it("drag='y' keeps x at 0 while y follows", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag="y" />
      </WardicProvider>
    ))
    await settle()

    await dragTo(el!, 40, 40)
    // Off-axis x is zeroed by axisLock; y follows the offset.
    expect(translateXOf(el!)).toBe(0)
    expect(translateYOf(el!)).toBeCloseTo(40, 0)
  })
})

describe("drag — (d) constraints", () => {
  it("hard-clamps the followed x at the max bound (elastic default 0)", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(node: HTMLElement) => (el = node)}
          drag
          dragConstraints={{ x: { min: 0, max: 100 } }}
        />
      </WardicProvider>
    ))
    await settle()

    await dragTo(el!, 200, 0)
    // offset.x = 200 clamps to max = 100 (hard clamp).
    expect(translateXOf(el!)).toBeCloseTo(100, 0)
  })
})

describe("drag — (e) snapToOrigin", () => {
  it("springs x back toward 0 after pointerup", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag dragSnapToOrigin />
      </WardicProvider>
    ))
    await settle()

    await dragTo(el!, 60, 0)
    expect(translateXOf(el!)).toBeCloseTo(60, 0)

    // Release: the snapToOrigin spring drives x -> 0 (deterministic target).
    el!.dispatchEvent(up(60, 0))
    await drive(80)
    expect(translateXOf(el!)).toBeCloseTo(0, 0)
  })
})

describe("drag — (f) post-drag rest (no momentum/snap)", () => {
  it("rests at the released value with dragMomentum:false", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag dragMomentum={false} />
      </WardicProvider>
    ))
    await settle()

    await dragTo(el!, 70, 0)
    expect(translateXOf(el!)).toBeCloseTo(70, 0)

    // Release with no momentum + no snap: x rests where the drag left it.
    el!.dispatchEvent(up(70, 0))
    await drive(40)
    expect(translateXOf(el!)).toBeCloseTo(70, 0)
  })
})
