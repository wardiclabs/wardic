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
import * as Fiber from "effect/Fiber"
import { constUndefined, identity, pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { dynamic, isServer, type JSX } from "@solidjs/web"
import { type Accessor, type Component, createContext, createEffect, createMemo, createSignal, flush, omit, onCleanup, untrack, useContext } from "solid-js"
import { MOTION_PROPS_V2 as MOTION_PROPS, type WardicMotionPropsV2 as WardicMotionProps } from "../../motion-props.ts"
import { reported, type WardicRuntime } from "../../runtime.ts"
import { changesContext } from "../../variant-tree.ts"
import { configView, type PerKey } from "./config-view.ts"
import { useWardicProjection, useWardicRuntime } from "./provider.tsx"
import { type Ward, type WardConfig, wardConfigView, type WardStyle, wardWith } from "./ward.tsx"
import { handOver, refsOf, wardic, type WardicProps, type WardRefProp } from "./wardic.tsx"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"
import { eachOf, neverLands, NO_EVENTS, Waiters } from "./waiters.ts"

/**
 * A **Reorder group**'s config: the app's `values` in order, `onReorder` to receive a new order (the
 * app sets `values` from it), an optional `axis` over the one detected from the items' boxes, the
 * keyboard reorder's settings (ADR-0037), and the element's `style`. Read reactively through an
 * accessor or getters.
 */
export interface ReorderGroupConfigValues<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly axis?: CoreReorder.Axis | undefined
  /** The **Keyboard reorder** (ADR-0037): on unless `false`. Off, items get no keys, no tab stop and no instructions. */
  readonly keyboard?: boolean | undefined
  /** The group's announcements, over the English defaults (`CoreReorder.defaultAnnouncements`). */
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  /** What each item's `aria-describedby` reads, over the English default (`@wardic/dom`'s `DEFAULT_REORDER_INSTRUCTIONS`). */
  readonly instructions?: string | undefined
  /** The group element's style, over `overflow-anchor: none`. */
  readonly style?: JSX.CSSProperties | string | undefined
}

/**
 * A **Reorder group**'s config, read per key (#259): each key a value or an accessor of it (a
 * getter, a store's property, a component's prop), `onReorder` a callback.
 */
export type ReorderGroupConfig<V> = PerKey<ReorderGroupConfigValues<V>, "onReorder">

/** A group's config read per key (#259). */
const GROUP_VIEW = configView<ReorderGroupConfigValues<unknown>>(["values", "onReorder", "axis", "keyboard", "announcements", "instructions", "style"], ["onReorder"])
/** A group's config as a view of `config`. */
const groupViewOf = <V,>(config: ReorderGroupConfig<V>): ReorderGroupConfigValues<V> => GROUP_VIEW.of(config) as ReorderGroupConfigValues<V>

/**
 * A **Reorder group**'s events (#257 item 3), as a ward's are (ADR-0046): `list.next(name)` and
 * `list.each(name)`.
 */
export interface ReorderGroupEvents<V> {
  /**
   * A user's reorder that changed the order, once, at its end: a drag released, or a keyboard lift
   * dropped, with the final order and the item that moved. What an app saves. Not a keyboard
   * cancel, nor `list.move`.
   */
  readonly reorderEnd: ReorderController.End<V>
}

/** The `AbortError`'s message for a group's `next` its disposal cut off. */
const GROUP_GONE = "The Reorder group was disposed before its next event."

/** The props a spread of a {@link ReorderGroup} applies. */
export interface ReorderGroupProps {
  /** The group: Solid calls it with the element. */
  readonly ref: (element: HTMLElement) => void
  /** The config's `style` over `overflow-anchor: none`. */
  readonly style: JSX.CSSProperties
}

/**
 * A **Reorder group**: a ref carrying its props (spread it on the list's element, or give it to
 * `ref`), the group items join, and its reads and `move`.
 */
