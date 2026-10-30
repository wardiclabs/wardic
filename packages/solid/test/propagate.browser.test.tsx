// `propagate={{ tap: false }}` on Solid 1 (#439, ADR-0066, Motion's `propagate`): a press inside a
// pressable element presses both, the pointer's and, as Motion's, a key's; a **Press claim** keeps an
// element's press from its pressable ancestors. Real Playwright mouse and keys; the scene sits clear of
// the page's one mouse, parked at (5, 5).
//
// - PR1: by default a press on the inner element presses both: each starts, the outer's `whileTap` on,
//   and each taps.
// - PR2: `propagate={{ tap: false }}` on the inner one: only it presses; the outer's `whileTap` stays off.
// - PR3: the outer one still presses from a down on itself, outside the inner one.
// - PR4: three deep, the middle one claiming: the inner and middle press, the outer doesn't.
// - PR5: a key on the inner one presses the outer too (Motion's): its start from the keyboard, at its
//   own centre, `whileTap` on, and both tap at the key's release.
// - PR6: with the claim, a key presses the inner one only.
// - PR7: Space, which the inner press takes, still reaches the outer one.
// - PR8: focus leaving the inner one mid-press cancels both, and the key's release taps neither.
// - PR9: a draggable ancestor still drags from a claiming child (the press claim isn't a drag claim); the
//   child's press ends with no tap.
// - PR10: `propagate` is read at each press's start: turned back on, the next press reaches the outer one.
// - PR11: `createWard`'s config takes it too.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWard, wardic, type WardicPressInfo, type WardicPropagate, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import { scaleOf } from "./base-values-harness.ts"
import "./browser-commands.ts"
import { afterPaint, raf } from "./browser-helpers.ts"

interface Pt {
  readonly x: number
  readonly y: number
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

// Whether the button is held, so a test that fails mid-press still releases it.
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

afterEach(async () => {
  if (held) await mouse.up({ x: 5, y: 5 })
  await mouse.move({ x: 5, y: 5 })
  cleanup()
})

const r = (n: number): number => Math.round(n)
const centreOf = (el: Element): Pt => {
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}
/** The point `(dx, dy)` px into `el` from its top left. */
const pointIn = (el: Element, dx: number, dy: number): Pt => {
  const box = el.getBoundingClientRect()
  return { x: box.left + dx, y: box.top + dy }
}

const OUTER: JSX.CSSProperties = { position: "absolute", top: "200px", left: "100px", width: "260px", height: "180px", padding: "40px", "box-sizing": "border-box", background: "#ccc" }
const MIDDLE: JSX.CSSProperties = { width: "180px", height: "100px", padding: "20px", "box-sizing": "border-box", background: "#aaa" }
const INNER: JSX.CSSProperties = { width: "80px", height: "60px", background: "teal" }
const SQUEEZE = { scale: 0.8 } as const
const QUICK = { type: "tween", duration: 0.05 } as const

/** The calls an element's tap callbacks make, named `name`. */
const tapsOf = (calls: Array<string>, name: string) => ({
  onTapStart: () => calls.push(`${name} start`),
  onTap: () => calls.push(`${name} tap`),
  onTapCancel: () => calls.push(`${name} cancel`),
})

/** An outer pressable box with a pressable inner one, the inner one's `propagate` given (`{}` propagates). */
const mountPair = async (propagate: () => WardicPropagate = () => ({})) => {
  const calls: Array<string> = []
  const els: Record<string, HTMLElement> = {}
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div ref={(n: HTMLElement) => (els.outer = n)} style={OUTER} whileTap={SQUEEZE} transition={QUICK} {...tapsOf(calls, "outer")}>
        <wardic.div ref={(n: HTMLElement) => (els.inner = n)} style={INNER} propagate={propagate()} {...tapsOf(calls, "inner")} />
      </wardic.div>
      <button ref={(n: HTMLElement) => (els.other = n)} style={{ position: "absolute", top: "420px", left: "100px" }}>
        other
      </button>
    </WardicProvider>
  ))
  await settle()
  return { calls, outer: els.outer!, inner: els.inner!, other: els.other! }
}

/** A click on `at` with the real mouse, held long enough for a frame. */
const click = async (at: Pt): Promise<void> => {
  await mouse.move(at)
  await mouse.down(at)
  await wait(60)
  await mouse.up(at)
  await wait(60)
}

