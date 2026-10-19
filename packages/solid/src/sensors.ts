/**
 * Low-level sensor hooks (`createX`) — the thin Solid surface over core's
 * recognizers and reactive service inputs (ADR-0006).
 *
 * Each boolean/sample sensor wraps the matching core recognizer `Stream` with
 * {@link streamToSignal}, so it inherits the recognizer's `wardic.*` span and
 * the per-element fiber lifecycle (interrupted on the consuming component's
 * unmount, dropping the Shared-source ref-count). `createReducedMotion` bridges
 * `Probe.prefersReducedMotion` (an `Atom`) via {@link fromAtom}. `createTransform` moved to
 * `live-value.ts`, with `createSpring` (#130).
 *
 * All hooks MUST be called within a component/owner (they register `onCleanup`
 * through the bridges and read the runtime from context).
 */
import * as Drag from "@wardic/core/Drag"
import type * as InputSource from "@wardic/core/InputSource"
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Bool from "effect/Boolean"
import { constFalse } from "effect/Function"
import * as Predicate from "effect/Predicate"
import type * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createComputed, createSignal, getOwner, runWithOwner, untrack } from "solid-js"
import { fromAtom, streamToSignal } from "./bridge.ts"
import { useWardicRuntime } from "./provider.tsx"
import { isServer } from "./server.ts"

/**
 * `true` while the pointer is inside `target`, `false` once it leaves. Wraps the
 * core `hover` recognizer; `false` until the first transition.
 */
export const createHover = (target: unknown): Accessor<boolean> => streamToSignal(Recognizer.hover(target), false)

/**
 * `true` while the pointer is held down on `target`, `false` once released or
 * cancelled. Wraps the core `press` recognizer; `false` until the first
 * transition.
 */
export const createPress = (target: unknown): Accessor<boolean> => streamToSignal(Recognizer.press(target), false)

/**
 * A State recognizer an element starts only once it wants it (#87, ADR-0040): `false` until
 * `wanted()` is first true, then `make()`'s signal, kept from then on. Motion's rule: its hover
 * and tap features attach only once their props are set. An element that never wants it starts
 * no fiber and no subscription; one that stops wanting it keeps the recognizer, so a prop that
 * toggles starts it once. A pointer already resting on the element when it starts counts from
 * its next entry, as Motion's does.
 *
 * `make` runs under the caller's owner, not this hook's computation, so the recognizer lives
 * and ends with the caller (its `onCleanup`), not with the next change of `wanted`.
 */
export const createWhenWanted = (wanted: Accessor<boolean>, make: () => Accessor<boolean>): Accessor<boolean> => {
  const owner = getOwner()
  const [sensor, setSensor] = createSignal<Accessor<boolean> | undefined>(undefined)
  createComputed(() => {
    if (Bool.and(Predicate.isUndefined(untrack(sensor)), wanted())) setSensor(() => runWithOwner(owner, make))
  })
  return () => UndefinedOr.match(sensor(), { onUndefined: constFalse, onDefined: (started) => started() })
}

/**
 * `true` while `target` is focused, `false` once blurred. Wraps the core `focus`
 * recognizer; `false` until the first transition.
 */
export const createFocus = (target: unknown): Accessor<boolean> => streamToSignal(Recognizer.focus(target), false)

/**
 * `true` while `target` intersects the viewport, `false` otherwise. Wraps the
 * core `inView` recognizer (`{ once: true }` settles after the first `true`);
 * `false` until the first emission.
 */
export const createInView = (
  target: unknown,
  options?: { readonly once?: boolean },
): Accessor<boolean> => streamToSignal(Recognizer.inView(target, options), false)

/** The axis, claim and bounds options for {@link createDrag}. */
export interface CreateDragOptions {
  /** Keep the drag to a single axis, zeroing the off-axis components; it claims only that axis. */
  readonly axis?: "x" | "y"
  /**
   * `false`: take no **Drag claim** (ADR-0019, *Amendment (#29)*), so watching a pan over an area
   * blocks no draggable inside it, and a draggable inside it blocks nothing here. Default `true`.
   */
  readonly claim?: boolean
  /** Constrain `offset` to a static numeric region (optionally elastic). */
  readonly bounds?: Drag.Bounds
  /** Rubber-band resistance past `bounds` (0 = hard clamp, 1 = free). */
  readonly elastic?: number
}

/**
 * The core `drag` recognizer on `target` with `options`' axis and claim, then `withinBounds`
 * when `bounds` is present (the off-axis is zeroed before clamping), keeping the requirement
 * set (`InputSource`) untouched.
 */
const shapedDrag = (target: unknown, options: CreateDragOptions = {}): Stream.Stream<Drag.Sample, never, InputSource.InputSource> => {
  const { axis = "xy", claim = true } = options
  const recognized = Recognizer.drag(target, { axis, claim })
  return UndefinedOr.match(options.bounds, {
    onUndefined: () => recognized,
    onDefined: (bounds) =>
      recognized.pipe(
        Drag.withinBounds(bounds, UndefinedOr.map(options.elastic, (elastic) => ({ elastic }))),
      ),
  })
}

/**
 * Latest `Drag.Sample` from a drag gesture on `target`, or `null` before the first sample.
 * Wraps the core `drag` recognizer with `options`' axis and claim, then `withinBounds` when
 * present. Like the element's own drag, it holds `target`'s **Drag claim** while a gesture
 * is on, which it shares with every other drag on `target`; refused one, it gets no samples
 * for that gesture.
 */
export const createDrag = (target: unknown, options?: CreateDragOptions): Accessor<Drag.Sample | null> =>
  streamToSignal<Drag.Sample | null>(shapedDrag(target, options), null)

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
