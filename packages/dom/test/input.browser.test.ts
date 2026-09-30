import { InputSource } from "@wardic/core"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { InputDomLive } from "../src/input.ts"

/** Hand the scheduler a fixed budget of turns so async steps settle. */
const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })

/**
 * Fork a collector draining a shared Stream into a Ref. The forked subscriber's
 * listener attaches asynchronously (subscriber fiber → RcMap.get → lookup →
 * forked pump → fromEventListener), so we `drain` once to let it become live
 * before the test dispatches. `collect(n)` drains, then returns what arrived;
 * `close` interrupts (dropping the ref-count) and drains so finalizers run.
 */
const subscribeIn = <A>(stream: Stream.Stream<A>) =>
  Effect.gen(function* () {
    const received = yield* Ref.make<ReadonlyArray<A>>([])
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(stream, (a) => Ref.update(received, (xs) => [...xs, a])),
    )
    yield* drain
    return {
      collect: (_n: number) => drain.pipe(Effect.andThen(Ref.get(received))),
      close: Fiber.interrupt(fiber).pipe(Effect.andThen(drain)),
    }
  })

/** Wrap an EventTarget to count add/removeEventListener calls (ref-counting). */
const spyTarget = <T extends EventTarget>(target: T) => {
  let adds = 0
  let removes = 0
  const realAdd = target.addEventListener.bind(target)
  const realRemove = target.removeEventListener.bind(target)
  target.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    adds++
    return realAdd(...args)
  }) as typeof target.addEventListener
  target.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    removes++
    return realRemove(...args)
  }) as typeof target.removeEventListener
  return { adds: () => adds, removes: () => removes }
}

// `layer()` provides InputDomLive to every test in the suite and memoizes it,
// so we don't re-provide it per test. Each test uses a FRESH element, so the
// shared RcMaps key distinct entries — no cross-test interference even though
// the layer (and its global keyboard source) is shared.
layer(InputDomLive)("InputDomLive", (it) => {
  it.effect("pointer maps down/move/up: type, coords, buttons, pointerId", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = document.createElement("div")
      const sub = yield* subscribeIn(input.pointer(el))

      el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1, pointerId: 2 }))
      el.dispatchEvent(new PointerEvent("pointermove", { clientX: 7, clientY: 8, buttons: 1, pointerId: 2 }))
      el.dispatchEvent(new PointerEvent("pointerup", { clientX: 9, clientY: 10, buttons: 0, pointerId: 2 }))

      const events = yield* sub.collect(3)
      expect(events.map((e) => ({ type: e.type, x: e.x, y: e.y, buttons: e.buttons, pointerId: e.pointerId }))).toEqual([
        { type: "down", x: 5, y: 6, buttons: 1, pointerId: 2 },
        { type: "move", x: 7, y: 8, buttons: 1, pointerId: 2 },
        { type: "up", x: 9, y: 10, buttons: 0, pointerId: 2 },
      ])
      yield* sub.close
    }))

  it.effect("pointer maps cancel/enter/leave phases", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = document.createElement("div")
      const sub = yield* subscribeIn(input.pointer(el))

      el.dispatchEvent(new PointerEvent("pointerenter"))
      el.dispatchEvent(new PointerEvent("pointerleave"))
      el.dispatchEvent(new PointerEvent("pointercancel"))

      expect((yield* sub.collect(3)).map((e) => e.type)).toEqual(["enter", "leave", "cancel"])
      yield* sub.close
    }))

  it.effect("focus maps focus/blur", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = document.createElement("div")
      const sub = yield* subscribeIn(input.focus(el))

      el.dispatchEvent(new FocusEvent("focus"))
      el.dispatchEvent(new FocusEvent("blur"))

      expect((yield* sub.collect(2)).map((e) => e.type)).toEqual(["focus", "blur"])
      yield* sub.close
    }))

  it.effect("wheel maps deltaX/deltaY/deltaZ", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = document.createElement("div")
      const sub = yield* subscribeIn(input.wheel(el))

      el.dispatchEvent(new WheelEvent("wheel", { deltaX: 1, deltaY: 2, deltaZ: 3 }))

      const events = yield* sub.collect(1)
      expect(events.map((e) => ({ deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ }))).toEqual([
        { deltaX: 1, deltaY: 2, deltaZ: 3 },
      ])
      yield* sub.close
    }))

  it.effect("keyboard maps document keydown/keyup with key/code/repeat", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const sub = yield* subscribeIn(input.keyboard())

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", repeat: false }))
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", repeat: false }))

      const events = yield* sub.collect(2)
      expect(events.map((e) => ({ type: e.type, key: e.key, code: e.code, repeat: e.repeat }))).toEqual([
        { type: "down", key: "a", code: "KeyA", repeat: false },
        { type: "up", key: "a", code: "KeyA", repeat: false },
      ])
      yield* sub.close
    }))

  it.effect("ref-counting: two subscribers to pointer(sameEl) attach one listener-set; removed after last closes", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = document.createElement("div")
      const spy = spyTarget(el)

      const a = yield* subscribeIn(input.pointer(el))
      const b = yield* subscribeIn(input.pointer(el))

      // One listener-set: 6 pointer event types attached exactly once, shared by
      // both subscribers (not 12). No removals yet.
      expect(spy.adds()).toBe(6)
      expect(spy.removes()).toBe(0)

      // Both subscribers see the same event off the one shared listener-set.
      el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 1, clientY: 2, buttons: 1 }))
      expect((yield* a.collect(1)).map((e) => e.type)).toEqual(["down"])
      expect((yield* b.collect(1)).map((e) => e.type)).toEqual(["down"])

      // First leaves: ref-count >= 1, listeners stay. Last leaves: all removed.
      yield* a.close
      expect(spy.removes()).toBe(0)
      yield* b.close
      expect(spy.removes()).toBe(6)
    }))
})

