/**
 * The pointer over an element as **Live values**, for every DOM binding: where it is in the element's
 * pixels and how far across the element's box, and whether it's inside, each an Atom a binding's
 * element binds, set within the pointer's own events and read until the Scope ends. Plain pointer
 * events, not the hover gesture: a finger counts only when asked (it never hovers), and a drag
 * suppresses nothing. Foldkit's `Wardic.pointer` reads it on the Handle's registry.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #833: the storefront's spotlight and magnifier each listened to the pointer
// and did the arithmetic themselves, where the Solid ward's `when("hover")` is its own per-move listener; core's
// recognizer knows hover's edges alone, and a per-move Message on Foldkit would render per move (decision 23).
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Num from "effect/Number"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"

/** A pointer's type, as its events name it. */
export type PointerType = "mouse" | "pen" | "touch"

/** What `pointer` takes: the pointer types that count, a mouse and a pen unless given, since a finger never hovers. */
export interface Options {
  readonly types?: ReadonlyArray<PointerType> | undefined
}

/**
 * The pointer over an element: its place in the element's pixels, from the box's top left; its
 * progress across the box, from 0 at the left or top edge to 1 at the right or bottom; and whether
 * it's inside. The place stays where the pointer left.
 */
export interface PointerValues {
  readonly x: Atom.Atom<number>
  readonly y: Atom.Atom<number>
  readonly xProgress: Atom.Atom<number>
  readonly yProgress: Atom.Atom<number>
  readonly inside: Atom.Atom<boolean>
}

const MOUSE_AND_PEN: ReadonlyArray<PointerType> = ["mouse", "pen"]

/** The events that place the pointer: its entry, each move, and a press, which is how a finger arrives. */
const PLACING: ReadonlyArray<string> = ["pointerenter", "pointermove", "pointerdown"]

const UNIT = { minimum: 0, maximum: 1 } as const

/** `offset` as progress across `length`: 0 for a box with none. */
const progressOf = (offset: number, length: number): number => {
  if (length <= 0) return 0
  return Num.clamp(offset / length, UNIT)
}

/**
 * The pointer over `element` as {@link PointerValues}, on the Environment's `AtomRegistry`, until the
 * Scope ends: its Atoms are mounted on the registry while read, so a set holds before anything binds
 * them, and its listeners are the element's own.
 */
export const pointer = (element: Element, options: Options = {}): Effect.Effect<PointerValues, never, AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const types = UndefinedOr.match(options.types, { onUndefined: () => MOUSE_AND_PEN, onDefined: (given) => given })
    const x = Atom.make(0)
    const y = Atom.make(0)
    const xProgress = Atom.make(0)
    const yProgress = Atom.make(0)
    const inside = Atom.make(false)
    // Mounted while read, not kept alive, as the scroll reader's Atom is: a kept-alive Atom's node never leaves the registry.
    const unmounts = [registry.mount(x), registry.mount(y), registry.mount(xProgress), registry.mount(yProgress), registry.mount(inside)]
    const counts = (event: Event): boolean => Arr.contains(types, (event as PointerEvent).pointerType as PointerType)
    const place = (event: Event): void => {
      if (Bool.not(counts(event))) return
      const { clientX, clientY } = event as PointerEvent
      const box = element.getBoundingClientRect()
      const left = clientX - box.left
      const top = clientY - box.top
      registry.set(x, left)
      registry.set(y, top)
      registry.set(xProgress, progressOf(left, box.width))
      registry.set(yProgress, progressOf(top, box.height))
      registry.set(inside, true)
    }
    const leave = (event: Event): void => {
      if (Bool.not(counts(event))) return
      registry.set(inside, false)
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        Arr.forEach(PLACING, (type) => element.addEventListener(type, place))
        element.addEventListener("pointerleave", leave)
      }),
      () =>
        Effect.sync(() => {
          Arr.forEach(PLACING, (type) => element.removeEventListener(type, place))
          element.removeEventListener("pointerleave", leave)
          Arr.forEach(unmounts, (unmount) => unmount())
        }),
    )
    return { x, y, xProgress, yProgress, inside }
  })
