/**
 * `createFrameEffect(compute, apply)`: an app's own code in Wardic's frame (a **Frame effect**), after
 * Wardic's writes for it and before the frame is drawn. On the DOM, after the Flush gate's commit and
 * before paint.
 *
 * - **compute** reads Live values and signals, tracked. It runs again once something it read changes:
 *   a Live value that moved in the frame, or a signal written since the last.
 * - **apply** runs at the end of the frame after each run of compute, given its value, untracked. What it
 *   returns runs before its next apply, and when its owner is disposed.
 *
 * Frame effects run in the order they were made. Every frame needs no hook of its own: `createTime()` read
 * in compute. Solid's own effect runs on Solid's schedule instead, after the frame is drawn. Under a
 * `<WardicStage>`, it runs in the Stage's Host loop, before the scene renders.
 *
 * @example
 * createFrameEffect(() => target.read("x")(), (x) => {
 *   label.style.transform = `translateX(${x}px)`
 * })
 * @see https://wardic.dev/reference/solid/live-values/create-frame-effect
 */
// #884's PR 1 (ADR-0073 decision 19, *Amendment (#882)*'s Q3): the DOM's slot is core's
// `FrameEffects.onFrameLoop`, one a runtime, open while a Frame effect lives. A Live value reaches Solid as
// a signal set from its Atom, which Solid holds until a microtask (`followAtom`): each effect calls
// `flush()` first, so what the frame moved reaches its compute in the frame, not the next.
import { isServer } from "@solidjs/web"
import * as FrameEffects from "@wardic/core/unstable/FrameEffects"
import * as Report from "@wardic/dom/Report"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as Cause from "effect/Cause"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import { createEffect, flush, onCleanup, untrack, useContext } from "solid-js"
import { useWardicRuntime } from "./provider.tsx"
import { CLIENT_ONLY } from "./solid-reactivity.ts"
import { WardicStage } from "./stage.ts"
import type { WardicRuntime } from "./runtime.ts"

const CLOSE_FAILED = "wardic.createFrameEffect: a finalizer failed"

/** A runtime's Frame effects, while one lives: core's slot, and the Scope it's on. */
interface Slot {
  readonly effects: FrameEffects.FrameEffects
  readonly scope: Scope.Closeable
  live: number
}

/** Each runtime's slot, made at its first Frame effect and closed after its last. */
// Module state (#460, Q7): held weakly by the runtime.
const SLOTS = new WeakMap<WardicRuntime, Slot>()

/** `runtime`'s slot, made now if it has none. */
const slotOf = (runtime: WardicRuntime): Slot => {
  const known = SLOTS.get(runtime)
  if (Predicate.isNotUndefined(known)) return known
  const scope = OwnerScope.open(runtime)
  const report = (defect: unknown): void => void runtime.runFork(Report.failure("wardic.createFrameEffect: an apply failed", Cause.die(defect)))
  const effects = runtime.runSync(FrameEffects.onFrameLoop(report).pipe(Scope.provide(scope)))
  const made: Slot = { effects, scope, live: 0 }
  SLOTS.set(runtime, made)
  return made
}

/** `slot` let go of one Frame effect: closed with the last. */
const release = (runtime: WardicRuntime, slot: Slot): void => {
  slot.live--
  if (slot.live > 0) return
  SLOTS.delete(runtime)
  OwnerScope.close(runtime, slot.scope, CLOSE_FAILED)
}

/** The DOM provider's slot for one Frame effect: held until its owner is disposed. */
const domEffects = (): Pick<FrameEffects.FrameEffects, "add" | "request"> => {
  const runtime = useWardicRuntime()
  const slot = slotOf(runtime)
  slot.live++
  onCleanup(() => release(runtime, slot))
  return slot.effects
}

/** The Frame effects a Frame effect made here joins: its Stage's, else the DOM provider's. */
const effectsHere = (): Pick<FrameEffects.FrameEffects, "add" | "request"> => {
  const stage = useContext(WardicStage)
  if (Predicate.isNotNull(stage)) return stage.frameEffects
  return domEffects()
}

/** Runs `apply` in Wardic's frame, after its writes and before the frame is drawn, each time `compute`'s value is new. */
export const createFrameEffect = <T,>(compute: () => T, apply: (value: T) => void | (() => void)): void => {
  if (isServer) return
  // Under a Stage, its Host loop's (#884's PR 3); else the DOM provider's.
  const effects = effectsHere()
  let due = false
  let value: T
  let cleanup: (() => void) | undefined
  // compute, tracked on Solid's own schedule: it only marks the effect due, and asks for a frame.
  createEffect(
    compute,
    (next) => {
      value = next
      due = true
      effects.request()
    },
    CLIENT_ONLY,
  )
  const remove = effects.add(() => {
    // What this frame moved, a Live value's signal among it, given to Solid now (see the header).
    flush()
    if (!due) return
    due = false
    const ending = cleanup
    cleanup = undefined
    if (Predicate.isNotUndefined(ending)) ending()
    const returned = untrack(() => apply(value))
    if (Predicate.isFunction(returned)) cleanup = returned
  })
  onCleanup(() => {
    remove()
    const ending = cleanup
    cleanup = undefined
    if (Predicate.isNotUndefined(ending)) ending()
  })
}
