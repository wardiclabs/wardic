/**
 * A **Batch Reorder group**'s work (#712, ADR-0072), Solid-free: a long list reordered as one keyed Batch,
 * each item at the place its index gives (`batch-reorder-places.ts`), never measured. Both bindings'
 * `Reorder.BatchGroup` build on it, each tracking its values and geometry with its own Solid.
 *
 * - **The Batch**: keyed by the value itself, each member turned toward its place, `x` and `y`, whenever
 *   the list or the geometry changes, in one change.
 * - **The item in hand** (decision 7): held where the pointer has it, raised, `whileDrag` on; let go, it
 *   flies to its place at its release's speed, and a grab stops it where it is, as a `Reorder.Item`'s.
 * - **What it reads of its element** (Q35, Q36): the direction it inherits, as it mounts, and a grid's width
 *   as it's resized; its first read's places drawn before the page paints.
 * - **A server's group** (Q37, Q39): each item's start, with no runtime.
 *
 * @module
 */
import type * as Box from "@wardic/core/Box"
import type * as Drag from "@wardic/core/Drag"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import * as InputSource from "@wardic/core/InputSource"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as CoreReorder from "@wardic/core/Reorder"
import * as DomBatch from "@wardic/dom/DomBatch"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { constUndefined, identity } from "effect/Function"
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
  bindBatch,
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
  groupStyleOf,
  inGridFlow,
  isFromWidth,
  itemBaseOf,
  placeOf,
  resolvePlaces,
  samePlaces,
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
  type ReorderBatchGap,
  type ReorderBatchItemSize,
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

