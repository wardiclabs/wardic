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
import type * as Recognizer from "@wardic/core/Recognizer"
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
 * Bridge a core `Stream` into a Solid `Accessor`.
 *
 * Seeds the signal with `initial`, then forks `Stream.runForEach` on the
 * provider runtime ({@link runScoped}), writing every emission into the signal.
 * The fiber is interrupted on the consuming component's `onCleanup`.
 *
 * `set(() => v)` (not `set(v)`) is used so function- or object-valued emissions
 * are stored as-is — Solid would otherwise treat a function argument as an
 * updater. The stream's `R` is the Wardic environment services (the recognizers
 * need `InputSource`/`Probe`), which the provider runtime satisfies.
 *
 * @param stream the source stream (its `R` is covered by the provider runtime).
 * @param initial the signal's value until the first emission.
 */
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
  watchOf: (handlers: Recognizer.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | WardicServices>,
  initial: A,
): Accessor<A> => {
  const [get, set] = createSignal(initial)
  runWatch(useWardicRuntime(), (onDefect) => watchOf({ on: (value) => set(() => value), onDefect }))
  return get
}

/**
 * Bridge an Effect `Atom` into a Solid `Accessor` via the provider runtime's
 * `AtomRegistry`, using Solid's `from`.
 *
 * `from(producer, seed)` creates the signal, runs the producer (which
 * `subscribe`s the atom), and auto-registers `onCleanup` with the producer's
 * returned unsubscribe — so this reduces to: seed with the atom's current value,
 * push changes through `set`. The seeded 2-arg form keeps the `Accessor`
 * non-`undefined`. `set(() => v)` is used so object/function values are stored
 * as-is rather than treated as a Solid updater.
 *
 * A server has no registry (it builds no runtime, ADR-0021), so pass `serverValue` for an
 * atom read during a server render: the server renders it, and a hydrating client keeps it
 * until mount, then reads and subscribes to the atom (the Hydration hold, decision 8).
 * Without one, a server render reads the atom through the Environment, which DomLive
 * refuses with its client-only error. A client-only render reads the atom at once.
 *
 * @param atom the reactive service input (e.g. `Probe.prefersReducedMotion`).
 * @param options.serverValue the value a server renders, and a hydrating client until mount.
 */
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
