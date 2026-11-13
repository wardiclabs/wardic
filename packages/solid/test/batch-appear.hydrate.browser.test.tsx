// A Batch's members' Appear animations, server render to hydration, on Solid 1 (#706, ADR-0044
// *Amendment (#706)*): every frame read after its callbacks, against the member's own Batch at its CSS
// animation's time, or a Wardic element on the same spec beside it.
//
// - BH1: a member and a Wardic element on one spec rise in alike, frame for frame, through a Handoff
//   mid-flight; no CSS animation left on the member after.
// - BH2: a staggered grid, each member to its own target: each frame its own Batch at its CSS time,
//   before hydration and after, through the Handoff mid-flight.
// - BH3: hydrated after the rules have ended: each member at its target throughout, none moving at the
//   Handoff, no CSS animation left.
// - BH4: never hydrated (JS off): the CSS plays each member to its target and holds it there.
// - BH5: under reduced motion, the reduced rule (the server's `"user"`): `x` snaps at each member's delay,
//   `opacity` fades; the client's reduced change takes it over.
// - BH6 (Q16, Q20): a Batch Reorder group's column fades in from first paint, taken over mid-flight.
// - BH7: a Wardic element on a member's element, with a mount animation of its own, leaves the Batch's
//   animation to its Batch, which takes it over mid-flight; its own mount plays from hydration. A member
//   whose own style sets an animation plays none, and moves from its start at hydration.
// - BH8 (Q21): a Batch without `appear` leaves a Wardic element on its member's element its own Appear
//   animation, which goes on through hydration, and moves its member from its start.
import * as Batch from "@wardic/core/Batch"
import * as Bool from "effect/Boolean"
import * as Rec from "effect/Record"
import type { JSX } from "solid-js"
import { commands } from "vitest/browser"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanups, followsMachine, type Run, runServerRendered, TOL } from "./appear-hydrate-harness.ts"
import { B1, B2, B2_STAGGER, B2_TARGETS, B2_TWEEN, B3, B3_TWEEN, B4, B4_TWEEN, B5 } from "./batch-appear-fixtures.tsx"
import "./browser-commands.ts"

const FILE = "./test/batch-appear-fixtures.tsx"

const run = (name: string, code: () => JSX.Element, options: Parameters<typeof runServerRendered>[3]): Promise<Run> => runServerRendered(FILE, name, code, options)

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await commands.emulateReducedMotion(false)
})

beforeAll(async () => {
  await commands.serverRenderPage(FILE, "B1", "warm")
}, 60_000)

const F = 1 / 60
const UNDRAWN: Batch.Writer<null> = { writes: () => true, forKeys: () => () => undefined }

/** A member's own Batch `seconds` into its change, its delay counted: started there, as the Handoff starts it. */
const memberAt = (
  keys: ReadonlyArray<string>,
  transition: Batch.Transitions,
  start: Readonly<Record<string, number>>,
  targets: ReadonlyArray<number>,
  delay: number,
  seconds: number,
): Record<string, number> => {
  const batch = Batch.make({ keys, writer: UNDRAWN, transition })
  const slot = Batch.enter(batch, null, start)
  Batch.retarget(batch, [slot], (_, k) => targets[k] as number, { delay, startAt: () => Math.max(0, seconds) })
  Batch.step(batch, F)
  const values = Object.fromEntries(keys.map((key) => [key, Batch.get(batch, slot, key)]))
  // An opacity past 1 draws as 1.
  if (values.opacity !== undefined) values.opacity = Math.min(1, Math.max(0, values.opacity))
  return values
}

/** B2's member `i` `seconds` in, on `transition`. */
const tileAt = (i: number, seconds: number, transition: Batch.Transitions = B2_TWEEN) =>
  memberAt(["x", "opacity"], transition, { x: 0, opacity: 0 }, [B2_TARGETS[i] as number, 1], i * B2_STAGGER, seconds)

/**
 * Whether `k` was let go of its CSS animation after hydration and runs none from then on: at its first
 * change's first step, which waits at the page's first Handoff for the Handoff's code to load (Q11), its CSS
 * drawing it meanwhile.
 */
