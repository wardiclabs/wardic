// Regression: a drag and a press keep their pointer until its release (issue #31,
// ADR-0019). Real Playwright mouse input (`commands.realMouse`): an event dispatched on
// the element can't show a pointer leaving it.
//
// Before #31 the DOM input source listened on the element only. A move that took the
// pointer off the dragged element stopped the drag, a release outside never ended it,
// and the gesture left behind followed later moves with no button pressed and ignored
// the next press. Since #31 a pointer that went down on the element is a Held pointer:
// its moves and release reach the element's stream wherever they land. A gesture whose
// release is lost anyway (a Stale gesture) ends at the owning pointer's first move with
// no button pressed, or at its next down.
//
// The drag scene: a 120x80 draggable D at (40,40), `layout` or free. A free D has
// `dragMomentum={false}`, so its release rests where the pointer let go; a `layout` D
// flies back to its slot. `whileDrag` fades D to 0.5 while the drag is on, so its
// opacity says whether the gesture ended. A recorder on D logs the drag recognizer's
// own samples (`createDrag`) and the hover and press recognizers. D is grabbed 20 px
// in from its left edge, at its vertical centre.
import { cleanup, render } from "@solidjs/testing-library"
import type * as Drag from "@wardic/core/Drag"
import { DomLive } from "@wardic/dom"
import { createDrag, createHover, createPress, wardic, WardicProvider } from "@wardic/solid"
import { createEffect, createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands, server } from "vitest/browser"
import "./browser-commands.ts"
import type { RealMouseOptions } from "./browser-commands.ts"
import { afterPaint, loseNextRelease, raf } from "./browser-helpers.ts"

interface Pt {
  readonly x: number
  readonly y: number
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const r1 = (n: number): number => Math.round(n * 10) / 10
const r2 = (n: number): number => Math.round(n * 100) / 100

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

// The mouse button held, so a test that fails mid-press still releases it, and the
// lost-release listeners a test registered, so one that ends early doesn't lose the
// next test's release.
let pressed: "left" | "right" | undefined
const disposers: Array<() => void> = []
const mouse = {
  move: (p: Pt): Promise<void> => commands.realMouse("move", p.x, p.y),
  down: async (p: Pt, options?: RealMouseOptions): Promise<void> => {
    await commands.realMouse("down", p.x, p.y, options)
    pressed = options?.button ?? "left"
  },
  up: async (p: Pt, options?: RealMouseOptions): Promise<void> => {
    await commands.realMouse("up", p.x, p.y, options)
    pressed = undefined
  },
}

afterEach(async () => {
  if (pressed !== undefined) await mouse.up({ x: 5, y: 5 }, { button: pressed })
  for (const dispose of disposers.splice(0)) dispose()
  await mouse.move({ x: 5, y: 5 })
  cleanup()
})

/** CDP touch input exists in Chromium only (`commands.realTouch`). */
const cdpTouch = server.browser === "chromium"

/** A finger at a client point. */
const finger = (id: number, p: Pt): { x: number; y: number; id: number } => ({ x: p.x, y: p.y, id })

/** Move the real mouse from `from` to `to` in `steps` moves, `ms` apart. */
const glide = async (from: Pt, to: Pt, steps: number, ms = 20): Promise<void> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps })
    await wait(ms)
  }
}

type Mode = "layout" | "free"

interface DragScene {
  readonly el: HTMLElement
  readonly slot: DOMRect
  /** The grab point: 20 px in from D's left edge, at its vertical centre. */
  readonly grab: Pt
  /** Every sample the drag recognizer emitted. */
  readonly samples: Array<Drag.Sample>
  readonly hovered: () => boolean
  readonly pressed: () => boolean
}

