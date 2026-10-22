// A ward's drag on Solid 2 (#209 PR 3a, ADR-0004, ADR-0016), in a real browser: the drag track the
// Solid 1 binding runs (drag-track.ts), on a ward. Ports of the Solid 1 binding's drag tests.
//
// - DG1: a free drag direct-sets `x` to the pointer's offset.
// - DG2: `whileDrag` through a kept ward animates while held, and returns after the release.
// - DG3: `drag: "y"` keeps `x` at 0 while `y` follows.
// - DG4: constraints: hard with `dragElastic: 0`; pulled back by Motion's 0.35 by default (#140).
// - DG5: `dragSnapToOrigin` springs back to 0 after the release.
// - DG6: `dragMomentum: false` rests where it was let go.
// - DG6b: a `whileTap` `y` the drag then moves stays where it was dropped, not returned (ADR-0022).
// - DG7: a layout drag follows through the projection, not a raw `x`, and FLIPs back to its slot.
// - DG8: Motion's drag defaults (#36): on `wardic.div`, by axis, under the user's style, none
//   without `drag`, through a kept ward's spread, and on a `wardic.create(Component)` wrap's element.
// - DG9: a real-mouse flick carries on past the release; with `dragMomentum: false` it doesn't (#139).
// - DG10: a claiming `createDrag` on the parent is refused while the ward drags; `claim: false` sees it (#29).
// - DG11: with `dragPropagation`, the ward claims nothing: the parent's claiming `createDrag` sees it too.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { createDrag, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Option from "effect/Option"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { commands, page } from "vitest/browser"
import "../browser-commands.ts"
import { afterPaint, leftOf, raf, retryGesture, topOf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const termOf = (el: HTMLElement, pattern: RegExp, none: number): number =>
  Option.match(Option.fromNullOr(pattern.exec(el.style.transform)), { onNone: () => none, onSome: (match) => Number(match[1]) })
const translateXOf = (el: HTMLElement): number => termOf(el, /translateX\(([-\d.]+)px\)/, 0)
const translateYOf = (el: HTMLElement): number => termOf(el, /translateY\(([-\d.]+)px\)/, 0)
const scaleOf = (el: HTMLElement): number => termOf(el, /scale\(([-\d.]+)\)/, 1)

const pointer = { pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true } as const
const down = (x: number, y: number): PointerEvent => new PointerEvent("pointerdown", { clientX: x, clientY: y, buttons: 1, ...pointer })
const move = (x: number, y: number): PointerEvent => new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, ...pointer })
const up = (x: number, y: number): PointerEvent => new PointerEvent("pointerup", { clientX: x, clientY: y, buttons: 0, ...pointer })

/** Grab `el` at (0, 0) and drag to `(x, y)`, retried until `took()` (the recognizer attaches its listener in a fiber). */
const dragTo = (el: HTMLElement, x: number, y: number, took = () => translateXOf(el) !== 0 || translateYOf(el) !== 0): Promise<void> =>
  retryGesture(
    () => {
      el.dispatchEvent(down(0, 0))
      el.dispatchEvent(move(x, y))
    },
    () => el.dispatchEvent(up(x, y)),
    took,
  )

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

/** `wardic.div` with `props`, in a provider; the element. */
const wardicDiv = (props: Record<string, unknown>): (() => HTMLElement) => {
  let el!: HTMLElement
  mount(() => (
    <WardicProvider env={DomLive}>
      <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ width: "40px", height: "40px" }} {...props} />
    </WardicProvider>
  ))
  return () => el
}

