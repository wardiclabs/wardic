/**
 * A **Batch Reorder group**'s work (#712, ADR-0072), Solid-free: a long list reordered as one keyed Batch,
 * each item at the place its index gives, never measured. Both bindings' `Reorder.BatchGroup` build on it,
 * each tracking its values and geometry with its own Solid.
 *
 * - **Places** (decision 3): every item is one size; `axis` picks the shape, a column (`"y"`), a row
 *   (`"x"`) or a wrapping grid (`"xy"`, its `columns`), `gap` apart. The group is sized to them, and each
 *   item is `position: absolute` at its top-left, placed by its transform (decision 4).
 * - **The Batch**: keyed by the value itself, each member turned toward its place, `x` and `y`, whenever
 *   the list or the geometry changes, in one change.
 * - **The item in hand** (decision 7): held where the pointer has it, raised, `whileDrag` on; let go, it
 *   flies to its place at its release's speed, and a grab stops it where it is, as a `Reorder.Item`'s.
 *
 * @module
 */
import type * as Box from "@wardic/core/Box"
import type * as Drag from "@wardic/core/Drag"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import * as InputSource from "@wardic/core/InputSource"
import type * as CoreReorder from "@wardic/core/Reorder"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { type BatchBinding, type BatchEnv, type BatchHooks, bindBatch, fail, type KeyedBatchConfig, type ReorderBatchConfig, type WardicBatchGesture, type WardicBatchTransition, type WardicBatchValues } from "./batch.ts"
import { turnDrag } from "./batch-gestures.ts"
import type { Feature } from "./feature.ts"
import { input } from "./features/input.ts"
import * as OwnerScope from "./owner-scope.ts"
import type { PresenceContextValue } from "./presence-record.ts"
import { watchItemsInputAmong } from "./reorder-input.ts"

/** Every item's size in a Batch Reorder group, in px. */
export interface ReorderBatchItemSize {
  readonly width: number
  readonly height: number
}

/** A point, or a length on each axis, in px. */
interface XY {
  readonly x: number
  readonly y: number
}

/** The space between a Batch Reorder group's places, in px: one for both axes, or each its own. */
export type ReorderBatchGap = number | XY

/** Where a Batch Reorder group's items go (decision 3): its shape, its items' size, the gap and a grid's columns. */
export interface BatchReorderGeometry {
  readonly axis: CoreReorder.Axis
  readonly itemSize: ReorderBatchItemSize
  readonly gap: ReorderBatchGap | undefined
  readonly columns: number | undefined
}

/** A group's geometry from its props, as either binding reads them: its axis `"y"` when it gives none. */
export const geometryOf = (props: {
  readonly axis?: CoreReorder.Axis | undefined
  readonly itemSize: ReorderBatchItemSize
  readonly gap?: ReorderBatchGap | undefined
  readonly columns?: number | undefined
}): BatchReorderGeometry => ({
  axis: UndefinedOr.match(props.axis, { onUndefined: (): CoreReorder.Axis => "y", onDefined: identity }),
  itemSize: props.itemSize,
  gap: props.gap,
  columns: props.columns,
})

/**
 * A group's places, resolved from its geometry once a change: how many a row holds, the step from one to
 * the next on each axis, and every item's size.
 */
export interface BatchReorderPlaces {
  readonly columns: number
  readonly stepX: number
  readonly stepY: number
  readonly itemSize: ReorderBatchItemSize
}

/** No offset, no gap: (0, 0). */
const ORIGIN: XY = { x: 0, y: 0 }
const NO_SIZE: ReorderBatchItemSize = { width: 0, height: 0 }

/** A gap's two axes: one number for both, else each its own. Built once, at module load. */
const gapsOf: (gap: ReorderBatchGap) => XY = Match.type<ReorderBatchGap>().pipe(
  Match.when(Predicate.isNumber, (gap): XY => ({ x: gap, y: gap })),
  Match.orElse((gap) => gap as XY),
)

/** Whether a grid's `columns` is a whole number, 1 or more. */
const isColumnCount = (columns: number): boolean => Bool.and(Number.isInteger(columns), columns >= 1)

/** A grid's `columns`, checked. */
// PR 3 (#712, Q21): a grid's columns from the group's width when it's given none.
const gridColumnsOf = (columns: number | undefined): number =>
  UndefinedOr.match(columns, {
    onUndefined: () => fail(`a Reorder.BatchGroup on axis "xy" takes its \`columns\`: how many items a row holds`),
    onDefined: (given) =>
      Bool.match(isColumnCount(given), {
        onTrue: () => given,
        onFalse: () => fail(`a Reorder.BatchGroup's \`columns\` is ${String(given)}: a whole number, 1 or more`),
      }),
  })

