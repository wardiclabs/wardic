/**
 * Low-level sensor hooks (`createX`) — the thin Solid surface over core's
 * recognizers and reactive service inputs (ADR-0006).
 *
 * Each boolean/sample sensor runs the matching core watch with `watchToSignal`
 * (#318, #379): the recognizer's `wardic.*` span, and a Scope of its own with no
 * fiber, closed on the consuming component's unmount (dropping the shared feed's
 * count). `createReducedMotion` bridges
 * `Probe.prefersReducedMotion` (an `Atom`) via {@link fromAtom}, `createReducedMotionConfig` lays the
 * nearest config's setting over it, and `createPageInView` bridges `Probe.pageVisible` (#443). `createTransform` moved to
 * `live-value.ts`, with `createSpring` (#130).
 *
 * All hooks MUST be called within a component/owner (they register `onCleanup`
 * through the bridges and read the runtime from context).
 */
import * as Drag from "@wardic/core/Drag"
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Bool from "effect/Boolean"
import { constFalse } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createComputed, createSignal, getOwner, runWithOwner, untrack } from "solid-js"
import { fromAtom, watchToSignal } from "./bridge.ts"
import { type CreateDragOptions, watchDragSamples } from "./drag-samples.ts"
import { useWardicReducedMotionSetting, useWardicRuntime } from "./provider.tsx"
import { watchPressOn } from "./press.ts"
import { isServer } from "./server.ts"

export type { CreateDragOptions } from "./drag-samples.ts"

/**
 * `true` while the pointer is inside `target`, `false` once it leaves. Wraps the
 * core hover watch (#318); `false` until the first transition.
 */
export const createHover = (target: unknown): Accessor<boolean> =>
  watchToSignal<boolean>(({ on, onDefect }) => Recognizer.watchHover(target, { on: (transition) => on(transition.active), onDefect }), false)

/**
 * `true` while the pointer is held down on `target`, or a **Keyboard press** holds Enter or Space on
 * it (#427, `target` made focusable for one), `false` once released or cancelled. Wraps the core
 * press watch (#318); `false` until the first transition.
 */
export const createPress = (target: unknown): Accessor<boolean> =>
  watchToSignal<boolean>(({ on, onDefect }) => watchPressOn(target, { on: (press) => on(press.phase === "start"), onDefect }), false)

/** Whether an element's config wants each of its gesture recognizers (#87, #273). */
export interface Wants<C> {
  readonly hover: (config: C) => boolean
  readonly press: (config: C) => boolean
  readonly inView: (config: C) => boolean
  readonly focus: (config: C) => boolean
  readonly pan: (config: C) => boolean
}

/** Each gesture recognizer's start: the layers' state signals, and pan's watch (it sets no layer). */
export interface Starts {
  readonly hover: () => Accessor<boolean>
  readonly press: () => Accessor<boolean>
  readonly inView: () => Accessor<boolean>
  readonly focus: () => Accessor<boolean>
  readonly pan: () => void
}

/**
 * The layer recognizers {@link createWhenWanted} has started: each its state's accessor, absent until
 * it starts.
 */
export interface Started {
  readonly hover?: Accessor<boolean> | undefined
  readonly press?: Accessor<boolean> | undefined
  readonly inView?: Accessor<boolean> | undefined
  readonly focus?: Accessor<boolean> | undefined
}

const NONE_STARTED: Started = {}

/** A layer's state: its recognizer's, `false` until it starts. */
export const stateOf = (started: Accessor<boolean> | undefined): boolean =>
  UndefinedOr.match(started, { onUndefined: constFalse, onDefined: (state) => state() })

/**
 * An element's gesture recognizers, each started only once its config wants it (#87, ADR-0040;
 * #273), and kept from then on. Motion's rule: its hover, tap, inView, focus and pan features attach
 * only once their props are set. An element that never wants one starts no fiber and no
 * subscription; one that stops wanting it keeps the recognizer, so a prop that toggles starts it
 * once. A pointer already resting on the element when hover starts counts from its next entry, as
 * Motion's does.
 *
 * One computation reads `config()` once a change for them all: a `wardic.*` element's config is
 * rebuilt at each read. The layers' recognizers started are one signal, so a reader tracks it once,
 * and then each started one's state ({@link stateOf}): Solid 1 tracks every read, the same signal's
 * again included. Each start runs under the caller's owner, not this computation, so its recognizer
 * lives and ends with the caller (its `onCleanup`), not with the next change.
 */