describe("a ward's drag on Solid 2 (ADR-0004)", () => {
  it("DG1: a free drag direct-sets x to the pointer's offset", async () => {
    const el = wardicDiv({ drag: true })
    await dragTo(el(), 50, 0)
    expect(translateXOf(el())).toBeCloseTo(50, 0)
  })

  it("DG2: whileDrag through a kept ward animates while held and returns after the release", async () => {
    let el!: HTMLElement
    const Box = () => {
      const card = ward({ drag: true, animate: { scale: 1 }, whileDrag: { scale: 1.1 }, dragMomentum: false, style: { width: "40px", height: "40px" } })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await dragTo(el, 20, 0)
    await until(() => scaleOf(el) > 1.02)
    expect(scaleOf(el)).toBeGreaterThan(1.02)
    el.dispatchEvent(up(20, 0))
    await until(() => Math.abs(scaleOf(el) - 1) < 0.002)
    expect(scaleOf(el)).toBeCloseTo(1, 2)
  })

  it("DG3: drag y keeps x at 0 while y follows", async () => {
    const el = wardicDiv({ drag: "y" })
    await dragTo(el(), 40, 40)
    expect(translateXOf(el())).toBe(0)
    expect(translateYOf(el())).toBeCloseTo(40, 0)
  })

  it("DG4: constraints hold hard with dragElastic 0, and pull back by 0.35 by default (#140)", async () => {
    const hard = wardicDiv({ drag: true, dragConstraints: { left: 0, right: 100 }, dragElastic: 0 })
    await dragTo(hard(), 200, 0)
    expect(translateXOf(hard())).toBeCloseTo(100, 0)
    hard().dispatchEvent(up(200, 0))
    const elastic = wardicDiv({ drag: true, dragConstraints: { left: 0, right: 100 } })
    await dragTo(elastic(), 200, 0)
    // 100 past the bound, pulled back to 100 + 100 × 0.35.
    expect(translateXOf(elastic())).toBeCloseTo(135, 0)
  })

  it("DG5: dragSnapToOrigin springs x back to 0 after the release", async () => {
    const el = wardicDiv({ drag: true, dragSnapToOrigin: true })
    await dragTo(el(), 60, 0)
    expect(translateXOf(el())).toBeCloseTo(60, 0)
    el().dispatchEvent(up(60, 0))
    await until(() => Math.abs(translateXOf(el())) < 0.3)
    expect(Math.abs(translateXOf(el()))).toBeLessThan(0.5)
  })

  it("DG6: dragMomentum false rests where it was let go", async () => {
    const el = wardicDiv({ drag: true, dragMomentum: false })
    await dragTo(el(), 70, 0)
    el().dispatchEvent(up(70, 0))
    await wait(500)
    expect(translateXOf(el())).toBeCloseTo(70, 0)
  })

  it("DG6b: a whileTap y the drag then moves stays where it was dropped, not returned (ADR-0022)", async () => {
    const el = wardicDiv({ drag: true, dragMomentum: false, whileTap: { y: 2 } })
    await retryGesture(
      () => el().dispatchEvent(down(0, 0)),
      () => el().dispatchEvent(up(0, 0)),
      () => translateYOf(el()) > 0.5,
    )
    el().dispatchEvent(move(40, 30))
    el().dispatchEvent(up(40, 30))
    await wait(800)
    expect(translateXOf(el()), "x where dropped").toBeCloseTo(40, 0)
    expect(translateYOf(el()), "y where dropped, not returned to 0").toBeGreaterThan(29)
  })

  it("DG7: a layout drag follows through the projection, not a raw x, and FLIPs back to its slot", async () => {
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", top: "50px", left: "50px", width: "300px", height: "300px" }}>
          <wardic.div ref={(n: HTMLElement) => (el = n)} layout drag style={{ width: "40px", height: "40px" }} />
        </div>
      </WardicProvider>
    ))
    await settle()
    const startLeft = leftOf(el)
    const startTop = topOf(el)
    await dragTo(el, 100, 60, () => Math.abs(leftOf(el) - (startLeft + 100)) < 5)
    expect(Math.abs(leftOf(el) - (startLeft + 100))).toBeLessThan(5)
    expect(Math.abs(topOf(el) - (startTop + 60))).toBeLessThan(5)
    expect(el.style.transform).not.toContain("translateX")
    el.dispatchEvent(up(100, 60))
    await until(() => Math.abs(leftOf(el) - startLeft) < 2 && Math.abs(topOf(el) - startTop) < 2)
    expect(Math.abs(leftOf(el) - startLeft)).toBeLessThan(2)
    expect(Math.abs(topOf(el) - startTop)).toBeLessThan(2)
  })
})

