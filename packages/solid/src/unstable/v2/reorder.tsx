/**
 * `<Reorder>` on Solid 2 (#209 PR 3b, ADR-0020, ADR-0037, ADR-0045): drag items to reorder a list,
 * or reorder it by keyboard. `reorderGroup(config)` and `reorderItem(list, config)` are refs that
 * carry their props, as a ward is; `Reorder.Group` and `Reorder.Item` are built on them.
 *
 * ```tsx
 * const list = reorderGroup(() => ({ values: items(), onReorder: setItems }))
 * <ul {...list}>
 *   <For each={items()}>
 *     {(item) => {
 *       const row = reorderItem(list, { value: item, whileDrag: { scale: 1.05 } })
 *       return <li {...row}>{item.name}</li>
 *     }}
 *   </For>
 * </ul>
 * ```
 *
 * The **Reorder group** is `@wardic/dom`'s `ReorderController` (core's `Reorder.Group` underneath),
 * as on the Solid 1 binding: it reads each item's slot and drag offset from its projection node,
 * runs the **Crossover** on each drag sample, calls the app's `onReorder`, runs **Auto-scroll**,
 * detects the axis after every Measure pass, and speaks the **Keyboard reorder** through the
 * Environment's `Announcer`. This file adds Solid 2's half: the reactive config, the lifecycle, the
 * props and the components. The app owns `values` and keys its items with `<For>`. The group flushes
 * Solid right after the app's `onReorder`, so the DOM follows within the controller's call, as
 * Solid 1's synchronous updates have it.
 *
 * - **The group** spreads `overflow-anchor: none` under the config's `style` (Motion's
 *   Group.tsx:187-195 at 16c6122), so the browser's scroll anchoring doesn't shift the page as items
 *   move; given to `ref` alone it sets it on the element. `list.move(value, toIndex)` moves a value
 *   in code, announced.
 * - **An item** is a ward (`row.read`, `row.atom`, `row.Provider`): a `layout` node whose drag the
 *   group's axis decides per gesture, raised while dragged, whose `touch-action` follows the group's
 *   axis. Its `value` is read once. Its spread carries the keyboard reorder's `tabindex="0"` and
 *   `aria-describedby` (the group's instructions); an app's own `tabindex` and `aria-describedby`
 *   go in the item's config, as a ward's `style` does: its `tabindex` wins, its ids come first
 *   (#209 PR 3b's R2). Written in JSX after the spread, they'd replace the item's (Solid's rule).
 *
 * @module
 */
