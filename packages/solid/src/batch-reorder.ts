/**
 * A **Batch Reorder group**'s work (#712, ADR-0072), Solid-free: a long list reordered as one keyed Batch,
 * each item at the place its index gives (`batch-reorder-places.ts`), its box computed, never measured.
 * Both bindings' `Reorder.BatchGroup` build on it, each tracking its values and geometry with its own Solid.
 *
 * - **The Batch**: keyed by the value itself, each member turned toward its place, `x` and `y`, whenever
 *   the list or the geometry changes, in one change.
 * - **The item in hand** (decision 7): held where the pointer has it, raised, `whileDrag` on; let go, it
 *   flies to its place at its release's speed, and a grab stops it where it is, as a `Reorder.Item`'s.
 * - **What it reads of its element** (Q35, Q36): the direction it inherits, as it mounts, and a grid's width
 *   as it's resized, its rows from it (#714 too); its first read's places drawn before the page paints.
 * - **Items each their own size** (#714, ADR-0072 *Amendment (#714)*): a function's, called for every item
 *   at each change, in the binding's tracking; each item's size written on its element as it's made, and
 *   again at a change that changes it. Or each read from the page, `itemSize` left out (decisions 3 to 5):
 *   one observer over every item, its delivery placing them, the group's own size a tick after.
 * - **A server's group** (Q37, Q39): each item's start, with no runtime.
 *
 * @module
 */
import type * as Box from "@wardic/core/Box"
import type * as Drag from "@wardic/core/Drag"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import * as InputSource from "@wardic/core/InputSource"
import * as Machine from "@wardic/core/Machine"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as CoreReorder from "@wardic/core/Reorder"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Equivalence from "effect/Equivalence"
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { constFalse, constUndefined, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import {
  type BatchBinding,
  type BatchEnv,
  type BatchHooks,
  type BatchServerAppear,
  bindBatch,
  identityOf,
  type KeyedBatchConfig,
  type ReorderBatchConfig,
  serverKeyedHandlesOf,
  type WardicBatchExit,
  type WardicBatchGesture,
  type WardicBatchTransition,
  type WardicBatchValues,
} from "./batch.ts"
import { batchGesturesOn, turnDrag } from "./batch-gestures.ts"
import {
  type BatchReorderDirection,
  type BatchReorderGeometry,
  type BatchReorderPlaces,
  type BatchReorderRead,
  type ReorderBatchItemSize,
  groupStyleOf,
  heightAt,
  isFromWidth,
  itemBaseOf,
  itemsInFlow,
  placeOf,
  readsSizes,
  type SizesRead,
  releaseGroupWidth,
  resolvePlaces,
  samePlaces,
  sizeStyleOf,
  widthAt,
  unwriteSizeOn,
  writeSizeOn,
  writesSizes,
  type WrittenSize,
  type XY,
} from "./batch-reorder-places.ts"
import type { Feature } from "./feature.ts"
import { input } from "./features/input.ts"
import { serviceOf } from "./gesture-features.ts"
import * as OwnerScope from "./owner-scope.ts"
import type { PresenceContextValue } from "./presence-record.ts"
import { watchItemsInputAmong } from "./reorder-input.ts"

export {
  type BatchReorderDirection,
  type BatchReorderRead,
  geometryOf,
  type ReorderBatchColumnSize,
  type ReorderBatchGap,
  type ReorderBatchItemSize,
  type ReorderBatchSizing,
  sameRead,
} from "./batch-reorder-places.ts"

/** An item's gesture, `whileDrag`'s, `whileHover`'s or `whileTap`'s: values with an optional `transition`, or a function of its item and index. */
export type BatchReorderGesture<V> = WardicBatchGesture | ((item: V, i: number) => WardicBatchValues)

/** An item's `initial`: values, a function of its item and index, `false` (at its place), or none. */
export type BatchReorderInitial<V> = false | WardicBatchValues | ((item: V, i: number) => WardicBatchValues)

/** An item's `exit`: values with an optional `transition`, or a function of its item, last index and the presence's `custom`. */
export type BatchReorderExit<V> = WardicBatchExit | ((item: V, i: number, custom: unknown) => WardicBatchValues)

const ORIGIN: XY = { x: 0, y: 0 }

/** A let-go's speed: its release's, or none for a cancelled drag (#431). Built once, at module load. */
const releaseVelocityOf: (sample: Drag.Sample) => XY = Match.type<Drag.Sample>().pipe(
  Match.when({ cancelled: true }, (): XY => ORIGIN),
  Match.orElse((sample): XY => sample.velocity),
)

/** What a group brings (ADR-0067 decision 12): the gestures' input, its items' drags heard through it. Either binding's. */
export const GROUP_BRINGS: ReadonlyArray<Feature> = [{ name: "Reorder.BatchGroup", key: InputSource.InputSource, layer: input }]

/** An item's `aria-describedby`: the app's own ids, then the instructions', or none. */
export const describedByOf = (own: string | undefined, instructions: string | undefined): string | undefined => {
  const ids = Arr.filter([own, instructions], Predicate.isNotUndefined)
  return Bool.match(ids.length === 0, { onTrue: () => undefined, onFalse: () => ids.join(" ") })
}

/**
 * The direction `el` inherits: its parent's computed one, which its own `direction` (its group's prop, which
 * the group writes on it) doesn't change; its own, at the top of a document.
 */
const directionAbove = (el: Element): BatchReorderDirection =>
  Bool.match(getComputedStyle(Option.getOrElse(Option.fromNullishOr(el.parentElement), () => el)).direction === "rtl", {
    onTrue: (): BatchReorderDirection => "rtl",
    onFalse: (): BatchReorderDirection => "ltr",
  })

/** Whether an `overflow` makes a scrollbar room may be taken from: one that scrolls. */
const scrolls = (overflow: string): boolean => Bool.or(overflow === "auto", overflow === "scroll")

/**
 * `el`'s content box's width, unrounded, as the browser lays its rows out (#714: a grid's rows break where
 * `flex-wrap`'s do): its used width, less its padding and border when it's border-box. One that scrolls may
 * have a scrollbar there, which only `clientWidth` leaves out: its client width less its padding, in whole px.
 */
const contentWidthOf = (el: Element): number => {
  const style = getComputedStyle(el)
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  const client = (): number => el.clientWidth - padding
  const used = parseFloat(style.width)
  if (Bool.or(scrolls(style.overflowY), Number.isNaN(used))) return client()
  return Bool.match(style.boxSizing === "border-box", {
    onTrue: () => used - padding - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
    onFalse: () => used,
  })
}

/**
 * What `el` holds beyond its content box (#714): what its own `width` and `height` hold besides it, on each
 * axis, its padding and border when it's `border-box`, as a CSS reset makes it, none when it's `content-box`;
 * and its horizontal padding, what an absolutely placed item's `100%` holds besides it.
 */
const edgesAndPaddingOf = (el: Element): Pick<BatchReorderRead, "edges" | "padding"> => {
  const style = getComputedStyle(el)
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  return {
    padding,
    edges: Bool.match(style.boxSizing === "border-box", {
      onTrue: (): XY => ({
        x: padding + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth),
        y: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth),
      }),
      onFalse: (): XY => ORIGIN,
    }),
  }
}