export interface ReorderGroup<V> extends ReorderGroupProps {
  /** Attaches the group to `element`: Solid calls it as a ref. */
  (element: HTMLElement): void
  /** The group itself, as a spread's `merge` reads it. */
  (previous?: unknown): ReorderGroup<V>
  /** Core's Reorder group. */
  readonly group: CoreReorder.Group<V>
  /** The axis: the config's, else the one detected from the items' boxes. */
  readonly axis: Accessor<CoreReorder.Axis>
  /** Move a value in code, and announce it (ADR-0037). */
  readonly move: (value: V, toIndex: number) => void
  /**
   * A promise of the group's next `name` after the call (#257 item 3). It rejects with an
   * `AbortError` once the group is disposed.
   */
  readonly next: <E extends keyof ReorderGroupEvents<V>>(name: E) => Promise<ReorderGroupEvents<V>[E]>
  /**
   * Every `name` from the call on, as an async iterable (#257 item 3): each step waits for the next
   * one, so one that comes while a step's work runs is missed; it ends once the group is disposed.
   * A memo over it holds the latest as an async value, which an effect can act on: an optimistic
   * save at each reorder (the README's pattern).
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
   * const reordered = createMemo(() => list.each("reorderEnd"))
   * createEffect(() => reordered().values.map((task) => task.id), (ids) => save(ids).catch(setSaveError))
   * ```
   */
  readonly each: <E extends keyof ReorderGroupEvents<V>>(name: E) => AsyncIterable<ReorderGroupEvents<V>[E]>
  /** Whether the items reorder by keyboard (ADR-0037). */
  readonly keyboard: Accessor<boolean>
  /** The items' instructions text (ADR-0037). */
  readonly instructions: Accessor<string>
  /** @internal for the items: the group's controller. */
  readonly controller: ReorderController.ReorderController<V>
}

/**
 * A `<Reorder>` item's Layout mode (ADR-0009, *Amendment (#42)*): `true`, its position and size (the
 * default), or `"position"`, its size changing at once, as Motion's `Reorder.Item` takes.
 */
export type ReorderItemLayout = true | "position"

/**
 * A `<Reorder>` item's config: its `value` (read once), its `layout` mode, the app's own `tabindex`
 * and `aria-describedby` (merged with the keyboard reorder's), and any motion config but `layoutId`
 * and `drag`.
 */
export type ReorderItemConfig<V> =
  & PerKey<ReorderItemOwn<V>>
  & Omit<WardConfig, "layout" | "layoutId" | "drag">

/** A `<Reorder>` item's own keys, beside a ward's. */
interface ReorderItemOwn<V> {
  readonly value: V
  readonly layout?: ReorderItemLayout
  /** The app's own tab stop (Solid 2's attribute spelling): it wins over the keyboard reorder's `0`. */
  readonly tabindex?: number | undefined
  /** The app's own ids: kept, before the instructions'. */
  readonly "aria-describedby"?: string | undefined
}

/** An item's own keys read per key (#259); the rest are its ward's, which reads them itself. */
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

/** A ref carrying `props` and `reads`: `props` enumerable (a spread applies them), `reads` not. */
const refCarrying = <G,>(attach: (element: HTMLElement) => void, props: PropertyDescriptorMap, reads: object): G => {
  const self = ((value?: unknown): G | undefined => {
    if (isElement(value)) {
      attach(value)
      return undefined
    }
    return self
  }) as unknown as G
  Object.defineProperties(self, { ref: { value: self, enumerable: true }, ...props })
  return Object.assign(self as object, reads) as G
}

/**
 * Create a **Reorder group** (ADR-0020): spread it on the list's element (`<ul {...list}>`), or give
 * it to `ref` (client-only). Items are made with {@link reorderItem}, keyed with `<For>`. Its axis is
 * the config's, else detected from the items' boxes after every Measure pass (for their
 * `touch-action`); a drag resolves its own axis at its start. A `values` change re-measures, so a
 * reorder the app makes itself animates. Call it where you'd make a signal, under a `WardicProvider`.
 *
 * On a server it renders the element's style and nothing else: no controller, no runtime; its
 * `group`, `move` and `controller` do nothing (ADR-0021).
 */