import * as InputSource from "@wardic/core/InputSource"
import type * as CoreReorder from "@wardic/core/Reorder"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Style from "@wardic/dom/Style"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { constUndefined, identity, pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { dynamic, isServer, type JSX } from "@solidjs/web"
import { type Accessor, type Component, createContext, createEffect, createMemo, createSignal, flush, omit, onCleanup, untrack, useContext } from "solid-js"
import { MOTION_PROPS_V2 as MOTION_PROPS, type WardicMotionPropsV2 as WardicMotionProps } from "../../motion-props.ts"
import type { Feature } from "../../feature.ts"
import { drag } from "../../features/drag.ts"
import { focus } from "../../features/focus.ts"
import { hover } from "../../features/hover.ts"
import { inView } from "../../features/in-view.ts"
import { layout } from "../../features/layout.ts"
import { pan } from "../../features/pan.ts"
import { press } from "../../features/press.ts"
import { inputIn } from "../../gesture-features.ts"
import type { WardicRuntime } from "../../runtime.ts"
import { watchItemInput } from "../../reorder-input.ts"
import { changesContext } from "../../variant-tree.ts"
import { configView, type PerKey } from "./config-view.ts"
import { useBrought, useWardicRuntime } from "./provider.tsx"
import { useWardicProjection } from "./layout-projection.ts"
import { type AnyWard, spreadPropsOf, type Ward, withSpreadProps, type WardConfig, type WardConfigValues, wardConfigView, type WardOptions, type WardShare, type WardStyle, wardWith } from "./ward.tsx"
import { drivenWard, type GivenWard, givenOf, handOver, listOf, refsOf, sets, setKeysOf, type WardicBeside, type WardicMotion, type WardRefCallback, type WardSetKey } from "./element.tsx"
import { w } from "./w.tsx"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"
import { eachOf, neverLands, NO_EVENTS, serverWhen, Waiters, whenOf } from "./waiters.ts"

/** A Reorder group's config, each key read as a value. */
export interface ReorderGroupConfigValues<V> {
  /** The list's values, in order. Your app owns them. */
  readonly values: ReadonlyArray<V>
  /** Given each new order, as an item crosses another: set `values` from it. */
  readonly onReorder: (values: Array<V>) => void
  /** The list's direction: `"y"`, a column, or `"x"`, a row. Left out, it's found from the items' boxes. */
  readonly axis?: CoreReorder.Axis | undefined
  /** The keyboard reorder: on unless `false`. Off, the items have no keys, no tab stop and no instructions. */
  // ADR-0037.
  readonly keyboard?: boolean | undefined
  /**
   * What a screen reader hears at each step of a keyboard reorder, over the English defaults: `lift`,
   * `step`, `drop`, `cancel`, and `move` for a move in code, each a function of the item's `label`,
   * `position` and the list's `count`.
   */
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  /** What each item's `aria-describedby` reads, over the English default. */
  readonly instructions?: string | undefined
  /** The list element's style, over `overflow-anchor: none`. */
  readonly style?: JSX.CSSProperties | string | undefined
}

/**
 * A Reorder group's config: its `values` in order, `onReorder`, given each new order to set them from,
 * and its options. Each key is a value or an accessor of it, such as a signal, a getter, a store's
 * property or a component's prop; `onReorder` is a function.
 */
// Read per key (#259).
export type ReorderGroupConfig<V> = PerKey<ReorderGroupConfigValues<V>, "onReorder">

/** A group's config read per key (#259). */
const GROUP_VIEW = configView<ReorderGroupConfigValues<unknown>>(["values", "onReorder", "axis", "keyboard", "announcements", "instructions", "style"], ["onReorder"])
/** A group's config as a view of `config`. */
const groupViewOf = <V,>(config: ReorderGroupConfig<V>, beside: object): ReorderGroupConfigValues<V> => GROUP_VIEW.of(config, beside) as ReorderGroupConfigValues<V>

/**
 * A group's config as made, and the layer a `Reorder.Group` it's given to lays its element's props in
 * (#398): empty until then, each key it fixes read through the element's prop.
 */
interface GroupLayer {
  readonly config: object
  readonly beside: object
}
const GROUP_LAYERS = new WeakMap<object, GroupLayer>()

/** A Reorder group's events, as a ward's: `list.next(name)`, `list.each(name)` and `list.when(name)`. */
// #257 item 3, ADR-0046.
export interface ReorderGroupEvents<V> {
  /**
   * Once at the end of a reorder that changed the order: a drag let go, or a keyboard lift dropped,
   * with the order, the item that moved, and its index `from` and `to`. What an app saves. Not for a
   * keyboard cancel, nor for `list.move`.
   */
  readonly reorderEnd: ReorderController.End<V>
  /**
   * As an item is taken in hand, by a drag starting (past its threshold, not at the press) or a
   * keyboard lift, with its index then.
   */
  // A Reorder hold's start (#348, ADR-0020 *Amendment (#348)*).
  readonly holdStart: ReorderController.HoldStart<V>
  /**
   * Once as an item in hand is let go, however: let go or dropped (`how: "drop"`), put back with Escape
   * (`"cancel"`), or unmounted (`"unmount"`). After `reorderEnd` when it moved.
   */
  // A Reorder hold's end (#348).
  readonly holdEnd: ReorderController.HoldEnd<V>
}

/** The `AbortError`'s message for a group's `next` its disposal cut off. */
const GROUP_GONE = "The Reorder group was disposed before its next event."

/** What a group's spread gives its element: its `ref`, and its `style` over `overflow-anchor: none`. */
export interface ReorderGroupProps {
  /** The group: Solid calls it with the element. */
  readonly ref: (element: HTMLElement) => void
  /** The config's `style` over `overflow-anchor: none`. */
  readonly style: JSX.CSSProperties
}

/**
 * A **Reorder group**'s mark (#349): what tells a group given to `Reorder.Group`'s `groupRef` from a
 * function handed the component's own. Internal.
 */
export const REORDER_GROUP: unique symbol = Symbol("wardic.reorderGroup")

/** A Reorder group of `V`, whatever its config: what `Reorder.Group`'s `groupRef` takes. */
// #349.
export interface AnyReorderGroup<V> {
  readonly [REORDER_GROUP]: V
}

/**
 * `reorderGroup()`'s group: spread it on the list's element, `<ul {...list}>`, or give it to `ref`.
 * Its items join it, and it gives its direction, `move`, and its events.
 */
export interface ReorderGroup<V> extends ReorderGroupProps, AnyReorderGroup<V> {
  /** Attaches the group to `element`: Solid calls it as a ref. */
  (element: HTMLElement): void
  /**
   * Its spread's props alone (#495): what Solid 2's `merge` reads when the group is spread, calling it
   * as a function source, on no prototype, so none of the group's own names shadows the element's props.
   */
  (previous?: unknown): ReorderGroupProps
  /** The group's state: `@wardic/core`'s `Reorder.Group`. */
  readonly group: CoreReorder.Group<V>
  /** The list's direction: the config's, else the one found from the items' boxes. */
  readonly axis: Accessor<CoreReorder.Axis>
  /** Moves `value` to `toIndex`, as a button of your own would, and announces it to a screen reader. */
  readonly move: (value: V, toIndex: number) => void
  /** A promise of the group's next `name` after the call. It rejects with an `AbortError` once the group is gone. */
  readonly next: <E extends keyof ReorderGroupEvents<V>>(name: E) => Promise<ReorderGroupEvents<V>[E]>
  /**
   * Every `name` from the call on, as an async iterable, for a `for await`: each step waits for the
   * next one, so one that comes while a step's work runs is missed. It ends once the group is gone. To
   * act on each one in an effect, use {@link when}.
   */
  readonly each: <E extends keyof ReorderGroupEvents<V>>(name: E) => AsyncIterable<ReorderGroupEvents<V>[E]>
  /**
   * Every `name`, as a memo for an effect, as a ward's `when` is: pending until the first, so the
   * effect runs at each one, on any page. An optimistic save at each reorder:
   *
   * ```tsx
   * const [tasks, setTasks] = createOptimisticStore<Task[]>(() => api.listTasks(), [])
   * const [order, setOrder] = createSignal(() => [...tasks])   // follows tasks; the drag writes it
   * const save = action(function* (ids: string[]) {
   *   setTasks((list) => ids.map((id) => list.find((task) => task.id === id)!))   // optimistic
   *   yield api.saveOrder(ids)
   *   refresh(tasks)
   * })
   * const list = reorderGroup({ values: order, onReorder: setOrder })
   * const reordered = list.when("reorderEnd")
   * createEffect(() => reordered().values.map((task) => task.id), (ids) => save(ids).catch(setSaveError))
   * ```
   */
  readonly when: <E extends keyof ReorderGroupEvents<V>>(name: E) => Accessor<ReorderGroupEvents<V>[E]>
  /** Whether the items reorder from the keyboard. */
  readonly keyboard: Accessor<boolean>
  /** The instructions the items' `aria-describedby` reads. */
  readonly instructions: Accessor<string>
  /** @internal for the items: the group's controller. */
  readonly controller: ReorderController.ReorderController<V>
}

/**
 * A `<Reorder>` item's `layout`: `true`, its place and size animating (the default), or `"position"`,
 * its place alone, its size changing at once, as Motion's `Reorder.Item` takes.
 */
// Its Layout mode (ADR-0009, *Amendment (#42)*).
export type ReorderItemLayout = true | "position"

/**
 * A `<Reorder>` item's config: its `value`, read once, its `layout`, your own `tabindex` and
 * `aria-describedby`, kept beside the keyboard reorder's, and any motion prop but `layoutId` and
 * `drag`, which the group sets.
 */
export type ReorderItemConfig<V> =
  & PerKey<ReorderItemOwn<V>>
  & Omit<WardConfig, "layout" | "layoutId" | "drag">

/** A `<Reorder>` item's own keys, beside a ward's. */
interface ReorderItemOwn<V> {
  /** Its value in the group's `values`. Read once. */
  readonly value: V
  /** `true`, its place and size animating (the default), or `"position"`, its place alone. */
  readonly layout?: ReorderItemLayout
  /** The app's own tab stop (Solid 2's attribute spelling): it wins over the keyboard reorder's `0`. */
  readonly tabindex?: number | undefined
  /** The app's own ids: kept, before the instructions'. */
  readonly "aria-describedby"?: string | undefined
}

/** An item's own keys read per key (#259); the rest are its ward's, which reads them itself. */
/**
 * What an item brings (ADR-0067 decision 12), whatever its section has (#511): its layout node, its
 * drag, and every other gesture, so `whileHover` or `whileTap` on an item works as on Motion's, for
 * about 0.5 KB gzipped beside the drag's.
 */
const ITEM_BRINGS: ReadonlyArray<Feature> = [layout, drag, hover, press, focus, inView, pan]

const ITEM_VIEW = configView<ReorderItemOwn<unknown>>(["value", "layout", "tabindex", "aria-describedby"], [])

/** An item's `layout` as its Layout mode: `"position"`, else `true` (ADR-0009, *Amendment (#42)*). */
const itemLayoutOf = (layout: unknown): ReorderItemLayout =>
  Bool.match(layout === "position", { onTrue: (): ReorderItemLayout => "position", onFalse: (): ReorderItemLayout => true })

/** A config given whole as an accessor, which the Solid 2 binding no longer reads (#259). */
const WHOLE_GROUP_ACCESSOR =
  "reorderGroup(config) takes its config as an object, read per key (#259): make a key reactive with an accessor " +
  "(`reorderGroup({ values: items, onReorder: setItems })`), a getter, a store or a component's props."
const WHOLE_ITEM_ACCESSOR =
  "reorderItem(list, config) takes its config as an object, read per key (#259): `reorderItem(list, { value })`, " +
  "a key made reactive with an accessor, a getter, a store or a component's props."

/** Whether a call is Solid applying a ref. */
const isElement = (value: unknown): value is HTMLElement => Predicate.hasProperty(value, "nodeType")

/** The group's keyboard reorder settings, as accessors (ADR-0037). */
const keyboardOf = <V,>(cfg: Accessor<ReorderGroupConfigValues<V>>) => ({
  keyboard: (): boolean => cfg().keyboard !== false,
  instructions: (): string => UndefinedOr.match(cfg().instructions, { onUndefined: () => ReorderController.DEFAULT_INSTRUCTIONS, onDefined: identity }),
})

/** The group element's style: the config's over `overflow-anchor: none`. */
const groupStyleOf = (style: JSX.CSSProperties | string | undefined): JSX.CSSProperties =>
  pipe(style, Style.over(ReorderController.GROUP_STYLE)) as JSX.CSSProperties

/**
 * A ref carrying `props` and `reads`: `props` enumerable (a spread applies them), `reads` not. Called
 * with nothing, as Solid 2's `merge` calls a spread's function source, it gives `ref` and `props` alone
 * (#495), so none of its own names (`name`, `length`, its reads) shadows the element's props.
 */
const refCarrying = <G,>(attach: (element: HTMLElement) => void, props: PropertyDescriptorMap, reads: object): G => {
  const self = ((value?: unknown): object | undefined => {
    if (isElement(value)) {
      attach(value)
      return undefined
    }
    return spread
  }) as unknown as G
  const spreadProps: PropertyDescriptorMap = { ref: { value: self, enumerable: true }, ...props }
  const spread = spreadPropsOf<object>(spreadProps)
  Object.defineProperties(self, { [REORDER_GROUP]: { value: true }, ...spreadProps })
  return Object.assign(self as object, reads) as G
}

/**
 * Makes a list of your own elements reorderable, by dragging or from the keyboard: spread the group on
 * the list's element, and make each item with `reorderItem`, keyed with `<For>`. Your app owns
 * `values`, and sets them from `onReorder`; a reorder it makes itself animates too. Call it where you'd
 * make a signal, under a `WardicProvider`. `Reorder.Group` is built on it.
 *
 * @example
 * const list = reorderGroup({ values: items, onReorder: setItems })
 * <ul {...list}>
 *   <For each={items()}>
 *     {(item) => {
 *       const row = reorderItem(list, { value: item })
 *       return <li {...row}>{item.name}</li>
 *     }}
 *   </For>
 * </ul>
 * @see https://wardic.dev/reference/solid/reorder/reorder-group
 */
// ADR-0020. Given to `ref` alone, it's client-only. Its axis is the config's, else detected from the
// items' boxes after every Measure pass (for their touch-action); a drag resolves its own at its start.
// A `values` change re-measures. On a server it renders the element's style and nothing else: no
// controller, no runtime; its `group`, `move` and `controller` do nothing (ADR-0021).
export function reorderGroup<V>(config: ReorderGroupConfig<V>): ReorderGroup<V> {
  if (Predicate.isFunction(config)) throw new Error(WHOLE_GROUP_ACCESSOR)
  const beside = {}
  const view = groupViewOf(config, beside)
  const cfg = (): ReorderGroupConfigValues<V> => view
  const runtime = useWardicRuntime()
  if (isServer) return layered(serverReorderGroup(cfg), config, beside)
  const [detected, setDetected] = createSignal<CoreReorder.Axis>("y")
  // Its events (#257 item 3), ended with it.
  const events = new Waiters<ReorderGroupEvents<V>>(GROUP_GONE)
  onCleanup(() => events.dispose())
  // Whether the app's `move` is the call under way: its reorder isn't flushed.
  let moving = false
  // The group's controller, over the provider's projection system and the Environment's channel to
  // assistive technology (ADR-0037), in a Scope of the group's own, closed with its owner.
  const scope = runtime.runSync(Scope.make())
  const controller = runtime.runSync(
    ReorderController.make<V>({
      values: () => untrack(() => cfg().values),
      // The DOM follows a reorder within the controller's call, as on Solid 1, whose updates are
      // synchronous: the controller keeps focus on a lifted item right after (moving a focused node
      // can blur it), and Solid 2 would otherwise move the node at its next flush, after that.
      // A `move` the app calls doesn't: nothing reads the DOM after it, and the app may call it inside
      // an `action`, where Solid refuses a flush (FLUSH_IN_ACTION, #257 item 12).
      onReorder: (values) => {
        const onReorder = untrack(() => cfg().onReorder)
        if (moving) return onReorder(values)
        flush(() => onReorder(values))
      },
      onReorderEnd: (end) => events.tell("reorderEnd", () => end),
      onHoldStart: (start) => events.tell("holdStart", () => start),
      onHoldEnd: (end) => events.tell("holdEnd", () => end),
      axis: () => Option.fromUndefinedOr(untrack(() => cfg().axis)),
      onAxis: setDetected,
      keyedWith: "<For>",
      keyboard: () => untrack(() => cfg().keyboard) !== false,
      announcements: () => Option.fromUndefinedOr(untrack(() => cfg().announcements)),
    }).pipe(Effect.provideService(ProjectionSystem.ProjectionSystem, useWardicProjection()), Scope.provide(scope)),
  )
  onCleanupScope(runtime, scope)
  // The app's axis, else the detected one. When the app's is cleared, detected here, from the boxes the
  // engine holds, so the items' touch-action follows in the same flush (#257's audit: an effect that
  // detected it wrote a signal the items read a flush late, EFFECT_RELAY_TEAR). A Measure pass's change
  // comes through `onAxis`. Lazy: read first by an item, so a given group's `axis` beside it, laid
  // over its config by the `Reorder.Group` the items render in, is the one it tracks (#398).
  const axis: Accessor<CoreReorder.Axis> = createMemo(
    () =>
      UndefinedOr.match(cfg().axis, {
        onDefined: identity,
        onUndefined: () => {
          detected()
          return controller.detect()
        },
      }),
    AXIS_MEMO,
  )

  // A `values` change re-measures, so the items animate to their new slots whoever reordered them.
  createEffect(
    () => cfg().values,
    () => {
      controller.valuesChanged()
    },
    CLIENT_ONLY_DEFERRED,
  )

  const attach = (element: HTMLElement): void => {
    // Given to `ref` alone, the element has no spread's style: the group sets its own.
    if (element.style.getPropertyValue("overflow-anchor") === "") element.style.setProperty("overflow-anchor", "none")
    controller.attach(element)
  }
  return layered(refCarrying<ReorderGroup<V>>(
    attach,
    { style: { get: () => groupStyleOf(cfg().style), enumerable: true } },
    {
      group: controller.group,
      axis,
      move: (value: V, toIndex: number) => {
        moving = true
        try {
          controller.move(value, toIndex)
        } finally {
          moving = false
        }
      },
      next: <E extends keyof ReorderGroupEvents<V>>(name: E) => events.wait(name),
      each: <E extends keyof ReorderGroupEvents<V>>(name: E) => eachOf<ReorderGroupEvents<V>, E>(events, name),
      when: <E extends keyof ReorderGroupEvents<V>>(name: E) => whenOf<ReorderGroupEvents<V>, E>(events, name),
      controller,
      ...keyboardOf(cfg),
    },
  ), config, beside)
}

/** The group's axis memo's options: client-only, and lazy (#398). */
const AXIS_MEMO = { ...CLIENT_ONLY, lazy: true } as const

/** `group`, its config and its layer kept for a `Reorder.Group` it's given to (#398). */
const layered = <G extends object,>(group: G, config: object, beside: object): G => {
  GROUP_LAYERS.set(group, { config, beside })
  return group
}

/**
 * A given group's element props (#398): each config key its `Reorder.Group` sets, laid over the
 * group's config, read through the element's prop. A key the group's config sets too is an error.
 */
const besideGroup = (local: object, group: object): void => {
  const layer = UndefinedOr.getOrThrow(GROUP_LAYERS.get(group))
  const given = setKeysOf(local, GROUP_CONFIG)
  const twice = setKeysOf(layer.config, given)
  if (twice.length > 0) {
    throw new Error(
      `Reorder.Group: ${listOf(twice)} set both in the group given to groupRef and on the element (#398). ` +
        "Set each key in one place: in reorderGroup({ … }), or on the element.",
    )
  }
  Arr.forEach(given, (key) =>
    Object.defineProperty(layer.beside, key, { enumerable: true, configurable: true, get: () => (local as Readonly<Record<string, unknown>>)[key] }))
}

/** Close `scope` with the owner. */
const onCleanupScope = (runtime: WardicRuntime, scope: Scope.Closeable): void => {
  onCleanup(() => runtime.runSync(Scope.close(scope, Exit.void)))
}

/**
 * {@link reorderGroup} during a server render (ADR-0021): the group element's style and the app's
 * axis, else `"y"`; its `group`, `move` and `controller` do nothing.
 */
const serverReorderGroup = <V,>(cfg: Accessor<ReorderGroupConfigValues<V>>): ReorderGroup<V> => {
  const controller = ReorderController.inert as unknown as ReorderController.ReorderController<V>
  const axis = (): CoreReorder.Axis => UndefinedOr.match(cfg().axis, { onUndefined: (): CoreReorder.Axis => "y", onDefined: identity })
  return refCarrying<ReorderGroup<V>>(
    constUndefined,
    { style: { value: groupStyleOf(untrack(() => cfg().style)), enumerable: true } },
    { group: controller.group, axis, move: constUndefined, next: neverLands, each: () => NO_EVENTS, when: serverWhen, controller, ...keyboardOf(cfg) },
  )
}

/** A Reorder item's drag axis for its gesture's axis: a grid's `xy` is a free drag. Built once, at module load. */
const dragAxisFor: (axis: CoreReorder.Axis) => true | "x" | "y" = Match.type<CoreReorder.Axis>().pipe(
  Match.when("xy", (): true => true),
  Match.orElse((axis) => axis as "x" | "y"),
)

/**
 * What an item adds to its spread for the keyboard reorder (ADR-0037): `tabindex="0"` while the
 * group's keyboard is on and the app gave no `tabindex`, and `aria-describedby` with the group's
 * instructions (`describedBy`, set on the client) after the app's own ids.
 */
const keyboardAttributes = <V,>(
  list: Pick<ReorderGroup<V>, "keyboard">,
  cfg: Accessor<ReorderItemOwn<V>>,
  describedBy: Accessor<string | undefined>,
): PropertyDescriptorMap => ({
  tabindex: {
    get: (): number | undefined =>
      UndefinedOr.match(cfg().tabindex, {
        onDefined: identity,
        onUndefined: () => Bool.match(list.keyboard(), { onTrue: () => 0, onFalse: constUndefined }),
      }),
    enumerable: true,
  },
  "aria-describedby": {
    get: (): string | undefined => {
      const ids = Arr.filter([cfg()["aria-describedby"], Bool.match(list.keyboard(), { onTrue: describedBy, onFalse: constUndefined })], Predicate.isNotUndefined)
      return Bool.match(ids.length === 0, { onTrue: constUndefined, onFalse: () => ids.join(" ") })
    },
    enumerable: true,
  },
})

/**
 * Makes an element an item of a Reorder group: a ward, spread on the element, `<li {...row}>`, or given
 * to `Reorder.Item`'s `wardRef`. `value` is its value in the group's `values`, read once; the rest is a
 * ward's config, but `layout` (`true` or `"position"`), `layoutId` and `drag`, which the group sets. It's
 * a tab stop for the keyboard reorder: your own `tabindex` and `aria-describedby` go in its config.
 * Call it where you'd make a signal: in a `<For>` callback.
 *
 * @example
 * const row = reorderItem(list, { value: item, whileDrag: { scale: 1.05 } })
 * <li {...row}>{item.name}</li>
 * @see https://wardic.dev/reference/solid/reorder/reorder-item
 */
// ADR-0020. Given to `ref` alone, it's client-only. The element takes the drag defaults, with the
// group's axis's touch-action, which its `style` can override.
export function reorderItem<V, const C extends ReorderItemConfig<V>>(list: ReorderGroup<V>, config: C, options?: WardOptions): ReorderItem<V, C> {
  return reorderItemWith(list, config as ReorderItemConfig<V>, UndefinedOr.map(options, (o) => o.parent), undefined) as unknown as ReorderItem<V, C>
}

/** A `<Reorder>` item's mark (#349): the group it's in. Internal. */
export const REORDER_ITEM: unique symbol = Symbol("wardic.reorderItem")

/** A `<Reorder>` item of `V`, whatever its config: what `Reorder.Item`'s `wardRef` takes. */
// #349.
export interface AnyReorderItem<V> extends AnyWard {
  readonly [REORDER_ITEM]: V
}

/**
 * `reorderItem()`'s item: a ward in its group. Spread it on the item's element, or give it to
 * `Reorder.Item`'s `wardRef`.
 */
export type ReorderItem<V, C extends ReorderItemConfig<V> = ReorderItemConfig<V>> = Ward<C> & AnyReorderItem<V>

/** {@link reorderItem} for `tag` (`Reorder.Item`'s `as`). Internal. */
const reorderItemWith = <V,>(list: ReorderGroup<V>, config: ReorderItemConfig<V>, parent: AnyWard | undefined, tag: string | undefined): Ward => {
  if (Predicate.isFunction(config)) throw new Error(WHOLE_ITEM_ACCESSOR)
  // Its own keys read per key (#259); the rest are its ward's config, read by the ward. Its `layout`
  // is its Layout mode, `true` or `"position"` whatever the config gives, read at each layout
  // animation's start as any ward's is (ADR-0009, *Amendment (#42)*).
  const own = ITEM_VIEW.of(config) as ReorderItemOwn<V>
  const cfg = (): ReorderItemOwn<V> => own
  const fixed = { layout: (): ReorderItemLayout => itemLayoutOf(own.layout) }
  const wardConfig = config as unknown as WardConfig
  // Its group's axis's `touch-action`, under its style: none when its own presses don't drag it
  // (`dragListener={false}`, #431), as with its other drag defaults, so a list dragged by handles scrolls by touch.
  const touchAction = Bool.match(untrack(() => wardConfig.dragListener) !== false, {
    onTrue: () => (): object => ({ "touch-action": Style.reorderTouchAction(list.axis()) }),
    onFalse: constUndefined,
  })
  // On a server the item renders the drag defaults with its group's touch-action, and joins no
  // controller (ADR-0021); the instructions element exists on the client only.
  if (isServer) {
    const row = wardWith(wardConfig, { tag, brings: ITEM_BRINGS, dragAxis: () => true, baseStyle: touchAction, fixed, group: list, parent })
    return withSpreadProps(Object.defineProperties(row, { [REORDER_ITEM]: { value: list } }), keyboardAttributes(list, cfg, constUndefined))
  }
  const runtime = useWardicRuntime()
  // Its keys' input, the `drag` Feature's it brings (#511).
  const services = useBrought(ITEM_BRINGS)
  const value = untrack(() => own.value)
  // A keyboard lift turns the item's `whileDrag` on (ADR-0037).
  const [lifted, setLifted] = createSignal(false)
  let element: HTMLElement | undefined
  const driver = list.controller.item(value, () => Option.fromUndefinedOr(element), setLifted)
  // An item unmounted mid-gesture gets no end sample: its disposal ends the gesture (and a lift).
  onCleanup(driver.dispose)
  // The instructions' id (ADR-0037), derived, so the element is rendered with its `aria-describedby`:
  // the page's document's, until the element's own replaces it (an iframe's). An effect adds the
  // instructions element, writing nothing. An effect that wrote the id after the mount relayed
  // through four effects, each flush showing the item without it (#320).
  const [document, setDocument] = createSignal<Document>(globalThis.document)
  const describedBy = createMemo(() => DomAnnouncer.instructionsIdOf(document(), list.instructions()), CLIENT_ONLY)
  createEffect(
    () => ({ doc: document(), text: list.instructions() }),
    ({ doc, text }) => DomAnnouncer.showInstructions(doc, text),
    CLIENT_ONLY,
  )
  const row = wardWith(wardConfig, {
    tag,
    brings: ITEM_BRINGS,
    fixed,
    group: list,
    parent,
    dragAxis: () => dragAxisFor(driver.dragAxis()),
    onDragSample: driver.onSample,
    onLayoutHandle: driver.register,
    raiseWhileDragged: true,
    keysTaken: true,
    lifted,
    baseStyle: touchAction,
    onMount: (el, watch) => {
      element = el
      setDocument(DomAnnouncer.documentOf(el))
      // Its keys, blurs and presses (ADR-0037), watched in the ward's watch Scope, with no fiber at rest (#379).
      watch((onDefect) => Effect.provideService(watchItemInput(el, driver, (effect) => void runtime.runFork(effect), onDefect), InputSource.InputSource, inputIn(services())))
      return () => {
        element = undefined
      }
    },
  })
  // eslint-disable-next-line solid/reactivity -- handed to getters, which read it where the spread tracks them
  return withSpreadProps(Object.defineProperties(row, { [REORDER_ITEM]: { value: list } }), keyboardAttributes(list, cfg, describedBy))
}

// --- Components (ADR-0020: built on the factories) ---------------------------------------------

/** The nearest `Reorder.Group`'s group, for its items: `null` for none (Solid 2's contexts). */
const GroupContext = createContext<ReorderGroup<unknown> | null>(null)

/** An element tag a `<Reorder>` group or item can render. */
export type ReorderElementTag = keyof JSX.IntrinsicElements

/**
 * `Reorder.Group`'s group: its config as props, `groupRef` handing the group out, or a group made with
 * `reorderGroup` given to `groupRef`, with the options its config doesn't set beside it. A key given
 * both ways is an error.
 */
// #349, #398. A key set twice is caught at setup; in the types only for `values` and `onReorder`, which
// every group sets: a group's type doesn't carry its config.
export type ReorderGroupOf<V> =
  | {
    readonly values: ReadonlyArray<V>
    readonly onReorder: (values: Array<V>) => void
    readonly axis?: CoreReorder.Axis | undefined
    readonly keyboard?: boolean | undefined
    readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
    readonly instructions?: string | undefined
    /**
     * Given the group once, as it's made, as `wardRef` is given a ward: for its `next(name)`,
     * `when(name)` and `move`.
     */
    readonly groupRef?: GroupRefCallback<V> | undefined
  }
  | {
    /**
     * A group made with `reorderGroup`, which the component renders, with the options its config
     * doesn't set beside it: never `values` or `onReorder`, which a group is made with.
     */
    readonly groupRef: AnyReorderGroup<V>
    readonly values?: never
    readonly onReorder?: never
    readonly axis?: CoreReorder.Axis | undefined
    readonly keyboard?: boolean | undefined
    readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
    readonly instructions?: string | undefined
  }

/** A function `groupRef` gives the component's group: never a group, which it would take instead. */
export type GroupRefCallback<V> = ((list: ReorderGroup<V>) => void) & { readonly [REORDER_GROUP]?: never }

/**
 * `Reorder.Group`'s props: its group ({@link ReorderGroupOf}), `as`, the element it renders (`"ul"` by
 * default, read once), and that element's own props and motion props.
 */
export type ReorderGroupComponentProps<V, Tag extends ReorderElementTag = "ul"> =
  & ReorderGroupOf<V>
  & { readonly as?: Tag }
  & Omit<JSX.IntrinsicElements[Tag], "style" | "onReorder">
  & { readonly style?: WardStyle | string | undefined }
  & WardicMotion

/** A `<Reorder>` item's motion props: any but `layoutId` and `drag`, its `layout` a Layout mode. */
type ItemMotionProps = Omit<WardicMotionProps, "layout" | "layoutId" | "drag">

/**
 * `Reorder.Item`'s item: its `value`, its `layout` and its motion props, `wardRef` handing its ward out,
 * or an item made with `reorderItem` given to `wardRef`, with the keys its config `C` doesn't set
 * beside it, as beside a ward: never `value`, which an item is made with.
 */
// #349, #398.
export type ReorderItemOf<V, C = {}> =
  | (ItemMotionProps & { readonly value: V; readonly layout?: ReorderItemLayout; readonly wardRef?: WardRefCallback | undefined })
  | (WardicBeside<C, ItemMotionProps> & {
    readonly wardRef: AnyReorderItem<V> & GivenWard<C>
    readonly value?: never
    readonly layout?: "layout" extends WardSetKey<C> ? never : ReorderItemLayout
    readonly tabindex?: "tabindex" extends WardSetKey<C> ? never : number
    readonly "aria-describedby"?: "aria-describedby" extends WardSetKey<C> ? never : string
  })

/**
 * `Reorder.Item`'s props: its item ({@link ReorderItemOf}), `as`, the element it renders (`"li"` by
 * default, read once), and that element's own props.
 */
export type ReorderItemComponentProps<V, Tag extends ReorderElementTag = "li", C = {}> =
  & ReorderItemOf<V, C>
  & { readonly as?: Tag }
  & Omit<JSX.IntrinsicElements[Tag], "style">
  & { readonly style?: WardStyle | string | undefined }

/**
 * The props a component body reads, as plain records: instantiating the public prop types over
 * every element tag makes a type checker build a union of every element's props.
 */
interface GroupLocal<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly groupRef?: unknown
  readonly axis?: CoreReorder.Axis | undefined
  readonly keyboard?: boolean | undefined
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  readonly instructions?: string | undefined
  readonly as?: string | undefined
  readonly ref?: unknown
  readonly style?: WardStyle | string | undefined
  readonly children?: JSX.Element
}
interface ItemLocal<V> {
  readonly value: V
  readonly as?: string | undefined
  readonly ref?: unknown
  readonly style?: WardStyle | string | undefined
  readonly children?: JSX.Element
  readonly tabindex?: number | undefined
  readonly "aria-describedby"?: string | undefined
  readonly wardRef?: unknown
}