/** The group's boxes its size is observed by (#714): a padding that changes moves one or the other. */
const GROUP_BOXES: ReadonlyArray<ResizeObserverBoxOptions> = ["content-box", "border-box"]

/** Whether a node is an HTML element: what a raise's `z-index` is written on. */
const isHTMLElement = (node: unknown): node is HTMLElement => node instanceof HTMLElement

/** What a Batch Reorder group takes from its binding: its values, geometry and motion, each read as it's needed. */
export interface BatchReorderOptions<V> {
  /** The list's values, in order: read in the binding's tracking. */
  readonly values: () => ReadonlyArray<V>
  /** Where its items go, given what it read of its element: read in the binding's tracking (its props'). */
  readonly geometryOf: (read: BatchReorderRead | undefined) => BatchReorderGeometry
  /** What it read of its element ({@link onRead}): read in the binding's tracking, a signal of the binding's own. */
  readonly read: () => BatchReorderRead | undefined
  /** What it read of its element, as it mounts and as it's resized: for the binding to keep, and track. */
  readonly onRead: (read: BatchReorderRead) => void
  readonly initial: () => BatchReorderInitial<V> | undefined
  readonly transition: () => WardicBatchTransition | undefined
  /** Its `appear`: whether its items' entrance from a server render is taken over at hydration (#706, Q21). */
  readonly appear: () => boolean | undefined
  readonly whileDrag: () => BatchReorderGesture<V> | undefined
  /** Where an item goes while the pointer is over it, and while it's pressed (#712's PR 3), read as each starts. */
  readonly whileHover: () => BatchReorderGesture<V> | undefined
  readonly whileTap: () => BatchReorderGesture<V> | undefined
  /** Where an item leaving under `<AnimatePresence>` goes (Q38), read as it's made. */
  readonly exit: () => BatchReorderExit<V> | undefined
  /** Given each new order, as an item crosses another: the app sets `values` from it, and the binding places it at once. */
  readonly onReorder: (values: Array<V>) => void
  readonly onReorderEnd?: ((end: ReorderController.End<V>) => void) | undefined
  readonly onHoldStart?: ((start: ReorderController.HoldStart<V>) => void) | undefined
  readonly onHoldEnd?: ((end: ReorderController.HoldEnd<V>) => void) | undefined
  /** Whether the items reorder from the keyboard, read at each key. */
  readonly keyboard: () => boolean
  /** The announcements over the defaults, read at each one. */
  readonly announcements: () => Option.Option<Partial<CoreReorder.Announcements<V>>>
  /** What the group brings ({@link GROUP_BRINGS}): the gestures' input its items are heard through. */
  readonly brought: () => Context.Context<never>
  /** Its items' sizes read from the page (#714): signals of the binding's own. */
  readonly sizes: BatchReorderSizeSignals
}

/**
 * A group's signals for its items' sizes read from the page, `itemSize` left out (#714, decisions 3 to 5),
 * its binding's own, each read in its tracking: the Batch's places read `version` and `placed`, its items'
 * style `placed`, the group's style `placed` and `groupVersion`, so its own size never changes in its
 * items' delivery (the page's "ResizeObserver loop" error).
 */
export interface BatchReorderSizeSignals {
  /** How many deliveries of new sizes there have been. */
  readonly version: () => number
  /** Whether the first came in: its items out of flow from then on. */
  readonly placed: () => boolean
  /** The group's own size's version: written a tick after a later delivery's. */
  readonly groupVersion: () => number
  /**
   * New sizes in: every change they make runs now, in the delivery, before the page paints. The first
   * also takes the items out of flow and sizes the group with them, where flow had it already.
   */
  readonly arrived: (first: boolean) => void
  /** The group's own size, written at the Frame loop's tick after a later delivery. */
  readonly resizeGroup: () => void
}

/** What a group's items read of it: each one's half, and whether they're pressed. A server's group is one. */
export interface BatchReorderItems<V> {
  /** The item with `value`, its element made under `presence`. */
  readonly item: (value: V, presence: PresenceContextValue | undefined) => BatchReorderItem
  /** Whether its items are pressed (`whileTap`): each one a tab stop, Enter and Space pressing it while the keyboard reorder is off. */
  readonly pressable: boolean
}

/** A Batch Reorder group bound to its binding: its Batch, its group's style, and each item's half. */
export interface BatchReorderBinding<V> extends BatchReorderItems<V> {
  /** Its Batch: the binding tracks its `targetsOf` and hands each new value to {@link apply}. */
  readonly batch: BatchBinding
  /** A change of the list or the geometry: every item turned toward its place, and the controller told they're placed. */
  readonly apply: BatchBinding["apply"]
  /** The group element's style: positioned, sized to its places, `overflow-anchor: none`, under `own`. */
  readonly groupStyle: (own: Style.Input) => Style.Style
  /** The group's element: what its Auto-scroll, its direction and its reveal go by. */
  readonly attach: (el: Element) => void
  /**
   * Every item's style but its own, the same for them all: sized, a drag's defaults and, out of flow,
   * absolute at its static position, less what the Batch draws. An item with its own takes its `style`.
   */
  readonly itemStyle: () => Style.Style
  /** Its controller: its group, its axis, `move`. */
  readonly controller: ReorderController.Placed<V>
  /** Its controller, its drag and its Batch's run ended. */
  readonly dispose: () => void
}