export function reorderGroup<V>(config: ReorderGroupConfig<V>): ReorderGroup<V> {
  if (Predicate.isFunction(config)) throw new Error(WHOLE_GROUP_ACCESSOR)
  const view = groupViewOf(config)
  const cfg = (): ReorderGroupConfigValues<V> => view
  const runtime = useWardicRuntime()
  if (isServer) return serverReorderGroup(cfg)
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
  // comes through `onAxis`.
  const axis: Accessor<CoreReorder.Axis> = createMemo(
    () =>
      UndefinedOr.match(cfg().axis, {
        onDefined: identity,
        onUndefined: () => {
          detected()
          return controller.detect()
        },
      }),
    CLIENT_ONLY,
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
  return refCarrying<ReorderGroup<V>>(
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
      controller,
      ...keyboardOf(cfg),
    },
  )
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
    { group: controller.group, axis, move: constUndefined, next: neverLands, each: () => NO_EVENTS, controller, ...keyboardOf(cfg) },
  )
}

/** A Reorder item's drag axis for its gesture's axis: a grid's `xy` is a free drag. Built once, at module load. */
const dragAxisFor: (axis: CoreReorder.Axis) => true | "x" | "y" = Match.type<CoreReorder.Axis>().pipe(
  Match.when("xy", (): true => true),
  Match.orElse((axis) => axis as "x" | "y"),
)

/**
 * Feed an item's keys, blurs and presses to its driver (ADR-0037) until the returned stop: its keys
 * inside their dispatch, so the reorder's `handle()` (the page's `preventDefault`) counts.
 */
const runItemInput = (runtime: WardicRuntime, el: HTMLElement, driver: ReorderController.ItemDriver): (() => void) => {
  const fiber = runtime.runFork(
    reported(
      Effect.gen(function* () {
        const input = yield* InputSource.InputSource
        yield* Effect.all(
          [
            Stream.runForEach(input.keyboard(el), (event) => Effect.sync(() => driver.onKey(event))),
            Stream.runForEach(Stream.filter(input.focus(el), (event) => event.type === "blur"), () => Effect.sync(driver.onBlur)),
            Stream.runForEach(
              Stream.filter(input.pointer(el), (event) => Bool.and(event.type === "down", InputSource.isPrimaryPointer(event))),
              () => Effect.sync(driver.onPress),
            ),
          ],
          { concurrency: "unbounded", discard: true },
        )
      }),
    ),
  )
  return () => {
    runtime.runFork(Fiber.interrupt(fiber))
  }
}

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
 * Create a `<Reorder>` item in `list` (ADR-0020): a ward, spread on the item's element
 * (`<li {...row}>`) or given to `ref` (client-only). Its `value` is its value in the group's
 * `values`, read once; the rest is a ward's config, but `layout` (its Layout mode), `layoutId` and
 * `drag` (the group decides the axis), plus the app's own `tabindex` and `aria-describedby`. The
 * element gets the drag defaults, with the group's axis's `touch-action` (its `style` can override
 * it), and the keyboard reorder's tab stop and instructions. Call it where you'd make a signal: in
 * a `<For>` callback, under a `WardicProvider`.
 */
export function reorderItem<V, const C extends ReorderItemConfig<V>>(list: ReorderGroup<V>, config: C): Ward<C> {
  return reorderItemWith(list, config as ReorderItemConfig<V>, undefined) as unknown as Ward<C>
}

