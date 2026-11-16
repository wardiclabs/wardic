// A pointer the test pushes with its own timestamps, for the browser tests whose drags must not depend
// on when the runner's real mouse events land: H7, DR1 (#206), FL5 (#729), the pushed drags of the
// gesture, layout and batch-driver tests (#734), and the flings that read a release's speed (RT7 and
// RT9 for #778; BG4b, DG9, DT1, DT9, FL4 and DC9 for #783: on the real mouse a loaded runner lands the
// up late, and the release's 100 ms window holds less of the motion). Kept out of browser-helpers.ts,
// which every browser test imports, so only these load @wardic/test and DomLive through it.

import * as InputSource from "@wardic/core/InputSource"
import { DomLive } from "@wardic/dom"
import { TestInput } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import type { WardicEnv } from "../src/runtime.ts"
import { raf } from "./browser-helpers.ts"

/** A point on the page, the harness's `Pt` (not imported: the Solid 2 tests' program would take the Solid 1 harness in with it). */
export interface Pt {
  readonly x: number
  readonly y: number
}

/** Where a pushed event is: an x (its y 0), or a point. */
export type PushedAt = number | Pt

/** A pushed pointer: the Environment its events reach, and how to push them. */
export interface PushedPointer {
  /** The Environment with the pushed InputSource in it, for the `WardicProvider`'s `env`. */
  readonly env: WardicEnv
  /** Push a `type` event at `at`, `after` ms after the one before, or after 0 for the first. */
  readonly push: (type: InputSource.PointerLikeEvent["type"], at: PushedAt, after?: number) => void
  /**
   * Push a `type` event at `at` told for `target`, a Batch's member element, on the feed over many
   * targets (`pointerAmong`, #665) a Batch's drags, presses and hovers hear; `push` reaches it not. A
   * member's drag adopts its down from this feed onto the one `push` reaches and hears the held
   * pointer's moves there, so a member's gesture is its down here, its moves through `push`, and its up
   * through both, here first (the DOM's feed over many targets runs before a member's own).
   */
  readonly pushTo: (target: unknown, type: InputSource.PointerLikeEvent["type"], at: PushedAt, after?: number) => void
}

const ORIGIN: Pt = { x: 0, y: 0 }

const pointOf = (at: PushedAt): Pt => {
  if (Predicate.isNumber(at)) return { x: at, y: 0 }
  return at
}

/**
 * A pointer whose events the test pushes over `over` (`DomLive` by default), each `step` ms (20 by
 * default) after the one before unless its push says otherwise. Each pointer keeps its own time, from 0.
 */
export const pushedPointer = ({ step = 20, over = DomLive }: { readonly step?: number; readonly over?: WardicEnv } = {}): PushedPointer => {
  const input = Effect.runSync(TestInput.pushable())
  let t = 0
  const eventOf = (type: InputSource.PointerLikeEvent["type"], at: PushedAt, after: number): InputSource.PointerLikeEvent => {
    t += after
    const { x, y } = pointOf(at)
    return InputSource.makePointerLikeEvent({ type, x, y, timeStamp: t })
  }
  return {
    env: input.layer.pipe(Layer.provideMerge(over)),
    push: (type, at, after = step) => {
      Effect.runSync(input.push(eventOf(type, at, after)))
    },
    pushTo: (target, type, at, after = step) => {
      Effect.runSync(input.pushTo(target, eventOf(type, at, after)))
    },
  }
}

/** A {@link pushedFling}'s shape. */
export interface PushedFlingOptions {
  /** Where the press is: the origin by default. */
  readonly from?: Pt
  /** The axis the moves are along: x by default. */
  readonly axis?: "x" | "y"
  /** How far the 6 slow moves go, 20 ms apart: 60 px by default. */
  readonly slow?: number
  /** How far each of the 4 fast moves goes, 35 ms apart: 40 px by default. */
  readonly fast?: number
  /** A Batch member element the press is told for, through `pushTo`; none for `push`. */
  readonly target?: unknown
}

/**
 * A flick on `pointer` with its own timestamps (#778, #783): a press at `from`, 6 moves of `slow` / 6
 * px 20 ms apart, then 4 of `fast` px 35 ms apart, each painted. The pointer stays down; let go with
 * `pointer.push("up", end, 5)` at the point returned (a member's up told for it first: see `pushTo`).
 * The release's 100 ms window then reaches back to the first fast move: by default (220 - 100) px
 * over 110 ms, about 1,090 px/s on any host.
 */
export const pushedFling = async (pointer: PushedPointer, { from = ORIGIN, axis = "x", slow = 60, fast = 40, target }: PushedFlingOptions = {}): Promise<Pt> => {
  const along = (by: number): Pt => {
    if (axis === "x") return { x: from.x + by, y: from.y }
    return { x: from.x, y: from.y + by }
  }
  if (Predicate.isUndefined(target)) pointer.push("down", along(0), 0)
  else pointer.pushTo(target, "down", along(0), 0)
  for (let k = 1; k <= 6; k++) {
    pointer.push("move", along((slow * k) / 6), 20)
    await raf()
  }
  for (let k = 1; k <= 4; k++) {
    pointer.push("move", along(slow + fast * k), 35)
    await raf()
  }
  // The last move painted.
  await raf()
  await raf()
  return along(slow + 4 * fast)
}
