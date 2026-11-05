/**
 * Reactive bridges (ADR-0006): the two adapters that turn Effect-side reactive
 * sources into Solid `Accessor`s the JSX layer can read.
 *
 * - {@link streamToSignal} bridges a core frame/recognizer `Stream` into a Solid
 *   signal: a fiber forked on the provider runtime runs `Stream.runForEach`,
 *   pushing each emission into the signal. The fiber is scoped to the consuming
 *   component's `onCleanup` (via {@link runScoped}), so unmount interrupts it,
 *   tears down its Scope, and drops the ref-count on the Shared sources it
 *   subscribed to — exactly the per-element fiber lifecycle ADR-0006 prescribes.
 * - {@link fromAtom} bridges an Effect `Atom` (reactive service inputs like
 *   `Probe.prefersReducedMotion` / `Probe.viewport`) into a Solid signal via the
 *   provider runtime's `AtomRegistry`: it reads the atom's current value for the
 *   initial signal, subscribes to push updates, and unsubscribes on `onCleanup`.
 *
 * Both MUST be called within a Solid owner (component body / `createRoot`) —
 * they register `onCleanup` and read the runtime from context.
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { AtomRegistry, type Atom } from "effect/reactivity"
import { type Accessor, createSignal, from, onCleanup, onMount } from "solid-js"
import { runScoped, runWatch, useWardicRuntime } from "./provider.tsx"
import type { WardicServices } from "./runtime.ts"
import { isHydrating, isServer } from "./server.ts"

/**
 * A core `Stream` as an accessor: `initial` until its first value, then its latest, the stream run on
 * the provider's runtime until the owner is cleaned up. Call it where you'd make a signal.
 *
 * @example
 * const point = streamToSignal(pointerMoves, { x: 0, y: 0 })
 * @see https://wardic.dev/reference/solid/advanced/bridges
 */
// `Stream.runForEach` through `runScoped`; `set(() => v)`, so an object or function value is stored as
// it is. The stream's `R` is the provider runtime's services.
export const streamToSignal = <A>(
  stream: Stream.Stream<A, never, WardicServices>,
  initial: A,
): Accessor<A> => {
  const [get, set] = createSignal(initial)
  const runtime = useWardicRuntime()
  runScoped(
    runtime,
    Stream.runForEach(stream, (v) => Effect.sync(() => set(() => v))),
  )
  return get
}

/**
 * A gesture watch's values as a Solid `Accessor` (#318, ADR-0055): `initial` until the first, the
 * watch run with {@link runWatch} (a Scope of its own, closed with the owner; a handler's throw
 * reported). Must be called within a Solid owner under a `WardicProvider`.
 */
export const watchToSignal = <A>(
  watchOf: (handlers: InputFeed.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | WardicServices>,
  initial: A,
): Accessor<A> => {
  const [get, set] = createSignal(initial)
  runWatch(useWardicRuntime(), (onDefect) => watchOf({ on: (value) => set(() => value), onDefect }))
  return get
}

/**
 * An Effect `Atom` as an accessor: read through the provider's `AtomRegistry`, and followed until the
 * owner is cleaned up. For a server render, give `serverValue`: the server renders it, and a hydrating
 * page keeps it until mount, then follows the atom.
 *
 * @example
 * const visible = fromAtom(probe.pageVisible, { serverValue: true })
 * @see https://wardic.dev/reference/solid/advanced/bridges
 */
// Solid's `from`, seeded with the atom's value; `set(() => v)`, so an object or function value is stored
// as it is. A server builds no registry (ADR-0021); the Hydration hold is decision 8.
export const fromAtom = <A>(atom: Atom.Atom<A>, options?: { readonly serverValue?: A }): Accessor<A> => {
  const runtime = useWardicRuntime()
  const held = Predicate.isNotUndefined(options) && "serverValue" in options
  if (held && isServer) {
    const serverValue = options.serverValue as A
    return () => serverValue
  }
  if (held && isHydrating()) {
    const [value, setValue] = createSignal<A>(options.serverValue as A)
    onMount(() => {
      const registry = runtime.runSync(AtomRegistry.AtomRegistry)
      setValue(() => registry.get(atom))
      onCleanup(registry.subscribe(atom, (v) => setValue(() => v)))
    })
    return value
  }
  // A `Context.Service` key is itself an `Effect<Shape, never, Identifier>`,
  // so running it on the provider runtime yields the registry instance.
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  return from<A>((set) => registry.subscribe(atom, (v) => set(() => v)), registry.get(atom))
}