// A Held pointer (ADR-0019, #31): a pointer that went down on the target keeps
// delivering its moves, release and cancel to `pointer(target)` wherever they land,
// until it is released. The DOM adds page-wide (window, capture-phase) listeners inside
// the down's dispatch and removes them at the release: move, up, cancel, and down,
// which ends a hold whose release was lost (decision 7). Page-wide events are dispatched
// on `document.body`; the target is attached to the document, so a window listener
// sees the events dispatched on it too.

/** A synthetic pointer event shaped like a real mouse's: primary, bubbling. */
const pointerEvent = (type: string, init: PointerEventInit = {}): PointerEvent =>
  new PointerEvent(type, { pointerType: "mouse", isPrimary: true, pointerId: 1, bubbles: true, ...init })

/** Count the window's capture-phase `pointer*` listeners added and removed while it runs. */
const spyWindowPointer = () => {
  let adds = 0
  let removes = 0
  const realAdd = window.addEventListener.bind(window)
  const realRemove = window.removeEventListener.bind(window)
  const counts = (type: string, options: unknown): boolean =>
    type.startsWith("pointer") &&
    (options === true || (typeof options === "object" && options !== null && (options as AddEventListenerOptions).capture === true))
  window.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    if (counts(args[0], args[2])) adds++
    return realAdd(...args)
  }) as typeof window.addEventListener
  window.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    if (counts(args[0], args[2])) removes++
    return realRemove(...args)
  }) as typeof window.removeEventListener
  return {
    adds: () => adds,
    removes: () => removes,
    restore: () => {
      window.addEventListener = realAdd
      window.removeEventListener = realRemove
    },
  }
}

/** A fresh target attached to the document; removed when the test's scope closes. */
const attachedTarget = Effect.acquireRelease(
  Effect.sync(() => {
    const el = document.createElement("div")
    document.body.append(el)
    return el
  }),
  (el) => Effect.sync(() => el.remove()),
)

