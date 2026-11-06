import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import { TestClock } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/**
 * springValues physics-completeness: per-key velocity now rides in each emitted
 * Frame.MultiPhysics, and a per-key initial velocity can be seeded — the
 * foundation for a velocity-preserving retarget. Driven via TestClock data
 * replay (fixed dt frames), the standard data-replay convention.
 */

it.effect("(a) a velocity-seeded key moves in that direction faster than an unseeded key", () =>
  Effect.gen(function* () {
    // Two keys, identical springs and start (0) toward identical target (100).
    // `seeded` gets a strong positive initial velocity; `plain` gets none.
    const ticks = TestClock.frames(1, 1 / 60) // just the first tick
    const frames = yield* Stream.runCollect(
      Machine.toStream(Machine.springValues({ seeded: 100, plain: 100 }, { stiffness: 170, damping: 26 }, { from: { seeded: 0, plain: 0 }, velocity: { seeded: 500, plain: 0 } })),
    ).pipe(Effect.provide(TestClock.layer(ticks)))

    const first = Array.from(frames)[0]!
    // On the very first tick the seeded key has already travelled further toward
    // the target purely from its initial momentum.
    expect(first.value.seeded!).toBeGreaterThan(first.value.plain!)
    // And it carries a larger positive instantaneous velocity.
    expect(first.velocity.seeded!).toBeGreaterThan(first.velocity.plain!)
    expect(first.velocity.seeded!).toBeGreaterThan(0)
  }),
)

it.effect("(b) frames carry a per-key velocity map that decays to ~0 as the key settles", () =>
  Effect.gen(function* () {
    const ticks = TestClock.frames(240, 1 / 60) // up to 4s — enough to settle
    const frames = yield* Stream.runCollect(
      Machine.toStream(Machine.springValues({ x: 100 }, { stiffness: 170, damping: 26 }, { from: { x: 0 } })),
    ).pipe(Effect.provide(TestClock.layer(ticks)))

    const all = Array.from(frames) as ReadonlyArray<Frame.MultiPhysics>
    const first = all[0]!
    const last = all.at(-1)!

    // Every frame carries a velocity map keyed like value.
    for (const frame of all) {
      expect(typeof frame.velocity.x).toBe("number")
      expect(Number.isFinite(frame.velocity.x!)).toBe(true)
    }
    // It starts moving, then settles: snapped to target with ~0 velocity.
    expect(first.velocity.x!).toBeGreaterThan(0)
    expect(last.done).toBe(true)
    expect(last.value.x!).toBe(100)
    expect(Math.abs(last.velocity.x!)).toBeLessThan(0.01)
    // Stopped before frames ran out (settle semantics unchanged).
    expect(all.length).toBeLessThan(ticks.length)
  }),
)

it.effect("(c) retarget continuity: seeding from a prior frame's value AND velocity is continuous", () =>
  Effect.gen(function* () {
    const options = { stiffness: 170, damping: 26 }

    // Leg 1 — spring toward T1; grab a mid-flight frame (not settled).
    const leg1 = yield* Stream.runCollect(
      Machine.toStream(Machine.springValues({ x: 100 }, options, { from: { x: 0 } })),
    ).pipe(Effect.provide(TestClock.layer(TestClock.frames(240, 1 / 60))))
    const leg1Frames = Array.from(leg1) as ReadonlyArray<Frame.MultiPhysics>
    const mid = leg1Frames[2]!
    expect(mid.done).toBe(false) // genuinely mid-flight
    const v = mid.value.x!
    const vel = mid.velocity.x!
    expect(vel).not.toBe(0)

    // Leg 2 — fresh springValues toward a NEW target, seeded from the mid frame's
    // value AND velocity. The first emitted frame must reflect that momentum.
    const seededRetarget = yield* Stream.runCollect(
      Machine.toStream(Machine.springValues({ x: 200 }, options, { from: { x: v }, velocity: { x: vel } })),
    ).pipe(Effect.provide(TestClock.layer(TestClock.frames(1, 1 / 60))))
    const seededFirst = (Array.from(seededRetarget) as ReadonlyArray<Frame.MultiPhysics>)[0]!

    // Control — the SAME retarget but with no velocity seed (the old, momentum-
    // losing behaviour). Its first velocity starts from 0 and only the spring
    // force over one tick builds it up.
    const unseededRetarget = yield* Stream.runCollect(
      Machine.toStream(Machine.springValues({ x: 200 }, options, { from: { x: v } })),
    ).pipe(Effect.provide(TestClock.layer(TestClock.frames(1, 1 / 60))))
    const unseededFirst = (Array.from(unseededRetarget) as ReadonlyArray<Frame.MultiPhysics>)[0]!

    // Continuity: the seeded retarget carries the prior momentum — its first
    // velocity is in the neighbourhood of `vel` (spring force over a single
    // 1/60s tick only perturbs it), and crucially NOT reset to 0.
    expect(seededFirst.velocity.x!).not.toBe(0)
    expect(seededFirst.velocity.x!).toBeGreaterThan(vel * 0.5)
    // And it is decisively ahead of the momentum-losing (unseeded) retarget:
    // the carried velocity dominates one tick of spring force.
    expect(seededFirst.velocity.x! - unseededFirst.velocity.x!).toBeGreaterThan(vel * 0.5)
  }),
)