const GROUP_OWN = ["values", "onReorder", "axis", "keyboard", "announcements", "instructions", "as", "ref", "style", "children", "groupRef"] as const
const ITEM_OWN = [...MOTION_PROPS, "value", "as", "ref", "style", "children", "tabindex", "aria-describedby", "wardRef"] as const
/** A group's config keys: beside a given group, each it doesn't set (#398). */
const GROUP_CONFIG = ["values", "onReorder", "axis", "keyboard", "announcements", "instructions"] as const
/** An item's config keys, its motion props and its own: beside a given item, each it doesn't set (#398). */
const ITEM_CONFIG = [...MOTION_PROPS, "value", "tabindex", "aria-describedby"] as const
/** A `<Reorder>` item's keyboard reorder attributes (ADR-0037), which a given item's element carries (#349). */
const KEYBOARD_ATTRIBUTES = ["tabindex", "aria-describedby"] as const

/**
 * The motion element for `tag`, as a plain component: a Slim element's (`w[tag]`, #511), so a Reorder
 * brings no Feature but its own (ADR-0067 decision 12) and renders under a `strict` section.
 */
const wardicTag = (tag: string): Component<Record<string, unknown>> =>
  UndefinedOr.getOrThrow((w as unknown as Record<string, Component<Record<string, unknown>> | undefined>)[tag])