layer(InputDomLive)("InputDomLive: Held pointer", (it) => {
  it.effect("I1: a pointer that went down on the target keeps its moves, release and cancel", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 300, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointerup", { clientX: 310 }))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1, pointerId: 2 }))
      document.body.dispatchEvent(pointerEvent("pointercancel", { clientX: 320, pointerId: 2 }))
      const events = yield* sub.collect(5)
      expect(events.map((e) => `${e.type}@${e.x}`)).toEqual(["down@0", "move@300", "up@310", "down@0", "cancel@320"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I2: a held pointer's move on the target itself arrives once", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      el.dispatchEvent(pointerEvent("pointermove", { clientX: 5, buttons: 1 }))
      el.dispatchEvent(pointerEvent("pointerup", { clientX: 5 }))
      const events = yield* sub.collect(3)
      expect(events.map((e) => e.type)).toEqual(["down", "move", "up"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I3: a page-wide move in the down's own task arrives (the listeners are added inside its dispatch)", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 200, buttons: 1 }))
      const events = yield* sub.collect(2)
      expect(events.map((e) => `${e.type}@${e.x}`)).toEqual(["down@0", "move@200"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I4: the release, a cancel or a move with no button pressed ends it", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      for (const ending of ["pointerup", "pointercancel", "pointermove"] as const) {
        const el = yield* attachedTarget
        const sub = yield* subscribeIn(input.pointer(el))
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
        document.body.dispatchEvent(pointerEvent(ending, { clientX: 100, buttons: 0 }))
        document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 200, buttons: 0 }))
        const events = yield* sub.collect(2)
        const kind = ending === "pointerup" ? "up" : ending === "pointercancel" ? "cancel" : "move"
        expect(events.map((e) => `${e.type}@${e.x}`), `ended by a ${ending}`).toEqual(["down@0", `${kind}@100`])
        yield* sub.close
      }
    }).pipe(Effect.scoped))

  it.effect("I5: page-wide listeners only while a pointer is held", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const spy = spyWindowPointer()
      try {
        const sub = yield* subscribeIn(input.pointer(el))
        expect(spy.adds(), "none at subscribe").toBe(0)
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
        yield* sub.collect(1)
        expect(spy.adds(), "move, up, cancel and down at the down").toBe(4)
        document.body.dispatchEvent(pointerEvent("pointerup", { clientX: 0 }))
        yield* sub.collect(2)
        expect(spy.removes(), "all four at the release").toBe(4)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I6: two held pointers share one page-wide set until both are released", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const spy = spyWindowPointer()
      try {
        const sub = yield* subscribeIn(input.pointer(el))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1, pointerId: 1 }))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1, pointerId: 2, isPrimary: false }))
        yield* sub.collect(2)
        expect(spy.adds(), "one set for both").toBe(4)
        document.body.dispatchEvent(pointerEvent("pointerup", { pointerId: 1 }))
        yield* sub.collect(3)
        expect(spy.removes(), "kept while pointer 2 is held").toBe(0)
        document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 50, buttons: 1, pointerId: 2, isPrimary: false }))
        document.body.dispatchEvent(pointerEvent("pointerup", { pointerId: 2, isPrimary: false }))
        const events = yield* sub.collect(5)
        expect(events.map((e) => `${e.type}#${e.pointerId}`)).toEqual(["down#1", "down#2", "up#1", "move#2", "up#2"])
        expect(spy.removes(), "removed at the last release").toBe(4)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I7: pointerType, button and isPrimary are mapped from the DOM event", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { pointerType: "pen", isPrimary: false, button: 2, buttons: 2 }))
      el.dispatchEvent(pointerEvent("pointerup", { pointerType: "pen", isPrimary: false, button: 2, buttons: 0 }))
      const events = yield* sub.collect(2)
      expect(events.map((e) => ({ type: e.type, pointerType: e.pointerType, button: e.button, isPrimary: e.isPrimary }))).toEqual([
        { type: "down", pointerType: "pen", button: 2, isPrimary: false },
        { type: "up", pointerType: "pen", button: 2, isPrimary: false },
      ])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I8: a pointer that never went down on the target doesn't reach it from the page", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1, pointerId: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 70, buttons: 1, pointerId: 3 }))
      document.body.dispatchEvent(pointerEvent("pointerup", { pointerId: 3 }))
      const events = yield* sub.collect(1)
      expect(events.map((e) => `${e.type}#${e.pointerId}`)).toEqual(["down#1"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I10: a page-wide press after a lost release ends the hold; a press on the target arrives after it", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 40, buttons: 1 }))
      // The release is lost; the same pointer presses elsewhere on the page.
      document.body.dispatchEvent(pointerEvent("pointerdown", { clientX: 300, buttons: 1 }))
      document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 320, buttons: 1 }))
      // Later it presses the target itself.
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, buttons: 1 }))
      const events = yield* sub.collect(4)
      expect(events.map((e) => `${e.type}@${e.x}/${e.buttons}`)).toEqual(["down@0/1", "move@40/1", "move@40/0", "down@5/1"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I9: two subscribers share one target listener-set and one page-wide set", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const el = yield* attachedTarget
      const target = spyTarget(el)
      const page = spyWindowPointer()
      try {
        const a = yield* subscribeIn(input.pointer(el))
        const b = yield* subscribeIn(input.pointer(el))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1 }))
        document.body.dispatchEvent(pointerEvent("pointermove", { clientX: 90, buttons: 1 }))
        expect((yield* a.collect(2)).map((e) => e.type)).toEqual(["down", "move"])
        expect((yield* b.collect(2)).map((e) => e.type)).toEqual(["down", "move"])
        expect(target.adds(), "one target listener-set").toBe(6)
        expect(page.adds(), "one page-wide set while held").toBe(4)
        yield* a.close
        expect(page.removes(), "kept while a subscriber remains").toBe(0)
        yield* b.close
        expect(target.removes(), "the target's set goes with the last subscriber").toBe(6)
        expect(page.removes(), "and so does the page-wide set").toBe(4)
      } finally {
        page.restore()
      }
    }).pipe(Effect.scoped))
})

// A scroll during a hold (ADR-0019, *Amendment (Reorder)*): while a pointer is held, the
// DOM reports scrolls of the target's scrollable ancestors and of its window, and core's
// heldPointerSource turns each into a move of the held pointer shifted by the scroll, so
// a drag stays under the pointer. Nothing listens for scroll at rest.