const mountDrag = async (
  mode: Mode,
  axis: true | "x" = true,
  momentum = false,
  touchAction?: "none",
): Promise<DragScene> => {
  const [el, setEl] = createSignal<HTMLElement>()
  const samples: Array<Drag.Sample> = []
  let hovered: () => boolean = () => false
  let pressedNow: () => boolean = () => false
  function Recorder(props: { readonly target: HTMLElement }) {
    // eslint-disable-next-line solid/reactivity
    const sample = createDrag(props.target)
    // eslint-disable-next-line solid/reactivity
    hovered = createHover(props.target)
    // eslint-disable-next-line solid/reactivity
    pressedNow = createPress(props.target)
    createEffect(() => {
      const s = sample()
      if (s !== null) samples.push(s)
    })
    return null
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          layout={mode === "layout"}
          drag={axis}
          dragMomentum={momentum}
          animate={{ opacity: 1 }}
          whileDrag={{ opacity: 0.5 }}
          style={{
            position: "relative",
            width: "120px",
            height: "80px",
            background: "#f88",
            ...(touchAction !== undefined ? { "touch-action": touchAction } : {}),
          }}
        />
      </div>
      <Show when={el()}>{(target) => <Recorder target={target()} />}</Show>
    </WardicProvider>
  ))
  await settle()
  const target = el()!
  const slot = target.getBoundingClientRect()
  return {
    el: target,
    slot,
    grab: { x: slot.left + 20, y: slot.top + 40 },
    samples,
    hovered: () => hovered(),
    pressed: () => pressedNow(),
  }
}

/** Where D paints relative to its slot, and its `whileDrag` opacity. */
interface Seen {
  readonly dx: number
  readonly dy: number
  readonly opacity: number
}
const seen = (s: DragScene): Seen => {
  const b = s.el.getBoundingClientRect()
  return { dx: r1(b.left - s.slot.left), dy: r1(b.top - s.slot.top), opacity: r2(Number(getComputedStyle(s.el).opacity)) }
}

/** The recognizer's samples since `from`, run-length encoded: `start move×5 end`. */
const phases = (samples: ReadonlyArray<Drag.Sample>, from: number): string => {
  const out: Array<string> = []
  let last = ""
  let n = 0
  for (const s of samples.slice(from)) {
    if (s.phase === last) {
      n++
      continue
    }
    if (last !== "") out.push(n > 1 ? `${last}×${n}` : last)
    last = s.phase
    n = 1
  }
  if (last !== "") out.push(n > 1 ? `${last}×${n}` : last)
  return out.length === 0 ? "none" : out.join(" ")
}

/** The x offset of the last sample since `from`. */
const lastOffsetX = (samples: ReadonlyArray<Drag.Sample>, from: number): number =>
  r1(samples.slice(from).at(-1)?.offset.x ?? Number.NaN)

/**
 * The prelude for a release outside: an x-locked D is pressed, the pointer drifts
 * 60 px down off D's bottom edge (D can't follow on y), then 60 px right, and is
 * released there. The release is off D: a `layout` D flies back to its slot, a free D
 * rests at +60.
 */
const releaseOutside = async (s: DragScene): Promise<{ readonly at: Pt; readonly held: Seen }> => {
  const g = s.grab
  await mouse.down(g)
  await glide(g, { x: g.x, y: g.y + 60 }, 12) // leaves D's bottom edge at +40
  await glide({ x: g.x, y: g.y + 60 }, { x: g.x + 60, y: g.y + 60 }, 6)
  await wait(150)
  const held = seen(s)
  const at = { x: g.x + 60, y: g.y + 60 }
  await mouse.up(at)
  await wait(900)
  return { at, held }
}

/**
 * The prelude for a lost release: D is pressed, glided 40 px right and released there,
 * but the release never reaches Wardic (`loseNextRelease`). The mouse button is up.
 */
const loseRelease = async (s: DragScene): Promise<{ readonly at: Pt; readonly held: Seen }> => {
  disposers.push(loseNextRelease())
  const g = s.grab
  await mouse.down(g)
  await glide(g, { x: g.x + 40, y: g.y }, 8)
  await wait(150)
  const held = seen(s)
  const at = { x: g.x + 40, y: g.y }
  await mouse.up(at)
  await wait(150)
  return { at, held }
}

