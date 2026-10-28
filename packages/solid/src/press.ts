/**
 * A Wardic element's press (#427, ADR-0056): watched with its **Keyboard presses**, the element made
 * focusable for them first, as Motion's press makes it. Both bindings' elements and their
 * `createPress` watch through it.
 *
 * @module
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import * as DomInput from "@wardic/dom/DomInput"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"

/**
 * Watch the presses on `element` (#427): a pointer's, and its **Keyboard presses**, the element made
 * focusable first. `keysTaken`: its Enter and Space are someone else's (a Reorder item's, which lift
 * it, ADR-0037), so it hears no keys, and is left as it is.
 */
export const watchPressOn = (
  element: unknown,
  handlers: InputFeed.Handlers<Recognizer.PressEvent>,
  keysTaken = false,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> =>
  Effect.andThen(
    Effect.sync(() => {
      if (Bool.not(keysTaken)) DomInput.makeFocusable(element)
    }),
    Recognizer.watchPress(element, handlers, { keys: Bool.not(keysTaken) }),
  )