describe("propagate on Solid 1 (#439)", () => {
  it("PR1: by default a press on the inner element presses both", async () => {
    const m = await mountPair()
    const at = centreOf(m.inner)
    await mouse.move(at)
    await mouse.down(at)
    await wait(120)
    expect(scaleOf(m.outer), "the outer one's whileTap on").toBeLessThan(0.85)
    await mouse.up(at)
    await wait(60)
    expect(m.calls).toEqual(["inner start", "outer start", "inner tap", "outer tap"])
  })

  it("PR2: tap: false on the inner element presses it alone", async () => {
    const m = await mountPair(() => ({ tap: false }))
    const at = centreOf(m.inner)
    await mouse.move(at)
    await mouse.down(at)
    await wait(120)
    expect(scaleOf(m.outer), "the outer one's whileTap off").toBe(1)
    await mouse.up(at)
    await wait(60)
    expect(m.calls).toEqual(["inner start", "inner tap"])
  })

  it("PR3: the outer element still presses from a down on itself", async () => {
    const m = await mountPair(() => ({ tap: false }))
    // Clear of the inner one, and inside the outer one at its whileTap's 0.8.
    await click(pointIn(m.outer, 200, 140))
    expect(m.calls).toEqual(["outer start", "outer tap"])
  })

  it("PR4: three deep, the middle one claiming: the inner and middle press, the outer doesn't", async () => {
    const calls: Array<string> = []
    let inner: HTMLElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div style={OUTER} {...tapsOf(calls, "outer")}>
          <wardic.div style={MIDDLE} propagate={{ tap: false }} {...tapsOf(calls, "middle")}>
            <wardic.div ref={(n: HTMLElement) => (inner = n)} style={INNER} {...tapsOf(calls, "inner")} />
          </wardic.div>
        </wardic.div>
      </WardicProvider>
    ))
    await settle()
    await click(centreOf(inner!))
    expect(calls).toEqual(["inner start", "middle start", "inner tap", "middle tap"])
  })

  it("PR5: a key on the inner element presses the outer one too, at its own centre", async () => {
    const calls: Array<string> = []
    const els: Record<string, HTMLElement> = {}
    const seen = (name: string) => (event: Event, info: WardicPressInfo) => calls.push(`${name} ${event.type} ${info.input} ${r(info.point.x)},${r(info.point.y)}`)
    // A whileTap that moves nothing: each point is its element's centre, measured at the key.
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (els.outer = n)} style={OUTER} whileTap={{ opacity: 0.5 }} transition={QUICK} onTapStart={seen("outer start")} onTap={seen("outer tap")}>
          <wardic.div ref={(n: HTMLElement) => (els.inner = n)} style={INNER} onTapStart={seen("inner start")} onTap={seen("inner tap")} />
        </wardic.div>
      </WardicProvider>
    ))
    await settle()
    const outer = centreOf(els.outer!)
    const inner = centreOf(els.inner!)
    els.inner!.focus()
    await commands.realKey("down", "Enter")
    await wait(120)
    expect(Number(getComputedStyle(els.outer!).opacity), "the outer one's whileTap on").toBeLessThan(0.6)
    await commands.realKey("up", "Enter")
    await wait(60)
    expect(calls).toEqual([
      `inner start keydown keyboard ${r(inner.x)},${r(inner.y)}`,
      `outer start keydown keyboard ${r(outer.x)},${r(outer.y)}`,
      `inner tap keyup keyboard ${r(inner.x)},${r(inner.y)}`,
      `outer tap keyup keyboard ${r(outer.x)},${r(outer.y)}`,
    ])
  })

  it("PR6: with the claim, a key presses the inner element alone", async () => {
    const m = await mountPair(() => ({ tap: false }))
    m.inner.focus()
    await commands.realKey("down", "Enter")
    await wait(120)
    expect(scaleOf(m.outer), "the outer one's whileTap off").toBe(1)
    await commands.realKey("up", "Enter")
    await wait(60)
    expect(m.calls).toEqual(["inner start", "inner tap"])
  })

  it("PR7: Space, which the inner press takes, still reaches the outer one", async () => {
    const m = await mountPair()
    m.inner.focus()
    await commands.realKey("press", " ")
    await wait(60)
    expect(m.calls).toEqual(["inner start", "outer start", "inner tap", "outer tap"])
  })

  it("PR8: focus leaving the inner element mid-press cancels both", async () => {
    const m = await mountPair()
    m.inner.focus()
    await commands.realKey("down", "Enter")
    await wait(60)
    m.other.focus()
    await wait(120)
    expect(scaleOf(m.outer), "the outer one's whileTap off").toBe(1)
    await commands.realKey("up", "Enter")
    await wait(60)
    expect(m.calls).toEqual(["inner start", "outer start", "inner cancel", "outer cancel"])
  })

  it("PR9: a draggable ancestor still drags from a claiming child, which doesn't tap", async () => {
    const calls: Array<string> = []
    const els: Record<string, HTMLElement> = {}
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (els.outer = n)} style={OUTER} drag="x" dragMomentum={false} {...tapsOf(calls, "outer")}>
          <wardic.div ref={(n: HTMLElement) => (els.inner = n)} style={INNER} propagate={{ tap: false }} {...tapsOf(calls, "inner")} />
        </wardic.div>
      </WardicProvider>
    ))
    await settle()
    const start = els.outer!.getBoundingClientRect().left
    const at = centreOf(els.inner!)
    await mouse.move(at)
    await mouse.down(at)
    for (let k = 1; k <= 6; k++) {
      await mouse.move({ x: at.x + 10 * k, y: at.y })
      await wait(16)
    }
    await mouse.up({ x: at.x + 60, y: at.y })
    await settle()
    expect(els.outer!.getBoundingClientRect().left - start, "the outer one dragged").toBeGreaterThan(40)
    expect(calls, "the inner press started, and ended with no tap; the outer one never pressed").toEqual(["inner start"])
  })

  it("PR10: propagate is read at each press's start", async () => {
    const [stops, setStops] = createSignal(true)
    const m = await mountPair(() => ({ tap: !stops() }))
    await click(centreOf(m.inner))
    expect(m.calls).toEqual(["inner start", "inner tap"])
    setStops(false)
    await settle()
    await click(centreOf(m.inner))
    expect(m.calls).toEqual(["inner start", "inner tap", "inner start", "outer start", "inner tap", "outer tap"])
  })

  it("PR11: createWard's config takes it", async () => {
    const calls: Array<string> = []
    let inner: HTMLElement | undefined
    const Inner = (): JSX.Element => {
      const ward = createWard({ propagate: { tap: false }, ...tapsOf(calls, "inner") })
      return <div {...ward({ style: INNER, ref: (n: HTMLElement) => (inner = n) })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div style={OUTER} {...tapsOf(calls, "outer")}>
          <Inner />
        </wardic.div>
      </WardicProvider>
    ))
    await settle()
    await click(centreOf(inner!))
    expect(calls).toEqual(["inner start", "inner tap"])
  })
})