/** The group given to `groupRef` (#349), or `undefined` for a function or none: read once, untracked, as `ref` is. */
const givenGroupOf = <V,>(local: GroupLocal<V>): ReorderGroup<V> | undefined => {
  const ref = untrack(() => local.groupRef)
  return Bool.match(Predicate.hasProperty(ref, REORDER_GROUP), { onTrue: () => ref as ReorderGroup<V>, onFalse: constUndefined })
}

/**
 * A list put in order by dragging its items, or from the keyboard, rendered as `as`, `"ul"` by
 * default. Your app owns `values`, and sets them from `onReorder`; or give it a group made with
 * `reorderGroup` as `groupRef`. Key its `Reorder.Item`s with `<For>`.
 *
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// ADR-0020, #349: a `reorderGroup` on `w[as]`, the group in context for its items.
function Group<V, Tag extends ReorderElementTag = "ul">(props: ReorderGroupComponentProps<V, Tag>): JSX.Element {
  const local = props as unknown as GroupLocal<V>
  const given = givenGroupOf(local)
  const list = UndefinedOr.match(given, {
    onUndefined: () => {
      // Its props are its config, read per key (#259).
      const made = reorderGroup<V>(local as unknown as ReorderGroupConfig<V>)
      // The group, to its `groupRef` (#257 item 3), read once, untracked, as `ref` is.
      const give = untrack(() => local.groupRef)
      if (Predicate.isFunction(give)) give(made)
      return made
    },
    onDefined: (group) => {
      besideGroup(local, group)
      return group
    },
  })
  const Tag = wardicTag(UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "ul", onDefined: identity }))
  const rest = omit(props as unknown as Record<string, unknown>, ...GROUP_OWN)
  // Its element's style over the group's: `overflow-anchor: none`, under a given group's config (#349).
  const styleOf: () => JSX.CSSProperties = UndefinedOr.match(given, {
    onUndefined: () => () => pipe(local.style, Style.over(ReorderController.GROUP_STYLE)) as JSX.CSSProperties,
    onDefined: (group) => () => pipe(local.style, Style.over(group.style)) as JSX.CSSProperties,
  })
  return (
    <GroupContext value={list as ReorderGroup<unknown>}>
      <Tag {...rest} style={styleOf()} ref={refsOf(local, [list])}>
        {local.children}
      </Tag>
    </GroupContext>
  )
}

/**
 * A `<Reorder>` item given to `Reorder.Item`'s `wardRef` (#349): one of `list`'s, made with
 * {@link reorderItem}. Its element is driven by a ward of the component's, and carries the item's
 * keyboard reorder attributes.
 */
