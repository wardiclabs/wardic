/**
 * The **Animation scope** on Foldkit (#433, Motion's `useAnimate`'s scope; #798, Q7–Q9, Q14 and Q19): an
 * opaque record made apart from any element, given to one `w.*` element as `w.AnimationScope(scope)`,
 * whose Mount makes it the scope's element (the latest mount wins, as a ref's does) and whose release
 * stops the animations started in it where they are, as a Solid component's cleanup stops its
 * `createAnimate` scope's. A Command's `Wardic.animate(…, { scope })` looks its selectors up inside the
 * element and tells the scope each animation's start and end (dom's `scopeOf`, whose ref and
 * `animations` list Foldkit doesn't use: it has no refs, and no Playback controls, Q10).
 *
 * @module
 */
import * as Imperative from "@wardic/dom/unstable/Imperative"
import * as MutableRef from "effect/MutableRef"
import * as UndefinedOr from "effect/UndefinedOr"

/** An Animation scope: the `w.*` element it's mounted on, while it is. */
export interface AnimationScope {
  /** The element given `w.AnimationScope(scope)`, once its Mount has run; `undefined` before, and after its release. */
  readonly element: () => Element | undefined
}

/** What the binding holds of a scope: its element, dom's watch over its animations, and their stop. */
interface Parts {
  readonly current: MutableRef.MutableRef<Element | undefined>
  readonly watch: Imperative.AnimationWatch
  readonly stopAll: () => void
}

// Module state (#460, Q7): each scope's parts, held weakly by the scope, for its element's Mount and the Commands.
const parts = new WeakMap<AnimationScope, Parts>()

/** Makes an Animation scope (Motion's `useAnimate`'s): needs no element, and outlives the element given it. */
export const make = (): AnimationScope => {
  const made = Imperative.scopeOf<Element>()
  const current = MutableRef.make<Element | undefined>(undefined)
  const scope: AnimationScope = { element: () => MutableRef.get(current) }
  parts.set(scope, { current, watch: made.watch, stopAll: made.stopAll })
  return scope
}

/** `scope`'s parts: made by {@link make}, so never missing. */
const partsOf = (scope: AnimationScope): Parts => UndefinedOr.getOrThrow(parts.get(scope))

/** What a Command's animation tells `scope` as it starts and ends: dom's watch over the scope's animations in flight. */
export const watchOf = (scope: AnimationScope): Imperative.AnimationWatch => partsOf(scope).watch

/**
 * `element` mounted with `scope` (its Mount): the scope's element from now. Returns the release: the
 * scope's element cleared, if it's still this one, and the animations started in the scope stopped
 * where they are (Q9, Q19); an element another mount took the scope from stops nothing.
 */
export const mounted = (scope: AnimationScope, element: Element): (() => void) => {
  const { current, stopAll } = partsOf(scope)
  MutableRef.set(current, element)
  return () => {
    if (MutableRef.get(current) !== element) return
    MutableRef.set(current, undefined)
    stopAll()
  }
}