describe.each(["layout", "free"] as const)("%s drag", (mode) => {
  const rest = (dx: number): number => (mode === "layout" ? 0 : dx)

  it("P0: moves that stay on D and a release on D", async () => {
    const s = await mountDrag(mode)
    const g = s.grab
    await mouse.down(g)
    await glide(g, { x: g.x + 40, y: g.y }, 10)
    await wait(150)
    const held = seen(s)
    await mouse.up({ x: g.x + 40, y: g.y })
    await wait(900)
    const after = seen(s)
    expect.soft(held.dx, "D follows the pointer").toBeCloseTo(40, 0)
    expect.soft(after.opacity, "the release ends the drag (whileDrag off)").toBeGreaterThan(0.95)
    expect.soft(after.dx, "D rests where the release leaves it").toBeCloseTo(rest(40), 0)
  })

  it("P1: a jump that takes the pointer off D, then more moves off it", async () => {
    const s = await mountDrag(mode)
    const g = s.grab
    await mouse.down(g)
    await glide(g, { x: g.x + 12, y: g.y }, 6)
    await wait(100)
    const before = seen(s)
    // D spans [grab − 20 + 12, grab + 112] now; +200 is 88 px past its right edge.
    await mouse.move({ x: g.x + 200, y: g.y })
    await wait(20)
    await glide({ x: g.x + 200, y: g.y }, { x: g.x + 240, y: g.y }, 4)
    await wait(150)
    const off = seen(s)
    await mouse.up({ x: g.x + 240, y: g.y })
    await wait(900)
    const after = seen(s)
    expect.soft(before.dx, "D follows the small moves").toBeCloseTo(12, 0)
    expect.soft(off.dx, "D follows the pointer after the jump off it").toBeCloseTo(240, 0)
    expect.soft(after.opacity, "the release ends the drag (whileDrag off)").toBeGreaterThan(0.95)
    expect.soft(after.dx, "D rests where the release leaves it").toBeCloseTo(rest(240), 0)
  })

  it("P2: an x-locked D whose pointer drifts off it, then a release outside", async () => {
    const s = await mountDrag(mode, "x")
    const { held } = await releaseOutside(s)
    const after = seen(s)
    expect.soft(held.dx, "D follows x while the pointer is off it").toBeCloseTo(60, 0)
    expect.soft(held.dy, "y stays locked").toBeCloseTo(0, 0)
    expect.soft(after.opacity, "the release outside ends the drag (whileDrag off)").toBeGreaterThan(0.95)
    expect.soft(after.dx, "D rests where the release leaves it").toBeCloseTo(rest(60), 0)
    expect.soft(s.pressed(), "the release outside ends the press").toBe(false)
  })

  it("P3: an unpressed move over D after a release outside", async () => {
    const s = await mountDrag(mode, "x")
    const { at } = await releaseOutside(s)
    const restAt = seen(s)
    const mark = s.samples.length
    const b = s.el.getBoundingClientRect()
    const centre = { x: b.left + 60, y: b.top + 40 }
    await glide(at, centre, 6)
    await glide(centre, { x: centre.x + 30, y: centre.y }, 3)
    await wait(200)
    const after = seen(s)
    expect.soft(after.dx, "an unpressed move doesn't drag D").toBeCloseTo(restAt.dx, 0)
    expect.soft(phases(s.samples, mark), "no drag samples without a press").toBe("none")
  })

  it("P4: a second press after a release outside starts its own drag", async () => {
    const s = await mountDrag(mode, "x")
    const { at } = await releaseOutside(s)
    const b = s.el.getBoundingClientRect()
    const centre = { x: b.left + 60, y: b.top + 40 }
    await glide(at, centre, 6)
    await wait(100)
    const atPress = seen(s)
    const mark = s.samples.length
    await mouse.down(centre)
    await glide(centre, { x: centre.x + 30, y: centre.y }, 6)
    await wait(150)
    const held = seen(s)
    const heldSamples = s.samples.slice(mark)
    await mouse.up({ x: centre.x + 30, y: centre.y })
    await wait(900)
    const after = seen(s)
    expect.soft(heldSamples[0]?.phase, "the second press starts a drag").toBe("start")
    expect.soft(lastOffsetX(s.samples, mark), "its offset is measured from the second press").toBeCloseTo(30, 0)
    expect.soft(held.dx, "D moves 30 px from where it was pressed").toBeCloseTo(atPress.dx + 30, 0)
    expect.soft(after.opacity, "the release ends the drag").toBeGreaterThan(0.95)
  })

  it("P5: after a lost release, the first unpressed move ends the drag at its last pressed point", async () => {
    const s = await mountDrag(mode)
    const { at, held } = await loseRelease(s)
    const mark = s.samples.length
    await glide(at, { x: at.x + 30, y: at.y }, 3)
    await wait(900)
    const after = seen(s)
    expect.soft(held.dx, "D follows the pressed glide").toBeCloseTo(40, 0)
    expect.soft(phases(s.samples, mark), "the first unpressed move ends the drag, and no move follows").toBe("end")
    expect.soft(lastOffsetX(s.samples, mark), "the drag ends at its last pressed point").toBeCloseTo(40, 0)
    expect.soft(after.opacity, "whileDrag ends").toBeGreaterThan(0.95)
    expect.soft(after.dx, "D rests where the last pressed point leaves it, not at the unpressed pointer").toBeCloseTo(
      rest(40),
      0,
    )
    expect.soft(s.pressed(), "the press ends").toBe(false)
    if (mode === "layout") return
    // With momentum on, the lost release carries no velocity: a fast glide still rests at its last pressed point.
    cleanup()
    const m = await mountDrag("free", true, true)
    disposers.push(loseNextRelease())
    const g = m.grab
    await mouse.down(g)
    await glide(g, { x: g.x + 60, y: g.y }, 4, 10) // ~1,500 px/s
    await mouse.up({ x: g.x + 60, y: g.y })
    await glide({ x: g.x + 60, y: g.y }, { x: g.x + 80, y: g.y }, 2, 10)
    await wait(900)
    expect.soft(Math.abs(seen(m).dx - 60), "momentum on: D rests within 1 px of its last pressed point").toBeLessThan(1)
  })

  it("P6: after a lost release, a press with no move in between ends the old drag and starts its own", async () => {
    const s = await mountDrag(mode)
    const { at } = await loseRelease(s)
    const atPress = seen(s)
    const mark = s.samples.length
    await mouse.down(at, { move: false })
    await glide(at, { x: at.x + 30, y: at.y }, 6)
    await wait(150)
    const held = seen(s)
    await mouse.up({ x: at.x + 30, y: at.y })
    await wait(900)
    const after = seen(s)
    expect.soft(phases(s.samples, mark).startsWith("end start"), "the down ends the old drag and a new one starts").toBe(
      true,
    )
    expect.soft(lastOffsetX(s.samples, mark), "the new offsets are measured from the second down").toBeCloseTo(30, 0)
    // A layout node grabbed while it flies back starts where the grab stopped its Release
    // offset, as a free drag's release does (ADR-0016, Amendment (velocity family), decision 4).
    expect.soft(Math.abs(held.dx - (atPress.dx + 30)), "D moves 30 px from where it was, under the pointer").toBeLessThan(1)
    expect.soft(after.opacity, "the release ends the drag").toBeGreaterThan(0.95)
  })

  // Found by the layout lab's R10: the old gesture's "end" and the new down's grab reach
  // the drag track together, and the grab must not drop the release.
  it("P7: after a lost release, a click with no move ends the stale drag", async () => {
    const s = await mountDrag(mode)
    const { at } = await loseRelease(s)
    const mark = s.samples.length
    await mouse.down(at, { move: false })
    await mouse.up(at)
    await wait(900)
    const after = seen(s)
    expect.soft(phases(s.samples, mark), "the click's down ends the old drag, and the click starts none").toBe("end")
    expect.soft(after.opacity, "whileDrag ends").toBeGreaterThan(0.95)
    expect.soft(after.dx, "D rests where the release leaves it").toBeCloseTo(rest(40), 0)
  })
})

