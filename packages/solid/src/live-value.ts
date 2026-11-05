/**
 * Live values for Solid (#130, ADR-0043): `createTransform`, `createFollowValue` and `createSpring`,
 * core's `LiveValue` helpers wrapped, each taking a Live value as Solid has one (an accessor, or an
 * `effect/reactivity` Atom) and giving an accessor back, for an element's `style` or anything else.
 *
 * - `createTransform(source, fn)` maps through a function (Motion's `useTransform(value, fn)`);
 *   `createTransform(source, input, output, { clamp })` maps ranges (Motion's
 *   `useTransform(value, input, output)`), each pair of outputs blended through the Environment's
 *   `InterpolatorRegistry`, so colours and unit strings map as `animate` blends them.
 * - `createFollowValue(source, transition)` follows its source on any transition, on the Frame loop
 *   (Motion's `useFollowValue`, #441), idle while it rests; `createSpring(source, options)` is its
 *   spring case (Motion's `useSpring`).
 * - `createScroll(options)` is a container's scroll (Motion's `useScroll`, #234): `scrollX`,
 *   `scrollY` and their progress, through Motion's offsets for a `target`.
 * - `createVelocity(source)` is a value's velocity a second, per frame (Motion's `useVelocity`).
 * - `createTime()` is the milliseconds since it was created (Motion's `useTime`).
 * - `createWillChange()` is a `willChange` that turns on as its element animates (Motion's `useWillChange`, #443).
 *
 * Call them where you'd create a signal (a component's body): each owns what it subscribes to
 * until its owner is disposed. On a server, each gives its source's value as it is now (ADR-0021).
 */
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import type * as ScrollOffset from "@wardic/dom/ScrollOffset"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Exit from "effect/Exit"
import * as Predicate from "effect/Predicate"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Scope from "effect/Scope"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { type Accessor, createComputed, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { eachFrameOf } from "./animation-frame.ts"
import { fromAtom } from "./bridge.ts"
import type { FollowAccessor, FollowValueOptions, LiveSource, SpringAccessor, WillChange } from "./live-style.ts"
import { atomOf, carry, followAccessorOf, followOptionsOf, numberOf, readLive, serverFollowOf, serverRegistryOf, unitOf, willChangeOf, withUnit } from "./live-style.ts"
import { useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import type { WardicRuntime, WardicServices } from "./runtime.ts"
import { isServer } from "./server.ts"

/** A Live value as an accessor: an accessor as it is, an Atom read through the provider's registry. */
const accessorOf = <A>(source: LiveSource<A>): Accessor<A> =>
  Bool.match(Atom.isAtom(source), {
    onTrue: () =>
      Bool.match(isServer, {
        onTrue: (): Accessor<A> => () => readLive(source, serverRegistryOf, untrack) as A,
        onFalse: () => fromAtom(source as Atom.Atom<A>),
      }),
    onFalse: () => source as Accessor<A>,
  })

/**
 * A value mapped from another: through a function, `createTransform(x, (x) => x * 2)`, or through
 * ranges, `createTransform(x, input, output)`: a source at `input[i]` gives `output[i]`, and one between
 * two stops blends their outputs, numbers, units and colours alike. `input` is as long as `output`,
 * ascending or descending; outside it the ends hold, unless `clamp: false`. `ease` eases each stretch,
 * one for all or one each, and a `mixer`, `(from, to) => (t) => value`, blends outputs of any type. The function form needs no `WardicProvider` when its source is a signal.
 * Motion's `useTransform`.
 *
 * @example
 * const card = createWard({ drag: "x" })
 * const opacity = createTransform(card.value("x"), [-150, 0, 150], [0, 1, 0])
 * <div {...card({ style: { opacity } })} />
 * @see https://wardic.dev/reference/solid/live-values/create-transform
 */
// #440 (descending ranges, `mixer`), #360 (`ease`).
export function createTransform<A, B>(source: LiveSource<A>, fn: (a: A) => B): Accessor<B>
export function createTransform<O extends number | string>(
  source: LiveSource<number>,
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options?: LiveValue.TransformOptions<O>,
): Accessor<O>
export function createTransform<O>(source: LiveSource<number>, input: ReadonlyArray<number>, output: ReadonlyArray<O>, options: LiveValue.MixedTransformOptions<O>): Accessor<O>
export function createTransform(
  source: LiveSource<unknown>,
  fnOrInput: ((a: unknown) => unknown) | ReadonlyArray<number>,
  output?: ReadonlyArray<unknown>,
  options?: LiveValue.TransformOptions<unknown>,
): Accessor<unknown> {
  const read = accessorOf(source)
  if (Predicate.isFunction(fnOrInput)) return createMemo(() => fnOrInput(read()))
  const map = interpolatorOf(fnOrInput as ReadonlyArray<number>, output as ReadonlyArray<unknown>, options)
  return createMemo(() => map(read() as number))
}

/**
 * The ranges' mapping, resolved once: through the provider's `InterpolatorRegistry` on a client,
 * the DOM's on a server, which builds no runtime (ADR-0021).
 */
const interpolatorOf = <O>(
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options: LiveValue.TransformOptions<O> | undefined,
): ((v: number) => O) => {
  // Typed at `createTransform`'s overloads: numbers and strings through the registry, any type through a
  // `mixer` (#440). Here one mapping serves both.
  const mapping = LiveValue.interpolate(input, output as ReadonlyArray<number | string>, options as LiveValue.TransformOptions | undefined) as unknown as Effect.Effect<
    (v: number) => O,
    never,
    InterpolatorRegistry.InterpolatorRegistry
  >
  if (isServer) return Effect.runSync(mapping.pipe(Effect.provide(DomInterpolators.layer)))
  return useWardicRuntime().runSync(mapping)
}

/**
 * A value that follows `source` on a transition, in seconds: from each change of `source`, it animates
 * there, then rests. No `type` is a spring, 100 / 10 / 1 unless it's set by time; `type: "tween"` is
 * 0.3 s `easeInOut`; `type: "inertia"` glides. A change mid-way: a spring steers to it, keeping its
 * speed; a tween starts again from where it is; an inertia glides again from there. `delay` waits at
 * every change, so a source that never rests moves it once it does. A string with a unit, `"10px"`,
 * is followed as its number. `jump(value)` puts it somewhere at once. Motion's `useFollowValue`.
 *
 * @example
 * const [x, setX] = createSignal(0)
 * const eased = createFollowValue(x, { type: "tween", duration: 0.4, ease: "easeOut" })
 * <w.div style={{ x: eased }} />
 * @see https://wardic.dev/reference/solid/live-values/create-follow-value
 */
// #441: on the Frame loop, idle while it rests, ended with its owner. An inertia mid-flight glides again,
// its target unread (#435). A `velocity` given is the one every run starts or steers with.
export function createFollowValue(source: LiveSource<number>, options?: FollowValueOptions): FollowAccessor<number>
export function createFollowValue(source: LiveSource<string>, options?: FollowValueOptions): FollowAccessor<string>
export function createFollowValue(source: LiveSource<number | string>, options: FollowValueOptions = {}): FollowAccessor<number | string> {
  const runtime = useWardicRuntime()
  const read = accessorOf(source)
  if (isServer) return serverFollowOf(read)
  // Its nearest WardicConfig's `skipAnimations` (#468): each change lands at once while it's on.
  const skipped = useWardicSkipAnimations()
  const transition = followOptionsOf(options)
  const initial = untrack(read)
  // A string's accessor or a number's, as its source started.
  return followAccessorOf(
    runtime,
    Bool.match(Predicate.isString(initial), {
      onFalse: () => derivedOf(source as LiveSource<number>, read as Accessor<number>, (atom) => LiveValue.follow(atom, transition, skipped)),
      // A unit string: its number followed, shown with the unit it started with (Motion's).
      onTrue: () =>
        derivedOf(
          () => numberOf(read()),
          read as Accessor<string>,
          (atom) => Effect.map(LiveValue.follow(atom, transition, skipped), withUnit(unitOf(initial as string))),
        ) as Accessor<number | string>,
    }),
  )
}

/**
 * A value that follows `source` on a spring: from each change, it springs there, a change mid-way
 * keeping its speed. `stiffness`, `damping` and `mass`, 100 / 10 / 1 by default, or a `visualDuration`
 * and `bounce`. A string with a unit, `"10px"`, is followed as its number. `jump(value)` puts it
 * somewhere at once, and `skipInitialAnimation` makes the source's first change a jump.
 * Motion's `useSpring`.
 *
 * @example
 * const [x, setX] = createSignal(0)
 * const followX = createSpring(x, { stiffness: 300, damping: 30 })
 * <w.div style={{ x: followX }} />
 * @see https://wardic.dev/reference/solid/live-values/create-spring
 */
// `createFollowValue`'s spring case (#441), at rest within 0.001.
export function createSpring(source: LiveSource<number>, options?: LiveValue.SpringOptions): SpringAccessor<number>
export function createSpring(source: LiveSource<string>, options?: LiveValue.SpringOptions): SpringAccessor<string>
export function createSpring(source: LiveSource<number | string>, options: LiveValue.SpringOptions = {}): SpringAccessor<number | string> {
  return createFollowValue(source as LiveSource<number>, { ...options, type: "spring" })
}

/**
 * How fast `source` is changing, in its units a second: 0 to begin with, then each frame while it
 * moves, and 0 once it stops. A velocity is a value too: `createVelocity(createVelocity(x))` is its
 * acceleration. Motion's `useVelocity`.
 *
 * @example
 * const { scrollY } = createScroll()
 * const skewY = createTransform(createVelocity(scrollY), [-1000, 1000], [-8, 8])
 * @see https://wardic.dev/reference/solid/live-values/create-velocity
 */
export const createVelocity = (source: LiveSource<number>): Accessor<number> => derivedOf(source, () => 0, LiveValue.velocity)

/**
 * The milliseconds since it was made, wall time, set every frame while its owner lives: for something
 * that turns forever. It keeps Wardic's frames running while it lives. Motion's `useTime`.
 *
 * @example
 * const rotate = createTransform(createTime(), (ms) => (ms / 1000) * 90)
 * <w.div style={{ rotate }} />
 * @see https://wardic.dev/reference/solid/live-values/create-time
 */
export const createTime = (): Accessor<number> => {
  const runtime = useWardicRuntime()
  if (isServer) return SERVER_ZERO
  return liveOf(runtime, LiveValue.time())
}

/**
 * A value derived from `source` by one of core's helpers, as an accessor: an accessor source
 * mirrored into an Atom first. On a server, `serverValue`: nothing runs there (ADR-0021).
 */
const derivedOf = <A, R>(
  source: LiveSource<number>,
  serverValue: Accessor<A>,
  make: (atom: Atom.Atom<number>) => Effect.Effect<Atom.Atom<A>, never, R>,
): Accessor<A> => {
  const runtime = useWardicRuntime()
  if (isServer) return serverValue
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  // Its own Atom, or the one it carries (another helper's): a jump of it reaches a velocity of it.
  const atom = UndefinedOr.match(atomOf(source) as Atom.Atom<number> | undefined, {
    onDefined: identity,
    onUndefined: () => mirrorOf(source as Accessor<number>, registry),
  })
  return liveOf(runtime, make(atom))
}

/** A helper's Atom on the provider's runtime, in a Scope its owner's disposal closes, as an accessor carrying it. */
const liveOf = <A, R>(runtime: WardicRuntime, live: Effect.Effect<Atom.Atom<A>, never, R>): Accessor<A> => {
  const scope = Scope.makeUnsafe()
  onCleanup(() => closeScope(runtime, scope))
  const out = runtime.runSync((live as Effect.Effect<Atom.Atom<A>, never, WardicServices | Scope.Scope>).pipe(Scope.provide(scope)))
  return carry(fromAtom(out), out)
}

const SERVER_ZERO: Accessor<number> = () => 0

/**
 * A `will-change` for an element's `style`: `"auto"` until the element first animates a transform key,
 * `opacity`, `clipPath`, `filter` or `backgroundColor`, or is dragged; then `"transform"`, for good, so
 * the browser keeps it on a layer of its own from its first move on. A key already at its target and a
 * layout animation don't count. `"auto"` on a server. Motion's `useWillChange`.
 *
 * @example
 * const willChange = createWillChange()
 * <w.div whileHover={{ scale: 1.1 }} style={{ "will-change": willChange }} />
 * @see https://wardic.dev/reference/solid/live-values/create-will-change
 */
// #443.
export const createWillChange = (): Accessor<WillChange> => {
  if (isServer) return SERVER_AUTO
  const runtime = useWardicRuntime()
  return willChangeOf(runtime.runSync(AtomRegistry.AtomRegistry), onCleanup, (atom) => carry(fromAtom(atom), atom))
}

const SERVER_AUTO: Accessor<WillChange> = () => "auto"

/**
 * Calls `callback` every frame while its owner lives, with the frame's `time` and `delta` in
 * milliseconds: for what a frame draws itself, such as a canvas or a 3D scene. `time` is 0 at the
 * first frame, then wall time since, a hidden tab's minutes included; `delta` is the frame's own, held
 * to 1–40 ms, so the first frame back from a hidden tab steps 40 ms. A throw is logged, and the next
 * frame calls it again. Nothing runs on a server. Motion's `useAnimationFrame`.
 *
 * @example
 * createAnimationFrame((time) => {
 *   cube.style.transform = `rotateY(${time / 10}deg)`
 * })
 * @see https://wardic.dev/reference/solid/live-values/create-animation-frame
 */
// #443. It keeps the Clock ticking every frame. A throw is logged at the first of a run of throws, as
// `onUpdate`'s.
export const createAnimationFrame = (callback: (time: number, delta: number) => void): void => {
  if (isServer) return
  const runtime = useWardicRuntime()
  const scope = Scope.makeUnsafe()
  onCleanup(() => closeScope(runtime, scope))
  runtime.runSync(eachFrameOf(runtime, callback).pipe(Scope.provide(scope)))
}

/** An element, or an accessor of one, such as `() => box` for a ref: read once it's there. */
export type ElementSource = Element | Accessor<Element | undefined>

/** `createScroll`'s options, as Motion's `useScroll`'s. */
export interface ScrollOptions {
  /** The scrolling element, as an accessor of its ref: `() => box`. The page's scroll when left out. */
  readonly container?: ElementSource
  /** An element whose way through the container the progress reads, between the `offset`s. */
  readonly target?: ElementSource
  /**
   * Where the progress runs, as Motion's: each stop pairs an edge of the target with an edge of the
   * container, `["start end", "end start"]`, 0 at the first and 1 at the last. An edge is `start`,
   * `center` or `end`, a fraction, or a length. With a target, `["start start", "end end"]` by default.
   */
  // The DOM's syntax (`@wardic/dom/ScrollOffset`); with a target and none given, its `All`.
  readonly offset?: ScrollOffset.ScrollOffset
  /** The axis `target` and `offset` read: `"y"` (the default) or `"x"`. */
  readonly axis?: "x" | "y"
}

/** `createScroll`'s values, Motion's four, each an accessor. */
export interface ScrollValues {
  /** How far it's scrolled across, in pixels. */
  readonly scrollX: Accessor<number>
  /** How far it's scrolled down, in pixels. */
  readonly scrollY: Accessor<number>
  /** Its progress across, from 0 to 1: through its range, or, with a `target` or `offset`, through theirs. */
  readonly scrollXProgress: Accessor<number>
  /** Its progress down, from 0 to 1: through its range, or, with a `target` or `offset`, through theirs. */
  readonly scrollYProgress: Accessor<number>
}

const SERVER_SCROLL: ScrollValues = { scrollX: SERVER_ZERO, scrollY: SERVER_ZERO, scrollXProgress: SERVER_ZERO, scrollYProgress: SERVER_ZERO }

/** An element source read now: `None` for an accessor whose ref hasn't arrived. */
const elementOf = (source: ElementSource): Option.Option<Element> =>
  Bool.match(Predicate.isFunction(source), {
    onTrue: () => Option.fromUndefinedOr((source as Accessor<Element | undefined>)()),
    onFalse: () => Option.some(source as Element),
  })

/**
 * A scroll as values: `scrollX` and `scrollY`, how far it's scrolled, in pixels, and `scrollXProgress`
 * and `scrollYProgress`, from 0 to 1 through its range. The page's, or a `container`'s. With a
 * `target`, the progress is the target's way through, between two `offset`s, on `axis`. Each is set in
 * the scroll's own event, so a value derived from one paints in the frame that shows the scroll. A
 * `container` or `target` given as an accessor of a ref reads 0s until the ref is there. 0s on a
 * server. Motion's `useScroll`.
 *
 * @example
 * let box!: HTMLDivElement
 * const { scrollYProgress } = createScroll({ container: () => box })
 * <div ref={box}>…</div>
 * <w.div style={{ scaleX: scrollYProgress }} />
 * @see https://wardic.dev/reference/solid/live-values/create-scroll
 */
// #234. An accessor `container` or `target` is read in an effect, and a change of either follows the
// new one.
export const createScroll = (options: ScrollOptions = {}): ScrollValues => {
  const runtime = useWardicRuntime()
  if (isServer) return SERVER_SCROLL
  const [scrollX, setScrollX] = createSignal(0)
  const [scrollY, setScrollY] = createSignal(0)
  const [scrollXProgress, setScrollXProgress] = createSignal(0)
  const [scrollYProgress, setScrollYProgress] = createSignal(0)
  createEffect(() => {
    const container = UndefinedOr.match(options.container, { onUndefined: () => Option.some(undefined), onDefined: elementOf })
    const target = UndefinedOr.match(options.target, { onUndefined: () => Option.some(undefined), onDefined: elementOf })
    // A ref not there yet: the values hold until it is.
    if (Bool.or(Option.isNone(container), Option.isNone(target))) return
    const registry = runtime.runSync(AtomRegistry.AtomRegistry)
    const scope = Scope.makeUnsafe()
    const values = runtime.runSync(
      LiveValue.scroll({
        ...UndefinedOr.match(Option.getOrUndefined(container), { onUndefined: () => ({}), onDefined: (element) => ({ container: element }) }),
        ...UndefinedOr.match(Option.getOrUndefined(target), { onUndefined: () => ({}), onDefined: (element) => ({ target: element }) }),
        ...UndefinedOr.match(options.offset, { onUndefined: () => ({}), onDefined: (offset) => ({ offset }) }),
        ...UndefinedOr.match(options.axis, { onUndefined: () => ({}), onDefined: (axis) => ({ axis }) }),
      }).pipe(Scope.provide(scope)),
    )
    // Each derived Atom is read at once: it tracks the scroll only once it's been read.
    const stops = Arr.map(
      [
        [values.scrollX, setScrollX],
        [values.scrollY, setScrollY],
        [values.scrollXProgress, setScrollXProgress],
        [values.scrollYProgress, setScrollYProgress],
      ] as const,
      ([atom, set]) => registry.subscribe(atom, (v) => void set(v), { immediate: true }),
    )
    onCleanup(() => {
      Arr.forEach(stops, (stop) => stop())
      closeScope(runtime, scope)
    })
  })
  return { scrollX, scrollY, scrollXProgress, scrollYProgress }
}

/** An accessor as an Atom, set as it changes, and held in `registry` until its owner's disposal. */
const mirrorOf = <A>(accessor: Accessor<A>, registry: AtomRegistry.AtomRegistry): Atom.Writable<A> => {
  const atom = Atom.make(untrack(accessor))
  onCleanup(registry.mount(atom))
  createComputed(on(accessor, (value) => registry.set(atom, value), { defer: true }))
  return atom
}

/** Close a helper's Scope on the provider's runtime. */
const closeScope = (runtime: WardicRuntime, scope: Scope.Closeable): void => {
  runtime.runFork(Scope.close(scope, Exit.void))
}
