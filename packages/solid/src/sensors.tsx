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
 * Or give it its element, or a ward, first: `createHover(el)` reads `el`, and `createHover(card)` reads the
 * ward's own recognizer, which `card`'s `when` would start, so nothing listens to its element twice
 * (#884). Then it's an accessor alone.
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
import * as InputSource from "@wardic/core/InputSource"
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Report from "@wardic/dom/Report"
import type * as Cause from "effect/Cause"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { constVoid } from "effect/Function"
import * as Scope from "effect/Scope"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { isServer } from "@solidjs/web"
import { type Accessor, createSignal, DEV, onCleanup, useContext } from "solid-js"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import { inViewOptionsOf } from "./gesture-callbacks.ts"
import { failedOn } from "./kept-transform.ts"
import type { Listener } from "./waiters.ts"
import { type StageSubject, WardicStage } from "./stage.ts"
import { type AnyWard, isWard, type Sensed, sensedOf } from "./ward.tsx"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import type { WardicServices } from "./runtime.ts"
import { fromAtom } from "./bridge.tsx"
import { useProvidedRuntime, useWardicReducedMotionSetting, useWardicRuntime } from "./provider.tsx"

export type { CreateDragOptions } from "./drag-samples.ts"

/**
 * A sensor: give it to an element's `ref` (alone, or in an array beside a ward), and call it with
 * nothing to read it, tracked as any signal. Given another element, it follows that one.
 */
export interface Sensor<A> {
  /** Its reading, tracked. */
  (): A
  /** Attach it to `element`: Solid calls it as a ref. */
  (element: Element): void
}

/** Whether a sensor's call is Solid applying it as a ref. */
export const isElement = (value: unknown): value is Element => Predicate.hasProperty(value, "nodeType")

/** What a sensor of the page takes first, when it isn't its call form: an element, or a ward whose own recognizer it reads (#884). */
export type PageTarget = Element | AnyWard

/** What `createHover` and `createPress` take first: what {@link PageTarget} is, or, under a `<WardicStage>`, one of its Subjects (#884). */
export type SensorTarget = PageTarget | StageSubject

/**
 * A sensor of a Stage's Subject (#884's PR 4): `watchOf` on the Stage's input from the call on, ended with
 * its owner. `undefined` for an element or a ward, which are the page's; anything else no `<WardicStage>`
 * above takes is an error in development, naming it.
 */
export const stageSensorOf = <A,>(
  name: string,
  target: unknown,
  initial: A,
  watchOf: (subject: unknown, handlers: InputFeed.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>,
): Accessor<A> | undefined => {
  if (Bool.some([isServer, Predicate.isUndefined(target), isElement(target), isWard(target)])) return undefined
  const stage = useContext(WardicStage)
  if (Bool.or(Predicate.isNull(stage), Bool.not(Predicate.isNotNull(stage) && stage.isSubject(target)))) {
    if (DEV) throw new Error(`${name}(subject): it was given neither an element nor a ward, and no <WardicStage> above it takes it as one of its Subjects.`)
    return undefined
  }
  const [value, setValue] = createSignal<A>(initial as Exclude<A, Function>)
  const scope = Scope.makeUnsafe()
  onCleanup(() => Effect.runSync(Scope.close(scope, Exit.void)))
  // #979 group I, row 26 (ADR-0074): on the provider's runtime, so the app's logger and reporters hear it;
  // a Stage needs no provider, and with none, Effect's default runtime's.
  const runtime = useProvidedRuntime()
  const onDefect = (cause: Cause.Cause<never>): void => failedOn(runtime, `wardic.${name}: a gesture handler failed`, cause)
  const watch = watchOf(target, { on: (next) => setValue(() => next as Exclude<A, Function>), onDefect })
  Effect.runSync(watch.pipe(Effect.provideService(InputSource.InputSource, (stage as NonNullable<typeof stage>).input), Scope.provide(scope)))
  return value
}

/** A sensor of a ward: its reading, set by `listen` from the ward's own events (#884's PR 2). */
// `listen` subscribes to the ward's lifecycle, which starts the gesture's recognizer as `when` would: the
// ward's own, so nothing listens to its element twice. A server ward has no lifecycle: it rests there.
export const wardSensorOf = <A,>(ward: AnyWard, initial: A, listen: (sensed: Sensed, set: (next: A) => void) => ReadonlyArray<() => void>): Accessor<A> => {
  if (isServer) return () => initial
  const sensed = sensedOf(ward)
  if (Predicate.isUndefined(sensed)) return () => initial
  const [value, setValue] = createSignal<A>(initial as Exclude<A, Function>)
  const stops = listen(sensed, (next) => setValue(() => next as Exclude<A, Function>))
  onCleanup(() => Arr.forEach(stops, (stop) => stop()))
  return value
}

/** A ward event's listener for a sensor: each told as `on` maps it, the ward's end ending nothing more. */
export const told = <E,>(on: (event: E) => void): Listener<E> => ({ next: on, error: constVoid })


/**
 * A sensor of a watch's values (#318, ADR-0055), at `initial` until its first: attached, the watch
 * runs in a Scope of its own, closed when the sensor is given another element or its owner is
 * disposed. Call within an owner.
 */
export const watchSensorOf = <A,>(
  watchOf: (target: Element, handlers: InputFeed.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | WardicServices>,
  initial: A,
  target?: Element,
): Sensor<A> => {
  // A server never calls a ref: the sensor rests where it starts.
  if (isServer) return ((): A => initial) as Sensor<A>
  const runtime = useWardicRuntime()
  const [value, setValue] = createSignal<A>(initial as Exclude<A, Function>)
  // The element it's attached to, and its watch's Scope there.
  let attached: { readonly element: Element; readonly scope: Scope.Closeable } | undefined
  const detach = (): void => {
    UndefinedOr.map(attached, ({ scope }) => OwnerScope.close(runtime, scope, "wardic.sensor: a finalizer failed"))
    attached = undefined
  }
  onCleanup(detach)
  const onDefect = (cause: Cause.Cause<never>): void => {
    runtime.runFork(Report.failure("wardic.sensor: a gesture handler failed", cause))
  }
  const attach = (element: Element): void => {
    if (Predicate.isNotUndefined(attached) && attached.element === element) return
    detach()
    // Attached before its watch starts, so one that throws as it subscribes is closed all the same (#618).
    const scope = OwnerScope.open(runtime)
    attached = { element, scope }
    runtime.runSync(watchOf(element, { on: (next) => setValue(() => next as Exclude<A, Function>), onDefect }).pipe(Scope.provide(scope)))
  }
  // Given its element first (#884): attached now.
  if (Predicate.isNotUndefined(target)) attach(target)
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
export const createInView = (viewport?: WardConfig.WardicViewport): Sensor<boolean> =>
  watchSensorOf<boolean>(
    (target, { on, onDefect }) => Recognizer.watchInView(target, inViewOptionsOf(viewport), { on: (transition) => on(transition.active), onDefect }),
    false,
  )

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
  if (isServer) return () => false
  const probe = useWardicRuntime().runSync(Probe.Probe)
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
 * hydrating page keeps it until it has settled. Motion's `usePageInView`.
 *
 * @example
 * const visible = createPageInView()
 * createEffect(visible, (shown) => (shown ? player.play() : player.pause()))
 * @see https://wardic.dev/reference/solid/gestures/create-page-in-view
 */
// #443, the Probe's `visible`, held until settled (the Hydration hold).
export const createPageInView = (): Accessor<boolean> => {
  if (isServer) return () => true
  const probe = useWardicRuntime().runSync(Probe.Probe)
  return fromAtom(probe.visible, { serverValue: true })
}
