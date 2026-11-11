/**
 * Low-level sensor hooks (`createX`) — the thin Solid surface over core's
 * recognizers and reactive service inputs (ADR-0006).
 *
 * Each boolean/sample sensor runs the matching core watch with `watchToSignal`
 * (#318, #379): the recognizer's `wardic.*` span, and a Scope of its own with no
 * fiber, closed on the consuming component's unmount (dropping the shared feed's
 * count). `createReducedMotion` bridges
 * `Probe.prefersReducedMotion` (an `Atom`) via {@link fromAtom}, `createReducedMotionConfig` lays the
 * nearest config's setting over it, and `createPageInView` bridges `Probe.visible` (#443). `createTransform` moved to
 * `live-value.ts`, with `createSpring` (#130).
 *
 * All hooks MUST be called within a component/owner (they register `onCleanup`
 * through the bridges and read the runtime from context).
 */
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Bool from "effect/Boolean"
import { constFalse } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createComputed, createSignal, getOwner, runWithOwner, untrack } from "solid-js"
import { fromAtom, watchToSignal } from "./bridge.tsx"
import type { WardicViewport } from "./config.ts"
import { inViewOptionsOf } from "./gesture-callbacks.ts"
import { useWardicReducedMotionSetting, useWardicRuntime } from "./provider.tsx"
import { isServer } from "./server.ts"

export type { CreateDragOptions } from "./drag-samples.ts"


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

/** No layer recognizer started, for good: an element that can never want one (#525). */
export const NEVER_STARTED: Accessor<Started> = () => NONE_STARTED

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
 * `true` while `target` is in view, `false` otherwise. What "in view" means is a `viewport`'s, as on a
 * Wardic element: `root`, a scrolling container (the window if none); `margin`, grown around it, as
 * CSS `rootMargin`; `amount` of the element that must show, `"some"`, `"all"` or 0 to 1; and `once`,
 * to stay `true` after the first entry. `false` until the first entry. `target` is the element itself,
 * and `root` is read as it's called, so call it where both exist. Motion's `useInView`.
 *
 * @example
 * const visible = createInView(props.card, { amount: "all", once: true })
 * @see https://wardic.dev/reference/solid/gestures/create-in-view
 */
// The core in-view watch (#318), its options mapped as the element's `viewport` is (#273): `root` read
// as it starts.
export const createInView = (target: unknown, viewport?: WardicViewport): Accessor<boolean> =>
  watchToSignal<boolean>(({ on, onDefect }) => Recognizer.watchInView(target, inViewOptionsOf(viewport), { on: (transition) => on(transition.active), onDefect }), false)

/**
 * Whether the visitor's system asks for reduced motion, as an accessor. A server renders `false`, and a
 * hydrating page keeps it until it has mounted, so markup that depends on it hydrates. Wardic's
 * animations honour the setting either way. Motion's `useReducedMotion`, which gives `null` on a server.
 *
 * @example
 * const reduced = createReducedMotion()
 * <Show when={!reduced()} fallback={<img src={still} />}><video autoplay src={clip} /></Show>
 * @see https://wardic.dev/reference/solid/utilities/create-reduced-motion
 */
// The Probe's `prefersReducedMotion` Atom, held until mount (the Hydration hold, ADR-0021 decision 8).
// The engine reads the preference as each animation starts, and snaps its positional keys (ADR-0029).
export const createReducedMotion = (): Accessor<boolean> => {
  // Before the provider is asked for: a server render needs none, as Solid 2's doesn't (#583).
  if (isServer) return () => false
  const runtime = useWardicRuntime()
  // Resolve the Probe service once to read its reactive atom; a Context.Service
  // key is itself an Effect, so running it yields the service instance.
  const probe = runtime.runSync(Probe.Probe)
  return fromAtom(probe.prefersReducedMotion, { serverValue: false })
}

/**
 * Whether reduced motion applies here, as Wardic's animations here honour it: the nearest
 * `WardicConfig`'s `reducedMotion`, else the provider's, over the visitor's setting. `"always"` is
 * `true`, `"never"` `false`, and `"user"` follows the system. A server renders `"always"` as `true` and
 * the rest as `false`, kept until the page has mounted. Motion's `useReducedMotionConfig`.
 *
 * @example
 * const reduced = createReducedMotionConfig()
 * const path = () => (reduced() ? undefined : arc())
 * @see https://wardic.dev/reference/solid/utilities/create-reduced-motion
 */
// #443; tracked since #584.
export const createReducedMotionConfig = (): Accessor<boolean> => {
  const setting = useWardicReducedMotionSetting()
  const prefers = createReducedMotion()
  return () => ReducedMotion.applies(setting(), prefers())
}

/**
 * Whether the page is shown: `false` while it's hidden, in a tab in the background or a minimised
 * window. Pause what nobody can see, such as a carousel's autoplay. A server renders `true`, and a
 * hydrating page keeps it until it has mounted. Motion's `usePageInView`.
 *
 * @example
 * const visible = createPageInView()
 * createEffect(() => (visible() ? player.play() : player.pause()))
 * @see https://wardic.dev/reference/solid/gestures/create-page-in-view
 */
// #443, the Probe's `visible`. The Hydration hold keeps `true` until mount, as Motion's starts
// `true` and corrects itself after its first render.
export const createPageInView = (): Accessor<boolean> => {
  const runtime = useWardicRuntime()
  if (isServer) return () => true
  const probe = runtime.runSync(Probe.Probe)
  return fromAtom(probe.visible, { serverValue: true })
}
