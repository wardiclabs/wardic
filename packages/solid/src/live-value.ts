/**
 * Live values for Solid (#130, ADR-0043): `createTransform` and `createSpring`, core's `LiveValue`
 * helpers wrapped, each taking a Live value as Solid has one (an accessor, or an `effect/reactivity`
 * Atom) and giving an accessor back, for an element's `style` or anything else.
 *
 * - `createTransform(source, fn)` maps through a function (Motion's `useTransform(value, fn)`);
 *   `createTransform(source, input, output, { clamp })` maps ranges (Motion's
 *   `useTransform(value, input, output)`), each pair of outputs blended through the Environment's
 *   `InterpolatorRegistry`, so colours and unit strings map as `animate` blends them.
 * - `createSpring(source, options)` follows its source with a spring on the Frame loop (Motion's
 *   `useSpring`), idle while it rests.
 * - `createScroll(options)` is a container's scroll (Motion's `useScroll`, #234): `scrollX`,
 *   `scrollY` and their progress, through Motion's offsets for a `target`.
 * - `createVelocity(source)` is a value's velocity a second, per frame (Motion's `useVelocity`).
 * - `createTime()` is the milliseconds since it was created (Motion's `useTime`).
 *
 * Call them where you'd create a signal (a component's body): each owns what it subscribes to
 * until its owner is disposed. On a server, each gives its source's value as it is now (ADR-0021).
 */
import * as LiveValue from "@wardic/core/LiveValue"
import type * as Machine from "@wardic/core/Machine"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import type * as ScrollOffset from "@wardic/dom/ScrollOffset"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Predicate from "effect/Predicate"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Scope from "effect/Scope"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { type Accessor, createComputed, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { fromAtom } from "./bridge.ts"
import type { LiveSource } from "./live-style.ts"
import { readLive, serverRegistryOf } from "./live-style.ts"
import { useWardicRuntime } from "./provider.tsx"
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
 * `source` mapped: through `fn` (Motion's `useTransform(value, fn)`), or through ranges: an input
 * at `input[i]` gives `output[i]`, and one between two stops blends their outputs by its progress
 * between them, colours and unit strings as `animate` blends them (Motion's
 * `useTransform(value, input, output)`). `input` ascends, and is as long as `output`, with two
 * stops or more. Outside the range the ends hold, unless `clamp: false`. The function form needs
 * no provider when its source is an accessor.
 *
 * ```tsx
 * const ward = createWard({ drag: "x" })
 * const opacity = createTransform(ward.value("x"), [-150, 0, 150], [0, 1, 0])
 * <div {...ward({ style: { opacity } })} />
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
  const read = accessorOf(source)
  if (Predicate.isFunction(fnOrInput)) return createMemo(() => fnOrInput(read()))
  const map = interpolatorOf(fnOrInput as ReadonlyArray<number>, output as ReadonlyArray<number | string>, options)
  return createMemo(() => map(read() as number))
}

/**
 * The ranges' mapping, resolved once: through the provider's `InterpolatorRegistry` on a client,
 * the DOM's on a server, which builds no runtime (ADR-0021).
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
 * starts where its source is, and from each change on, a spring toward the source, read afresh
 * each frame, runs on the Frame loop until it rests there (Motion's `useSpring`). A change
 * mid-flight keeps its velocity. Nothing runs while it rests, and its owner's disposal ends it.
 *
 * ```tsx
 * const [x, setX] = createSignal(0)
 * const followX = createSpring(x, { stiffness: 300, damping: 30 })
 * <div {...ward({ style: { x: followX } })} />
 * ```
 */
export const createSpring = (source: LiveSource<number>, options: Machine.SpringOptions = {}): Accessor<number> =>
  derivedOf(source, accessorOf(source), (atom) => LiveValue.spring(atom, options))

/**
 * `source`'s velocity, in its units a second (Motion's `useVelocity`): 0 to begin with, then, each
 * frame while the source moves, its change since the frame before over the frame's time, and 0
 * once it stops. A velocity is a value too: `createVelocity(createVelocity(x))` is acceleration.
 *
 * ```tsx
 * const { scrollY } = createScroll()
 * const skewY = createTransform(createVelocity(scrollY), [-1000, 1000], [-8, 8])
 * ```
 */
export const createVelocity = (source: LiveSource<number>): Accessor<number> => derivedOf(source, () => 0, LiveValue.velocity)

/**
 * Milliseconds since it was created, wall time (Motion's `useTime`): set every frame, so it keeps
 * the Clock ticking every frame while its owner lives.
 *
 * ```tsx
 * const rotate = createTransform(createTime(), (ms) => (ms / 1000) * 90)
 * ```
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
const derivedOf = <R>(
  source: LiveSource<number>,
  serverValue: Accessor<number>,
  make: (atom: Atom.Atom<number>) => Effect.Effect<Atom.Atom<number>, never, R>,
): Accessor<number> => {
  const runtime = useWardicRuntime()
  if (isServer) return serverValue
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  const atom = Bool.match(Atom.isAtom(source), {
    onTrue: () => source as Atom.Atom<number>,
    onFalse: () => mirrorOf(source as Accessor<number>, registry),
  })
  return liveOf(runtime, make(atom))
}

/** A helper's Atom on the provider's runtime, in a Scope its owner's disposal closes, as an accessor. */
const liveOf = <R>(runtime: WardicRuntime, live: Effect.Effect<Atom.Atom<number>, never, R>): Accessor<number> => {
  const scope = Scope.makeUnsafe()
  onCleanup(() => closeScope(runtime, scope))
  const out = runtime.runSync((live as Effect.Effect<Atom.Atom<number>, never, WardicServices | Scope.Scope>).pipe(Scope.provide(scope)))
  return fromAtom(out)
}

const SERVER_ZERO: Accessor<number> = () => 0

/** An element given as it is, or as an accessor of one (a ref, set at mount). */
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

const SERVER_SCROLL: ScrollValues = { scrollX: SERVER_ZERO, scrollY: SERVER_ZERO, scrollXProgress: SERVER_ZERO, scrollYProgress: SERVER_ZERO }

/** An element source read now: `None` for an accessor whose ref hasn't arrived. */
const elementOf = (source: ElementSource): Option.Option<Element> =>
  Bool.match(Predicate.isFunction(source), {
    onTrue: () => Option.fromUndefinedOr((source as Accessor<Element | undefined>)()),
    onFalse: () => Option.some(source as Element),
  })

/**
 * A container's scroll (Motion's `useScroll`): how far it's scrolled across and down, and the
 * progress through its range, or, with a `target` or an `offset`, through the offsets the target
 * passes on `axis`. Set within the scroll's own event, so a value derived from one paints in the
 * frame that shows the scroll. A `container` or `target` given as an accessor (a ref) is read in an
 * effect: until it's there, every value reads 0, as Motion's do; a change of either follows the new
 * one. On a server, 0s.
 *
 * ```tsx
 * let box!: HTMLDivElement
 * const { scrollYProgress } = createScroll({ container: () => box })
 * <div ref={box}>…</div>
 * <wardic.div style={{ scaleX: scrollYProgress }} />
 * ```
 */
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