describe("primary pointer", () => {
  it("R1: a right-button press and move on D", async () => {
    const s = await mountDrag("free")
    const g = s.grab
    await mouse.down(g, { button: "right" })
    await glide(g, { x: g.x + 40, y: g.y }, 8)
    await wait(150)
    const held = seen(s)
    const heldPress = s.pressed()
    await mouse.up({ x: g.x + 40, y: g.y }, { button: "right" })
    await wait(300)
    expect.soft(phases(s.samples, 0), "a right button starts no drag").toBe("none")
    expect.soft(held.dx, "D doesn't move").toBeCloseTo(0, 0)
    expect.soft(heldPress, "and isn't pressed").toBe(false)
  })

  // CDP touch: Chromium only. CDP's touchEnd lifts every finger, so the second finger
  // stays down until the end; its down is what a drag must ignore.
  it.skipIf(!cdpTouch)("M1: finger 1 drags D; finger 2 lands on D; finger 1 moves on", async () => {
    const s = await mountDrag("free", true, false, "none")
    const g = s.grab
    const f2 = { x: g.x + 60, y: g.y + 20 }
    await commands.realTouch("touchStart", [finger(1, g)])
    for (let k = 1; k <= 8; k++) {
      await commands.realTouch("touchMove", [finger(1, { x: g.x + 5 * k, y: g.y })])
      await wait(20)
    }
    await wait(150)
    const before = seen(s)
    await commands.realTouch("touchStart", [finger(1, { x: g.x + 40, y: g.y }), finger(2, f2)])
    await wait(100)
    for (let k = 1; k <= 4; k++) {
      await commands.realTouch("touchMove", [finger(1, { x: g.x + 40 + 5 * k, y: g.y }), finger(2, f2)])
      await wait(20)
    }
    await wait(150)
    const after = seen(s)
    await commands.realTouch("touchEnd", [])
    await wait(300)
    expect.soft(before.dx, "finger 1 drags D").toBeCloseTo(40, 0)
    expect.soft(after.dx, "a second finger doesn't rebase the drag").toBeCloseTo(60, 0)
  })

  it.skipIf(!cdpTouch)("M3: finger 1 rests off D; finger 2 drags D", async () => {
    const s = await mountDrag("free", true, false, "none")
    const g = s.grab
    const f1 = finger(1, { x: g.x + 200, y: g.y + 200 })
    await commands.realTouch("touchStart", [f1])
    await wait(60)
    await commands.realTouch("touchStart", [f1, finger(2, g)])
    for (let k = 1; k <= 8; k++) {
      await commands.realTouch("touchMove", [f1, finger(2, { x: g.x + 5 * k, y: g.y })])
      await wait(20)
    }
    await wait(150)
    const held = seen(s)
    await commands.realTouch("touchEnd", [])
    await wait(300)
    expect.soft(phases(s.samples, 0), "a second finger starts no drag").toBe("none")
    expect.soft(held.dx, "D doesn't move").toBeCloseTo(0, 0)
  })
})

