// The drag recorder's frames and moves on a phone (#184), against fakes for the browser's rAF, its
// MessageChannel tasks, the window's events and the item's boxes, so the order of a frame's callback,
// its read and a move is set by the test. They need no DOM: the repo's `bun run test` runs them in
// plain Node, and the lab's own vitest under jsdom (vite-plugin-solid sets it):
// - DR1: a read the next frame overtook (a phone painting every 7 ms while touched) reads that frame's
//   paint, so it's recorded as that frame, and that frame's own read is skipped. Before, the recorder
//   asked for its next frame only after a read: the overtaking frame went uncounted, and its paint was
//   read as the frame before, a move ahead of it, judged a frame behind and 3 px off the pointer.
// - DR2: a page scroll before the pointer's first move (a fling still settling as the finger lands) is
//   no move, as Wardic's Held pointer has it (ADR-0019, *Amendment (Reorder)*); the next move counts it.
// - DR3: a layout change noted between a frame's callback and its read drops that read (#31: it would
//   read a layout no frame painted), and the loop goes on to read the next frame.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dragRunOf, type DragRunInput } from "../src/lab/drag-run.ts"
import { attachDragRecorder } from "../src/scenarios/drag-recorder.ts"

type Listener = (e: unknown) => void

/** The browser's tasks, run by hand: rAF callbacks, a frame at a time, and posted messages. */
const browser = () => {
  let now = 0
  let nextId = 1
  let callbacks = new Map<number, FrameRequestCallback>()
  const messages: Array<() => void> = []
  const windowListeners = new Map<string, Set<Listener>>()
  const win = {
    scrollX: 0,
    scrollY: 0,
    addEventListener: (type: string, fn: Listener) => {
      const set = windowListeners.get(type) ?? new Set()
      set.add(fn)
      windowListeners.set(type, set)
    },
    removeEventListener: (type: string, fn: Listener) => void windowListeners.get(type)?.delete(fn),
  }
  const doc = {}
  vi.stubGlobal("window", win)
  vi.stubGlobal("document", doc)
  // The repo's gate runs this in plain Node, with no DOM: the recorder asks whether an event's target is a
  // Node (whether the pointer left the item), and these fakes aren't.
  vi.stubGlobal("Node", class {})
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, fn)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => void callbacks.delete(id))
  vi.stubGlobal(
    "MessageChannel",
    class {
      readonly port1: { onmessage: ((e: { data: unknown }) => void) | null; close: () => void } = { onmessage: null, close: () => {} }
      readonly port2 = { postMessage: (data: unknown) => messages.push(() => this.port1.onmessage?.({ data })) }
    },
  )
  vi.stubGlobal("getComputedStyle", () => ({ borderLeftWidth: "0px", borderTopWidth: "0px" }))
  vi.spyOn(performance, "now").mockImplementation(() => now)
  return {
    win,
    doc,
    /** One frame: time moves on 7 ms, and every rAF callback asked for so far runs. */
    frame: () => {
      now += 7
      const due = callbacks
      callbacks = new Map()
      for (const fn of due.values()) fn(now)
    },
    /** Run the messages posted so far (the frames' reads). */
    reads: () => {
      for (const run of messages.splice(0)) run()
    },
    /** A window event, to its capture listeners. */
    dispatch: (type: string, e: unknown) => {
      now += 1
      for (const fn of windowListeners.get(type) ?? []) fn(e)
    },
  }
}

/** A stage at the client origin, and an 80 x 40 item in it at (20, 20) whose painted offset the test sets. */
const scene = () => {
  const stage = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), clientLeft: 0, clientTop: 0 } as unknown as HTMLElement
  const painted = { x: 0, y: 0 }
  const itemListeners = new Map<string, Listener>()
  const item = {
    getBoundingClientRect: () => ({ left: 20 + painted.x, top: 20 + painted.y, width: 80, height: 40 }),
    offsetLeft: 20,
    offsetTop: 20,
    offsetWidth: 80,
    offsetHeight: 40,
    offsetParent: stage,
    parentElement: stage,
    isConnected: true,
    contains: () => true,
    addEventListener: (type: string, fn: Listener) => void itemListeners.set(type, fn),
    removeEventListener: (type: string) => void itemListeners.delete(type),
  } as unknown as HTMLElement
  return { stage, item, painted, down: (e: unknown) => itemListeners.get("pointerdown")?.(e) }
}

