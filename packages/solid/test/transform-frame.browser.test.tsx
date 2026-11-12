// A box carries no ancestor transform (ADR-0012, *Amendment (#136)*), on screen: real
// rendering, and the real mouse (`commands.realMouse`) where a drag moves the parent.
//
// A Measure pass compared each node's box with the box of its last pass, both read with
// the transforms of every ancestor that isn't a node applied. A parent moved by a transform
// between the two (its `animate`, a free drag, a hand-set style) left a stale box: a
// `layout` child FLIPed from where it was painted before the parent moved, and a dragged
// `<Reorder>` item lost the card's travel at a reorder. Now the pass reads every box with
// those ancestors held at their identity, and compares `layoutId` twins where they paint.
//
// TS5 pins what main already did: a Switch into a modal centred by a transform starts on
// the leaver. Every browser file shares the page's one mouse, parked at (5, 5), and the
// iframe is about 414 px wide, so the scenes sit right of and below it, and stay narrow.
import { cleanup, render } from "@solidjs/testing-library"
import * as Spring from "@wardic/core/Spring"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, Reorder, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX, onCleanup, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { afterPaint, paintedFrames, raf, until } from "./browser-helpers.ts"

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

const centreOf = (el: Element): Pt => {
  const b = el.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}

const leftOf = (el: Element): number => el.getBoundingClientRect().left
const widthOf = (el: Element): number => el.getBoundingClientRect().width
const op = (el: HTMLElement): number => Number(el.style.opacity || "1")

/** Move the real mouse from `from` by `(dx, dy)` in `steps` moves, ~16 ms apart. */
const glide = async (from: Pt, dx: number, dy: number, steps = 10): Promise<Pt> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + (dx * k) / steps, y: from.y + (dy * k) / steps })
    await wait(16)
  }
  return { x: from.x + dx, y: from.y + dy }
}

/** Press `at`, glide by `(dx, dy)`, run `whileHeld`, release, and let the release land. */
const drag = async (at: Pt, dx: number, dy: number, whileHeld: () => void = () => undefined): Promise<void> => {
  await mouse.move(at)
  await wait(60)
  await mouse.down(at)
  await wait(30)
  const end = await glide(at, dx, dy)
  await wait(150)
  whileHeld()
  await mouse.up(end)
  await wait(700)
}

const SPRING = { stiffness: 170, damping: 26 }

/** A Refresh frame at 60 Hz, in ms: a flight's first step (core's `NOMINAL_DT`). */
const FRAME_MS = 1000 / 60

/** {@link SPRING}, resolved once, and rest thresholds it never meets: its curve, unsettled. */
const SPRING_RESOLVED = Spring.resolve(SPRING)
const NEVER_RESTS: Spring.Rest = { delta: -1, speed: -1 }

/** How far a flight on {@link SPRING} has gone `ms` into it: 0 at its start, 1 at its end. */
const progressAt = (ms: number): number => Spring.step(Spring.init({}), ms / 1000, 1, SPRING_RESOLVED, NEVER_RESTS).value

/** The first box a twin paints after a change, and how long the flight the change started has run by then, in ms. */
interface FirstPaint {
  readonly box: DOMRect
  readonly ran: number
}

/**
 * Run `change`, then read the box the twin `el` returns paints in the 2nd frame from it, as
 * {@link paintedFrames} reads it. A loaded runner can read it several frames late (#729), so its frame is
 * the latest one when the box is read, by rAF's own timestamps (HA8 saw `document.timeline` stand still
 * for a frame). The flight's first step is the 1st frame's tick, a nominal frame (ADR-0033), and each
 * frame after it steps by its interval: it has run the frames since the 1st and one more.
 */
const firstPaintAfter = async (change: () => void, el: () => Element): Promise<FirstPaint> => {
  change()
  const firstAt = await new Promise<number>((resolve) => requestAnimationFrame(resolve))
  let frameAt = firstAt
  let reading = true
  const track = (t: number): void => {
    frameAt = t
    if (reading) requestAnimationFrame(track)
  }
  requestAnimationFrame(track)
  const [box] = await paintedFrames(el(), 1)
  reading = false
  return { box, ran: frameAt - firstAt + FRAME_MS }
}

/**
 * A twin's first painted frame is where a flight from its other twin `from` to its own box `to` puts it
 * by then, on {@link SPRING}: within a sixth of its way. Read at once, that's within a sixth of `from`.
 */
const startsOn = (first: FirstPaint, from: DOMRect, to: Pick<DOMRect, "left" | "top" | "width">): void => {
  const gone = progressAt(first.ran)
  for (const key of ["left", "top", "width"] as const) {
    const way = to[key] - from[key]
    const expected = from[key] + way * gone
    const at = `its ${key} ${first.box[key]} ${first.ran.toFixed(0)} ms into a flight from ${from[key]} to ${to[key]}, where ${expected} is expected`
    expect(Math.abs(first.box[key] - expected), at).toBeLessThanOrEqual(Math.abs(way) / 6 + 1)
  }
}

