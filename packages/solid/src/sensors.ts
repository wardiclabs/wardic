/**
 * Low-level sensor hooks (`createX`) — the thin Solid surface over core's
 * recognizers and reactive service inputs (ADR-0006).
 *
 * Each boolean/sample sensor wraps the matching core recognizer `Stream` with
 * {@link streamToSignal}, so it inherits the recognizer's `wardic.*` span and
 * the per-element fiber lifecycle (interrupted on the consuming component's
 * unmount, dropping the Shared-source ref-count). `createReducedMotion` bridges
 * `Probe.prefersReducedMotion` (an `Atom`) via {@link fromAtom}, and
 * `createTransform` is pure Solid (`createMemo`) — no Effect.
 *
 * All hooks MUST be called within a component/owner (they register `onCleanup`
 * through the bridges and read the runtime from context).
 */
import * as Drag from "@wardic/core/Drag"
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Stream from "effect/Stream"
import { type Accessor, createMemo } from "solid-js"
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

/** Per-axis / bounds shaping options for {@link createDrag}. */
export interface CreateDragOptions {
  /** Lock the drag to a single axis, zeroing the off-axis components. */
  readonly axis?: "x" | "y"
  /** Constrain `offset` to a static numeric region (optionally elastic). */
  readonly bounds?: Drag.Bounds
  /** Rubber-band resistance past `bounds` (0 = hard clamp, 1 = free). */
  readonly elastic?: number
}

/**
 * Pipe the optional shaping combinators onto a drag stream in a fixed order:
 * `axisLock` first (so the off-axis is zeroed before clamping), then
 * `withinBounds`. Each combinator is applied only when its option is present,
 * keeping the requirement set (`InputSource`) untouched.
 */
const applyShaping = <R>(
  stream: Stream.Stream<Drag.Sample, never, R>,
  options: CreateDragOptions | undefined,
): Stream.Stream<Drag.Sample, never, R> => {
  let shaped = stream
  if (options?.axis !== undefined) shaped = shaped.pipe(Drag.axisLock(options.axis))
  if (options?.bounds !== undefined) {
    shaped = shaped.pipe(
      Drag.withinBounds(options.bounds, options.elastic !== undefined ? { elastic: options.elastic } : undefined),
    )
  }
  return shaped
}

/**
 * Latest `Drag.Sample` from a drag gesture on `target`, or `null` before
 * the first sample. Wraps the core `drag` recognizer, applying `axisLock` /
 * `withinBounds` from `options` when present.
 */
export const createDrag = (target: unknown, options?: CreateDragOptions): Accessor<Drag.Sample | null> =>
  streamToSignal<Drag.Sample | null>(applyShaping(Recognizer.drag(target), options), null)

/**
 * Reactive `prefers-reduced-motion` preference as a boolean `Accessor`. Resolves
 * `Probe` from the provider runtime to get its `prefersReducedMotion` Atom, then
 * bridges it via {@link fromAtom}.
 *
 * A server can't know the preference: it renders `false`, and a hydrating client keeps
 * `false` until mount, then switches to the live value (the Hydration hold, ADR-0021
 * decision 8), so markup that depends on it hydrates without a mismatch. Motion's
 * `useReducedMotion` returns `null` on a server and the live value on the client's first
 * render, which can break hydration. Animations honour the preference either way: the
 * engine reads it itself when one starts.
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
 * Map a source `Accessor<A>` through `fn` into a derived `Accessor<B>`. Pure
 * Solid (`createMemo`) — no Effect, no runtime — so it composes any sensor (or
 * plain signal) into a projected value.
 */
export const createTransform = <A, B>(source: Accessor<A>, fn: (a: A) => B): Accessor<B> =>
  createMemo(() => fn(source()))