const pointer = (type: string, x: number, y: number, item: HTMLElement, buttons = 1) => ({
  type,
  pointerId: 1,
  clientX: x,
  clientY: y,
  buttons,
  button: 0,
  pointerType: "touch",
  isPrimary: true,
  target: item,
})

let b: ReturnType<typeof browser>

beforeEach(() => {
  b = browser()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const attach = (s: ReturnType<typeof scene>, runs: Array<DragRunInput>) =>
  attachDragRecorder({
    stage: () => s.stage,
    item: () => s.item,
    children: () => ({}),
    mode: () => "test",
    record: (run) => void runs.push(run as DragRunInput),
  })

describe("the drag recorder on a phone (#184)", () => {
  it("DR1: a read the next frame overtook is recorded as that frame, whose own read is skipped", () => {
    const s = scene()
    const runs: Array<DragRunInput> = []
    attach(s, runs)
    s.down(pointer("pointerdown", 60, 40, s.item))
    b.frame()
    b.reads() // frame 1: at the grab
    b.dispatch("pointermove", pointer("pointermove", 60, 50, s.item)) // after frame 1's callback
    b.frame() // frame 2 paints it (the engine writes in the frame)
    s.painted.y = 10
    // Frame 2's read runs late: the page handles a move and paints frame 3 first.
    b.dispatch("pointermove", pointer("pointermove", 60, 60, s.item))
    b.frame()
    s.painted.y = 20
    b.reads() // frame 2's read, then frame 3's
    b.dispatch("pointerup", pointer("pointerup", 60, 60, s.item, 0))
    for (let k = 0; k < 6; k++) {
      b.frame()
      b.reads()
    }
    expect(runs).toHaveLength(1)
    const run = runs[0]!
    const held = run.frames.filter((f) => f.frame <= 3).map((f) => ({ frame: f.frame, y: f.d.y - run.grabBox.y }))
    expect(held, "frame 2 was never read: its read ran after frame 3's paint, and reads that").toEqual([
      { frame: 1, y: 0 },
      { frame: 3, y: 20 },
    ])
    const judged = dragRunOf(run, [])
    expect(judged.framesBehindMax).toBe(0)
    expect(judged.underPointerMaxPx).toBe(0)
  })

  it("DR2: a page scroll before the pointer's first move is no move; the next move counts it, and later scrolls are moves", () => {
    const s = scene()
    const runs: Array<DragRunInput> = []
    attach(s, runs)
    s.down(pointer("pointerdown", 60, 40, s.item))
    b.win.scrollY = 9
    b.dispatch("scroll", { target: b.doc })
    b.dispatch("pointermove", pointer("pointermove", 60, 41, s.item))
    b.win.scrollY = 12
    b.dispatch("scroll", { target: b.doc })
    b.dispatch("pointerup", pointer("pointerup", 60, 41, s.item, 0))
    s.down(pointer("pointerdown", 60, 41, s.item)) // the next press cuts the run short, and records it
    expect(runs).toHaveLength(1)
    expect(runs[0]!.moves.map((m) => ({ dx: m.dx, dy: m.dy }))).toEqual([
      { dx: 0, dy: 10 },
      { dx: 0, dy: 13 },
    ])
  })

  it("DR3: a layout change noted between a frame's callback and its read drops that read; the next frame is read", () => {
    const s = scene()
    const runs: Array<DragRunInput> = []
    const recorder = attach(s, runs)
    s.down(pointer("pointerdown", 60, 40, s.item))
    b.frame()
    b.reads()
    b.frame()
    recorder.noteLayoutChange() // a scenario's timer, after frame 2's paint
    b.reads()
    b.frame()
    b.reads()
    b.dispatch("pointerup", pointer("pointerup", 60, 40, s.item, 0))
    s.down(pointer("pointerdown", 60, 40, s.item))
    expect(runs).toHaveLength(1)
    expect(runs[0]!.frames.map((f) => f.frame)).toEqual([1, 3])
  })
})