/** `el`'s content box's width: its client width less its padding. */
const contentWidthOf = (el: Element): number => {
  const style = getComputedStyle(el)
  return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
}

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
  // The places each item's is read from, resolved once a change: the Batch reads the list before any
  // item's targets. A change of them its first read makes lands at once (Q35, Q36): no flight from a guess,
  // drawn before the first paint.
  let resolved: BatchReorderPlaces = resolvePlaces(env.untrack(geometryNow), env.untrack(options.values).length)
  /** An item's place now, at index `i`. */
  const placeAt = (i: number): XY => placeOf(resolved, i)
  const startOf = startsAtPlace<V>(placeAt)
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
      resolved = resolvePlaces(geometryNow(), values.length)
      return values
    },
    key: (item: V) => item,
    animate: (_: V, i: number) => placeAt(i),
    // Read as a change starts or a member enters, which a binding's effect may run in its apply: untracked.
    get initial() {
      return startOf(env.untrack(options.initial))
    },
    get transition() {
      return env.untrack(options.transition)
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
      const size = resolved.itemSize
      boxIndex = index
      boxPlaces = resolved
      box = Option.some({ x: { min: place.x, max: place.x + size.width }, y: { min: place.y, max: place.y + size.height } })
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
      // Called for a reveal, once the group is attached and the item placed: from the item's static position
      // (its untransformed offset in its group, padding and direction counted), its place.
      placeOnScreen: () => {
        const group = UndefinedOr.getOrThrow(groupEl)
        const item = batch.elementOf(i) as HTMLElement
        const at = group.getBoundingClientRect()
        const placed = Option.getOrThrow(boxOf())
        const left = at.left + group.clientLeft + item.offsetLeft
        const top = at.top + group.clientTop + item.offsetTop
        return { left: left + placed.x.min, top: top + placed.y.min, right: left + placed.x.max, bottom: top + placed.y.max }
      },
    }
  }

  // --- What it reads of its element (Q35, Q36) -------------------------------------------------

  // The direction its element inherits, read the first time (Q35: as it mounts); its observer of its size;
  // and whether it's gone: a read a frame callback still had waiting does nothing then.
  let inherited: BatchReorderDirection | undefined
  let resizes: ResizeObserver | undefined
  let gone = false
  /**
   * What it reads of its element, told its binding: the direction its parent gives it (not its own, which
   * its `direction` sets), the first time; and, for a grid whose columns come from it, its content width.
   * The first time, its items go to the places that gives at once when those aren't where they are.
   */
  const readElement = (el: Element): void => {
    if (gone) return
    if (Bool.not(el.isConnected)) return
    const first = Predicate.isUndefined(inherited)
    const direction = UndefinedOr.match(inherited, { onUndefined: () => directionAbove(el), onDefined: identity })
    inherited = direction
    const seen: BatchReorderRead = { direction, width: Bool.match(isFromWidth(env.untrack(geometryNow)), { onTrue: () => contentWidthOf(el), onFalse: () => undefined }) }
    if (first) atOnce = Bool.not(samePlaces(resolved, resolvePlaces(env.untrack(() => options.geometryOf(seen)), env.untrack(options.values).length)))
    options.onRead(seen)
  }
  /**
   * Its element read again as it's resized: a grid's columns from its width (Q36). Read the frame after: a new
   * column count changes the group's height, which inside the observer's own delivery is a notification it
   * can't deliver (the page's "ResizeObserver loop" error).
   */
  const observeSize = (el: Element): void => {
    UndefinedOr.map(resizes, (observer) => observer.disconnect())
    // The Environment's frames (ADR-0031), called detached as the flush gate's are: the web's is
    // `requestAnimationFrame` itself, which won't run with another object as its `this`.
    const { requestFrame } = runtime.runSync(RefreshFrameSource.RefreshFrameSource)
    resizes = new ResizeObserver(() => {
      requestFrame(() => readElement(el))
    })
    resizes.observe(el)
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
      if (values !== placedValues) controller.valuesChanged()
      placedValues = values
      // The first read of its element's places, drawn now, before the page paints (Q35, Q36, Q37): each item as
      // far off its new place as it was off its guessed one, an entrance from `initial` going on.
      Bool.match(atOnce, { onTrue: () => batch.applyShifted(targets), onFalse: () => batch.apply(targets) })
      atOnce = false
      version = version + 1
      controller.placed()
    },
    groupStyle: (own) => {
      const n = options.values().length
      const geometry = geometryNow()
      return groupStyleOf(resolvePlaces(geometry, n), n, geometry, own)
    },
    attach: (el) => {
      groupEl = el
      controller.attach(el)
      observeSize(el)
      // Once it's on the page: the direction it inherits and its width, before the first paint.
      queueMicrotask(() => readElement(el))
    },
    itemStyle: () => batch.styleOf(itemBaseOf(geometryNow())),
    item: (value, presence) => {
      const member = batch.memberFor(value, presence)
      const driver = controller.item(value, () => Option.fromUndefinedOr(batch.elementOf(member)), (lifted) => onLift(member, lifted))
      drivers.set(value, driver)
      const unregister = driver.register(handleOf(member))
      return {
        ref: batch.refOf(member),
        style: (own) => batch.styleOf(Style.over(own, itemBaseOf(geometryNow()))),
        dispose: () => {
          // Under `<AnimatePresence>` its element stays while it exits (Q38), at its last place: let go if it was
          // in hand, `whileDrag` off, let down, and neither focused nor pressed meanwhile.
          host.handOff(member, 0, 0)
          turnWhileDrag(member, false)
          raise(member, undefined)
          UndefinedOr.map(batch.elementOf(member), (el) => {
            if (isHTMLElement(el)) el.inert = true
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
      UndefinedOr.map(resizes, (observer) => observer.disconnect())
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
export interface ServerBatchReorderOptions<V> extends Pick<BatchReorderOptions<V>, "values" | "initial" | "whileTap"> {
  readonly geometry: () => BatchReorderGeometry
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
  const places = resolvePlaces(geometry, values.length)
  const placeAt = (i: number): XY => placeOf(places, i)
  const startOf = startsAtPlace<V>(placeAt)
  const config = {
    each: () => values,
    key: (item: V) => item,
    animate: (_: V, i: number) => placeAt(i),
    get initial() {
      return startOf(untrack(options.initial))
    },
  }
  // Each item's start, its keyed Batch's server handle's.
  let handles: ReturnType<typeof serverKeyedHandlesOf<Style.Style>> | undefined
  const handlesFor = (presence: PresenceContextValue | undefined) => {
    if (Predicate.isUndefined(handles)) handles = serverKeyedHandlesOf<Style.Style>(config as KeyedBatchConfig<unknown>, () => presence)
    return handles
  }
  /** An item in flow's start: `initial`'s keys but its place's, which the grid gives. */
  const inFlowStartOf = (value: V): Readonly<Record<string, string>> => {
    const given = startOf(untrack(options.initial))
    return Bool.match(given === false, {
      onTrue: () => NO_STYLE,
      onFalse: () =>
        DomBatch.styleOf(Rec.filter((given as (item: V, i: number) => WardicBatchValues)(value, values.indexOf(value)) as Readonly<Record<string, number>>, (_, key) => Bool.and(key !== "x", key !== "y"))),
    })
  }
  const base = itemBaseOf(geometry)
  return {
    groupStyle: (own) => groupStyleOf(places, values.length, geometry, own),
    item: (value, presence) => ({
      ref: noop,
      style: (own) =>
        Bool.match(inGridFlow(geometry), {
          onTrue: () => ({ ...Style.over(own, base), ...inFlowStartOf(value) }),
          onFalse: () => {
            const placed = Style.over(own, base)
            // Its start over its own and its group's: what the handle draws, the base when it draws none.
            return UndefinedOr.match(handlesFor(presence)(value, { style: placed }).style, { onUndefined: () => placed, onDefined: identity })
          },
        }),
      dispose: noop,
    }),
    pressable: Predicate.isNotUndefined(untrack(options.whileTap)),
  }
}

const NO_STYLE: Readonly<Record<string, string>> = {}