const handedOff = (r: Run, k: string): boolean => {
  const after = r.frames.filter((frame) => frame.hydrated)
  const released = after.findIndex((frame) => frame.drawn[k]?.css === false)
  expect(released, `${k} let go of its CSS animation`).toBeGreaterThanOrEqual(0)
  expect(after.length - released, `${k}: frames after it was let go`).toBeGreaterThan(5)
  return after.slice(released).every((frame) => frame.drawn[k]?.css === false)
}

/** B1's member and Wardic element, frame for frame, within the tolerances: how many frames had both. */
const comparedAlike = (r: Run): number => {
  let compared = 0
  for (const frame of r.frames) {
    const member = frame.drawn.member
    const element = frame.drawn.element
    if (member === undefined || element === undefined) continue
    const where = `at ${frame.at.toFixed(1)} (${Bool.match(frame.hydrated, { onTrue: () => "hydrated", onFalse: () => "before hydration" })})`
    expect(Math.abs(member.y - element.y), `${where}: y ${member.y} vs ${element.y}`).toBeLessThanOrEqual(TOL.px)
    expect(Math.abs(member.opacity - element.opacity), `${where}: opacity ${member.opacity} vs ${element.opacity}`).toBeLessThanOrEqual(TOL.opacity)
    compared++
  }
  return compared
}

