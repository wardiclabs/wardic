// Drag (whileDrag + pluggable release) tests in a REAL browser. The old happy-dom
// version hand-drove rAF and noted that happy-dom never populated event.timeStamp
// (so release velocity was non-deterministic); here events carry a REAL timeStamp,
// the engine runs in real time, and we poll real frames. The FOLLOW facts are
// still velocity-independent (they read `offset`); the release tests assert
// direction / continuation / settle.
//
// DESIGN under test (ADR-0004): on a drag-enabled `wardic.div`, `x`/`y` are
// DIRECT-SET by the pointer (1:1, NOT sprung) while the spring keeps driving every
// OTHER key + `whileDrag`; ownership of `x`/`y` returns to the spring on release.
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { retryGesture, until } from "./browser-helpers.ts"

afterEach(cleanup)

const translateXOf = (el: HTMLElement): number => {
  const m = /translateX\(([-\d.]+)px\)/.exec(el.style.transform)
  return m ? Number(m[1]) : 0
}
const translateYOf = (el: HTMLElement): number => {
  const m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform)
  return m ? Number(m[1]) : 0
}
const scaleOf = (el: HTMLElement): number => {
  const m = /scale\(([-\d.]+)\)/.exec(el.style.transform)
  return m ? Number(m[1]) : 1
}

const down = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerdown", { clientX: x, clientY: y, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true })
const move = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true })
const up = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerup", { clientX: x, clientY: y, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true })

/**
 * Grab `el` and drag the pointer to `(x, y)`, retrying until the direct-set lands in
 * the committed transform. The recognizer fiber attaches its DOM listener
 * asynchronously, so a single dispatch can be dropped before the listener is live;
 * `retryGesture` never presses again once the drag has started.
 */
const dragTo = (el: HTMLElement, x: number, y: number): Promise<void> =>
  retryGesture(
    () => {
      el.dispatchEvent(down(0, 0))
      el.dispatchEvent(move(x, y))
    },
    () => el.dispatchEvent(up(x, y)),
    () => translateXOf(el) !== 0 || translateYOf(el) !== 0,
  )

describe("drag — (a) FOLLOW", () => {
  it("direct-sets translateX to the dragged offset after a flush", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag />
      </WardicProvider>
    ))

    await dragTo(el!, 50, 0) // offset.x = 50 (down at 0)
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

    await dragTo(el!, 20, 0)
    await until(() => scaleOf(el!) > 1.02) // whileDrag scale climbs toward 1.1
    expect(scaleOf(el!)).toBeGreaterThan(1)

    el!.dispatchEvent(up(20, 0)) // release -> whileDrag deactivates, scale springs back to 1
    await until(() => Math.abs(scaleOf(el!) - 1) < 0.02)
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

    await dragTo(el!, 40, 40)
    expect(translateXOf(el!)).toBe(0) // off-axis x zeroed by the drag's axis
    expect(translateYOf(el!)).toBeCloseTo(40, 0)
  })
})

describe("drag — (d) constraints", () => {
  it("hard-clamps the followed x at the max bound with dragElastic={0}", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag dragConstraints={{ x: { min: 0, max: 100 } }} dragElastic={0} />
      </WardicProvider>
    ))

    await dragTo(el!, 200, 0) // offset 200 clamps to max 100
    expect(translateXOf(el!)).toBeCloseTo(100, 0)
  })

  it("pulls the followed x back past the bound by Motion's default dragElastic, 0.35 (#140)", async () => {
    let el: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag dragConstraints={{ x: { min: 0, max: 100 } }} />
      </WardicProvider>
    ))

    await dragTo(el!, 200, 0) // 100 past the bound, pulled back to 100 + 100 × 0.35
    expect(translateXOf(el!)).toBeCloseTo(135, 0)
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

    await dragTo(el!, 60, 0)
    expect(translateXOf(el!)).toBeCloseTo(60, 0)

    el!.dispatchEvent(up(60, 0)) // snapToOrigin spring drives x -> 0
    await until(() => Math.abs(translateXOf(el!)) < 0.3)
    expect(Math.abs(translateXOf(el!))).toBeLessThan(0.5)
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

    await dragTo(el!, 70, 0)
    expect(translateXOf(el!)).toBeCloseTo(70, 0)

    el!.dispatchEvent(up(70, 0)) // no momentum + no snap -> rests where released
    await until(() => false, 500) // observe ~500ms of frames
    expect(translateXOf(el!)).toBeCloseTo(70, 0)
  })
})