/** How many places a row holds, by axis: one in a column, every item in a row, a grid's `columns`. Built once, at module load. */
const columnsBy: (axis: CoreReorder.Axis) => (geometry: BatchReorderGeometry, n: number) => number = Match.type<CoreReorder.Axis>().pipe(
  Match.when("y", () => (): number => 1),
  Match.when("x", () => (_: BatchReorderGeometry, n: number): number => Math.max(n, 1)),
  Match.orElse(() => (geometry: BatchReorderGeometry): number => gridColumnsOf(geometry.columns)),
)

/** `geometry`'s places for `n` items: an error naming a grid's `columns` that's missing or isn't a whole number. */
export const resolvePlaces = (geometry: BatchReorderGeometry, n: number): BatchReorderPlaces => {
  const gap = UndefinedOr.match(geometry.gap, { onUndefined: () => ORIGIN, onDefined: gapsOf })
  return {
    columns: columnsBy(geometry.axis)(geometry, n),
    stepX: geometry.itemSize.width + gap.x,
    stepY: geometry.itemSize.height + gap.y,
    itemSize: geometry.itemSize,
  }
}

/** Item `i`'s place among `places`: its column and row, a step apart, from the group's top-left. */
export const placeOf = (places: BatchReorderPlaces, i: number): XY => ({
  x: (i % places.columns) * places.stepX,
  y: Math.floor(i / places.columns) * places.stepY,
})

/** The group's size for `n` items: its places' extent, the last place's far edge. */
export const extentOf = (places: BatchReorderPlaces, n: number): ReorderBatchItemSize =>
  Bool.match(n === 0, {
    onTrue: () => NO_SIZE,
    onFalse: () => {
      const columns = Math.min(places.columns, n)
      const rows = Math.ceil(n / places.columns)
      return { width: (columns - 1) * places.stepX + places.itemSize.width, height: (rows - 1) * places.stepY + places.itemSize.height }
    },
  })

/** A Reorder item's drag axis for its group's: a grid's `xy` is a free drag. Built once, at module load. */
const dragAxisFor: (axis: CoreReorder.Axis) => true | "x" | "y" = Match.type<CoreReorder.Axis>().pipe(
  Match.when("xy", (): true => true),
  Match.orElse((axis) => axis as "x" | "y"),
)

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

/** Whether a node is an HTML element: what a raise's `z-index` is written on. */
const isHTMLElement = (node: unknown): node is HTMLElement => node instanceof HTMLElement

/** What a Batch Reorder group takes from its binding: its values, geometry and motion, each read as it's needed. */
export interface BatchReorderOptions<V> {
  /** The list's values, in order: read in the binding's tracking. */
  readonly values: () => ReadonlyArray<V>
  /** Where its items go: read in the binding's tracking. */
  readonly geometry: () => BatchReorderGeometry
  readonly initial: () => false | WardicBatchValues | ((item: V, i: number) => WardicBatchValues) | undefined
  readonly transition: () => WardicBatchTransition | undefined
  readonly whileDrag: () => WardicBatchGesture | ((item: V, i: number) => WardicBatchValues) | undefined
  /** Given each new order, as an item crosses another: the app sets `values` from it, and the binding places it at once. */
  readonly onReorder: (values: Array<V>) => void
  readonly onReorderEnd?: ((end: ReorderController.End<V>) => void) | undefined
  readonly onHoldStart?: ((start: ReorderController.HoldStart<V>) => void) | undefined
  readonly onHoldEnd?: ((end: ReorderController.HoldEnd<V>) => void) | undefined
  /** Whether the items reorder from the keyboard, read at each key. */
  readonly keyboard: () => boolean
  /** The announcements over the defaults, read at each one. */
  readonly announcements: () => Option.Option<Partial<CoreReorder.Announcements<V>>>
  /** The gestures' input the group brings: what its items' drags are heard through. */
  readonly input: () => InputSource.InputSource["Service"]
}

/** A Batch Reorder group bound to its binding: its Batch, its group's style, and each item's half. */
export interface BatchReorderBinding<V> {
  /** Its Batch: the binding tracks its `targetsOf` and hands each new value to {@link apply}. */
  readonly batch: BatchBinding
  /** A change of the list or the geometry: every item turned toward its place, and the controller told they're placed. */
  readonly apply: BatchBinding["apply"]
  /** The group element's style: positioned, sized to its places, `overflow-anchor: none`, under `own`. */
  readonly groupStyle: (own: Style.Input) => Style.Style
  /** The group's element: what its Auto-scroll, its direction and its reveal go by. */
  readonly attach: (el: Element) => void
  /** The item with `value`, its element made under `presence`. */
  readonly item: (value: V, presence: PresenceContextValue | undefined) => BatchReorderItem
  /** Its controller: its group, its axis, `move`. */
  readonly controller: ReorderController.Placed<V>
  /** Its controller, its drag and its Batch's run ended. */
  readonly dispose: () => void
}

