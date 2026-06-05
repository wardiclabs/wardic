// @vitest-environment happy-dom
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