/** A y list of three 100x40 items, 10 px apart: a +60 move crosses the next one's centre and reorders. */
function List() {
  const [values, setValues] = createSignal(["a", "b", "c"])
  return (
    <Reorder.Group axis="y" values={values()} onReorder={setValues} style={{ "list-style": "none", margin: "0", padding: "20px 0 0 20px" }}>
      <For each={values()}>
        {(v) => (
          <Reorder.Item value={v} id={`tf-item-${v}`} dragMomentum={false} style={{ width: "100px", height: "40px", "margin-bottom": "10px", background: "#8cf" }}>
            {v}
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  )
}

/** A plain card moved on x by hand: its `translateX` follows the pressed pointer's dx. Neither Wardic's. */
const handMoved = (el: HTMLElement): void => {
  let from = Number.NaN
  let x = 0
  const down = (e: PointerEvent) => {
    from = e.clientX - x
  }
  const move = (e: PointerEvent) => {
    if (Number.isNaN(from)) return
    x = e.clientX - from
    el.style.transform = `translateX(${x}px)`
  }
  const up = () => {
    from = Number.NaN
  }
  el.addEventListener("pointerdown", down)
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
  onCleanup(() => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
  })
}

const CARD: JSX.CSSProperties = { position: "absolute", left: "20px", top: "60px", width: "200px", height: "200px", background: "#eee" }

/** Twice: grab item a, move +60,+60 (it reorders past b), and read a's x against the card's while held and after. */
const twoGrabs = async (card: () => HTMLElement): Promise<Array<number>> => {
  const item = () => document.getElementById("tf-item-a")!
  const rest = leftOf(item()) - leftOf(card())
  const offsets: Array<number> = []
  for (let k = 0; k < 2; k++) {
    await drag(centreOf(item()), 60, 60, () => offsets.push(leftOf(item()) - leftOf(card()) - rest))
    offsets.push(leftOf(item()) - leftOf(card()) - rest)
  }
  return offsets
}

describe("a box carries no ancestor transform (ADR-0012, Amendment (#136))", () => {
  it("TS1: a Reorder item in a card dragged on x by Wardic stays on its card through a reorder, on both grabs", async () => {
    let card!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(el: HTMLElement) => (card = el)} drag="x" dragMomentum={false} style={CARD}>
          <List />
        </wardic.div>
      </WardicProvider>
    ))
    await settle()
    const offsets = await twoGrabs(() => card)
    expect(leftOf(card) - 20).toBeGreaterThan(100) // the card dragged both times
    for (const offset of offsets) expect(Math.abs(offset)).toBeLessThan(1)
  })

  it("TS2: the same in a plain card moved by a hand-set transform", async () => {
    let card!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <div ref={(el) => {
          card = el
          handMoved(el)
        }} style={CARD}>
          <List />
        </div>
      </WardicProvider>
    ))
    await settle()
    const offsets = await twoGrabs(() => card)
    expect(leftOf(card) - 20).toBeGreaterThan(100)
    for (const offset of offsets) expect(Math.abs(offset)).toBeLessThan(1)
  })

  /** A parent holding a `layout` child K at left 20, 40 px wide; `moveK` puts K at 70. */
  const flipScene = (parent: (k: JSX.Element) => JSX.Element) => {
    let k!: HTMLElement
    const [kLeft, setKLeft] = createSignal(20)
    render(() => (
      <WardicProvider env={DomLive}>
        {parent(
          <wardic.div
            ref={(el: HTMLElement) => (k = el)}
            layout
            layoutDependency={kLeft()}
            transition={SPRING}
            style={{ position: "absolute", left: `${kLeft()}px`, top: "20px", width: "40px", height: "40px", background: "#c66" }}
          />,
        )}
      </WardicProvider>
    ))
    return { k: () => k, moveK: () => setKLeft(70) }
  }

  /** K's x against its parent's in the first frames after `moveK`: from 20, moving toward 70. */
  const flipFrom = async (s: ReturnType<typeof flipScene>, parent: HTMLElement): Promise<Array<number>> => {
    const p = leftOf(parent)
    const frames = paintedFrames(s.k(), 3)
    s.moveK()
    return (await frames).map((b) => b.left - p)
  }

  it("TS3: a layout child of a parent moved 100 px by its animate FLIPs from where it painted", async () => {
    let parent!: HTMLElement
    const [x, setX] = createSignal(0)
    const s = flipScene((k) => (
      <wardic.div ref={(el: HTMLElement) => (parent = el)} animate={{ x: x() }} transition={SPRING} style={CARD}>
        {k}
      </wardic.div>
    ))
    await settle()
    const rest = leftOf(parent)
    setX(100)
    await until(() => Math.abs(leftOf(parent) - rest - 100) < 0.5)
    await wait(300)
    const rel = await flipFrom(s, parent)
    expect(rel[0]).toBeGreaterThanOrEqual(19.5)
    expect(rel[0]).toBeLessThan(30)
    expect(rel[2]).toBeGreaterThan(rel[0]!)
  })

  it("TS4: a layout child of a parent dragged 100 px FLIPs from where it painted", async () => {
    let parent!: HTMLElement
    const s = flipScene((k) => (
      <wardic.div ref={(el: HTMLElement) => (parent = el)} drag="x" dragMomentum={false} style={CARD}>
        {k}
      </wardic.div>
    ))
    await settle()
    const rest = leftOf(parent)
    const at = { x: rest + 150, y: parent.getBoundingClientRect().top + 150 }
    await drag(at, 100, 0)
    expect(leftOf(parent) - rest).toBeCloseTo(100, 0)
    const rel = await flipFrom(s, parent)
    expect(rel[0]).toBeGreaterThanOrEqual(19.5)
    expect(rel[0]).toBeLessThan(30)
    expect(rel[2]).toBeGreaterThan(rel[0]!)
  })

  it("TS5 (guard): a layoutId Switch into a modal centred by a transform starts on the leaver", async () => {
    let a!: HTMLElement
    let b!: HTMLElement
    const [open, setOpen] = createSignal(false)
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", left: "20px", top: "60px", width: "380px", height: "380px" }}>
          <Show
            when={open()}
            fallback={
              <wardic.div ref={(el: HTMLElement) => (a = el)} layoutId="tf5" transition={SPRING} style={{ position: "absolute", left: "10px", top: "280px", width: "80px", height: "60px", background: "#68c" }} />
            }
          >
            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "240px", height: "160px", background: "#eee" }}>
              <wardic.div ref={(el: HTMLElement) => (b = el)} layoutId="tf5" transition={SPRING} style={{ position: "absolute", left: "20px", top: "20px", width: "160px", height: "120px", background: "#68c" }} />
            </div>
          </Show>
        </div>
      </WardicProvider>
    ))
    await settle()
    const from = a.getBoundingClientRect()
    const first = await firstPaintAfter(() => setOpen(true), () => b)
    await until(() => Math.abs(b.getBoundingClientRect().width - 160) < 0.5)
    await settle()
    startsOn(first, from, b.getBoundingClientRect())
  })

  /** A thumbnail twin A in the page, and its twin B in a modal scaled 0.5 (`open`). */
  const scaledTwins = (presence: boolean) => {
    let a!: HTMLElement
    const [open, setOpen] = createSignal(false)
    const twin = () => (
      <Show when={open()}>
        <wardic.div
          id="tf-b"
          layoutId="tf6"
          transition={SPRING}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ position: "absolute", left: "40px", top: "40px", width: "200px", height: "120px", background: "#68c" }}
        />
      </Show>
    )
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", left: "20px", top: "60px", width: "380px", height: "380px" }}>
          <wardic.div
            ref={(el: HTMLElement) => (a = el)}
            layoutId="tf6"
            transition={SPRING}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            style={{ position: "absolute", left: "10px", top: "280px", width: "100px", height: "60px", background: "#c66" }}
          />
          {/* The modal stays; its twin comes and goes, under AnimatePresence for TS7, so the leaver is retained inside it. */}
          <div style={{ position: "absolute", left: "180px", top: "20px", width: "400px", height: "300px", transform: "scale(0.5)", "transform-origin": "0 0" }}>
            <Show when={presence} fallback={twin()}>
              <AnimatePresence>{twin()}</AnimatePresence>
            </Show>
          </div>
        </div>
      </WardicProvider>
    ))
    return { a: () => a, b: () => document.getElementById("tf-b") as HTMLElement, setOpen }
  }

  it("TS6: a crossfade into a modal scaled 0.5 starts on the live twin, which stays locked onto it as it flies", async () => {
    const t = scaledTwins(false)
    await settle()
    const from = t.a().getBoundingClientRect()
    const first = await firstPaintAfter(() => t.setOpen(true), t.b)
    // Its own box: the modal at 200,80 scaled 0.5 from there, B 40 px in, 200 wide.
    startsOn(first, from, { left: 200 + 20, top: 80 + 20, width: 100 })
    let worst = 0
    await until(() => {
      if (op(t.a()) > 0.1) worst = Math.max(worst, Math.abs(leftOf(t.a()) - leftOf(t.b())), Math.abs(widthOf(t.a()) - widthOf(t.b())))
      return op(t.b()) >= 0.99
    })
    expect(worst).toBeLessThan(2)
  })

  it("TS7: closing it under AnimatePresence flies the thumbnail from where the modal's twin painted, and the leaver stays locked onto it", async () => {
    const t = scaledTwins(true)
    await settle()
    t.setOpen(true)
    await until(() => op(t.a()) < 0.05 && t.b() !== null && op(t.b()) >= 0.99)
    await wait(200)
    const b = t.b()
    const from = b.getBoundingClientRect()
    const first = await firstPaintAfter(() => t.setOpen(false), t.a)
    startsOn(first, from, { left: 20 + 10, top: 60 + 280, width: 100 })
    let worst = 0
    let sampled = 0
    await until(() => {
      if (b.isConnected && op(b) > 0.1) {
        sampled++
        worst = Math.max(worst, Math.abs(leftOf(b) - leftOf(t.a())), Math.abs(widthOf(b) - widthOf(t.a())))
      }
      return !b.isConnected
    })
    expect(sampled).toBeGreaterThan(5) // the leaver was retained, visible, for these frames
    expect(worst).toBeLessThan(2)
  })
})
