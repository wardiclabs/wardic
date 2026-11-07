/**
 * Reactive bridges on Solid 2 (#209, ADR-0006), as the Solid 1 binding's: `streamToSignal` runs a
 * core `Stream` into a signal for as long as its owner lives, and `fromAtom` reads an Effect `Atom`
 * through the provider's registry. Their signals are written from outside Solid (a fiber, the
 * registry), so a change shows at Solid 2's next flush. `fromAtom`'s accessor carries its Atom
 * (#209 PR 3's Q2), so a `style` given it follows the Atom itself, in the frame the Atom is set.
 *
 * @module
 */
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Stream from "effect/Stream"
import { isServer } from "@solidjs/web"
import { type Accessor, createSignal, isHydrating, onCleanup } from "solid-js"
import { carry } from "../../live-style.ts"
import type { WardicServices } from "../../runtime.ts"
import { runScoped, useWardicRuntime } from "./provider.tsx"
import { onSettledClientOnly } from "./solid-reactivity.ts"

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
export const streamToSignal = <A>(stream: Stream.Stream<A, never, WardicServices>, initial: A): Accessor<A> => {
  const runtime = useWardicRuntime()
  const [value, setValue] = createSignal<A>(initial as Exclude<A, Function>)
  runScoped(runtime, Stream.runForEach(stream, (next) => Effect.sync(() => setValue(() => next))))
  return value
}

/**
 * `atom` as an accessor carrying it: a signal set from `registry` at each change, unsubscribed when
 * the owner is disposed. Every Atom the binding hands to Solid goes through it (a ward's `read`, the
 * Live-value helpers, `fromAtom`). Call it where you'd make a signal.
 */
export const followAtom = <A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A>): Accessor<A> => {
  const [value, setValue] = createSignal<A>(registry.get(atom) as Exclude<A, Function>)
  onCleanup(registry.subscribe(atom, (next) => setValue(() => next as Exclude<A, Function>)))
  // eslint-disable-next-line solid/reactivity -- the accessor itself is returned, for its caller to read where it tracks
  return carry(value, atom)
}

/**
 * An Effect `Atom` as an accessor: read through the provider's `AtomRegistry`, and followed until the
 * owner is cleaned up. For a server render, give `serverValue`: the server renders it, and a hydrating
 * page keeps it until it has settled, then follows the atom. It carries the Atom, so a `style` given it
 * follows the Atom itself.
 *
 * @example
 * const visible = fromAtom(probe.visible, { serverValue: true })
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
    const [value, setValue] = createSignal<A>(options.serverValue as Exclude<A, Function>)
    onSettledClientOnly(() => {
      const registry = runtime.runSync(AtomRegistry.AtomRegistry)
      setValue(() => registry.get(atom))
      return registry.subscribe(atom, (next) => setValue(() => next))
    })
    return value
  }
  return followAtom(runtime.runSync(AtomRegistry.AtomRegistry), atom)
}