/**
 * The stale-gesture scene (S1, S2): a free draggable D (`whileDrag` opacity 0.5) and a
 * second draggable Y with `whileTap`, both `touch-action: none`. Y can be laid out
 * under a still pointer (`setYAt`).
 */
const mountPair = async () => {
  const [d, setD] = createSignal<HTMLElement>()
  const [y, setY] = createSignal<HTMLElement>()
  const [yAt, setYAt] = createSignal<Pt | undefined>(undefined)
  const samples: Array<Drag.Sample> = []
  const ySamples: Array<Drag.Sample> = []
  let yPressed: () => boolean = () => false
  function Recorder(props: { readonly d: HTMLElement; readonly y: HTMLElement }) {
    // eslint-disable-next-line solid/reactivity
    const sd = createDrag(props.d)
    // eslint-disable-next-line solid/reactivity
    const sy = createDrag(props.y)
    // eslint-disable-next-line solid/reactivity
    yPressed = createPress(props.y)
    createEffect(() => {
      const v = sd()
      if (v !== null) samples.push(v)
    })
    createEffect(() => {
      const v = sy()
      if (v !== null) ySamples.push(v)
    })
    return null
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => setD(n)}
        drag
        dragMomentum={false}
        animate={{ opacity: 1 }}
        whileDrag={{ opacity: 0.5 }}
        style={{ position: "absolute", left: "40px", top: "40px", width: "120px", height: "80px", "touch-action": "none" }}
      />
      <wardic.div
        ref={(n: HTMLElement) => setY(n)}
        drag
        dragMomentum={false}
        animate={{ scale: 1 }}
        whileTap={{ scale: 0.8 }}
        style={{
          position: "absolute",
          left: `${yAt()?.x ?? 320}px`,
          top: `${yAt()?.y ?? 40}px`,
          width: "120px",
          height: "80px",
          "touch-action": "none",
          "z-index": "2",
        }}
      />
      <Show when={d() && y()}>{(_) => <Recorder d={d()!} y={y()!} />}</Show>
    </WardicProvider>
  ))
  await settle()
  const dLeft = d()!.getBoundingClientRect().left
  return {
    samples,
    ySamples,
    yPressed: () => yPressed(),
    dDx: () => r1(d()!.getBoundingClientRect().left - dLeft),
    // Y's centre: `whileTap` scales it about its centre while pressed.
    yCentre: () => {
      const b = y()!.getBoundingClientRect()
      return b.left + b.width / 2
    },
    dOpacity: () => r2(Number(getComputedStyle(d()!).opacity)),
    setYAt,
  }
}