const givenItem = <V,>(list: ReorderGroup<V>, local: ItemLocal<V>, share: WardShare, tag: string): { readonly row: Ward; readonly keys: object; readonly setup: WardConfigValues } => {
  if (Predicate.isUndefined(share.internal.group)) {
    throw new Error("Reorder.Item: the ward in wardRef isn't a Reorder item (#349). Make it with reorderItem(list, { value }), list the group it's in.")
  }
  if (share.internal.group !== list) {
    throw new Error("Reorder.Item: the item in wardRef is another group's (#349). Make it with reorderItem(list, …), list the Reorder.Group it renders in.")
  }
  const item = untrack(() => local.wardRef) as object
  const { ward: row, setup } = drivenWard("Reorder.Item", local, share, { tag }, ITEM_CONFIG)
  // Its keyboard attributes: the item's, or the element's where it sets one the item doesn't (#398).
  const keys = Object.defineProperties(
    {},
    Object.fromEntries(
      Arr.map(KEYBOARD_ATTRIBUTES, (key) => [
        key,
        Bool.match(sets(local, key), {
          onTrue: (): PropertyDescriptor => ({ enumerable: true, get: () => (local as unknown as Readonly<Record<string, unknown>>)[key] }),
          onFalse: () => UndefinedOr.getOrThrow(Object.getOwnPropertyDescriptor(item, key)),
        }),
      ]),
    ),
  )
  return { row, keys, setup }
}

