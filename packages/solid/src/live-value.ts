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
 *
 * Call them where you'd create a signal (a component's body): each owns what it subscribes to
 * until its owner is disposed. On a server, each gives its source's value as it is now (ADR-0021).
 */
import * as LiveValue from "@wardic/core/LiveValue"
import type * as Machine from "@wardic/core/Machine"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Predicate from "effect/Predicate"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import { type Accessor, createComputed, createMemo, on, onCleanup, untrack } from "solid-js"
import { fromAtom } from "./bridge.ts"
import type { LiveSource } from "./live-style.ts"
import { readLive, serverRegistryOf } from "./live-style.ts"
import { useWardicRuntime, type WardicRuntime } from "./provider.tsx"
import { isServer } from "./server.ts"

/** A Live value as an accessor: an accessor as it is, an Atom read through the provider's registry. */
const accessorOf = <A>(source: LiveSource<A>): Accessor<A> =>
  Bool.match(Atom.isAtom(source), {
    onTrue: () =>
      Bool.match(isServer, {
        onTrue: (): Accessor<A> => () => readLive(source, serverRegistryOf) as A,
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
export const createSpring = (source: LiveSource<number>, options: Machine.SpringOptions = {}): Accessor<number> => {
  const runtime = useWardicRuntime()
  if (isServer) return accessorOf(source)
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  const atom = Bool.match(Atom.isAtom(source), {
    onTrue: () => source as Atom.Atom<number>,
    onFalse: () => mirrorOf(source as Accessor<number>, registry),
  })
  const scope = Scope.makeUnsafe()
  onCleanup(() => closeScope(runtime, scope))
  const out = runtime.runSync(LiveValue.spring(atom, options).pipe(Scope.provide(scope)))
  return fromAtom(out)
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