export const createWhenWanted = <C,>(config: Accessor<C>, wants: Wants<C>, starts: Starts): Accessor<Started> => {
  const owner = getOwner()
  const [started, setStarted] = createSignal<Started>(NONE_STARTED)
  let panning = false
  createComputed(() => {
    const c = config()
    const was = untrack(started)
    let now = was
    if (Predicate.isUndefined(was.hover)) {
      if (wants.hover(c)) now = { ...now, hover: runWithOwner(owner, starts.hover) }
    }
    if (Predicate.isUndefined(was.press)) {
      if (wants.press(c)) now = { ...now, press: runWithOwner(owner, starts.press) }
    }
    if (Predicate.isUndefined(was.inView)) {
      if (wants.inView(c)) now = { ...now, inView: runWithOwner(owner, starts.inView) }
    }
    if (Predicate.isUndefined(was.focus)) {
      if (wants.focus(c)) now = { ...now, focus: runWithOwner(owner, starts.focus) }
    }
    if (now !== was) setStarted(now)
    if (Bool.not(panning)) {
      if (wants.pan(c)) {
        panning = true
        runWithOwner(owner, starts.pan)
      }
    }
  })
  return started
}

/**
 * `true` while `target` is focused, `false` once blurred. Wraps the core focus
 * watch (#318); `false` until the first transition.
 */
export const createFocus = (target: unknown): Accessor<boolean> => watchToSignal<boolean>((handlers) => Recognizer.watchFocus(target, {}, handlers), false)

/**
 * `true` while `target` intersects the viewport, `false` otherwise. Wraps the
 * core in-view watch (#318; `{ once: true }` settles after the first `true`);
 * `false` until the first entry.
 */
export const createInView = (
  target: unknown,
  options?: { readonly once?: boolean },
): Accessor<boolean> =>
  watchToSignal<boolean>(({ on, onDefect }) => Recognizer.watchInView(target, { ...options }, { on: (transition) => on(transition.active), onDefect }), false)

/**
 * Latest `Drag.Sample` from a drag gesture on `target`, or `null` before the first sample.
 * Runs the core drag watch (#379) with `options`' axis and claim, each sample kept within
 * `bounds` when present. Like the element's own drag, it holds `target`'s **Drag claim** while a gesture
 * is on, which it shares with every other drag on `target`; refused one, it gets no samples
 * for that gesture.
 */
export const createDrag = (target: unknown, options?: CreateDragOptions): Accessor<Drag.Sample | null> =>
  watchToSignal<Drag.Sample | null>((handlers) => watchDragSamples(target, { ...options }, handlers), null)

/**
 * Reactive `prefers-reduced-motion` preference as a boolean `Accessor`. Resolves
 * `Probe` from the provider runtime to get its `prefersReducedMotion` Atom, then
 * bridges it via {@link fromAtom}.
 *
 * A server can't know the preference: it renders `false`, and a hydrating client keeps
 * `false` until mount, then switches to the live value (the Hydration hold, ADR-0021
 * decision 8), so markup that depends on it hydrates without a mismatch. Motion's
 * `useReducedMotion` returns `null` on a server and the live value on the client's first
 * render, which can break hydration. Animations honour the preference either way (ADR-0029):
 * the engine reads it when each one starts, and snaps its positional keys.
 */
export const createReducedMotion = (): Accessor<boolean> => {
  const runtime = useWardicRuntime()
  if (isServer) return () => false
  // Resolve the Probe service once to read its reactive atom; a Context.Service
  // key is itself an Effect, so running it yields the service instance.
  const probe = runtime.runSync(Probe.Probe)
  return fromAtom(probe.prefersReducedMotion, { serverValue: false })
}

/**
 * Whether reduced motion applies here, as Wardic's animations here honour it (#443, Motion's
 * `useReducedMotionConfig`): the nearest `WardicConfig`'s `reducedMotion`, else the provider's, over
 * the user's preference. `"always"` is `true`, `"never"` `false`, and `"user"` follows
 * {@link createReducedMotion}.
 *
 * A server renders `"always"` as `true` and the rest as `false`, and a hydrating client keeps that
 * until mount (the Hydration hold, as `createReducedMotion`'s), so markup that depends on it hydrates.
 */
export const createReducedMotionConfig = (): Accessor<boolean> => {
  const setting = useWardicReducedMotionSetting()
  const prefers = createReducedMotion()
  return () => ReducedMotion.applies(setting(), prefers())
}

/**
 * Whether the page is shown (#443, Motion's `usePageInView`): `false` while it's hidden, in a tab in
 * the background or a minimised window, from the Probe's `pageVisible`. Pause what nobody can see,
 * such as a carousel's autoplay.
 *
 * A server renders `true`, and a hydrating client keeps it until mount (the Hydration hold), as
 * Motion's starts `true` and corrects itself after its first render.
 *
 * ```tsx
 * const visible = createPageInView()
 * createEffect(() => (visible() ? player.play() : player.pause()))
 * ```
 */
export const createPageInView = (): Accessor<boolean> => {
  const runtime = useWardicRuntime()
  if (isServer) return () => true
  const probe = runtime.runSync(Probe.Probe)
  return fromAtom(probe.pageVisible, { serverValue: true })
}
