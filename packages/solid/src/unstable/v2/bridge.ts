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
import { AtomRegistry, type Atom } from "effect/reactivity"
import * as Stream from "effect/Stream"
import { isServer } from "@solidjs/web"
import { type Accessor, createSignal, isHydrating, onCleanup } from "solid-js"
import { carry } from "../../live-style.ts"
import type { WardicServices } from "../../runtime.ts"
import { runScoped, useWardicRuntime } from "./provider.tsx"
import { onSettledClientOnly } from "./solid-reactivity.ts"

/**
 * A core `Stream` as an accessor: `initial` until its first value, then its latest, the stream run
 * on the provider's runtime until the owner is disposed (`runScoped`). Call it where you'd make a
 * signal.
 */
export const streamToSignal = <A>(stream: Stream.Stream<A, never, WardicServices>, initial: A): Accessor<A> => {
  const runtime = useWardicRuntime()
  const [value, setValue] = createSignal<A>(initial as Exclude<A, Function>, { ownedWrite: true })
  runScoped(runtime, Stream.runForEach(stream, (next) => Effect.sync(() => setValue(() => next))))
  return value
}

/**
 * `atom` as an accessor carrying it: a signal set from `registry` at each change, unsubscribed when
 * the owner is disposed. Every Atom the binding hands to Solid goes through it (a ward's `read`, the
 * Live-value helpers, `fromAtom`). Call it where you'd make a signal.
 */
export const followAtom = <A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A>): Accessor<A> => {
  const [value, setValue] = createSignal<A>(registry.get(atom) as Exclude<A, Function>, { ownedWrite: true })
  onCleanup(registry.subscribe(atom, (next) => setValue(() => next as Exclude<A, Function>)))
  return carry(value, atom)
}

/**
 * An Effect `Atom` as an accessor, read through the provider runtime's `AtomRegistry` and followed
 * until the owner is disposed; it carries the Atom, so a `style` given it follows the Atom itself. A
 * server builds no registry (ADR-0021): give `serverValue` for an atom read during a server render,
 * which a hydrating client keeps until it has settled (the Hydration hold), then reads and follows
 * the atom. That held accessor carries nothing: until it has settled it doesn't read what its Atom
 * holds.
 */
export const fromAtom = <A>(atom: Atom.Atom<A>, options?: { readonly serverValue?: A }): Accessor<A> => {
  const runtime = useWardicRuntime()
  const held = Predicate.isNotUndefined(options) && "serverValue" in options
  if (held && isServer) {
    const serverValue = options.serverValue as A
    return () => serverValue
  }
  if (held && isHydrating()) {
    const [value, setValue] = createSignal<A>(options.serverValue as Exclude<A, Function>, { ownedWrite: true })
    onSettledClientOnly(() => {
      const registry = runtime.runSync(AtomRegistry.AtomRegistry)
      setValue(() => registry.get(atom))
      return registry.subscribe(atom, (next) => setValue(() => next))
    })
    return value
  }
  return followAtom(runtime.runSync(AtomRegistry.AtomRegistry), atom)
}
