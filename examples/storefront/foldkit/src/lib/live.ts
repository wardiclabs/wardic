/**
 * Live values on Foldkit (#795; ADR-0071, decision 16). The Atoms a view binds, in `w.Style` or
 * `w.Text`, are made at module scope, so the view can name them. What drives them, a spring, a
 * scroll's progress, a transform, is made where a Scope holds it: in a Mount on the element it reads,
 * on Wardic's services, and fed into the bound Atoms until the element goes. A Replay mounts the
 * element afresh, and the values with it.
 */
import * as Effect from "effect/Effect"
import type * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type * as Scope from "effect/Scope"
import type { LiveValue } from "@wardic/foldkit"
import * as Wardic from "@wardic/foldkit/Wardic"
import { wardic } from "~/lib/wardic.ts"

/**
 * `effect` on the shop's Wardic services, from a Mount, which Foldkit gives no services of the
 * program's: the Handle's own Layer provides the one `Wardic.provide` needs. The Scope is the Mount's.
 */
export const onWardic = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(Wardic.provide(effect), wardic.resources)

/**
 * A scroll as Live values (`Wardic.scroll`, Motion's `useScroll`): the page's, or `container`'s,
 * with Motion's `target` and `offset`, read until the Scope ends. The shop's Handle names
 * `Features.scroll` among Features given, not loaded, so the binding's `ScrollFailed` can't come
 * here: were it to, that's a defect of the app's wiring, not a case a page handles.
 */
export const scroll = (options?: Wardic.ScrollOptions): Effect.Effect<LiveValue.ScrollValues, never, Wardic.Wardic | Scope.Scope> => Effect.orDie(Wardic.scroll(options))

// ADR-0071, decision 16: Atoms at module scope, here one set per item of several.
/** One `make()` per key: the Live values of each of several items, which a view binds by the item's key and the item's Mount feeds. */
export const perKey = <A>(keys: ReadonlyArray<string>, make: () => A): Readonly<Record<string, A>> => Object.fromEntries(keys.map((key) => [key, make()]))

/** Each value of `from`, written into `into`, which a view binds, until the Scope ends. */
export const feed = <A>(from: Atom.Atom<A>, into: Atom.Writable<A, A>): Effect.Effect<void, never, AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const stop = registry.subscribe(from, (value) => registry.set(into, value), { immediate: true })
    yield* Effect.addFinalizer(() => Effect.sync(stop))
  })

/** `handler` on `element`'s `type` events until the Scope ends. */
export const listen = <K extends keyof HTMLElementEventMap>(element: Element, type: K, handler: (event: HTMLElementEventMap[K]) => void): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => element.addEventListener(type, handler as EventListener)),
    () => Effect.sync(() => element.removeEventListener(type, handler as EventListener)),
  )