/** An item's half of a Batch Reorder group: its element's `ref` and style, and its end. */
export interface BatchReorderItem {
  readonly ref: (el: Element) => void
  /** The element's style: absolute at its static position, sized and with a drag's defaults, under `own`, less what the Batch draws. */
  readonly style: (own: Style.Input) => Style.Style
  /** The item is going: a gesture or a lift of it ended, and it leaves the controller. */
  readonly dispose: () => void
}

/** Whether two orders hold the same items in the same order. */
const sameOrder: Equivalence.Equivalence<ReadonlyArray<unknown>> = Arr.makeEquivalence(Equivalence.strictEqual())

/** An item's tab stop when it gives none of its own: `0` with the keyboard reorder on, or with its items pressable. */
export const tabStopOf = (keyboard: boolean, pressable: boolean): 0 | undefined => Bool.match(Bool.or(keyboard, pressable), { onTrue: (): 0 => 0, onFalse: constUndefined })

/** What a group's Scope reports when one of its finalizers fails as it goes. */
const CLOSE_FAILED = "Reorder.BatchGroup: a finalizer failed"

/** A raise's `z-index`, as a layout node's (ADR-0016, *Amendment (velocity family)*, decision 6): `2` in hand, `1` coming to rest. */
const IN_HAND_Z = "2"
const COMING_TO_REST_Z = "1"

/** A let-go's raise, by whether anything's moving: `1` while it comes to rest, none at rest. */
const RAISE_AFTER = { true: COMING_TO_REST_Z, false: undefined } as const

/** A dragged member: where it was drawn at its drag's start, and where it's held now, in its group. */
interface InHand {
  readonly member: number
  readonly originX: number
  readonly originY: number
  x: number
  y: number
}


/** No targets beyond an item's place: an `initial` that gives none but `x` and `y`, or none. */
const NO_IDENTITIES: Readonly<Record<string, number>> = {}

/** Whether `key` is one an item's place sets: `x` or `y`. */
const isPlaceKey: Predicate.Predicate<string> = (key) => Bool.or(key === "x", key === "y")

/** `values` but the keys an item's place sets. */
const withoutPlaceKeys = (values: WardicBatchValues): WardicBatchValues =>
  Rec.filter(values as Readonly<Record<string, number>>, (_, key) => Bool.not(isPlaceKey(key))) as WardicBatchValues

/**
 * Each item's targets (#706, Q20): its place, and the identity of each key its `initial` gives but `x` and
 * `y`, so its entrance moves them there: `initial: { opacity: 0 }` fades in. A function `initial`'s keys
 * are its values' for the list's first item. Made once a given `initial` and a list with an item.
 */
const targetsAtPlace = <V>(placeAt: (i: number) => XY, firstItem: () => V | undefined) => {
  let given: unknown = undefined
  let identities = NO_IDENTITIES
  /** The identities of `initial`'s keys but `x` and `y`. */
  const identitiesOf = (initial: BatchReorderInitial<V> | undefined): Readonly<Record<string, number>> => {
    if (Bool.or(Predicate.isUndefined(initial), initial === false)) return NO_IDENTITIES
    if (initial === given) return identities
    const values = Bool.match(Predicate.isFunction(initial), {
      onTrue: () => UndefinedOr.map(firstItem(), (item) => (initial as (item: V, i: number) => WardicBatchValues)(item, 0)),
      onFalse: () => initial as WardicBatchValues,
    })
    if (Predicate.isUndefined(values)) return NO_IDENTITIES
    given = initial
    identities = Rec.map(withoutPlaceKeys(values) as Readonly<Record<string, number>>, (_, key) => identityOf(key))
    return identities
  }
  // Per member at a change (#665): its place alone when `initial` gives nothing more, as before Q20.
  return (initial: BatchReorderInitial<V> | undefined, i: number): WardicBatchValues => {
    const own = identitiesOf(initial)
    if (Rec.isEmptyRecord(own)) return placeAt(i)
    return { ...own, ...placeAt(i) }
  }
}

/**
 * An item starts at its place: `initial` none, or `false`, starts it at its targets; values or a function
 * start it there, but for the keys they give. Made once a given `initial`.
 */
const startsAtPlace = <V>(placeAt: (i: number) => XY) => {
  let startGiven: unknown = undefined
  let startMade: false | ((item: V, i: number) => WardicBatchValues) = false
  return (given: BatchReorderInitial<V> | undefined): false | ((item: V, i: number) => WardicBatchValues) => {
    if (Bool.or(Predicate.isUndefined(given), given === false)) return false
    if (given === startGiven) return startMade
    startGiven = given
    startMade = Bool.match(Predicate.isFunction(given), {
      onTrue: () => (item: V, i: number): WardicBatchValues => ({ ...placeAt(i), ...(given as (item: V, i: number) => WardicBatchValues)(item, i) }),
      onFalse: () => (_: V, i: number): WardicBatchValues => ({ ...placeAt(i), ...(given as WardicBatchValues) }),
    })
    return startMade
  }
}

/**
 * A Batch Reorder group for `options`, under `env`'s provider. The binding tracks `batch.targetsOf` and
 * hands each new value to `apply`.
 */