describe("a drag element's defaults on Solid 2 (#36)", () => {
  const BOX = { width: "120px", height: "80px" } as const
  const expectDefaults = (el: HTMLElement, touchAction: string): void => {
    expect(el.style.getPropertyValue("touch-action")).toBe(touchAction)
    expect(el.style.getPropertyValue("user-select")).toBe("none")
    expect(el.getAttribute("draggable")).toBe("false")
  }

  it("DG8a: wardic.div gets them, by axis, under the user's style; none without drag", async () => {
    const free = wardicDiv({ drag: true, style: BOX })
    const x = wardicDiv({ drag: "x", style: BOX })
    const y = wardicDiv({ drag: "y", style: BOX })
    const over = wardicDiv({ drag: true, style: { ...BOX, "user-select": "text" } })
    const none = wardicDiv({ animate: { opacity: 1 }, style: BOX })
    await settle()
    expectDefaults(free(), "none")
    expect(x().style.getPropertyValue("touch-action")).toBe("pan-y")
    expect(y().style.getPropertyValue("touch-action")).toBe("pan-x")
    expect(over().style.getPropertyValue("user-select")).toBe("text")
    expect(over().style.getPropertyValue("touch-action")).toBe("none")
    expect(none().style.getPropertyValue("touch-action")).toBe("")
    expect(none().style.getPropertyValue("user-select")).toBe("")
    expect(none().hasAttribute("draggable")).toBe(false)
  })

  it("DG8b: a kept ward's spread carries them", async () => {
    let el!: HTMLElement
    const Box = () => {
      const card = ward({ drag: true, style: BOX })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    expectDefaults(el, "none")
  })

  it("DG8c: a wardic.create(Component) wrap whose component passes no style gets them on its element", async () => {
    let el!: HTMLElement
    // Forwards only `ref`: no `style`, no `draggable`.
    const Plain = (props: { readonly ref?: JSX.Ref<HTMLDivElement> }): JSX.Element => <div ref={props.ref} style={{ width: "120px", height: "80px" }} />
    const Wrapped = wardic.create(Plain)
    mount(() => (
      <WardicProvider env={DomLive}>
        <Wrapped ref={(n: HTMLElement) => (el = n)} drag="x" />
      </WardicProvider>
    ))
    await settle()
    expectDefaults(el, "pan-y")
  })
})

describe("a real-mouse fling on Solid 2 (ADR-0004, Amendment (#139))", () => {
  interface Pt {
    readonly x: number
    readonly y: number
  }
  let held = false
  const mouse = {
    move: (p: Pt): Promise<void> => commands.realMouse("move", p.x, p.y),
    down: async (p: Pt): Promise<void> => {
      await commands.realMouse("down", p.x, p.y)
      held = true
    },
    up: async (p: Pt): Promise<void> => {
      await commands.realMouse("up", p.x, p.y)
      held = false
    },
  }
  const add = (p: Pt, dx: number): Pt => ({ x: p.x + dx, y: p.y })

  let viewport = { width: 0, height: 0 }
  beforeAll(async () => {
    viewport = { width: window.innerWidth, height: window.innerHeight }
    await page.viewport(1200, viewport.height)
    await wait(50)
  })
  afterAll(async () => {
    await page.viewport(viewport.width, viewport.height)
  })
  afterEach(async () => {
    if (held) await mouse.up({ x: 5, y: 5 })
    await mouse.move({ x: 5, y: 5 })
    window.getSelection()?.removeAllRanges()
  })

  /** A 120x80 free drag box at (40, 400): low on the page, away from other files' elements under the shared mouse. */
  const mountBox = async (momentum: boolean) => {
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", top: "400px", left: "40px" }}>
          <wardic.div ref={(n: HTMLElement) => (el = n)} drag dragMomentum={momentum} style={{ position: "relative", width: "120px", height: "80px" }} />
        </div>
      </WardicProvider>
    ))
    await settle()
    const slot = el.getBoundingClientRect()
    return { dx: () => el.getBoundingClientRect().left - slot.left, grab: { x: slot.left + 20, y: slot.top + 40 } }
  }

  /** Grab, glide 100 px right, then flick 4 moves of 50 px, 35 ms apart; where the pointer is, not let go. */
  const flick = async (grab: Pt): Promise<Pt> => {
    await mouse.down(grab)
    for (let k = 1; k <= 10; k++) {
      await mouse.move(add(grab, 10 * k))
      await wait(20)
    }
    for (let k = 1; k <= 4; k++) {
      await mouse.move(add(grab, 100 + 50 * k))
      if (k < 4) await wait(35)
    }
    return add(grab, 300)
  }

  it("DG9: a flick carries on past where it was let go; with dragMomentum false it stays", async () => {
    const free = await mountBox(true)
    const at = await flick(free.grab)
    const released = free.dx()
    await mouse.up(at)
    await wait(1500)
    expect(free.dx() - released, "carried past the release").toBeGreaterThan(30)
    await mouse.move({ x: 5, y: 5 })
    const still = await mountBox(false)
    // The first box carried on to the right: the second is grabbed where it is, over the first's slot.
    const at2 = await flick(still.grab)
    const released2 = still.dx()
    await mouse.up(at2)
    await wait(600)
    expect(Math.abs(still.dx() - released2), "it stayed").toBeLessThan(0.5)
  })
})

