/**
 * A Wardic element's press (#427, ADR-0056): watched with its **Keyboard presses**, the element made
 * focusable for them first, as Motion's press makes it, and kept from its pressable ancestors when its
 * `propagate` says so (#439). Both bindings' elements and their `createPress` watch through it.
 *
 * @module
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import * as DomInput from "@wardic/dom/DomInput"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constTrue, type LazyArg } from "effect/Function"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicPropagate } from "./config.ts"

/** Whether an element's taps reach its pressable ancestors (#439): unless its `propagate` says `tap: false`. */
export const tapPropagates = (propagate: WardicPropagate | undefined): boolean =>
  UndefinedOr.match(propagate, { onUndefined: constTrue, onDefined: (p) => p.tap !== false })

/**
 * Watch the presses on `element` (#427): a pointer's, and its **Keyboard presses**, the element made
 * focusable first. `keysTaken`: its Enter and Space are someone else's (a Reorder item's, which lift
 * it, ADR-0037), so it hears no keys, and is left as it is. `propagates`: whether its presses reach its
 * pressable ancestors (#439), read at each press's start.
 */
export const watchPressOn = (
  element: unknown,
  handlers: InputFeed.Handlers<Recognizer.PressEvent>,
  keysTaken = false,
  propagates: LazyArg<boolean> = constTrue,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> =>
  Effect.andThen(
    Effect.sync(() => {
      if (Bool.not(keysTaken)) DomInput.makeFocusable(element)
    }),
    Recognizer.watchPress(element, handlers, { keys: Bool.not(keysTaken), propagate: propagates }),
  )