/** {@link reorderItem} for `tag` (`Reorder.Item`'s `as`). Internal. */
const reorderItemWith = <V,>(list: ReorderGroup<V>, config: ReorderItemConfig<V>, tag: string | undefined): Ward => {
  if (Predicate.isFunction(config)) throw new Error(WHOLE_ITEM_ACCESSOR)
  // Its own keys read per key (#259); the rest are its ward's config, read by the ward. Its `layout`
  // is its Layout mode, `true` or `"position"` whatever the config gives, read at each layout
  // animation's start as any ward's is (ADR-0009, *Amendment (#42)*).
  const own = ITEM_VIEW.of(config) as ReorderItemOwn<V>
  const cfg = (): ReorderItemOwn<V> => own
  const fixed = { layout: (): ReorderItemLayout => itemLayoutOf(own.layout) }
  const wardConfig = config as unknown as WardConfig
  const touchAction = (): object => ({ "touch-action": Style.reorderTouchAction(list.axis()) })
  // On a server the item renders the drag defaults with its group's touch-action, and joins no
  // controller (ADR-0021); the instructions element exists on the client only.
  if (isServer) {
    const row = wardWith(wardConfig, { tag, dragAxis: () => true, baseStyle: touchAction, fixed })
    return Object.defineProperties(row, keyboardAttributes(list, cfg, constUndefined))
  }
  const runtime = useWardicRuntime()
  const value = untrack(() => own.value)
  // A keyboard lift turns the item's `whileDrag` on (ADR-0037).
  const [lifted, setLifted] = createSignal(false)
  let element: HTMLElement | undefined
  const driver = list.controller.item(value, () => Option.fromUndefinedOr(element), setLifted)
  // An item unmounted mid-gesture gets no end sample: its disposal ends the gesture (and a lift).
  onCleanup(driver.dispose)
  // The instructions' id, once the element's document is known, and again when the text changes.
  const [document, setDocument] = createSignal<Document | undefined>(undefined)
  const [describedBy, setDescribedBy] = createSignal<string | undefined>(undefined)
  createEffect(
    () => ({ doc: document(), text: list.instructions() }),
    ({ doc, text }) => {
      UndefinedOr.map(doc, (d) => setDescribedBy(DomAnnouncer.instructionsId(d, text)))
    },
    CLIENT_ONLY,
  )
  const row = wardWith(wardConfig, {
    tag,
    fixed,
    dragAxis: () => dragAxisFor(driver.dragAxis()),
    onDragSample: driver.onSample,
    onLayoutHandle: driver.register,
    raiseWhileDragged: true,
    lifted,
    baseStyle: touchAction,
    onMount: (el) => {
      element = el
      setDocument(DomAnnouncer.documentOf(el))
      const stopInput = runItemInput(runtime, el, driver)
      return () => {
        stopInput()
        element = undefined
      }
    },
  })
  // eslint-disable-next-line solid/reactivity -- handed to getters, which read it where the spread tracks them
  return Object.defineProperties(row, keyboardAttributes(list, cfg, describedBy))
}

// --- Components (ADR-0020: built on the factories) ---------------------------------------------

/** The nearest `Reorder.Group`'s group, for its items: `null` for none (Solid 2's contexts). */
const GroupContext = createContext<ReorderGroup<unknown> | null>(null)

/** An element tag a `<Reorder>` group or item can render. */
export type ReorderElementTag = keyof JSX.IntrinsicElements

/**
 * `Reorder.Group`'s props: the group's `values`, `onReorder` and optional `axis`, the keyboard
 * reorder's settings, `as` (the tag, `"ul"` by default, static), and the tag's own and motion props.
 */
export type ReorderGroupComponentProps<V, Tag extends ReorderElementTag = "ul"> =
  & {
    readonly values: ReadonlyArray<V>
    readonly onReorder: (values: Array<V>) => void
    readonly axis?: CoreReorder.Axis | undefined
    readonly keyboard?: boolean | undefined
    readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
    readonly instructions?: string | undefined
    readonly as?: Tag
    /**
     * The group, handed over once, as it's made (#257 item 3), as `wardRef` hands over a ward: its
     * `next(name)` and `each(name)` (`"reorderEnd"`) and its `move`.
     */
    readonly groupRef?: ((list: ReorderGroup<V>) => void) | undefined
  }
  & Omit<WardicProps<Tag>, "onReorder">

/**
 * `Reorder.Item`'s props: its `value` (static), `as` (the tag, `"li"` by default, static), its
 * `layout` mode, and the tag's own and motion props, but `layoutId` and `drag`.
 */
