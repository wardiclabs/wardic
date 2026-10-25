/**
 * Sensors on Solid 2 (#209 PR 3's Q1): each is a ref that's also its reading, as a ward is a ref
 * carrying its props. Give it to an element's `ref` (alone, or in an array beside a ward); call it
 * with nothing to read it, tracked as any signal:
 *
 * ```tsx
 * const hovered = createHover()
 * <div ref={hovered}>{hovered() ? "in" : "out"}</div>
 * ```
 *
 * Each wraps a core recognizer (ADR-0006): attached, it runs on the provider's runtime until the
 * sensor's owner is disposed or it's given another element. Hover, press, focus and in view are
 * watches (#318, ADR-0055), in a Scope with no fiber; a drag is a Stream on a fiber. Its value starts at its rest (`false`,
 * or `null` for a drag) and stays there on a server, where no ref is called. `createReducedMotion`
 * takes no element: it follows the Probe's preference.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Report from "@wardic/dom/Report"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { isServer } from "@solidjs/web"
import { type Accessor, createSignal, onCleanup } from "solid-js"
import { type CreateDragOptions, dragSamples } from "../../drag-samples.ts"
import { reported, type WardicServices } from "../../runtime.ts"
import { fromAtom } from "./bridge.ts"
import { useWardicRuntime } from "./provider.tsx"

export type { CreateDragOptions } from "../../drag-samples.ts"

/** A sensor: a ref that attaches it to an element, and, called with nothing, its reading. */
export interface Sensor<A> {
  /** Its reading, tracked. */
  (): A
  /** Attach it to `element`: Solid calls it as a ref. */
  (element: Element): void
}

/** Whether a sensor's call is Solid applying it as a ref. */
const isElement = (value: unknown): value is Element => Predicate.hasProperty(value, "nodeType")

/** A sensor of `streamOf`'s values, at `initial` until its first. Call within an owner. */
const sensorOf = <A>(streamOf: (target: Element) => Stream.Stream<A, never, WardicServices>, initial: A): Sensor<A> => {
  // A server never calls a ref: the sensor rests where it starts.
  if (isServer) return ((): A => initial) as Sensor<A>
  const runtime = useWardicRuntime()
  const [value, setValue] = createSignal<A>(initial as Exclude<A, Function>)
  // The element it's attached to, and the recognizer's fiber there.
  let attached: { readonly element: Element; readonly fiber: Fiber.Fiber<void, never> } | undefined
  const detach = (): void => {
    UndefinedOr.map(attached, ({ fiber }) => runtime.runFork(Fiber.interrupt(fiber)))
    attached = undefined
  }
  onCleanup(detach)
  const attach = (element: Element): void => {
    if (Predicate.isNotUndefined(attached) && attached.element === element) return
    detach()
    const fiber = runtime.runFork(reported(Stream.runForEach(streamOf(element), (next) => Effect.sync(() => setValue(() => next)))))
    attached = { element, fiber }
  }
  // eslint-disable-next-line solid/reactivity -- the sensor: a ref Solid calls with its element, and an accessor its caller reads where it tracks
  return ((element?: unknown): A | undefined => {
    if (isElement(element)) {
      attach(element)
      return undefined
    }
    return value()
  }) as Sensor<A>
}

/**
 * A sensor of a watch's values (#318, ADR-0055), at `initial` until its first: attached, the watch
 * runs in a Scope of its own, closed when the sensor is given another element or its owner is
 * disposed. Call within an owner.
 */
const watchSensorOf = <A>(
  watchOf: (target: Element, handlers: Recognizer.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | WardicServices>,
  initial: A,
): Sensor<A> => {
  // A server never calls a ref: the sensor rests where it starts.
  if (isServer) return ((): A => initial) as Sensor<A>
  const runtime = useWardicRuntime()
  const [value, setValue] = createSignal<A>(initial as Exclude<A, Function>)
  // The element it's attached to, and its watch's Scope there.
  let attached: { readonly element: Element; readonly scope: Scope.Closeable } | undefined
  const detach = (): void => {
    UndefinedOr.map(attached, ({ scope }) => runtime.runSync(Scope.close(scope, Exit.void)))
    attached = undefined
  }
  onCleanup(detach)
  const onDefect = (cause: Cause.Cause<never>): void => {
    runtime.runFork(Report.failure("wardic.sensor: a gesture handler failed", cause))
  }
  const attach = (element: Element): void => {
    if (Predicate.isNotUndefined(attached) && attached.element === element) return
    detach()
    const scope = Scope.makeUnsafe()
    runtime.runSync(watchOf(element, { on: (next) => setValue(() => next as Exclude<A, Function>), onDefect }).pipe(Scope.provide(scope)))
    attached = { element, scope }
  }
  // eslint-disable-next-line solid/reactivity -- the sensor: a ref Solid calls with its element, and an accessor its caller reads where it tracks
  return ((element?: unknown): A | undefined => {
    if (isElement(element)) {
      attach(element)
      return undefined
    }
    return value()
  }) as Sensor<A>
}

/** `true` while the pointer is over the element, `false` once it leaves (the core hover watch). */
export const createHover = (): Sensor<boolean> =>
  watchSensorOf<boolean>((target, { on, onDefect }) => Recognizer.watchHover(target, { on: (transition) => on(transition.active), onDefect }), false)

/** `true` while the pointer is held down on the element, `false` once released or cancelled (the core press watch). */
export const createPress = (): Sensor<boolean> =>
  watchSensorOf<boolean>((target, { on, onDefect }) => Recognizer.watchPress(target, { on: (press) => on(press.phase === "start"), onDefect }), false)

/** `true` while the element is focused, `false` once blurred (the core focus watch). */
export const createFocus = (): Sensor<boolean> => watchSensorOf<boolean>((target, handlers) => Recognizer.watchFocus(target, {}, handlers), false)

/** `true` while the element intersects the viewport (the core in-view watch); `{ once: true }` settles at the first `true`. */
export const createInView = (options?: { readonly once?: boolean }): Sensor<boolean> =>
  watchSensorOf<boolean>(
    (target, { on, onDefect }) => Recognizer.watchInView(target, { ...options }, { on: (transition) => on(transition.active), onDefect }),
    false,
  )

/**
 * The latest sample of a drag gesture on the element, `null` before the first: the core `drag`
 * recognizer with `options`' axis, claim and bounds. Like an element's own drag, it holds the
 * element's **Drag claim** while a gesture is on, unless `claim: false`.
 */
export const createDrag = (options?: CreateDragOptions): Sensor<Drag.Sample | null> =>
  sensorOf<Drag.Sample | null>((target) => dragSamples(target, options), null)

/**
 * Whether the user prefers reduced motion, from the Probe's preference. A server renders `false`,
 * and a hydrating client keeps it until it has settled (the Hydration hold), so markup that
 * depends on it hydrates. Animations honour the preference either way (ADR-0029).
 */
export const createReducedMotion = (): Accessor<boolean> => {
  if (isServer) return () => false
  const probe = useWardicRuntime().runSync(Probe.Probe)
  return fromAtom(probe.prefersReducedMotion, { serverValue: false })
}