// A lost release that the owning pointer can't end itself: a lifted finger sends no more
// moves, and a new finger has a new pointer id; a mouse pressed again elsewhere keeps
// `buttons ≥ 1`. A new press anywhere on the page, by the same pointer or a new primary
// pointer of its type, ends it (ADR-0019, decision 7).
describe("a press elsewhere after a lost release", () => {
  it.skipIf(!cdpTouch)("S1: touch: a tap on another element presses it, and a new touch drag on D works", async () => {
    const s = await mountPair()
    disposers.push(loseNextRelease())
    const g = { x: 60, y: 80 }
    await commands.realTouch("touchStart", [finger(1, g)])
    for (let k = 1; k <= 8; k++) {
      await commands.realTouch("touchMove", [finger(1, { x: g.x + 5 * k, y: g.y })])
      await wait(20)
    }
    await wait(100)
    await commands.realTouch("touchEnd", []) // swallowed
    await wait(300)
    const lost = { dx: s.dDx(), opacity: s.dOpacity() }
    // Chromium can swallow the first touch after an earlier touch gesture: tap off both first.
    await commands.realTouch("touchStart", [finger(3, { x: 5, y: 300 })])
    await commands.realTouch("touchEnd", [])
    await wait(100)
    await commands.realTouch("touchStart", [finger(4, { x: 380, y: 80 })])
    await wait(200)
    const yPressed = s.yPressed()
    await commands.realTouch("touchEnd", [])
    await wait(300)
    const afterTap = { dx: s.dDx(), opacity: s.dOpacity() }
    const mark = s.samples.length
    const g2 = { x: 100, y: 80 }
    await commands.realTouch("touchStart", [finger(5, g2)])
    for (let k = 1; k <= 6; k++) {
      await commands.realTouch("touchMove", [finger(5, { x: g2.x + 5 * k, y: g2.y })])
      await wait(20)
    }
    await wait(150)
    const dragged = s.dDx()
    await commands.realTouch("touchEnd", [])
    await wait(300)
    expect.soft(lost.opacity, "the lost release leaves the drag on").toBeLessThan(0.6)
    expect.soft(yPressed, "a tap on another element presses it").toBe(true)
    expect.soft(afterTap.opacity, "the tap ended the stale drag (whileDrag off)").toBeGreaterThan(0.95)
    expect.soft(afterTap.dx, "D rests at its last pressed point").toBeCloseTo(40, 0)
    expect.soft(phases(s.samples, mark).startsWith("start"), "a new touch drag on D starts").toBe(true)
    expect.soft(dragged, "and moves D 30 px").toBeCloseTo(70, 0)
  })

  it("S2: mouse: a press on an element laid out under the still pointer drags only it", async () => {
    const s = await mountPair()
    disposers.push(loseNextRelease())
    const g = { x: 60, y: 80 }
    await mouse.down(g)
    await glide(g, { x: g.x + 40, y: g.y }, 8)
    await wait(150)
    const at = { x: g.x + 40, y: g.y }
    await mouse.up(at) // swallowed
    await wait(200)
    const mark = s.samples.length
    s.setYAt({ x: at.x - 60, y: at.y - 40 }) // Y under the pointer, which doesn't move
    await settle()
    const yStart = s.yCentre()
    await mouse.down(at, { move: false })
    await wait(100)
    const yPressed = s.yPressed()
    await glide(at, { x: at.x + 30, y: at.y }, 6)
    await wait(150)
    const held = { dDx: s.dDx(), yMoved: r1(s.yCentre() - yStart) }
    await mouse.up({ x: at.x + 30, y: at.y })
    await wait(600)
    expect.soft(yPressed, "the press on Y presses it").toBe(true)
    expect.soft(phases(s.samples, mark), "the press ends D's stale drag, and D follows nothing after").toBe("end")
    expect.soft(held.dDx, "D stays at its last pressed point").toBeCloseTo(40, 0)
    expect.soft(held.yMoved, "Y drags 30 px").toBeCloseTo(30, 0)
    expect.soft(s.dOpacity(), "D's whileDrag has ended").toBeGreaterThan(0.95)
  })
})

interface StateScene {
  readonly el: HTMLElement
  readonly centre: Pt
  readonly hovered: () => boolean
  readonly pressed: () => boolean
  /** The binding's response: `whileHover` opacity 0.6 (base 0.2), `whileTap` scale 0.8. */
  readonly look: () => { readonly opacity: number; readonly scale: number }
}