export type ReorderItemComponentProps<V, Tag extends ReorderElementTag = "li"> =
  & {
    readonly value: V
    readonly as?: Tag
    readonly layout?: ReorderItemLayout
  }
  & Omit<WardicProps<Tag>, "layout" | "layoutId" | "drag">

/**
 * The props a component body reads, as plain records: instantiating the public prop types over
 * every element tag makes a type checker build a union of every element's props.
 */
interface GroupLocal<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly groupRef?: ((list: ReorderGroup<V>) => void) | undefined
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
}

const GROUP_OWN = ["values", "onReorder", "axis", "keyboard", "announcements", "instructions", "as", "ref", "style", "children", "groupRef"] as const
const ITEM_OWN = [...MOTION_PROPS, "value", "as", "ref", "style", "children", "tabindex", "aria-describedby", "wardRef"] as const

/** The motion element for `tag` (`wardic[tag]`), as a plain component. */
const wardicTag = (tag: string): Component<Record<string, unknown>> =>
  UndefinedOr.getOrThrow((wardic as unknown as Record<string, Component<Record<string, unknown>> | undefined>)[tag])

/**
 * `Reorder.Group` (ADR-0020): a {@link reorderGroup} on `wardic[as]` (`"ul"` by default), the group
 * in context for its `Reorder.Item`s. Key the items with `<For>`.
 */
function Group<V, Tag extends ReorderElementTag = "ul">(props: ReorderGroupComponentProps<V, Tag>): JSX.Element {
  const local = props as unknown as GroupLocal<V>
  // Its props are its config, read per key (#259).
  const list = reorderGroup<V>(local as unknown as ReorderGroupConfig<V>)
  // The group, to its `groupRef` (#257 item 3), read once, untracked, as `ref` is.
  UndefinedOr.map(untrack(() => local.groupRef), (give) => give(list))
  const Tag = wardicTag(UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "ul", onDefined: identity }))
  const rest = omit(props as unknown as Record<string, unknown>, ...GROUP_OWN)
  return (
    <GroupContext value={list as ReorderGroup<unknown>}>
      <Tag {...rest} style={pipe(local.style, Style.over(ReorderController.GROUP_STYLE))} ref={refsOf(local, [list])}>
        {local.children}
      </Tag>
    </GroupContext>
  )
}

/**
 * `Reorder.Item` (ADR-0020): a {@link reorderItem} on the nearest `Reorder.Group`, rendered as `as`
 * (`"li"` by default). Outside a group it throws, as Motion's does.
 */
function Item<V, Tag extends ReorderElementTag = "li">(props: ReorderItemComponentProps<V, Tag>): JSX.Element {
  const list = useContext(GroupContext) as ReorderGroup<V> | null
  if (Predicate.isNull(list)) throw new Error("Reorder.Item must be a child of Reorder.Group")
  const local = props as unknown as ItemLocal<V> & WardicMotionProps
  const tag = UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "li", onDefined: identity })
  // Its props are its config, read per key (#259); its `layout` is read as a Layout mode.
  const row = reorderItemWith<V>(list, local as unknown as ReorderItemConfig<V>, tag)
  // Its ward, to the item's `wardRef` (#257).
  handOver(local as WardRefProp, row)
  const Element = dynamic(() => tag)
  const rest = omit(props as unknown as Record<string, unknown>, ...ITEM_OWN)
  const element = (): JSX.Element => (
    <Element {...rest} {...row} ref={refsOf(local, [row])}>
      {local.children}
    </Element>
  )
  // An item that changes what its children read renders its variant context's Provider around them
  // (#50), as every Wardic element does; any other renders none.
  return Bool.match(untrack(() => changesContext(wardConfigView(local as unknown as WardConfig))), {
    onFalse: element,
    onTrue: () => <row.Provider>{element()}</row.Provider>,
  })
}

/** `<Reorder>`: `Reorder.Group` and `Reorder.Item` (ADR-0020), as Motion's `Reorder`. */
export const Reorder = { Group, Item } as const
