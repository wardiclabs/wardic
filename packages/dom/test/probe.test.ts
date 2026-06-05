// @vitest-environment happy-dom
import { Probe } from "@wardic/core"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { ProbeDomLive } from "../src/probe.ts"

/** Hand the scheduler a fixed budget of turns so async steps settle. */
const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })

/**
 * `layer()` provides ProbeDomLive (merged with its AtomRegistry) to every test
 * and memoizes it, exactly as clock.test.ts merges `ClockDomLive` with
 * `AtomRegistry.layer`. Atoms are read with `Atom.get`, which resolves against
 * the same ambient (Environment) registry the listeners write through. Each
 * observer test uses a FRESH element so the shared RcMaps key distinct entries.
 */
const TestLayer = Layer.provideMerge(ProbeDomLive, AtomRegistry.layer)

layer(TestLayer)("ProbeDomLive", (it) => {
  // --- viewport -----------------------------------------------------------
  it.effect("viewport reflects window.innerWidth/innerHeight and updates on resize", () =>
    Effect.gen(function* () {
      const probe = yield* Probe

      // Initial value mirrors the window. Shape: { width, height: numbers }.
      const initial = yield* Atom.get(probe.viewport)
      expect(typeof initial.width).toBe("number")
      expect(typeof initial.height).toBe("number")
      expect(initial.width).toBe(window.innerWidth)
      expect(initial.height).toBe(window.innerHeight)

      // Let the forked resize listener become live (it attaches asynchronously:
      // make → forkScoped → fromEventListener) before we dispatch.
      yield* drain

      // happy-dom permits mutating innerWidth/innerHeight; dispatch a real
      // window "resize" event and assert the Atom tracks it via the registry.
      ;(window as { innerWidth: number }).innerWidth = 640
      ;(window as { innerHeight: number }).innerHeight = 480
      window.dispatchEvent(new Event("resize"))
      yield* drain

      const updated = yield* Atom.get(probe.viewport)
      expect(updated).toEqual({ width: 640, height: 480 })
    }))

  // --- prefersReducedMotion ----------------------------------------------
  it.effect("prefersReducedMotion reads a boolean from matchMedia", () =>
    Effect.gen(function* () {
      const probe = yield* Probe
      const value = yield* Atom.get(probe.prefersReducedMotion)
      // happy-dom's matchMedia reports `false` by default (no real OS query); we
      // assert the type + default. Reacting to the MediaQueryList "change" event
      // is real-browser-verified (happy-dom does not emit it headlessly).
      expect(typeof value).toBe("boolean")
      expect(value).toBe(false)
    }))

  // --- measure (SMOKE) ----------------------------------------------------
  it.effect("measure returns a Bounds-shaped object with 8 numeric fields", () =>
    Effect.gen(function* () {
      const probe = yield* Probe
      const el = document.createElement("div")
      // happy-dom has no layout engine, so every field is 0. We assert SHAPE
      // only; real geometry is real-browser-verified.
      const bounds = yield* probe.measure(el)
      for (const key of ["x", "y", "width", "height", "top", "right", "bottom", "left"] as const) {
        expect(typeof bounds[key]).toBe("number")
      }
    }))

  // --- observeResize (SMOKE) ---------------------------------------------
  it.effect("observeResize yields a Stream; constructs/observes a ResizeObserver and disconnects on unsubscribe", () =>
    Effect.gen(function* () {
      const probe = yield* Probe
      const el = document.createElement("div")

      // Spy the per-instance observe/disconnect. happy-dom provides
      // ResizeObserver but does not fire it headlessly, so we assert wiring +
      // teardown only; emissions are real-browser-verified.
      let observed = 0
      let disconnected = 0
      const Real = globalThis.ResizeObserver
      class SpyRO extends Real {
        override observe(...args: Parameters<ResizeObserver["observe"]>) {
          observed++
          return super.observe(...args)
        }
        override disconnect() {
          disconnected++
          return super.disconnect()
        }
      }
      ;(globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = SpyRO as typeof ResizeObserver

      try {
        const stream = probe.observeResize(el)
        expect(Stream.isStream(stream)).toBe(true)

        const fiber = yield* Effect.forkChild(Stream.runDrain(stream))
        yield* drain
        expect(observed).toBe(1)
        expect(disconnected).toBe(0)

        yield* Fiber.interrupt(fiber).pipe(Effect.andThen(drain))
        expect(disconnected).toBe(1)
      } finally {
        ;(globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = Real
      }
    }))

  // --- observeIntersection (SMOKE) ---------------------------------------
  it.effect(
    "observeIntersection yields a Stream; constructs/observes an IntersectionObserver and disconnects on unsubscribe",
    () =>
      Effect.gen(function* () {
        const probe = yield* Probe
        const el = document.createElement("div")

        let observed = 0
        let disconnected = 0
        const Real = globalThis.IntersectionObserver
        class SpyIO extends Real {
          override observe(...args: Parameters<IntersectionObserver["observe"]>) {
            observed++
            return super.observe(...args)
          }
          override disconnect() {
            disconnected++
            return super.disconnect()
          }
        }
        ;(globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
          SpyIO as unknown as typeof IntersectionObserver

        try {
          const stream = probe.observeIntersection(el)
          expect(Stream.isStream(stream)).toBe(true)

          const fiber = yield* Effect.forkChild(Stream.runDrain(stream))
          yield* drain
          expect(observed).toBe(1)
          expect(disconnected).toBe(0)

          yield* Fiber.interrupt(fiber).pipe(Effect.andThen(drain))
          expect(disconnected).toBe(1)
        } finally {
          ;(globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = Real
        }
      }),
  )
})