const mountState = async (): Promise<StateScene> => {
  const [el, setEl] = createSignal<HTMLElement>()
  let hovered: () => boolean = () => false
  let pressedNow: () => boolean = () => false
  function Recorder(props: { readonly target: HTMLElement }) {
    // eslint-disable-next-line solid/reactivity
    hovered = createHover(props.target)
    // eslint-disable-next-line solid/reactivity
    pressedNow = createPress(props.target)
    return null
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          animate={{ opacity: 0.2, scale: 1 }}
          whileHover={{ opacity: 0.6 }}
          whileTap={{ scale: 0.8 }}
          style={{ width: "120px", height: "80px", background: "#8f8" }}
        />
      </div>
      <Show when={el()}>{(target) => <Recorder target={target()} />}</Show>
    </WardicProvider>
  ))
  await settle()
  const target = el()!
  const b = target.getBoundingClientRect()
  return {
    el: target,
    centre: { x: b.left + 60, y: b.top + 40 },
    hovered: () => hovered(),
    pressed: () => pressedNow(),
    look: () => {
      const m = /scale\(([-\d.]+)\)/.exec(target.style.transform)
      return { opacity: r2(Number(getComputedStyle(target).opacity)), scale: r2(m ? Number(m[1]) : 1) }
    },
  }
}

/**
 * The Drag activity scene (H3): an x-locked draggable D above O, a `whileHover`
 * element 40 px below it. D is grabbed at its centre; the pointer can drift down onto
 * O while D, locked to x, stays put.
 */
const mountDragOverO = async (): Promise<{ readonly d: DOMRect; readonly o: StateScene }> => {
  const [d, setD] = createSignal<HTMLElement>()
  const [o, setO] = createSignal<HTMLElement>()
  let hovered: () => boolean = () => false
  let pressedNow: () => boolean = () => false
  function Recorder(props: { readonly target: HTMLElement }) {
    // eslint-disable-next-line solid/reactivity
    hovered = createHover(props.target)
    // eslint-disable-next-line solid/reactivity
    pressedNow = createPress(props.target)
    return null
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setD(n)}
          drag="x"
          dragMomentum={false}
          style={{ position: "relative", width: "120px", height: "80px", background: "#f88" }}
        />
        <wardic.div
          ref={(n: HTMLElement) => setO(n)}
          animate={{ opacity: 0.2 }}
          whileHover={{ opacity: 0.6 }}
          style={{ position: "relative", "margin-top": "40px", width: "120px", height: "80px", background: "#8f8" }}
        />
      </div>
      <Show when={o()}>{(target) => <Recorder target={target()} />}</Show>
    </WardicProvider>
  ))
  await settle()
  const target = o()!
  const b = target.getBoundingClientRect()
  return {
    d: d()!.getBoundingClientRect(),
    o: {
      el: target,
      centre: { x: b.left + 60, y: b.top + 40 },
      hovered: () => hovered(),
      pressed: () => pressedNow(),
      look: () => ({ opacity: r2(Number(getComputedStyle(target).opacity)), scale: 1 }),
    },
  }
}