describe("drag claims on Solid 2 (#29)", () => {
  it("DG10: a claiming createDrag on the parent is refused while the ward drags; claim: false sees the gesture", async () => {
    let inner!: HTMLElement
    let claimed!: ReturnType<typeof createDrag>
    let watched!: ReturnType<typeof createDrag>
    const Scene = () => {
      claimed = createDrag()
      watched = createDrag({ claim: false })
      return (
        <div ref={[claimed, watched]} style={{ padding: "20px", width: "100px", height: "100px" }}>
          <wardic.div ref={(n: HTMLElement) => (inner = n)} drag dragMomentum={false} style={{ width: "40px", height: "40px" }} />
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await dragTo(inner, 60, 30)
    expect(translateXOf(inner)).toBeCloseTo(60, 0)
    expect(watched(), "the watcher sees the drag while held").not.toBeNull()
    inner.dispatchEvent(up(60, 30))
    await until(() => watched()?.phase === "end")
    expect(watched()?.phase, "the watcher saw the release").toBe("end")
    expect(claimed(), "the claiming sensor was refused: no sample at all").toBeNull()
  })

  it("DG11: with dragPropagation the ward claims nothing: the parent's claiming createDrag sees the gesture too", async () => {
    let inner!: HTMLElement
    let claimed!: ReturnType<typeof createDrag>
    const Scene = () => {
      claimed = createDrag()
      return (
        <div ref={claimed} style={{ padding: "20px", width: "100px", height: "100px" }}>
          <wardic.div ref={(n: HTMLElement) => (inner = n)} drag dragPropagation dragMomentum={false} style={{ width: "40px", height: "40px" }} />
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await dragTo(inner, 60, 30, () => translateXOf(inner) !== 0 && claimed() !== null)
    expect(translateXOf(inner)).toBeCloseTo(60, 0)
    expect(claimed()?.offset).toEqual({ x: 60, y: 30 })
  })
})