export const bindBatchReorder = <V>(env: BatchEnv, options: BatchReorderOptions<V>, hooks: BatchHooks): BatchReorderBinding<V> => {
  const runtime = env.runtime
  // Its items' hover and presses, over the input it brings (#712's PR 3): a focused item's keys press it
  // only while the keyboard reorder doesn't take them (Q32), read at each key.
  const gestures = batchGesturesOn(runtime, options.brought)
  /** Where its items go now: its props', with what it read of its element. */
  const geometryNow = (): BatchReorderGeometry => options.geometryOf(options.read())
  // The places each item's is read from, resolved once a change, and the list they're for: the Batch reads
  // the list before any item's targets. A change of them its first read makes lands at once (Q35, Q36): no
  // flight from a guess, drawn before the first paint.
  // Its items' sizes as read from the page (#714), by value: what its places read, `itemSize` left out.
  const sizesByValue = new Map<V, ReorderBatchItemSize>()
  const readSoFar: SizesRead = {
    sizeOf: (item) => sizesByValue.get(item as V),
    get arrived() {
      return options.sizes.placed()
    },
  }
  let resolvedValues: ReadonlyArray<V> = env.untrack(options.values)
  let resolved: BatchReorderPlaces = env.untrack(() => resolvePlaces(geometryNow(), resolvedValues, readSoFar))
  /** An item's place now, at index `i`. */
  const placeAt = (i: number): XY => placeOf(resolved, i)
  const startOf = startsAtPlace<V>(placeAt)
  const targetsOf = targetsAtPlace<V>(placeAt, () => env.untrack(options.values)[0])
  let atOnce = false
  // Whether any member is moving, from a flight's start to its landing; the items raised as they come to
  // rest, let down at the landing; and the members a pointer let go of, still flying to their places,
  // which a grab stops.
  let flying = false
  const comingToRest = new Set<HTMLElement>()
  const released = new Set<number>()
  const config = {
    each: () => {
      const values = options.values()
      const geometry = geometryNow()
      // A function `itemSize` is called here for every item, tracked: what it reads places them again (#714, Q8).
      // Sizes read from the page place them again at each delivery.
      if (readsSizes(geometry)) options.sizes.version()
      resolved = resolvePlaces(geometry, values, readSoFar)
      resolvedValues = values
      return values
    },
    key: (item: V) => item,
    animate: (_: V, i: number) => targetsOf(env.untrack(options.initial), i),
    // Read as a change starts or a member enters, which a binding's effect may run in its apply: untracked.
    get initial() {
      return startOf(env.untrack(options.initial))
    },
    get transition() {
      return env.untrack(options.transition)
    },
    get appear() {
      return env.untrack(options.appear)
    },
    get whileDrag() {
      return env.untrack(options.whileDrag)
    },
    get whileHover() {
      return env.untrack(options.whileHover)
    },
    get whileTap() {
      return env.untrack(options.whileTap)
    },
    get exit() {
      return env.untrack(options.exit)
    },
    gestureKeysFromFirst: true as const,
  }
  const batch = bindBatch({ ...env, gestures, pressKeys: () => Bool.not(options.keyboard()) }, config as ReorderBatchConfig<V> as KeyedBatchConfig<unknown>, {
    ...hooks,
    started: () => {
      flying = true
      hooks.started()
    },
    landed: (landing) => {
      flying = false
      Iter.forEach(comingToRest, (el) => el.style.removeProperty("z-index"))
      comingToRest.clear()
      released.clear()
      hooks.landed(landing)
    },
  })
  const host = batch.host
  // Its items' hover and presses watched when it's made with `whileHover` or `whileTap`.
  const pressable = Predicate.isNotUndefined(env.untrack(options.whileTap))
  if (Predicate.isNotUndefined(env.untrack(options.whileHover))) batch.listen("hover")
  if (pressable) batch.listen("press")

  // The group's controller (ADR-0072 decision 6), in a Scope of the group's own: its items placed, never
  // measured, so a reorder waits for the Batch to place the new order (`placed`).
  const scope = OwnerScope.open(runtime)
  const controller = runtime.runSync(
    ReorderController.makePlaced<V>({
      values: () => env.untrack(options.values),
      onReorder: options.onReorder,
      onReorderEnd: options.onReorderEnd,
      onHoldStart: options.onHoldStart,
      onHoldEnd: options.onHoldEnd,
      axis: () => Option.some(env.untrack(geometryNow).axis),
      keyedWith: "<For>",
      keyboard: options.keyboard,
      announcements: options.announcements,
    }).pipe(Scope.provide(scope)),
  )
  // Its items' drivers, by value; how many times it has placed its items; its element.
  const drivers = new Map<V, ReorderController.ItemDriver>()
  let version = 0
  let groupEl: Element | undefined
  // The values it last placed: a change of the geometry alone is no change of the app's.
  let placedValues: ReadonlyArray<V> | undefined = env.untrack(options.values)

  const report = (message: string) => (cause: Cause.Cause<unknown>): void => {
    runtime.runFork(Report.failure(message, cause))
  }
  const onDefect = report("Reorder.BatchGroup: an item's input failed")

  /** A raise's `z-index` on member `i`'s element, or none. */
  const raise = (i: number, z: string | undefined): void => {
    const el = batch.elementOf(i)
    if (!isHTMLElement(el)) return
    comingToRest.delete(el)
    if (Predicate.isUndefined(z)) {
      el.style.removeProperty("z-index")
      return
    }
    el.style.setProperty("z-index", z)
    if (z === COMING_TO_REST_Z) comingToRest.add(el)
  }

  /** Member `i` let go, its turn made: raised while it comes to rest, or let down at once when nothing moves. */
  const settle = (i: number): void => raise(i, RAISE_AFTER[`${flying}`])

  /** Member `i`'s `whileDrag` on or off; one that fails is reported, and the hand goes on without it. */
  const turnWhileDrag = (i: number, on: boolean): void => {
    try {
      turnDrag(host, i, on)
    } catch (defect) {
      report("Reorder.BatchGroup: an item's whileDrag failed")(Cause.die(defect))
    }
  }

  // --- The drag (decision 7) ---------------------------------------------------------------------

  // Each dragged member's hand; the members a grab stopped as they flew back, to go on if no drag follows.
  const inHand = new Map<number, InHand>()
  const stopped = new Set<number>()

  /** Where member `i` is drawn now, on `key`: the Batch draws every item of the group. */
  const drawnOf = (i: number, key: string): number => UndefinedOr.getOrThrow(batch.drawnValueOf(i, key))

  /** Member `i` taken in hand at its drag's start: held where it's drawn, moved by the drag's offset, raised. */
  const take = (i: number, sample: Drag.Sample): void => {
    stopped.delete(i)
    released.delete(i)
    const originX = drawnOf(i, "x")
    const originY = drawnOf(i, "y")
    const hand: InHand = { member: i, originX, originY, x: originX + sample.offset.x, y: originY + sample.offset.y }
    inHand.set(i, hand)
    host.handAt(i, hand.x, hand.y)
    turnWhileDrag(i, true)
    raise(i, IN_HAND_Z)
  }

  /** Member `i` held where the pointer has it now. */
  const follow = (i: number, sample: Drag.Sample): void => {
    const hand = inHand.get(i)
    if (Predicate.isUndefined(hand)) return
    hand.x = hand.originX + sample.offset.x
    hand.y = hand.originY + sample.offset.y
    host.handAt(i, hand.x, hand.y)
  }

  /** Member `i` let go: toward its place at the release's speed, `whileDrag` off, raised while it comes to rest. */
  const letGo = (i: number, sample: Drag.Sample): void => {
    inHand.delete(i)
    const velocity = releaseVelocityOf(sample)
    host.handOff(i, velocity.x, velocity.y)
    turnWhileDrag(i, false)
    released.add(i)
    settle(i)
  }

  // Each drag phase's step: the item held where the pointer has it before the controller's crossover reads
  // its offset, and let go after the controller's end.
  const steps: Readonly<Record<Drag.Sample["phase"], (i: number, driver: ReorderController.ItemDriver, sample: Drag.Sample) => void>> = {
    start: (i, driver, sample) => {
      take(i, sample)
      driver.onSample(sample)
    },
    move: (i, driver, sample) => {
      follow(i, sample)
      driver.onSample(sample)
    },
    end: (i, driver, sample) => {
      driver.onSample(sample)
      letGo(i, sample)
    },
  }

  /** A member's drag sample, its phase's step. */
  const onDrag = (element: unknown, sample: Drag.Sample): void => {
    const i = host.memberAt(element)
    if (Predicate.isUndefined(i)) return
    const driver = drivers.get(host.itemOf(i) as V)
    if (Predicate.isUndefined(driver)) return
    steps[sample.phase](i, driver, sample)
  }

  /**
   * A grab of an item flying back from a release stops it where it is: a drag that follows starts from there,
   * and a press that ends with none lets it go on, from rest (a `Reorder.Item`'s, Motion's `stopAnimation`).
   */
  const onPress = (target: unknown): void => {
    const i = host.memberAt(target)
    if (Predicate.isUndefined(i)) return
    if (!released.has(i)) return
    released.delete(i)
    stopped.add(i)
    host.handAt(i, drawnOf(i, "x"), drawnOf(i, "y"))
  }
  const onPressEnd = (target: unknown): void => {
    const i = host.memberAt(target)
    if (Predicate.isUndefined(i)) return
    if (!stopped.delete(i)) return
    host.handOff(i, 0, 0)
    released.add(i)
  }

  /** The driver of the item `target` is, while it has one. */
  const driverOf = (target: unknown): ReorderController.ItemDriver | undefined =>
    UndefinedOr.map(host.memberAt(target), (i) => drivers.get(host.itemOf(i) as V))
  // The items' drags, keys, blurs and presses, heard through the feeds over them (Q28): no item listens
  // until it's pressed or focused.
  runtime.runSync(
    Effect.all([
      DragRecognizer.watchDragAmong(host.memberElementOf, { axis: () => controller.axis() }, { on: onDrag, onDefect }),
      watchItemsInputAmong(host.memberElementOf, { driverOf, onPress, onPressEnd, fork: (effect) => void runtime.runFork(effect), onDefect }),
    ]).pipe(
      Effect.provideService(InputSource.InputSource, serviceOf(options.brought(), InputSource.InputSource)),
      Scope.provide(scope),
    ),
  )

  /** A dragged member's offset from its place now: where it's held, less where its index places it. Built once. */
  const offsetOf = UndefinedOr.match({
    onUndefined: (): XY => ORIGIN,
    onDefined: (hand: InHand): XY => {
      const place = placeAt(host.indexOf(hand.member))
      return { x: hand.x - place.x, y: hand.y - place.y }
    },
  })

  /** Member `i`'s handle: its box its place, its drag's offset from it, raised by a keyboard lift. */
  const handleOf = (i: number): ReorderController.ItemHandle => {
    // Its box, kept while its index and the places are the ones it was made for: the Crossover reads every
    // item's at each drag sample.
    let boxIndex = -1
    let boxPlaces: BatchReorderPlaces | undefined
    let box: Option.Option<Box.Box> = Option.none()
    // Per item, per drag sample (the hot path): statements.
    const boxOf = (): Option.Option<Box.Box> => {
      const index = host.indexOf(i)
      if (index < 0) return Option.none()
      if (index === boxIndex && resolved === boxPlaces) return box
      const place = placeAt(index)
      const width = widthAt(resolved, index)
      // Every box from the static position of an item with no width: the content box's start, its left edge, or,
      // right to left, its right edge, where each item's right edge sits, however wide it is (#714).
      let start = place.x
      if (resolved.signX < 0) start = place.x - width
      boxIndex = index
      boxPlaces = resolved
      box = Option.some({ x: { min: start, max: start + width }, y: { min: place.y, max: place.y + heightAt(resolved, index) } })
      return box
    }
    return {
      layoutBox: boxOf,
      dragOffset: () => offsetOf(inHand.get(i)),
      layoutVersion: () => version,
      // A lift raises it; its drop lets it down as its `whileDrag` turns off, in the item's `onLift`.
      setLifted: (lifted) => {
        if (lifted) raise(i, IN_HAND_Z)
      },
      // Called for a reveal, once the group is attached and the item placed: its element's box at its static
      // position (its untransformed offset in its group, padding and direction counted), moved to its place.
      placeOnScreen: () => {
        const group = UndefinedOr.getOrThrow(groupEl)
        const item = batch.elementOf(i) as HTMLElement
        const at = group.getBoundingClientRect()
        const place = placeAt(host.indexOf(i))
        const left = at.left + group.clientLeft + item.offsetLeft + place.x
        const top = at.top + group.clientTop + item.offsetTop + place.y
        return { left, top, right: left + item.offsetWidth, bottom: top + item.offsetHeight }
      },
    }
  }

  // --- What it reads of its element (Q35, Q36) -------------------------------------------------

  // The direction its element inherits, read the first time (Q35: as it mounts); its observer of its size;
  // and whether it's gone: a read a frame callback still had waiting does nothing then.
  let inherited: BatchReorderDirection | undefined
  let resizes: ReadonlyArray<ResizeObserver> = []
  let gone = false
  /**
   * What it reads of its element, told its binding: the direction its parent gives it (not its own, which
   * its `direction` sets), the first time; for a grid whose rows break at it, its content width; and its edges
   * and padding, what its own size and a column's items' width go by (#714). The first time, its items go to
   * the places that gives at once when those aren't where they are.
   */
  const readElement = (el: Element): void => {
    if (gone) return
    if (Bool.not(el.isConnected)) return
    const first = Predicate.isUndefined(inherited)
    const direction = UndefinedOr.match(inherited, { onUndefined: () => directionAbove(el), onDefined: identity })
    inherited = direction
    const seen: BatchReorderRead = { direction, width: Bool.match(isFromWidth(env.untrack(geometryNow)), { onTrue: () => contentWidthOf(el), onFalse: () => undefined }), ...edgesAndPaddingOf(el) }
    if (first) atOnce = Bool.not(samePlaces(resolved, env.untrack(() => resolvePlaces(options.geometryOf(seen), options.values(), readSoFar))))
    options.onRead(seen)
  }
  /**
   * Its element read again as it's resized: a grid's columns or rows from its width (Q36; #714), its edges and
   * padding. Its content box and its border box are each observed: a padding that changes moves one or the
   * other, as it's `content-box` or `border-box` and its width its own or not. Read once, the frame after: a new
   * column count changes the group's height, which inside the observer's own delivery is a notification it
   * can't deliver (the page's "ResizeObserver loop" error).
   */
  const observeSize = (el: Element): void => {
    Arr.forEach(resizes, (observer) => observer.disconnect())
    // The Environment's frames (ADR-0031), called detached as the flush gate's are: the web's is
    // `requestAnimationFrame` itself, which won't run with another object as its `this`.
    const { requestFrame } = runtime.runSync(RefreshFrameSource.RefreshFrameSource)
    let readPending = false
    const readNextFrame = (): void => {
      if (readPending) return
      readPending = true
      requestFrame(() => {
        readPending = false
        readElement(el)
      })
    }
    resizes = Arr.map(GROUP_BOXES, (box) => {
      const observer = new ResizeObserver(readNextFrame)
      observer.observe(el, { box })
      return observer
    })
  }

  // --- Its items' own sizes (#714) -------------------------------------------------------------

  // The size last written on each item's element, given by a function; and the last change's sizing.
  let written = new WeakMap<Element, WrittenSize>()
  let givenSizes = writesSizes(resolved)
  let readingSizes = resolved.sizesRead
  /** Every listed item's element, where it has one. */
  const eachElement = (f: (el: HTMLElement, value: V, i: number) => void): void => {
    // Per item at a change: statements.
    Arr.forEach(resolvedValues, (value, i) => {
      const el = batch.elementOf(batch.memberFor(value, undefined))
      if (isHTMLElement(el)) f(el, value, i)
    })
  }
  /** Every listed item's own size written on its element where it isn't already: its items each their own size. */
  const writeEachSize = (): void => {
    if (gone) return
    eachElement((el, _, i) => writeSizeOn(el, resolved, i, written))
  }
  /**
   * Its items' sizes at a change: each one's own written, a function's; or each one's observed, read from the
   * page. Switched to a function's, after the change's style writes: the group's style for every item drops
   * the one size it had, which, written after these, would take theirs. Switched from one, an item whose width
   * was the group's gets its own sizing back where its style gives no width; and to sizes read from the page,
   * each item's written size goes, after the change's style writes, where it's still the one written.
   */
  const changeSizes = (): void => {
    const nowGiven = writesSizes(resolved)
    const nowReading = resolved.sizesRead
    const fromGiven = Bool.and(givenSizes, Bool.not(nowGiven))
    const toGiven = Bool.and(Bool.not(givenSizes), nowGiven)
    const was = written
    if (Bool.or(fromGiven, toGiven)) written = new WeakMap()
    if (Bool.and(fromGiven, Bool.not(Bool.or(nowReading, resolved.takesWidth)))) eachElement((el) => releaseGroupWidth(el, was.get(el)))
    if (Bool.and(fromGiven, nowReading)) queueMicrotask(() => eachElement((el) => unwriteSizeOn(el, was.get(el))))
    if (nowReading !== readingSizes) Bool.match(nowReading, { onTrue: () => eachElement(observe), onFalse: stopReading })
    givenSizes = nowGiven
    readingSizes = nowReading
    if (Bool.not(nowGiven)) return
    if (toGiven) {
      queueMicrotask(writeEachSize)
      return
    }
    writeEachSize()
  }

  // Its items' sizes as read (decisions 3 to 5): one observer over every item, made at the first; each
  // observed element's value; and whether the group's own size waits for the Frame loop's next tick.
  let sizes: ResizeObserver | undefined
  const observedValue = new WeakMap<Element, V>()
  let resizePending = false
  /**
   * New sizes, in the observer's delivery: placed now, before the page paints, by their transforms alone. The
   * first takes the items out of flow, at once, where flow had them: no flight from a guess, and the group
   * sized as flow sized it. A later one moves the items after a changed one on the group's transition, and the
   * group's own size waits for the Frame loop's next tick: a size change in the delivery of an element its
   * items are inside is one the browser can't deliver to its observers (the page's "ResizeObserver loop" error).
   */
  const onSizes = (entries: ReadonlyArray<ResizeObserverEntry>): void => {
    if (Bool.or(gone, Bool.not(resolved.sizesRead))) return
    let changed = false
    // Per item at a delivery: statements. Its layout size, its border box: the Batch's transforms change none.
    // None at all is an item under a hidden ancestor (a tab, a closed `<details>`): its last size is kept, so
    // shown again it's where it was, and hidden from the start, its group stays in flow.
    Arr.forEach(entries, (entry) => {
      const value = observedValue.get(entry.target)
      const box = entry.borderBoxSize[0]
      if (Predicate.isUndefined(value) || Predicate.isUndefined(box)) return
      if (box.inlineSize === 0 && box.blockSize === 0) return
      const was = sizesByValue.get(value)
      if (Predicate.isNotUndefined(was) && was.width === box.inlineSize && was.height === box.blockSize) return
      sizesByValue.set(value, { width: box.inlineSize, height: box.blockSize })
      changed = true
    })
    if (Bool.not(changed)) return
    const first = Bool.not(env.untrack(options.sizes.placed))
    if (first) atOnce = true
    options.sizes.arrived(first)
    if (Bool.not(first)) resizeAtNextTick()
  }
  /** The group's own size, at the Frame loop's next tick (core's `Machine.nextFrame`): once for a frame's deliveries. */
  const resizeAtNextTick = (): void => {
    if (resizePending) return
    resizePending = true
    runtime.runFork(
      Effect.andThen(
        Machine.nextFrame,
        Effect.sync(() => {
          resizePending = false
          if (Bool.not(gone)) options.sizes.resizeGroup()
        }),
      ),
    )
  }
  /** `el`, `value`'s element, observed: its size delivered now, and at each change. */
  const observe = (el: Element, value: V): void => {
    // Per element at mount, by the hot path's rules: statements.
    observedValue.set(el, value)
    if (Predicate.isUndefined(sizes)) sizes = new ResizeObserver(onSizes)
    sizes.observe(el)
  }
  /** `el`, `value`'s element, gone: observed no more, its size forgotten. */
  const forget = (el: Element, value: V): void => {
    // Per element as it goes: statements.
    if (observedValue.get(el) !== value) return
    observedValue.delete(el)
    if (Predicate.isNotUndefined(sizes)) sizes.unobserve(el)
    sizesByValue.delete(value)
  }
  /** No sizes read for now: its `itemSize` given. The sizes read so far stay, for a switch back. */
  const stopReading = (): void => {
    UndefinedOr.map(sizes, (observer) => observer.disconnect())
    sizes = undefined
  }

  /**
   * Member `member`'s `ref`, for `value`: its size read from the page, its element observed; given by a
   * function, written on its element, now when the places have its index, else at the change that lists it.
   */
  const refOf = (member: number, value: V): ((el: Element) => void) => {
    // Per element at mount, by the hot path's rules: statements.
    const memberRef = batch.refOf(member)
    if (resolved.sizesRead) {
      return (el) => {
        memberRef(el)
        observe(el, value)
      }
    }
    if (Predicate.isUndefined(resolved.each)) return memberRef
    return (el) => {
      memberRef(el)
      const index = host.indexOf(member)
      if (isHTMLElement(el) && index >= 0 && resolvedValues[index] === value) writeSizeOn(el, resolved, index, written)
    }
  }

  /** An item's own style under its group's now, in flow or not: read in the binding's tracking. */
  const itemBaseNow = (): Readonly<Record<string, string>> => {
    const geometry = geometryNow()
    return itemBaseOf(geometry, itemsInFlow(geometry, options.sizes.placed()))
  }

  /** Member `i`'s keyboard lift: its `whileDrag` on, or off at its drop, then let down. */
  const onLift = (i: number, lifted: boolean): void => {
    turnWhileDrag(i, lifted)
    if (Bool.not(lifted)) settle(i)
  }

  return {
    batch,
    apply: (targets) => {
      // The app's own change of `values` while an item is lifted drops it: not the geometry's.
      const values = env.untrack(options.values)
      // By its items: a store's order is a new array at each read (#721).
      if (Bool.not(UndefinedOr.match(placedValues, { onUndefined: constFalse, onDefined: (placed) => sameOrder(placed, values) }))) controller.valuesChanged()
      placedValues = values
      // Switched to sizes read from the page (#714): into flow, or to the places read so far, at once, as their
      // first delivery takes them out of it: no flight from a guess.
      if (Bool.and(resolved.sizesRead, Bool.not(readingSizes))) atOnce = true
      // The first read of its element's places, drawn now, before the page paints (Q35, Q36, Q37): each item as
      // far off its new place as it was off its guessed one, an entrance from `initial` going on.
      Bool.match(atOnce, { onTrue: () => batch.applyShifted(targets), onFalse: () => batch.apply(targets) })
      atOnce = false
      changeSizes()
      version = version + 1
      controller.placed()
    },
    groupStyle: (own) => {
      const values = options.values()
      const geometry = geometryNow()
      // Its own resolution, tracked as the Batch's is: a function `itemSize`'s sizes size it (#714).
      if (Bool.not(readsSizes(geometry))) return groupStyleOf(resolvePlaces(geometry, values), values.length, geometry, own)
      // Sizes read from the page: its own size from its own version, never in its items' delivery (`onSizes`).
      options.sizes.placed()
      options.sizes.groupVersion()
      return groupStyleOf(env.untrack(() => resolvePlaces(geometry, values, readSoFar)), values.length, geometry, own)
    },
    attach: (el) => {
      groupEl = el
      controller.attach(el)
      observeSize(el)
      // Once it's on the page: the direction it inherits and its width, before the first paint.
      queueMicrotask(() => readElement(el))
    },
    itemStyle: () => batch.styleOf(itemBaseNow()),
    item: (value, presence) => {
      const member = batch.memberFor(value, presence)
      const driver = controller.item(value, () => Option.fromUndefinedOr(batch.elementOf(member)), (lifted) => onLift(member, lifted))
      drivers.set(value, driver)
      const unregister = driver.register(handleOf(member))
      return {
        ref: refOf(member, value),
        style: (own) => batch.styleOf(Style.over(own, itemBaseNow())),
        dispose: () => {
          // Under `<AnimatePresence>` its element stays while it exits (Q38), at its last place: let go if it was
          // in hand, `whileDrag` off, let down, and neither focused nor pressed meanwhile.
          host.handOff(member, 0, 0)
          turnWhileDrag(member, false)
          raise(member, undefined)
          UndefinedOr.map(batch.elementOf(member), (el) => {
            if (isHTMLElement(el)) el.inert = true
            forget(el, value)
          })
          driver.dispose()
          unregister()
          inHand.delete(member)
          stopped.delete(member)
          released.delete(member)
          if (drivers.get(value) === driver) drivers.delete(value)
        },
      }
    },
    controller,
    pressable,
    dispose: () => {
      gone = true
      Arr.forEach(resizes, (observer) => observer.disconnect())
      UndefinedOr.map(sizes, (observer) => observer.disconnect())
      gestures.close()
      OwnerScope.close(runtime, scope, CLOSE_FAILED)
      batch.dispose()
    },
  }
}

