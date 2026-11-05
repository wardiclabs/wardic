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
 * sensor's owner is disposed or it's given another element. Each is a watch (#318, #379, ADR-0055),
 * in a Scope of its own with no fiber. Its value starts at its rest (`false`,
 * or `null` for a drag) and stays there on a server, where no ref is called. `createReducedMotion`,
 * `createReducedMotionConfig` and `createPageInView` take no element: they follow the Probe's
 * preference, the nearest config's setting over it, and the page's visibility (#443).
 *
 * @module
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Report from "@wardic/dom/Report"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { isServer } from "@solidjs/web"
import { type Accessor, createSignal, onCleanup } from "solid-js"
import type { WardicViewport } from "../../config.ts"
import { inViewOptionsOf } from "../../gesture-callbacks.ts"
import type { WardicServices } from "../../runtime.ts"
import { fromAtom } from "./bridge.ts"
import { useWardicReducedMotionSetting, useWardicRuntime } from "./provider.tsx"

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


/**
 * A sensor of a watch's values (#318, ADR-0055), at `initial` until its first: attached, the watch
 * runs in a Scope of its own, closed when the sensor is given another element or its owner is
 * disposed. Call within an owner.
 */
export const watchSensorOf = <A>(
  watchOf: (target: Element, handlers: InputFeed.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | WardicServices>,
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

/**
 * `true` while the element it's given to as a `ref` is in view, `false` otherwise. What "in view"
 * means is a `viewport`'s, as on a Wardic element: `root`, a scrolling container (the window if none);
 * `margin`, grown around it, as CSS `rootMargin`; `amount` of the element that must show, `"some"`,
 * `"all"` or 0 to 1; and `once`, to stay `true` after the first entry. `root` is read as it's
 * attached: an ancestor's `ref`, which Solid applies before its children's, has it by then. Motion's
 * `useInView`.
 *
 * @example
 * const visible = createInView({ amount: "all", once: true })
 * <section ref={visible}>{visible() ? "Seen" : "Not yet"}</section>
 * @see https://wardic.dev/reference/solid/gestures/create-in-view
 */
// The core in-view watch, its options mapped as the element's `viewport` is (#273): `root` read as
// it's attached.
export const createInView = (viewport?: WardicViewport): Sensor<boolean> =>
  watchSensorOf<boolean>(
    (target, { on, onDefect }) => Recognizer.watchInView(target, inViewOptionsOf(viewport), { on: (transition) => on(transition.active), onDefect }),
    false,
  )

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

/**
 * Whether reduced motion applies here, as Wardic's animations here honour it (#443, Motion's
 * `useReducedMotionConfig`): the nearest `WardicConfig`'s `reducedMotion`, else the provider's, over
 * the user's preference. `"always"` is `true`, `"never"` `false`, and `"user"` follows
 * {@link createReducedMotion}. A server renders `"always"` as `true` and the rest as `false`, and a
 * hydrating client keeps that until it has settled (the Hydration hold).
 */
export const createReducedMotionConfig = (): Accessor<boolean> => {
  const setting = useWardicReducedMotionSetting()
  const prefers = createReducedMotion()
  return () => ReducedMotion.applies(setting(), prefers())
}

/**
 * Whether the page is shown (#443, Motion's `usePageInView`): `false` while it's hidden, in a tab in
 * the background or a minimised window, from the Probe's `pageVisible`. A server renders `true`, and
 * a hydrating client keeps it until it has settled (the Hydration hold).
 */
export const createPageInView = (): Accessor<boolean> => {
  if (isServer) return () => true
  const probe = useWardicRuntime().runSync(Probe.Probe)
  return fromAtom(probe.pageVisible, { serverValue: true })
}
