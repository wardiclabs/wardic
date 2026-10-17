// ProbeDomLive in a REAL browser. The old happy-dom version could only assert
// SHAPE + wiring (it has no layout engine and never fires ResizeObserver /
// IntersectionObserver / matchMedia "change" headlessly, as its own comments
// noted: "real-browser-verified"). Here Chromium gives REAL geometry and REAL
// observer emissions, so we assert them directly. Real async (the observers fire
// on their own schedule) is awaited with Effect.sleep rather than a yieldNow drain.
import * as Probe from "@wardic/core/Probe"
import { expect, it as it_, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { Atom, AtomRegistry } from "effect/reactivity"
import { ProbeDomLive } from "../src/internal/probe.ts"

const drain = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, { discard: true })

const TestLayer = Layer.provideMerge(ProbeDomLive, AtomRegistry.layer)

layer(TestLayer)("ProbeDomLive", (it) => {
  // --- viewport -----------------------------------------------------------
  it.effect("viewport mirrors the REAL window.innerWidth/innerHeight and re-reads on resize", () =>
    Effect.gen(function* () {
      const probe = yield* Probe.Probe

      const initial = yield* Atom.get(probe.viewport)
      expect(initial.width).toBe(window.innerWidth)
      expect(initial.height).toBe(window.innerHeight)
      // A real browser has a non-zero viewport (happy-dom defaulted to a fixed stub).
      expect(initial.width).toBeGreaterThan(0)
      expect(initial.height).toBeGreaterThan(0)

      // window.innerWidth is read-only in a real browser, so we can't force a size
      // change; dispatch a real "resize" and assert the listener re-reads (the Atom
      // stays consistent with the live window — proves the wiring fired, no stale).
      yield* drain
      window.dispatchEvent(new Event("resize"))
      yield* drain
      const after = yield* Atom.get(probe.viewport)
      expect(after).toEqual({ width: window.innerWidth, height: window.innerHeight })
    }))

  it.effect("viewport is written inside the resize event: a subscriber runs before dispatchEvent returns (ADR-0018, Amendment (#45))", () =>
    Effect.gen(function* () {
      const probe = yield* Probe.Probe
      const registry = yield* AtomRegistry.AtomRegistry
      let calls = 0
      const stop = registry.subscribe(probe.viewport, () => calls++)
      // A synthetic dispatch runs its listeners synchronously, with no microtask between them: only
      // a write inside the event reaches the subscriber before `dispatchEvent` returns.
      window.dispatchEvent(new Event("resize"))
      expect(calls, "written inside the event, not a scheduler hop later").toBe(1)
      stop()
    }))

  // --- prefersReducedMotion ----------------------------------------------
  it.effect("prefersReducedMotion reads a boolean from REAL matchMedia", () =>
    Effect.gen(function* () {
      const probe = yield* Probe.Probe
      const value = yield* Atom.get(probe.prefersReducedMotion)
      expect(typeof value).toBe("boolean")
      // Cross-check against the real media query (headless default is no-preference).
      expect(value).toBe(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    }))

  // --- measure (REAL geometry) -------------------------------------------
  it.effect("measure returns the element's REAL bounds (non-zero, all 8 fields)", () =>
    Effect.gen(function* () {
      const probe = yield* Probe.Probe
      const el = document.createElement("div")
      el.style.cssText = "position:absolute;left:10px;top:20px;width:100px;height:40px"
      document.body.appendChild(el)
      try {
        const bounds = yield* probe.measure(el)
        for (const key of ["x", "y", "width", "height", "top", "right", "bottom", "left"] as const) {
          expect(typeof bounds[key]).toBe("number")
        }
        // REAL layout (happy-dom reported all-zeros here).
        expect(bounds.width).toBeCloseTo(100, 0)
        expect(bounds.height).toBeCloseTo(40, 0)
        expect(bounds.left).toBeCloseTo(10, 0)
        expect(bounds.top).toBeCloseTo(20, 0)
      } finally {
        el.remove()
      }
    }))
})

// The observer tests need REAL wall-clock time (a real ResizeObserver /
// IntersectionObserver fires on its own schedule), so they use the top-level
// `it.live` (real clock) — `layer()`'s scoped `it` only offers `it.effect`
// (TestClock), under which Effect.sleep would never advance. The layer is
// provided per-test instead.
// --- observeResize (REAL emission + teardown) --------------------------
it_.live("ProbeDomLive > observeResize emits the element's new Bounds when it REALLY resizes, and disconnects", () =>
  Effect.gen(function* () {
      const probe = yield* Probe.Probe
      const el = document.createElement("div")
      el.style.cssText = "position:absolute;width:50px;height:50px"
      document.body.appendChild(el)

      // Spy the per-instance disconnect to also prove teardown (the real observer
      // still works via super).
      let disconnected = 0
      const Real = globalThis.ResizeObserver
      class SpyRO extends Real {
        override disconnect() {
          disconnected++
          return super.disconnect()
        }
      }
      ;(globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = SpyRO as typeof ResizeObserver

      try {
        const received = yield* Ref.make<ReadonlyArray<{ width: number; height: number }>>([])
        const fiber = yield* Effect.forkChild(
          Stream.runForEach(probe.observeResize(el), (b) => Ref.update(received, (xs) => [...xs, b])),
        )

        yield* Effect.sleep("80 millis") // initial RO callback (fires on observe)
        el.style.width = "140px" // REAL resize
        yield* Effect.sleep("150 millis") // RO fires for the new size

        const got = yield* Ref.get(received)
        expect(got.length).toBeGreaterThanOrEqual(1)
        expect(got[got.length - 1]!.width).toBeCloseTo(140, 0) // last emission tracks the real width

        expect(disconnected).toBe(0)
        yield* Fiber.interrupt(fiber).pipe(Effect.andThen(drain))
        expect(disconnected).toBe(1) // last subscriber left -> observer disconnected
      } finally {
        ;(globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = Real
        el.remove()
      }
    }).pipe(Effect.provide(TestLayer)))

// --- observeIntersection (REAL emission + teardown) --------------------
it_.live("ProbeDomLive > observeIntersection emits the REAL intersection state, and disconnects", () =>
  Effect.gen(function* () {
      const probe = yield* Probe.Probe
      const el = document.createElement("div")
      el.style.cssText = "position:absolute;top:0;left:0;width:50px;height:50px"
      document.body.appendChild(el)

      let disconnected = 0
      const Real = globalThis.IntersectionObserver
      class SpyIO extends Real {
        override disconnect() {
          disconnected++
          return super.disconnect()
        }
      }
      ;(globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
        SpyIO as unknown as typeof IntersectionObserver

      try {
        const received = yield* Ref.make<ReadonlyArray<boolean>>([])
        const fiber = yield* Effect.forkChild(
          Stream.runForEach(probe.observeIntersection(el), (v) => Ref.update(received, (xs) => [...xs, v])),
        )

        // IntersectionObserver fires an initial async callback after observe.
        yield* Effect.sleep("200 millis")
        const got = yield* Ref.get(received)
        expect(got.length).toBeGreaterThanOrEqual(1)
        expect(got[0]).toBe(true) // element at the top-left is within the viewport

        expect(disconnected).toBe(0)
        yield* Fiber.interrupt(fiber).pipe(Effect.andThen(drain))
        expect(disconnected).toBe(1)
      } finally {
        ;(globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = Real
        el.remove()
      }
    }).pipe(Effect.provide(TestLayer)))