/** A Batch Reorder group as a server renders it (Q37, Q39): its element's style, and its items' starts. */
export interface ServerBatchReorder<V> extends BatchReorderItems<V> {
  readonly groupStyle: (own: Style.Input) => Style.Style
}

/** What a server's group reads: its values, its geometry (no element's, Q35), `initial` and `whileTap`. */
export interface ServerBatchReorderOptions<V> extends Pick<BatchReorderOptions<V>, "values" | "initial" | "whileTap" | "transition"> {
  readonly geometry: () => BatchReorderGeometry
  /** The group's `appear`: its items' entrance an Appear animation with `true` (#706, Q16, Q21). */
  readonly appear: () => boolean | undefined
  /** The provider's Appear animations and the nearest `WardicConfig`'s settings, as the binding reads them here. */
  readonly server: BatchServerAppear
}

const noop = (): void => {}

/**
 * A Batch Reorder group during a server render (Q39): no runtime, no Batch, no controller. Its element is
 * sized to its places, and each item drawn at its start, its place or `initial`'s, as the client's Batch
 * starts it, so hydrating moves nothing. A grid whose columns come from its width, which a server can't
 * know, lays its items out by CSS grid, each in flow at its `initial`'s other keys (Q37): the client's first
 * read places them where the grid had them.
 */
