/**
 * Live values on Solid 2 (#130, ADR-0043; #209 PR 3's Q2, ADR-0045): `createTransform`,
 * `createFollowValue`, `createSpring`, `createVelocity`, `createTime` and `createScroll`, core's
 * `LiveValue` helpers wrapped, as on the Solid 1 binding (Motion's `useTransform`, `useFollowValue`,
 * `useSpring`, `useVelocity`, `useTime`, `useScroll`).
 *
 * Each gives an accessor back, for an element's `style` or anything else. Where it's derived on an
 * Atom, the accessor carries it (`live-style.ts`'s `carry`): a `style` given it follows the Atom,
 * set where its source is, so a value derived from a ward's `read(key)` is written in the gate's
 * frame and paints with it. Read through Solid it would come a frame late: Solid 2 shows a change at
 * its flush, after the gate's write. So:
 *
 * - `createFollowValue`, `createSpring`, `createVelocity`, `createTime` and `createScroll` are always
 *   derived on Atoms (core's); an accessor source with no Atom of its own is mirrored into one.
 * - `createTransform` derives on an Atom when its source is one or carries one (a ward's `read`,
 *   another helper's); a plain accessor (a signal) is mapped in a memo, as Solid maps it. Its
 *   function form's own reads of Solid stay tracked: a change re-derives it.
 *
 * Call them where you'd create a signal, in a component's body, not in JSX: on Solid 2 a prop's
 * expression runs in an effect, where no primitive can be made. Each owns what it subscribes to
 * until its owner is disposed. On a server, each gives its source's value as it is now, or 0
 * (ADR-0021).
 *
 * @module
 */
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import type * as ScrollOffset from "@wardic/dom/ScrollOffset"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { isServer } from "@solidjs/web"
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import {
  atomOf,
  type FollowAccessor,
  followAccessorOf,
  followOptionsOf,
  type FollowValueOptions,
  type LiveSource,
  numberOf,
  readLive,
  serverFollowOf,
  serverRegistryOf,
  type SpringAccessor,
  unitOf,
  type WillChange,
  willChangeOf,
  withUnit,
} from "../../live-style.ts"
import type { WardicRuntime, WardicServices } from "../../runtime.ts"
import { eachFrameOf } from "../../animation-frame.ts"
import { followAtom } from "./bridge.ts"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED, onSettledClientOnly } from "./solid-reactivity.ts"
import { useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"

/** A Live value read now on a server: an Atom through a server's own registry, an accessor called. */
const readOnServer = <A>(source: LiveSource<A>): A => readLive(source, serverRegistryOf, untrack) as A

/** An accessor as an Atom, set at each of its changes (at Solid's flush), held in `registry` until its owner's disposal. */
const mirrorOf = <A>(accessor: Accessor<A>, registry: AtomRegistry.AtomRegistry): Atom.Writable<A> => {
  const atom = Atom.make(untrack(accessor))
  onCleanup(registry.mount(atom))
  createEffect(
    accessor,
    (value) => {
      registry.set(atom, value)
    },
    CLIENT_ONLY_DEFERRED,
  )
  return atom
}

/** `source`'s Atom: its own, the one it carries, or, for a plain accessor, a mirror of it. */
const sourceAtomOf = <A>(source: LiveSource<A>, registry: AtomRegistry.AtomRegistry): Atom.Atom<A> =>
  UndefinedOr.match(atomOf(source) as Atom.Atom<A> | undefined, {
    onUndefined: () => mirrorOf(source as Accessor<A>, registry),
    onDefined: (atom) => atom,
  })

/** Close a helper's Scope on the provider's runtime. */
const closeScope = (runtime: WardicRuntime, scope: Scope.Closeable): void => {
  runtime.runFork(Scope.close(scope, Exit.void))
}

/** A helper's Atom, made on the provider's runtime in a Scope its owner's disposal closes, as an accessor carrying it. */
const liveOf = <A, R>(runtime: WardicRuntime, live: Effect.Effect<Atom.Atom<A>, never, R>): Accessor<A> => {
  const scope = Scope.makeUnsafe()
  onCleanup(() => closeScope(runtime, scope))
  const out = runtime.runSync((live as Effect.Effect<Atom.Atom<A>, never, WardicServices | Scope.Scope>).pipe(Scope.provide(scope)))
  return followAtom(runtime.runSync(AtomRegistry.AtomRegistry), out)
}

/**
 * A value mapped from another: through a function, `createTransform(x, (x) => x * 2)`, or through
 * ranges, `createTransform(x, input, output)`: a source at `input[i]` gives `output[i]`, and one between
 * two stops blends their outputs, numbers, units and colours alike. `input` is as long as `output`,
 * ascending or descending; outside it the ends hold, unless `clamp: false`. `ease` eases each stretch,
 * one for all or one each, and a `mixer`, `(from, to) => (t) => value`, blends outputs of any type. A signal read inside `fn` is tracked too: its change maps again.
 * Motion's `useTransform`.
 *
 * @example
 * const card = w.ward({ drag: "x" })
 * const opacity = createTransform(card.read("x"), [-150, 0, 150], [0, 1, 0])
 * <w.div wardRef={card} style={{ opacity }} />
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
  const fn = Bool.match(Predicate.isFunction(fnOrInput), {
    onTrue: () => fnOrInput as (a: unknown) => unknown,
    onFalse: () => interpolatorOf(fnOrInput as ReadonlyArray<number>, output as ReadonlyArray<unknown>, options) as (a: unknown) => unknown,
  })
  if (isServer) return () => fn(readOnServer(source))
  const atom = atomOf(source)
  // A plain accessor: mapped in a memo, as Solid maps it.
  if (Predicate.isUndefined(atom)) return createMemo(() => fn((source as Accessor<unknown>)()), CLIENT_ONLY)
  // On an Atom: derived on it, so it's set where its source is. What `fn` reads of Solid besides its
  // source is tracked here, and a change of it re-derives the Atom.
  const registry = useWardicRuntime().runSync(AtomRegistry.AtomRegistry)
  const version = Atom.make(0)
  onCleanup(registry.mount(version))
  createEffect(
    () => fn(registry.get(atom)),
    () => {
      registry.update(version, (n) => n + 1)
    },
    CLIENT_ONLY_DEFERRED,
  )
  const derived = Atom.make((get) => {
    get(version)
    return untrack(() => fn(get(atom)))
  })
  return followAtom(registry, derived)
}

/**
 * The ranges' mapping, resolved once: through the provider's `InterpolatorRegistry` on a client, the
 * DOM's on a server, which builds no runtime (ADR-0021).
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
  if (isServer) return serverFollowOf(() => readOnServer(source))
  const runtime = useWardicRuntime()
  // Its nearest WardicConfig's `skipAnimations` (#468): each change lands at once while it's on.
  const skipped = useWardicSkipAnimations()
  const transition = followOptionsOf(options)
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  const atom = sourceAtomOf(source, registry)
  const initial = registry.get(atom)
  // A string's accessor or a number's, as its source started.
  return followAccessorOf(
    runtime,
    Bool.match(Predicate.isString(initial), {
      onFalse: () => liveOf(runtime, LiveValue.follow(atom as Atom.Atom<number>, transition, skipped)),
      // A unit string: its number followed, shown with the unit it started with (Motion's).
      onTrue: () =>
        liveOf(
          runtime,
          Effect.map(LiveValue.follow(Atom.map(atom, numberOf), transition, skipped), withUnit(unitOf(initial as string))),
        ) as Accessor<number | string>,
    }),
  )
}

/**
 * A value that follows `source` on a spring: from each change, it springs there, a change mid-way
 * keeping its speed. `stiffness`, `damping` and `mass`, 100 / 10 / 1 by default, or a `visualDuration`
 * and `bounce`. A string with a unit, `"10px"`, is followed as its number. `jump(value)` puts it
 * somewhere at once, and `skipInitialAnimation` makes the source's first change a jump. On a source that's both derived and
 * set, Solid 2's `createSignal(fn)`, a write springs there, and the next change of what it derives from
 * springs on to that.
 * Motion's `useSpring`.
 *
 * @example
 * const [x, setX] = createSignal(0)
 * const followX = createSpring(x, { stiffness: 300, damping: 30 })
 * <w.div style={{ x: followX }} />
 * @see https://wardic.dev/reference/solid/live-values/create-spring
 */
// `createFollowValue`'s spring case (#441), at rest within 0.001. A writable memo source: #257 item 7.
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
export const createVelocity = (source: LiveSource<number>): Accessor<number> => {
  if (isServer) return SERVER_ZERO
  const runtime = useWardicRuntime()
  return liveOf(runtime, LiveValue.velocity(sourceAtomOf(source, runtime.runSync(AtomRegistry.AtomRegistry))))
}

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
  if (isServer) return SERVER_ZERO
  return liveOf(useWardicRuntime(), LiveValue.time())
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
  const registry = useWardicRuntime().runSync(AtomRegistry.AtomRegistry)
  return willChangeOf(registry, onCleanup, (atom) => followAtom(registry, atom))
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

const SCROLL_KEYS = ["scrollX", "scrollY", "scrollXProgress", "scrollYProgress"] as const
/** `createScroll`'s elements before the render has settled: none yet. */
const NOT_YET = { container: Option.none(), target: Option.none() } as const
const SERVER_SCROLL: ScrollValues = { scrollX: SERVER_ZERO, scrollY: SERVER_ZERO, scrollXProgress: SERVER_ZERO, scrollYProgress: SERVER_ZERO }

/** An element source read now: `None` for an accessor whose ref hasn't arrived. */
const elementOf = (source: ElementSource | undefined): Option.Option<Element | undefined> =>
  Bool.match(Predicate.isFunction(source), {
    onTrue: () => Option.fromUndefinedOr((source as Accessor<Element | undefined>)()),
    onFalse: () => Option.some(source as Element | undefined),
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
// new one. Each value carries one Atom for its life.
export const createScroll = (options: ScrollOptions = {}): ScrollValues => {
  if (isServer) return SERVER_SCROLL
  const runtime = useWardicRuntime()
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  // Its own four Atoms, set from the scroll of the elements there now.
  const outs = Rec.fromIterableWith(SCROLL_KEYS, (key) => [key, Atom.make(0)] as const)
  Arr.forEach(SCROLL_KEYS, (key) => onCleanup(registry.mount(outs[key])))
  // Its elements are read once the render has settled: a ref given as `() => box` is set during the
  // render, after this effect's first compute, and isn't a signal, so nothing would read it again.
  const [settled, setSettled] = createSignal(false)
  onSettledClientOnly(() => {
    setSettled(true)
  })
  createEffect(
    () =>
      Bool.match(settled(), {
        onTrue: () => ({ container: elementOf(options.container), target: elementOf(options.target) }),
        onFalse: () => NOT_YET,
      }),
    ({ container, target }) => {
      // A ref not there yet: the values hold until it is.
      if (Bool.or(Option.isNone(container), Option.isNone(target))) return undefined
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
      const stops = Arr.map(SCROLL_KEYS, (key) => registry.subscribe(values[key], (v) => registry.set(outs[key], v), { immediate: true }))
      return () => {
        Arr.forEach(stops, (stop) => stop())
        closeScope(runtime, scope)
      }
    },
    CLIENT_ONLY,
  )
  return Rec.map(outs, (atom) => followAtom(registry, atom)) as unknown as ScrollValues
}