/** Count the window's `scroll` listeners added and removed while it runs (any phase). */
const spyWindowScroll = () => {
  let adds = 0
  let removes = 0
  const realAdd = window.addEventListener.bind(window)
  const realRemove = window.removeEventListener.bind(window)
  window.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    if (args[0] === "scroll") adds++
    return realAdd(...args)
  }) as typeof window.addEventListener
  window.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    if (args[0] === "scroll") removes++
    return realRemove(...args)
  }) as typeof window.removeEventListener
  return {
    adds: () => adds,
    removes: () => removes,
    restore: () => {
      window.addEventListener = realAdd
      window.removeEventListener = realRemove
    },
  }
}

/** Wait for the next Refresh frame: scroll events are dispatched in its rendering steps. */
const nextFrame = Effect.promise(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

/** A 100 px tall `overflow: auto` container holding 400 px of content, and a target inside it. */
const scrolledTarget = Effect.acquireRelease(
  Effect.sync(() => {
    const container = document.createElement("div")
    container.style.cssText = "position:relative;width:200px;height:100px;overflow:auto"
    const content = document.createElement("div")
    content.style.cssText = "height:400px"
    const el = document.createElement("div")
    el.style.cssText = "width:50px;height:50px"
    content.append(el)
    container.append(content)
    document.body.append(container)
    return { container, el }
  }),
  ({ container }) => Effect.sync(() => container.remove()),
)

layer(InputDomLive)("InputDomLive: a scroll during a hold", (it) => {
  it.effect("I11: no scroll listener at rest, and none from a plain move", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const spy = spyWindowScroll()
      try {
        const { el } = yield* scrolledTarget
        const sub = yield* subscribeIn(input.pointer(el))
        el.dispatchEvent(pointerEvent("pointermove", { buttons: 0 }))
        yield* sub.collect(1)
        expect(spy.adds()).toBe(0)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I12: a held pointer's container scrolled 60 px arrives as a move shifted 60 px", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const { container, el } = yield* scrolledTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
      container.scrollTop += 60
      yield* nextFrame
      const events = yield* sub.collect(2)
      expect(events.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(["down@5,6", "move@5,66"])
      expect(events[1]!.buttons).toBe(1)
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I13: the window scrolled 60 px while a pointer is held arrives as a shifted move", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const tall = document.createElement("div")
      tall.style.cssText = "height:4000px"
      document.body.append(tall)
      try {
        const { el } = yield* scrolledTarget
        const sub = yield* subscribeIn(input.pointer(el))
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        window.scrollBy(0, 60)
        yield* nextFrame
        const events = yield* sub.collect(2)
        expect(events.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(["down@5,6", "move@5,66"])
        yield* sub.close
      } finally {
        window.scrollTo(0, 0)
        tall.remove()
      }
    }).pipe(Effect.scoped))

  it.effect("I14: a scroll of a container the target isn't in reports nothing", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const { el } = yield* scrolledTarget
      const other = yield* scrolledTarget
      const sub = yield* subscribeIn(input.pointer(el))
      el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
      other.container.scrollTop += 60
      yield* nextFrame
      expect((yield* sub.collect(1)).map((e) => e.type)).toEqual(["down"])
      yield* sub.close
    }).pipe(Effect.scoped))

  it.effect("I15: the two scroll listeners come with the hold and go at its release", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const spy = spyWindowScroll()
      try {
        const { el } = yield* scrolledTarget
        const sub = yield* subscribeIn(input.pointer(el))
        el.dispatchEvent(pointerEvent("pointerdown", { buttons: 1 }))
        expect(spy.adds(), "one capture-phase listener for element scrolls, one for the window's own").toBe(2)
        expect(spy.removes()).toBe(0)
        document.body.dispatchEvent(pointerEvent("pointerup", { buttons: 0 }))
        expect(spy.removes()).toBe(2)
        yield* sub.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))

  it.effect("I16: two subscribers to one element share one pair of scroll listeners", () =>
    Effect.gen(function* () {
      const input = yield* InputSource
      const spy = spyWindowScroll()
      try {
        const { container, el } = yield* scrolledTarget
        const a = yield* subscribeIn(input.pointer(el))
        const b = yield* subscribeIn(input.pointer(el))
        el.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 6, buttons: 1 }))
        expect(spy.adds()).toBe(2)
        container.scrollTop += 60
        yield* nextFrame
        expect((yield* a.collect(2)).map((e) => `${e.type}@${e.y}`)).toEqual(["down@6", "move@66"])
        expect((yield* b.collect(2)).map((e) => `${e.type}@${e.y}`)).toEqual(["down@6", "move@66"])
        yield* a.close
        yield* b.close
      } finally {
        spy.restore()
      }
    }).pipe(Effect.scoped))
})