export const serverBatchReorder = <V>(options: ServerBatchReorderOptions<V>, untrack: <A>(read: () => A) => A): ServerBatchReorder<V> => {
  const geometry = untrack(options.geometry)
  const values = untrack(options.values)
  const places = resolvePlaces(geometry, values)
  // In flow (Q37; #714, decision 4), CSS places each item: drawn at no place, and `initial`'s `x` and `y` left out.
  const inFlow = places.inFlow
  const placeAt = (i: number): XY => Bool.match(inFlow, { onTrue: () => AT_NO_PLACE, onFalse: () => placeOf(places, i) })
  const startOf = startsAtPlace<V>(placeAt)
  const targetsOf = targetsAtPlace<V>(placeAt, () => values[0])
  const initialNow = (): BatchReorderInitial<V> | undefined => Bool.match(inFlow, { onTrue: () => withoutPlace(untrack(options.initial)), onFalse: () => untrack(options.initial) })
  const config = {
    each: () => values,
    key: (item: V) => item,
    animate: (_: V, i: number) => targetsOf(initialNow(), i),
    get initial() {
      return startOf(initialNow())
    },
    get transition() {
      return untrack(options.transition)
    },
    get appear() {
      return untrack(options.appear)
    },
  }
  // Each item's start and its entrance, its keyed Batch's server handle's (#706, Q16).
  let handles: ReturnType<typeof serverKeyedHandlesOf<Style.Style>> | undefined
  const handlesFor = (presence: PresenceContextValue | undefined) => {
    if (Predicate.isUndefined(handles)) handles = serverKeyedHandlesOf<Style.Style>(config as KeyedBatchConfig<unknown>, () => presence, options.server)
    return handles
  }
  const base = itemBaseOf(geometry, inFlow)
  // Each item's index, for its own size (#714): built at the first item that needs it.
  let indexOfValue: Map<V, number> | undefined
  const indexOf = (value: V): number => {
    if (Predicate.isUndefined(indexOfValue)) {
      const made = new Map<V, number>()
      Arr.forEach(values, (v, i) => made.set(v, i))
      indexOfValue = made
    }
    return UndefinedOr.getOrThrow(indexOfValue.get(value))
  }
  /**
   * An item's style: its own over its group's, and, its items each their own size (#714), that size over both,
   * as the client writes it on its element: the size places it.
   */
  const placedOf = (own: Style.Input, value: V): Style.Style => {
    // Per element at mount, by the hot path's rules: statements.
    const placed = Style.over(own, base)
    if (Predicate.isUndefined(places.each)) return placed
    return Style.over(sizeStyleOf(places, indexOf(value)), placed)
  }
  return {
    groupStyle: (own) => groupStyleOf(places, values.length, geometry, own),
    item: (value, presence) => ({
      ref: noop,
      style: (own) => {
        const placed = placedOf(own, value)
        // Its start over its own and its group's: what the handle draws, the base when it draws none.
        return UndefinedOr.match(handlesFor(presence)(value, { style: placed }).style, { onUndefined: () => placed, onDefined: identity })
      },
      dispose: noop,
    }),
    pressable: Predicate.isNotUndefined(untrack(options.whileTap)),
  }
}

/** An item in flow's place: none, the grid's (Q37). */
const AT_NO_PLACE: XY = { x: 0, y: 0 }

/** `initial` but its `x` and `y`, an item in flow's (Q37): made once a given `initial`. */
// Module state (#460, Q7): a cache held weakly by the object it's for, so it goes with it.
const WITHOUT_PLACE = /*#__PURE__*/ new WeakMap<object, BatchReorderInitial<unknown>>()

const withoutPlace = <V>(given: BatchReorderInitial<V> | undefined): BatchReorderInitial<V> | undefined => {
  if (Bool.or(Predicate.isUndefined(given), given === false)) return given
  const known = WITHOUT_PLACE.get(given as object)
  if (Predicate.isNotUndefined(known)) return known as BatchReorderInitial<V>
  const made = Bool.match(Predicate.isFunction(given), {
    onTrue: () => (item: V, i: number): WardicBatchValues => withoutPlaceKeys((given as (item: V, i: number) => WardicBatchValues)(item, i)),
    onFalse: () => withoutPlaceKeys(given as WardicBatchValues),
  }) as BatchReorderInitial<V>
  WITHOUT_PLACE.set(given as object, made as BatchReorderInitial<unknown>)
  return made
}
