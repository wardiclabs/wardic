/**
 * A Reorder item's input (ADR-0037), Solid-free (#379): its keys, blurs and presses told to its driver
 * by watches while a Scope is open, each inside its event, with no fiber at rest. Both bindings run it
 * in the item's watch Scope (ADR-0055, *Amendment (#379)*). A Batch Reorder group's items (#712) are
 * heard through the feeds over them instead, with no listener per item at rest.
 *
 * @module
 */
import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import type * as ReorderController from "@wardic/dom/ReorderController"
import * as Report from "@wardic/dom/Report"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"

/** A Primary pointer's down: a press the driver hears. */
const isPress = (event: InputSource.PointerLikeEvent): boolean => Bool.and(event.type === "down", InputSource.isPrimaryPointer(event))

/**
 * Watch an item's keys, blurs and presses for its driver (ADR-0037, #379) while the Scope is open: its
 * keys inside their dispatch, so the reorder's `handle()` (the page's `preventDefault`) counts. A blur
 * is judged after this task's own work, one scheduler hop on (#318): a reorder can blur the node it
 * moves and puts focus back after (the driver's `keepFocus`). So `fork` runs that hop on the provider
 * runtime, only when a blur happens, and a blur whose judging fails is reported. A throw from the
 * driver inside an event goes to `onDefect`.
 */
export const watchItemInput = (
  el: HTMLElement,
  driver: ReorderController.ItemDriver,
  fork: (effect: Effect.Effect<void>) => void,
  onDefect: InputFeed.OnDefect,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> => {
  const judgeBlur = judgedBlurOf(driver)
  return Effect.gen(function* () {
    const input = yield* InputSource.InputSource
    yield* InputFeed.watch(input.keyboard(el), { on: (event) => driver.onKey(event), onDefect })
    yield* InputFeed.watch(input.focus(el), {
      on: (event) => {
        // The item's own blur: one inside it (#439) leaves it focused.
        if (Bool.and(event.type === "blur", event.fromTarget !== false)) fork(judgeBlur)
      },
      onDefect,
    })
    yield* InputFeed.watch(input.pointer(el), {
      on: (event) => {
        if (isPress(event)) driver.onPress()
      },
      onDefect,
    })
  })
}

/** A blur judged after this task's own work, one scheduler hop on (#318); a judging that fails reported. */
const judgedBlurOf = (driver: ReorderController.ItemDriver): Effect.Effect<void> =>
  Effect.andThen(Effect.yieldNow, Effect.sync(() => driver.onBlur())).pipe(
    Effect.catchCause((cause) => Report.failure("wardic.reorder: judging an item's blur failed", cause)),
  )

/** An InputSource's feed over many targets, or a defect naming it. */
const amongOf = <A>(feed: A | undefined, name: string): Effect.Effect<A> =>
  UndefinedOr.match(feed, {
    onUndefined: () => Effect.die(new Error(`wardic.reorder: the Environment's InputSource has no \`${name}\`, which a Batch Reorder group's items need`)),
    onDefined: Effect.succeed,
  })

/**
 * Watch a Batch Reorder group's items' keys, blurs and presses for their drivers (#712, ADR-0072 decision 6,
 * Q28) while the Scope is open, through the feeds over them: focus heard by `focusAmong`, and a focused
 * item's own keys from its focus to its blur, as a Batch's press watch holds them (#460); presses by
 * `pointerAmong`. So at rest no item listens. `memberOf` names the item a node is; `driverOf` is its
 * driver, `undefined` for an item gone. Blurs are judged as {@link watchItemInput}'s are.
 */
export const watchItemsInputAmong = (
  memberOf: (node: unknown) => Option.Option<unknown>,
  driverOf: (target: unknown) => ReorderController.ItemDriver | undefined,
  fork: (effect: Effect.Effect<void>) => void,
  onDefect: InputFeed.OnDefect,
): Effect.Effect<void, never, Scope.Scope | InputSource.InputSource> =>
  Effect.gen(function* () {
    const input = yield* InputSource.InputSource
    const focusAmong = yield* amongOf(input.focusAmong, "focusAmong")
    const pointerAmong = yield* amongOf(input.pointerAmong, "pointerAmong")
    // Each focused item's keys.
    const keysOf = new Map<unknown, InputFeed.Switch>()
    const closeKeys = (target: unknown): void => {
      UndefinedOr.map(keysOf.get(target), (keysNow) => keysNow.close())
      keysOf.delete(target)
    }
    const openKeys = (target: unknown): void => {
      if (keysOf.has(target)) return
      const driver = driverOf(target)
      if (Predicate.isUndefined(driver)) return
      const keysNow = InputFeed.switched(input.keyboard(target), (event) => driver.onKey(event), onDefect)
      keysOf.set(target, keysNow)
      keysNow.open()
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        keysOf.forEach((keysNow) => keysNow.close())
        keysOf.clear()
      })
    )
    yield* InputFeed.watch(focusAmong(memberOf), {
      on: ({ target, event }) => {
        if (event.type === "focus") return openKeys(target)
        closeKeys(target)
        // The item's own blur: one inside it (#439) leaves it focused.
        if (event.fromTarget === false) return
        UndefinedOr.map(driverOf(target), (driver) => fork(judgedBlurOf(driver)))
      },
      onDefect,
    })
    yield* InputFeed.watch(pointerAmong(memberOf), {
      on: ({ target, event }) => {
        if (isPress(event)) UndefinedOr.map(driverOf(target), (driver) => driver.onPress())
      },
      onDefect,
    })
  })