/**
 * An item of the `Reorder.Group` around it, rendered as `as`, `"li"` by default: made from its props,
 * or an item made with `reorderItem` given as `wardRef`. Outside a group it throws, as Motion's does.
 *
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// ADR-0020, #349: a `reorderItem` on the nearest group.
function Item<V, Tag extends ReorderElementTag = "li", C = {}>(props: ReorderItemComponentProps<V, Tag, C>): JSX.Element {
  const list = useContext(GroupContext) as ReorderGroup<V> | null
  if (Predicate.isNull(list)) throw new Error("Reorder.Item must be a child of Reorder.Group")
  const local = props as unknown as ItemLocal<V> & WardicMotionProps
  const tag = UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "li", onDefined: identity })
  const given = givenOf(local)
  const Element = dynamic(() => tag)
  const rest = omit(props as unknown as Record<string, unknown>, ...ITEM_OWN)
  const element = UndefinedOr.match(given, {
    onUndefined: () => {
      // Its props are its config, read per key (#259); its `layout` is read as a Layout mode.
      const row = reorderItemWith<V>(list, local as unknown as ReorderItemConfig<V>, undefined, tag)
      // Its ward, to the item's `wardRef` (#257).
      handOver(local, row)
      return {
        row,
        setup: undefined,
        render: (): JSX.Element => (
          <Element {...rest} {...row} ref={refsOf(local, [row])}>
            {local.children}
          </Element>
        ),
      }
    },
    onDefined: (share) => {
      const { row, keys, setup } = givenItem(list, local, share, tag)
      return {
        row,
        setup,
        render: (): JSX.Element => (
          <Element {...rest} {...row.with({ style: local.style })} {...keys} ref={refsOf(local, [row])}>
            {local.children}
          </Element>
        ),
      }
    },
  })
  // An item that changes what its children read renders its variant context's Provider around them
  // (#50), as every Wardic element does; any other renders none.
  const config = UndefinedOr.match(element.setup, { onUndefined: () => wardConfigView(local as unknown as WardConfig), onDefined: identity })
  return Bool.match(untrack(() => changesContext(config)), {
    onFalse: element.render,
    onTrue: () => <element.row.Provider>{element.render()}</element.row.Provider>,
  })
}

/**
 * A list put in order by dragging its items, or from the keyboard: `Reorder.Group` and `Reorder.Item`.
 * Your app owns the order: the group takes it as `values`, and `onReorder` hands each new one back.
 * Motion's `Reorder`.
 *
 * @example
 * <Reorder.Group values={items()} onReorder={setItems}>
 *   <For each={items()}>{(item) => <Reorder.Item value={item}>{item}</Reorder.Item>}</For>
 * </Reorder.Group>
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// ADR-0020.
export const Reorder = { Group, Item } as const