describe("press and hover", () => {
  it("Q0: a press released on the element", async () => {
    const s = await mountState()
    await glide({ x: 5, y: 5 }, s.centre, 4)
    await mouse.down(s.centre)
    await wait(400)
    await mouse.up(s.centre)
    await wait(400)
    expect.soft(s.pressed(), "the release ends the press").toBe(false)
    expect.soft(s.look().scale, "whileTap ends").toBeCloseTo(1, 1)
  })

  it("Q1: a press whose pointer leaves the element and is released outside", async () => {
    const s = await mountState()
    await glide({ x: 5, y: 5 }, s.centre, 4)
    await mouse.down(s.centre)
    await wait(300)
    const outside = { x: s.centre.x + 150, y: s.centre.y }
    await glide(s.centre, outside, 6)
    await mouse.up(outside)
    await wait(400)
    const released = { pressed: s.pressed(), scale: s.look().scale }
    await glide(outside, s.centre, 6)
    await wait(300)
    expect.soft(released.pressed, "the release outside ends the press").toBe(false)
    expect.soft(released.scale, "whileTap ends").toBeCloseTo(1, 1)
    expect.soft(s.pressed(), "an unpressed move over it doesn't bring the press back").toBe(false)
  })

  it("Q2: after a lost release, the first unpressed move ends the press", async () => {
    const s = await mountState()
    await glide({ x: 5, y: 5 }, s.centre, 4)
    disposers.push(loseNextRelease())
    await mouse.down(s.centre)
    await wait(300)
    await mouse.up(s.centre)
    await wait(300)
    const lost = s.pressed()
    await glide(s.centre, { x: s.centre.x + 10, y: s.centre.y }, 2)
    await wait(400)
    expect.soft(lost, "the lost release leaves the press on").toBe(true)
    expect.soft(s.pressed(), "the first unpressed move ends it").toBe(false)
    expect.soft(s.look().scale, "whileTap ends").toBeCloseTo(1, 1)
  })

  it("H0: hover follows enter and leave", async () => {
    const s = await mountState()
    await glide({ x: 5, y: 5 }, s.centre, 4)
    await wait(400)
    const inside = s.hovered()
    await glide(s.centre, { x: s.centre.x + 150, y: s.centre.y }, 6)
    await wait(400)
    expect.soft(inside, "hover on enter").toBe(true)
    expect.soft(s.hovered(), "hover off on leave").toBe(false)
  })

  // Motion's deferred leave (hover.ts:67-107 @ 16c6122, pinned by hover.test.tsx:279-310).
  it("H1: a leave while pressed waits for the release", async () => {
    const s = await mountState()
    await glide({ x: 5, y: 5 }, s.centre, 4)
    await mouse.down(s.centre)
    await wait(300)
    const outside = { x: s.centre.x + 150, y: s.centre.y }
    await glide(s.centre, outside, 6)
    await wait(300)
    const heldOff = { hovered: s.hovered(), opacity: s.look().opacity }
    await mouse.up(outside)
    await wait(400)
    expect.soft(heldOff.hovered, "hover stays on while the pointer is held off the element").toBe(true)
    expect.soft(heldOff.opacity, "and so does whileHover").toBeCloseTo(0.6, 1)
    expect.soft(s.hovered(), "the release outside ends it").toBe(false)
  })

  // Touch never hovers (Motion's hover.ts:26-28, :99). The browser still fires
  // pointerenter/pointerleave around a touch (enter down … up leave).
  it.skipIf(!cdpTouch)("H2: a touch tap and a touch drag never hover", async () => {
    const s = await mountState()
    // Chromium can swallow the first touch after an earlier test's touch gesture, so
    // tap once off the element first.
    await commands.realTouch("touchStart", [finger(6, { x: 5, y: 5 })])
    await commands.realTouch("touchEnd", [])
    await wait(100)
    const seenHover: Array<boolean> = []
    await commands.realTouch("touchStart", [finger(7, s.centre)])
    await wait(200)
    seenHover.push(s.hovered())
    await commands.realTouch("touchEnd", [])
    await wait(200)
    seenHover.push(s.hovered())
    await commands.realTouch("touchStart", [finger(8, { x: s.centre.x - 40, y: s.centre.y })])
    for (let k = 1; k <= 6; k++) {
      await commands.realTouch("touchMove", [finger(8, { x: s.centre.x - 40 + 30 * k, y: s.centre.y })])
      await wait(20)
      seenHover.push(s.hovered())
    }
    await commands.realTouch("touchEnd", [])
    await wait(300)
    seenHover.push(s.hovered())
    expect.soft(seenHover.every((h) => !h), `hover stays off: ${seenHover.join(",")}`).toBe(true)
    expect.soft(s.look().opacity, "whileHover never starts").toBeCloseTo(0.2, 1)
  })

  // No hover starts while a drag is active (Motion's isDragActive, hover.ts:26-28). At the
  // release over O, Motion leaves O unhovered until the pointer leaves and comes back
  // (framer-motion 13.4.0 runtime, .tmp/motion-check/drag-run31b.ts, 2026-09-29).
  it("H3: a drag whose pointer drifts onto another element doesn't hover it", async () => {
    const { d, o } = await mountDragOverO()
    const g = { x: d.left + 60, y: d.top + 40 }
    await glide({ x: 5, y: 5 }, g, 4)
    await mouse.down(g)
    await glide(g, { x: g.x, y: g.y + 10 }, 2) // past the drag threshold, still on D
    await glide({ x: g.x, y: g.y + 10 }, o.centre, 8) // D can't follow on y: the pointer is over O
    await wait(400)
    const during = { hovered: o.hovered(), opacity: o.look().opacity }
    await mouse.up(o.centre)
    await wait(300)
    const released = o.hovered()
    await glide(o.centre, { x: o.centre.x + 150, y: o.centre.y }, 4)
    await glide({ x: o.centre.x + 150, y: o.centre.y }, o.centre, 4)
    await wait(400)
    expect.soft(during.hovered, "no hover starts on O while the drag is on").toBe(false)
    expect.soft(during.opacity, "O's whileHover never starts").toBeCloseTo(0.2, 1)
    expect.soft(released, "the release over O leaves it unhovered (Motion)").toBe(false)
    expect.soft(o.hovered(), "leaving and coming back hovers it").toBe(true)
  })
})