/** An item's half of a Batch Reorder group: its element's `ref` and style, and its end. */
export interface BatchReorderItem {
  readonly ref: (el: Element) => void
  /** The element's style: absolute at its group's top-left, sized and with a drag's defaults, under `own`, less what the Batch draws. */
  readonly style: (own: Style.Input) => Style.Style
  /** The item is going: a gesture or a lift of it ended, and it leaves the controller. */
  readonly dispose: () => void
}

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

/** `px`. */
const px = (n: number): string => `${n}px`

/**
 * A Batch Reorder group for `options`, under `env`'s provider. The binding tracks `batch.targetsOf` and
 * hands each new value to `apply`.
 */
export const bindBatchReorder = <V>(env: BatchEnv, options: BatchReorderOptions<V>, hooks: BatchHooks): BatchReorderBinding<V> => {
  const runtime = env.runtime
  // The places each item's is read from, resolved once a change: the Batch reads the list before any
  // item's targets.
  let resolved: BatchReorderPlaces = resolvePlaces(env.untrack(options.geometry), env.untrack(options.values).length)
  /** An item's place now, at index `i`. */
  const placeAt = (i: number): XY => placeOf(resolved, i)
  // An item starts at its place: none given, or `false`, starts it at its targets; values or a function
  // start it there, but for the keys they give. Made once a given `initial`.
  let startGiven: unknown = undefined
  let startMade: false | ((item: V, i: number) => WardicBatchValues) = false
  const startOf = (given: false | WardicBatchValues | ((item: V, i: number) => WardicBatchValues) | undefined): false | ((item: V, i: number) => WardicBatchValues) => {
    if (Bool.or(Predicate.isUndefined(given), given === false)) return false
    if (given === startGiven) return startMade
    startGiven = given
    startMade = Bool.match(Predicate.isFunction(given), {
      onTrue: () => (item: V, i: number): WardicBatchValues => ({ ...placeAt(i), ...(given as (item: V, i: number) => WardicBatchValues)(item, i) }),
      onFalse: () => (_: V, i: number): WardicBatchValues => ({ ...placeAt(i), ...(given as WardicBatchValues) }),
    })
    return startMade
  }
  // Whether any member is moving, from a flight's start to its landing; the items raised as they come to
  // rest, let down at the landing; and the members a pointer let go of, still flying to their places,
  // which a grab stops.
  let flying = false
  const comingToRest = new Set<HTMLElement>()
  const released = new Set<number>()
  const config = {
    each: () => {
      const values = options.values()
      resolved = resolvePlaces(options.geometry(), values.length)
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
  }
  const batch = bindBatch(env, config as ReorderBatchConfig<V> as KeyedBatchConfig<unknown>, {
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
      axis: () => Option.some(env.untrack(options.geometry).axis),
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
      Effect.provideService(InputSource.InputSource, options.input()),
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
      // Called for a reveal, once the group is attached and the item placed.
      placeOnScreen: () => {
        const el = UndefinedOr.getOrThrow(groupEl)
        const at = el.getBoundingClientRect()
        const placed = Option.getOrThrow(boxOf())
        const left = at.left + el.clientLeft
        const top = at.top + el.clientTop
        return { left: left + placed.x.min, top: top + placed.y.min, right: left + placed.x.max, bottom: top + placed.y.max }
      },
    }
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
      batch.apply(targets)
      version = version + 1
      controller.placed()
    },
    groupStyle: (own) => {
      const n = options.values().length
      const extent = extentOf(resolvePlaces(options.geometry(), n), n)
      return Style.over(own, { ...ReorderController.GROUP_STYLE, position: "relative", width: px(extent.width), height: px(extent.height) })
    },
    attach: (el) => {
      groupEl = el
      controller.attach(el)
    },
    item: (value, presence) => {
      const member = batch.memberFor(value, presence)
      const driver = controller.item(value, () => Option.fromUndefinedOr(batch.elementOf(member)), (lifted) => onLift(member, lifted))
      drivers.set(value, driver)
      const unregister = driver.register(handleOf(member))
      return {
        ref: batch.refOf(member),
        style: (own) => {
          const geometry = options.geometry()
          const base = {
            ...Style.dragDefaults(dragAxisFor(geometry.axis)),
            position: "absolute",
            top: "0px",
            left: "0px",
            width: px(geometry.itemSize.width),
            height: px(geometry.itemSize.height),
          }
          return batch.styleOf(Style.over(own, base))
        },
        dispose: () => {
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
    dispose: () => {
      OwnerScope.close(runtime, scope, CLOSE_FAILED)
      batch.dispose()
    },
  }
}
