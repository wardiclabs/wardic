import type { DragSample } from "@wardic/core"
import { Clock, drag, InputSource, InterpolatorRegistry, Probe, Renderer } from "@wardic/core"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { DomLive } from "../src/index.ts"

/** Hand the scheduler a fixed budget of turns so async steps settle. */
const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })

/**
 * Fork a collector draining a Stream into a Ref. The forked subscriber's DOM
 * listener attaches asynchronously (subscriber fiber → InputSource.pointer →
 * RcMap.get → lookup → forked pump → fromEventListener), so we `drain` once to
 * let it become live before the test dispatches. `collect()` drains, then
 * returns what arrived; `close` interrupts (dropping the ref-count) and drains
 * so finalizers run. Mirrors input.test.ts's `subscribeIn`.
 */
const subscribeIn = <A>(stream: Stream.Stream<A, never, never>) =>
  Effect.gen(function* () {
    const received = yield* Ref.make<ReadonlyArray<A>>([])
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(stream, (a) => Ref.update(received, (xs) => [...xs, a])),
    )
    yield* drain
    return {
      collect: () => drain.pipe(Effect.andThen(Ref.get(received))),
      close: Fiber.interrupt(fiber).pipe(Effect.andThen(drain)),
    }
  })

// `layer(DomLive)` provides the whole composed browser environment to every test
// and memoizes it. Each test uses a FRESH element, so the shared input RcMaps
// key distinct entries — no cross-test interference.
layer(DomLive)("DomLive", (it) => {
  it.effect("end-to-end: core `drag` recognizer over the real DOM produces start/move/end", () =>
    Effect.gen(function* () {
      const el = document.createElement("div")
      // `drag(el)` resolves InputSource from DomLive; R is satisfied by the layer.
      const sub = yield* subscribeIn(drag(el) as Stream.Stream<DragSample, never, never>)

      // pointerdown claims the gesture (no emission yet).
      el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, buttons: 1, pointerId: 1 }))
      // move past the 3px threshold → "start".
      el.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 0, buttons: 1, pointerId: 1 }))
      // further move → "move".
      el.dispatchEvent(new PointerEvent("pointermove", { clientX: 20, clientY: 0, buttons: 1, pointerId: 1 }))
      // release → "end".
      el.dispatchEvent(new PointerEvent("pointerup", { clientX: 20, clientY: 0, buttons: 0, pointerId: 1 }))

      const samples = yield* sub.collect()

      // The headline proof: a CORE recognizer ran over the REAL DOM environment.
      expect(samples.map((s) => s.phase)).toEqual(["start", "move", "end"])
      // Offsets are measured from the down-origin (0,0). Velocity is NOT asserted
      // (happy-dom event timeStamps are unreliable).
      expect(samples[0]!.offset).toEqual({ x: 10, y: 0 })
      expect(samples[1]!.offset).toEqual({ x: 20, y: 0 })

      yield* sub.close
    }))

  it.effect("provides all five services (Clock, Renderer, InputSource, Probe, InterpolatorRegistry)", () =>
    Effect.gen(function* () {
      const clock = yield* Clock
      const renderer = yield* Renderer
      const input = yield* InputSource
      const probe = yield* Probe
      const registry = yield* InterpolatorRegistry

      expect(clock).toBeDefined()
      expect(renderer).toBeDefined()
      expect(input).toBeDefined()
      expect(probe).toBeDefined()
      expect(registry).toBeDefined()
    }))
})