describe("a Batch's members' Appear animations, server render to hydration (#706)", () => {
  it("BH1: a member and a Wardic element on one spec rise in alike, frame for frame, through the Handoff", async () => {
    const r = await run("B1", B1, { hydrateAfter: 150, forMs: 1200 })
    expect(comparedAlike(r), "frames compared").toBeGreaterThan(40)
    expect(r.frames.some((frame) => !frame.hydrated && (frame.drawn.member?.y ?? 40) < 39), "moving before hydration").toBe(true)
    expect(handedOff(r, "member")).toBe(true)
  }, 30_000)

  it("BH2: a staggered grid, each member its own Batch at its CSS time, through the Handoff mid-flight", async () => {
    const r = await run("B2", B2, { hydrateAfter: 300, forMs: 1300 })
    for (const i of [0, 1, 2]) {
      const after = followsMachine(r, `t${i}`, (seconds) => tileAt(i, seconds))
      expect(after, `t${i}: frames after hydration`).toBeGreaterThan(5)
      expect(handedOff(r, `t${i}`)).toBe(true)
    }
  }, 30_000)

  it("BH3: hydrated after the rules have ended, each member at its target throughout, none moving", async () => {
    const r = await run("B2", B2, { hydrateAfter: 1300, forMs: 1700 })
    for (const frame of r.frames.filter((f) => f.at - (r.startOf.t2 ?? f.at) > 1000)) {
      for (const i of [0, 1, 2]) {
        const drawn = frame.drawn[`t${i}`]
        expect(Math.abs((drawn?.x ?? Number.NaN) - (B2_TARGETS[i] as number)), `t${i} at its target`).toBeLessThanOrEqual(TOL.px)
        expect(drawn?.opacity).toBe(1)
      }
    }
    expect(handedOff(r, "t2")).toBe(true)
  }, 30_000)

  it("BH4: never hydrated, the CSS plays each member to its target and holds it", async () => {
    const r = await run("B2", B2, { forMs: 1200 })
    const last = r.frames[r.frames.length - 1]
    for (const i of [0, 1, 2]) {
      expect(Math.abs((last?.drawn[`t${i}`]?.x ?? Number.NaN) - (B2_TARGETS[i] as number))).toBeLessThanOrEqual(TOL.px)
      expect(last?.drawn[`t${i}`]?.opacity).toBe(1)
    }
  }, 30_000)

  it("BH5: under reduced motion, the reduced rule plays, x snapping at each delay, and the client's reduced change takes it over", async () => {
    await commands.emulateReducedMotion(true)
    const reduced = { x: { type: "tween", duration: 0 }, opacity: B2_TWEEN } as const
    const r = await run("B2", B2, { hydrateAfter: 300, forMs: 1200 })
    for (const i of [0, 1, 2]) {
      // A display frame near a member's snap can land on either side of it: its x doesn't count there,
      // as in AH9. The delays are whole 60 Hz frames, so a frame lands on the snap itself, where the rAF
      // time this reads and the animation's own can fall either side of it (#736).
      const delay = i * B2_STAGGER
      const nearSnap = (seconds: number): boolean => Math.abs(seconds - delay) < 0.02
      const want = (seconds: number): Record<string, number> => {
        const values = tileAt(i, seconds, reduced)
        return Bool.match(nearSnap(seconds), { onTrue: () => Rec.remove(values, "x"), onFalse: () => values })
      }
      const after = followsMachine(r, `t${i}`, want)
      expect(after).toBeGreaterThan(5)
      expect(handedOff(r, `t${i}`)).toBe(true)
    }
  }, 30_000)

  it("BH6: a Batch Reorder group's column fades in from first paint, taken over mid-flight", async () => {
    const r = await run("B3", B3, { hydrateAfter: 300, forMs: 1300 })
    for (const k of ["ga", "gb", "gc"]) {
      const after = followsMachine(r, k, (seconds) => ({ opacity: memberAt(["opacity"], B3_TWEEN, { opacity: 0 }, [1], 0, seconds).opacity as number }))
      expect(after).toBeGreaterThan(5)
      expect(handedOff(r, k)).toBe(true)
    }
  }, 30_000)

  it("BH7: a Wardic element on a member's element leaves its Batch's animation to the Batch; a vetoed member moves from its start", async () => {
    const r = await run("B4", B4, { hydrateAfter: 300, forMs: 1300 })
    const fade = (seconds: number) => ({ opacity: memberAt(["opacity"], B4_TWEEN, { opacity: 0 }, [1], 0, seconds).opacity as number })
    expect(followsMachine(r, "w", fade)).toBeGreaterThan(5)
    expect(handedOff(r, "w")).toBe(true)
    const before = r.frames.filter((frame) => !frame.hydrated)
    const after = r.frames.filter((frame) => frame.hydrated)
    const last = after[after.length - 1]
    // Its own mount waited for the JavaScript, at its start, then played from hydration.
    for (const frame of before) expect(Math.abs((frame.drawn.w?.scale ?? 0) - 0.5), "w's scale before hydration").toBeLessThanOrEqual(0.01)
    expect(after[1]?.drawn.w?.scale, "w's scale as hydration starts it").toBeLessThan(0.6)
    expect(last?.drawn.w?.scale).toBeCloseTo(1, 2)
    // The vetoed member: no CSS of the Batch's, at its start till hydration, then moved from there.
    expect(r.frames.every((frame) => frame.drawn.v?.css === false), "v runs no CSS animation").toBe(true)
    for (const frame of before) expect(frame.drawn.v?.opacity, "v before hydration").toBe(0)
    expect(after[1]?.drawn.v?.opacity, "v as hydration starts it").toBeLessThan(0.15)
    expect(last?.drawn.v?.opacity).toBe(1)
  }, 30_000)

  it("BH8: without appear, a Wardic element on its member's element keeps its own Appear animation, the member moved from its start", async () => {
    const r = await run("B5", B5, { hydrateAfter: 300, forMs: 1300 })
    const before = r.frames.filter((frame) => !frame.hydrated)
    const after = r.frames.filter((frame) => frame.hydrated)
    const playedTo = before[before.length - 1]?.drawn.w?.scale ?? 0
    // Its own Appear animation plays before hydration, and goes on from there: no step back to its start.
    expect(playedTo, "w's own CSS scale before hydration").toBeGreaterThan(0.6)
    for (const frame of after) expect(frame.drawn.w?.scale ?? 0, "w's scale after hydration").toBeGreaterThanOrEqual(playedTo - 0.02)
    // Its member: at its start till hydration, then moved from there, not from the element's animation's time.
    for (const frame of before) expect(frame.drawn.w?.opacity, "w's opacity before hydration").toBe(0)
    expect(after[1]?.drawn.w?.opacity, "w's opacity as hydration starts it").toBeLessThan(0.15)
    expect(after[after.length - 1]?.drawn.w?.opacity).toBe(1)
  }, 30_000)
})
