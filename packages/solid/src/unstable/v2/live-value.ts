/**
 * Live values on Solid 2 (#130, ADR-0043; #209 PR 3's Q2, ADR-0045): `createTransform`,
 * `createSpring`, `createVelocity`, `createTime` and `createScroll`, core's `LiveValue` helpers
 * wrapped, as on the Solid 1 binding (Motion's `useTransform`, `useSpring`, `useVelocity`,
 * `useTime`, `useScroll`).
 *
 * Each gives an accessor back, for an element's `style` or anything else. Where it's derived on an
 * Atom, the accessor carries it (`live-style.ts`'s `carry`): a `style` given it follows the Atom,
 * set where its source is, so a value derived from a ward's `read(key)` is written in the gate's
 * frame and paints with it. Read through Solid it would come a frame late: Solid 2 shows a change at
 * its flush, after the gate's write. So:
 *
 * - `createSpring`, `createVelocity`, `createTime` and `createScroll` are always derived on Atoms
 *   (core's); an accessor source with no Atom of its own is mirrored into one.
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
import { atomOf, type LiveSource, readLive, serverRegistryOf, serverSpringOf, type SpringAccessor, springAccessorOf } from "../../live-style.ts"
import type { WardicRuntime, WardicServices } from "../../runtime.ts"
import { followAtom } from "./bridge.ts"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED, onSettledClientOnly } from "./solid-reactivity.ts"
import { useWardicRuntime } from "./provider.tsx"

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
 * `source` mapped: through `fn` (Motion's `useTransform(value, fn)`), or through ranges: an input at
 * `input[i]` gives `output[i]`, and one between two stops blends their outputs by its progress
 * between them, colours and unit strings as `animate` blends them (Motion's
 * `useTransform(value, input, output)`). `input` ascends, and is as long as `output`, with two stops
 * or more. Outside the range the ends hold, unless `clamp: false`.
 *
 * ```tsx
 * const card = ward({ drag: "x" })
 * const opacity = createTransform(card.read("x"), [-150, 0, 150], [0, 1, 0])
 * const label = ward({ style: { opacity } })  // in the frame the card moves
 * ```
 */
export function createTransform<A, B>(source: LiveSource<A>, fn: (a: A) => B): Accessor<B>
export function createTransform<O extends number | string>(
  source: LiveSource<number>,
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options?: LiveValue.TransformOptions,
): Accessor<O>
export function createTransform(
  source: LiveSource<unknown>,
  fnOrInput: ((a: unknown) => unknown) | ReadonlyArray<number>,
  output?: ReadonlyArray<number | string>,
  options?: LiveValue.TransformOptions,
): Accessor<unknown> {
  const fn = Bool.match(Predicate.isFunction(fnOrInput), {
    onTrue: () => fnOrInput as (a: unknown) => unknown,
    onFalse: () => interpolatorOf(fnOrInput as ReadonlyArray<number>, output as ReadonlyArray<number | string>, options) as (a: unknown) => unknown,
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
const interpolatorOf = <O extends number | string>(
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options: LiveValue.TransformOptions | undefined,
): ((v: number) => O) => {
  const mapping = LiveValue.interpolate(input, output, options)
  if (isServer) return Effect.runSync(mapping.pipe(Effect.provide(DomInterpolators.layer)))
  return useWardicRuntime().runSync(mapping)
}

/**
 * A value that follows `source` with a spring (`options`, as `transition`'s spring options): it
 * starts where its source is, and from each change on, a spring toward the source runs on the Frame
 * loop until it rests there (Motion's `useSpring`). A change mid-flight keeps its velocity. Nothing
 * runs while it rests, and its owner's disposal ends it.
 *
 * - **`jump(value)`** sets it at once, not as motion (Motion's `jump`): it rests there until its
 *   source next changes, then springs from there, and a `createVelocity` of it reads 0 across it.
 * - **`skipInitialAnimation`**: the source's first change is a jump, as Motion's option, for a
 *   source set once after mount (a scroll the browser restores).
 * - **A source that's derived and also set** is Solid's writable memo, `createSignal(fn)`: a write
 *   springs there, and the next change of what it derives from springs to that (#257 item 7).
 *
 * ```tsx
 * const [x, setX] = createSignal(0)
 * const card = ward({ style: { x: createSpring(x, { stiffness: 300, damping: 30 }) } })
 * ```
 */
export const createSpring = (source: LiveSource<number>, options: LiveValue.SpringOptions = {}): SpringAccessor => {
  if (isServer) return serverSpringOf(() => readOnServer(source))
  const runtime = useWardicRuntime()
  return springAccessorOf(runtime, liveOf(runtime, LiveValue.spring(sourceAtomOf(source, runtime.runSync(AtomRegistry.AtomRegistry)), options)))
}

/**
 * `source`'s velocity, in its units a second (Motion's `useVelocity`): 0 to begin with, then, each
 * frame while the source moves, its change since the frame before over the frame's time, and 0 once
 * it stops. A velocity is a value too: `createVelocity(createVelocity(x))` is acceleration.
 */
export const createVelocity = (source: LiveSource<number>): Accessor<number> => {
  if (isServer) return SERVER_ZERO
  const runtime = useWardicRuntime()
  return liveOf(runtime, LiveValue.velocity(sourceAtomOf(source, runtime.runSync(AtomRegistry.AtomRegistry))))
}

/**
 * Milliseconds since it was created, wall time (Motion's `useTime`): set every frame, so it keeps
 * the Clock ticking every frame while its owner lives.
 */
export const createTime = (): Accessor<number> => {
  if (isServer) return SERVER_ZERO
  return liveOf(useWardicRuntime(), LiveValue.time())
}

const SERVER_ZERO: Accessor<number> = () => 0

/** An element given as it is, or as an accessor of one (a ref's, set at mount). */
export type ElementSource = Element | Accessor<Element | undefined>

/** `createScroll`'s options, Motion's `useScroll`'s. */
export interface ScrollOptions {
  /** The scroll container; the page when left out. */
  readonly container?: ElementSource
  /** An element whose progress through the container `offset` reads, on `axis`. */
  readonly target?: ElementSource
  /** Where the target's progress runs: Motion's syntax, the DOM's (`@wardic/dom/ScrollOffset`). `All` with a target. */
  readonly offset?: ScrollOffset.ScrollOffset
  /** The axis `target` and `offset` apply to. Default `"y"`. */
  readonly axis?: "x" | "y"
}

/** `createScroll`'s values, Motion's four. */
export interface ScrollValues {
  readonly scrollX: Accessor<number>
  readonly scrollY: Accessor<number>
  readonly scrollXProgress: Accessor<number>
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
 * A container's scroll (Motion's `useScroll`): how far it's scrolled across and down, and the
 * progress through its range, or, with a `target` or an `offset`, through the offsets the target
 * passes on `axis`. Set within the scroll's own event, so a value derived from one paints in the
 * frame that shows the scroll. A `container` or `target` given as an accessor (a ref's) is read in
 * an effect: until it's there every value reads 0, as Motion's do, and a change of either follows
 * the new one. Each value carries one Atom for its life. On a server, 0s.
 *
 * ```tsx
 * let box!: HTMLDivElement
 * const { scrollYProgress } = createScroll({ container: () => box })
 * <div ref={box}>…</div>
 * <wardic.div style={{ scaleX: scrollYProgress }} />
 * ```
 */
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
