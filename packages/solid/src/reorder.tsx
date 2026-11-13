/**
 * `<Reorder>` for Solid (ADR-0020): drag items to reorder a list, built headless first
 * (D8). `createReorderGroup` and `createReorderItem` are spreads for any elements and
 * `use:reorderItem` a directive, so a list outside JSX components (a web component, a
 * plain element) reorders the same way; `Reorder.Group` / `Reorder.Item` are built on
 * them.
 *
 * The **Reorder group** is `@wardic/dom`'s `makeReorderController` (core's
 * `Reorder.Group` underneath): it reads each item's slot, drag offset and layout
 * version from its projection node's handle, runs the **Crossover** on each drag
 * sample, calls the app's `onReorder`, runs **Auto-scroll**, and detects the axis after
 * every Measure pass. This file adds Solid's half: the reactive config, the lifecycle,
 * the elements and the components. The app owns `values` and keys its items with
 * `<For>`. Each item is a `layout` node with a drag the group's axis decides per
 * gesture, raised while dragged, whose `touch-action` follows the group's axis. A
 * `values` change re-measures, so a reorder the app makes itself animates.
 *
 * Each item is also a tab stop for the group's **Keyboard reorder** (ADR-0037): `tabindex="0"`
 * unless the app gives its own, and `aria-describedby` pointing at the group's instructions (on
 * the client, with the app's ids kept). Its keys, blurs and presses reach the controller, which
 * speaks through the Environment's `Announcer`; a lift turns its `whileDrag` on. `keyboard: false`
 * on the group turns all of that off; `move` still announces.
 *
 * Observability: the controller logs its own `wardic.reorder:` events through the
 * runtime (cold path: once per reorder, wait, gesture, edge or axis change, never per
 * sample); this file logs nothing.
 */
import * as InputSource from "@wardic/core/InputSource"
import * as CoreReorder from "@wardic/core/Reorder"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Style from "@wardic/dom/Style"
import { mergeRefs } from "@solid-primitives/refs"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constUndefined, identity, pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import {
  $PROXY,
  type Accessor,
  type Component,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  mergeProps,
  on,
  onCleanup,
  splitProps,
  untrack,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import * as OwnerScope from "./owner-scope.ts"
import { runWatch, useBrought, useWardicGate, useWardicRuntime } from "./provider.tsx"
import { useLayoutServices } from "./layout-projection.tsx"
import { watchItemInput } from "./reorder-input.ts"
import { plainOrder } from "./reorder-values.ts"
import type { Feature } from "./feature.ts"
import { drag } from "./features/drag.ts"
import { focus } from "./features/focus.ts"
import { hover } from "./features/hover.ts"
import { inView } from "./features/in-view.ts"
import { layout } from "./features/layout.ts"
import { pan } from "./features/pan.ts"
import { press } from "./features/press.ts"
import { inputIn } from "./gesture-features.ts"
import type { WardicRuntime } from "./runtime.ts"
import { controlledOf, runSpine, type SpineInternals, createWardWith, type Ward, type WardProps, type WardUserProps } from "./create-ward.tsx"
import type { WardConfig } from "./config.ts"
import { isServer } from "./server.ts"
import { createVariantNode } from "./variant-node.ts"
import { accessorOf } from "./spine.ts"
import { changesContext } from "./variant-tree.ts"
import { useVariantContext } from "./variants.ts"
import { configOfMotion, type WardicProps } from "./element.tsx"
import { MOTION_PROPS, type WardicMotionProps } from "./motion-props.ts"
import { w } from "./w.tsx"
import { BatchGroup, BatchItem } from "./batch-reorder-group.tsx"

export type { ReorderBatchColumnSize, ReorderBatchGap, ReorderBatchGroupProps, ReorderBatchItemProps, ReorderBatchItemSize, ReorderBatchSizing } from "./batch-reorder-group.tsx"

/**
 * A Reorder group's config: its `values` in order, and `onReorder`, given each new order to set them
 * from. Give an accessor of it for values that change.
 */
export interface ReorderGroupConfig<V> {
  /** The list's values, in order. Your app owns them. */
  readonly values: ReadonlyArray<V>
  /** Given each new order, as an item crosses another: set `values` from it. */
  readonly onReorder: (values: Array<V>) => void
  /**
   * Called once at the end of a reorder that changed the order: a drag let go, or a keyboard lift
   * dropped, with the order, the item that moved, and its index `from` and `to`. What an app saves.
   * Not called for a keyboard cancel, nor for `move`.
   */
  // #257 item 3.
  readonly onReorderEnd?: (end: ReorderController.End<V>) => void
  /**
   * Called as an item is taken in hand, by a drag starting (past its threshold, not at the press) or a
   * keyboard lift, with its index then.
   */
  // A Reorder hold's start (#348, ADR-0020 *Amendment (#348)*).
  readonly onHoldStart?: (start: ReorderController.HoldStart<V>) => void
  /**
   * Called once as an item in hand is let go, however: let go or dropped (`how: "drop"`), put back with
   * Escape (`"cancel"`), or unmounted (`"unmount"`). After `onReorderEnd` when it moved.
   */
  // A Reorder hold's end (#348).
  readonly onHoldEnd?: (end: ReorderController.HoldEnd<V>) => void
  /** The list's direction: `"y"`, a column, `"x"`, a row, or `"xy"`, a grid that wraps. Left out, it's found from the items' boxes. */
  readonly axis?: CoreReorder.Axis
  /** The keyboard reorder: on unless `false`. Off, the items have no keys, no tab stop and no instructions. */
  // ADR-0037.
  readonly keyboard?: boolean
  /**
   * What a screen reader hears at each step of a keyboard reorder, over the English defaults: `lift`,
   * `step`, `drop`, `cancel`, and `move` for a move in code, each a function of the item's `label`,
   * `position` and the list's `count`.
   */
  readonly announcements?: Partial<CoreReorder.Announcements<V>>
  /** What each item's `aria-describedby` reads, over the English default. */
  readonly instructions?: string
}

/** What a group's spread takes from the app: its `ref` and its `style`, which may be a live getter. */
export interface ReorderGroupUserProps {
  readonly ref?: (el: HTMLElement) => void
  readonly style?: JSX.CSSProperties | undefined
}

/** What a group's spread gives its element: its `ref`, and its `style` over `overflow-anchor: none`. */
export interface ReorderGroupSpread {
  readonly ref: (el: HTMLElement) => void
  readonly style: JSX.CSSProperties
}

/**
 * `createReorderGroup`'s group: call it to spread on the list's element, `{...list()}`, or
 * `{...list({ ref, style })}` with a `ref` and a `style` of your own.
 */
export type ReorderGroup<V> = ((userProps?: ReorderGroupUserProps) => ReorderGroupSpread) & {
  /** The group's state: `@wardic/core`'s `Reorder.Group`. */
  readonly group: CoreReorder.Group<V>
  /** The list's direction: the config's, else the one found from the items' boxes. */
  readonly axis: Accessor<CoreReorder.Axis>
  /** Moves `value` to `toIndex`, as a button of your own would, and announces it to a screen reader. */
  readonly move: (value: V, toIndex: number) => void
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
 * A `<Reorder>` item's config: its `value`, its `layout` ({@link ReorderItemLayout}), and any motion
 * prop but `layoutId` and `drag`, which the group sets.
 */
export type ReorderItemConfig<V> = { readonly value: V; readonly layout?: ReorderItemLayout } & Omit<WardConfig, "layout" | "layoutId" | "drag">

/** An item's `layout` as its Layout mode: `"position"`, else `true` (ADR-0009, *Amendment (#42)*). */
const itemLayoutOf = (layout: unknown): ReorderItemLayout =>
  Bool.match(layout === "position", { onTrue: (): ReorderItemLayout => "position", onFalse: (): ReorderItemLayout => true })

/** What a group's Scope reports when one of its finalizers fails as its owner goes. */
const CLOSE_FAILED = "wardic.reorder: a finalizer failed"

/**
 * Makes a list of your own elements reorderable, by dragging or from the keyboard: spread the group on
 * the list's element, and make each item with `createReorderItem`, keyed with `<For>`. Your app owns
 * `values`, and sets them from `onReorder`. It gives the element `overflow-anchor: none`, so the
 * browser doesn't scroll the page as items move. `Reorder.Group` is built on it.
 *
 * @example
 * const list = createReorderGroup(() => ({ values: items(), onReorder: setItems }))
 * <ul {...list()}>
 *   <For each={items()}>
 *     {(item) => {
 *       const row = createReorderItem(list, { value: item })
 *       return <li {...row()}>{item}</li>
 *     }}
 *   </For>
 * </ul>
 * @see https://wardic.dev/reference/solid/reorder/reorder-group
 */
// ADR-0020. `overflow-anchor: none` goes under the app's style, as Motion's Group.tsx:187-195 at
// 16c6122 does. The axis is the config's, else detected from the items' boxes after every Measure pass
// (for their touch-action); a drag resolves its own at its start. On a server it renders the
// element's style and nothing else: no controller, no runtime; its `group`, `move` and `controller` do
// nothing (ADR-0021).
export function createReorderGroup<V>(config: ReorderGroupConfig<V> | Accessor<ReorderGroupConfig<V>>): ReorderGroup<V> {
  const cfg: Accessor<ReorderGroupConfig<V>> = accessorOf(config)
  if (isServer) {
    useWardicRuntime()
    return serverReorderGroup(cfg)
  }
  const [detected, setDetected] = createSignal<CoreReorder.Axis>("y")
  // The order as a plain array (#721): a store's copied, so a store changed in place is a new order.
  const values = (): ReadonlyArray<V> => plainOrder(cfg().values, $PROXY)
  const runtime = useWardicRuntime()
  // The group's controller, over the provider's projection system and the Environment's channel to
  // assistive technology (ADR-0037), in a Scope of the group's own, closed on unmount (#132's PR 3),
  // set before the controller is built, so one that fails as it's built leaves nothing (#618).
  const scope = OwnerScope.open(runtime)
  onCleanup(() => OwnerScope.close(runtime, scope, CLOSE_FAILED))
  const controller = runtime.runSync(
    ReorderController.make<V>({
      values: () => untrack(values),
      onReorder: (values) => untrack(cfg).onReorder(values),
      onReorderEnd: (end) => UndefinedOr.map(untrack(cfg).onReorderEnd, (tell) => tell(end)),
      onHoldStart: (start) => UndefinedOr.map(untrack(cfg).onHoldStart, (tell) => tell(start)),
      onHoldEnd: (end) => UndefinedOr.map(untrack(cfg).onHoldEnd, (tell) => tell(end)),
      axis: () => Option.fromUndefinedOr(untrack(cfg).axis),
      onAxis: setDetected,
      keyedWith: "<For>",
      keyboard: () => untrack(cfg).keyboard !== false,
      announcements: () => Option.fromUndefinedOr(untrack(cfg).announcements),
    }).pipe(Effect.provide(useLayoutServices()), Scope.provide(scope)),
  )
  // The app's axis, else the detected one. When the app's is cleared, detected here, from the boxes the
  // engine holds, so the items' touch-action follows in the same update (#257's audit: an effect that
  // detected it wrote a signal the items read a step late). A Measure pass's change comes through `onAxis`.
  const axis: Accessor<CoreReorder.Axis> = createMemo(() =>
    UndefinedOr.match(cfg().axis, {
      onDefined: identity,
      onUndefined: () => {
        detected()
        return controller.detect()
      },
    }),
  )

  // A `values` change re-measures, so the items animate to their new slots whoever
  // reordered them (as LayoutGroup's layoutDependency does).
  createEffect(on(values, () => controller.valuesChanged(), { defer: true }))

  const spread = (userProps: ReorderGroupUserProps = NO_GROUP_PROPS): ReorderGroupSpread => ({
    ref: mergeRefs(userProps.ref, (el: HTMLElement) => controller.attach(el)),
    get style() {
      return pipe(userProps.style, Style.over(ReorderController.GROUP_STYLE)) as JSX.CSSProperties
    },
  })

  const move = (value: V, toIndex: number): void => controller.move(value, toIndex)
  return Object.assign(spread, { group: controller.group, axis, move, controller, ...keyboardOf(cfg) })
}

/** A group's keyboard reorder settings, as accessors (ADR-0037). */
const keyboardOf = <V,>(cfg: Accessor<ReorderGroupConfig<V>>) => ({
  keyboard: (): boolean => cfg().keyboard !== false,
  instructions: (): string => UndefinedOr.match(cfg().instructions, { onUndefined: () => ReorderController.DEFAULT_INSTRUCTIONS, onDefined: (text: string) => text }),
})

/**
 * The spine additions of an item with `value` in `group` (D8: shared by
 * {@link createReorderItem} and `use:reorderItem`): a `layout` node registered with the
 * group, raised while dragged, whose drag takes the group's axis at each start and
 * feeds the controller its samples, and whose `touch-action` follows the group's axis.
 */
/**
 * What an item reads from its group: its controller's driver for the item, and the group's
 * axis. Any {@link ReorderGroup} is one. Its value type appears only in `item`'s
 * parameters, so `ItemGroup<never>` accepts a group of any value type.
 */
type ItemGroup<V> = {
  readonly controller: Pick<ReorderController.ReorderController<V>, "item">
  readonly axis: Accessor<CoreReorder.Axis>
  readonly keyboard: Accessor<boolean>
  readonly instructions: Accessor<string>
}

/**
 * An item's `touch-action`, its group's axis's, under its style: none when its own presses don't drag
 * it (`dragListener={false}`, #431), as with its other drag defaults, so a list dragged by its handles
 * scrolls by touch.
 */
const touchActionOf = <V,>(group: ItemGroup<V>, listens: boolean): SpineInternals["baseStyle"] =>
  Bool.match(listens, { onTrue: () => () => ({ "touch-action": Style.reorderTouchAction(group.axis()) }), onFalse: constUndefined })

/**
 * What an item brings (ADR-0067 decision 12), whatever its section has (#511): its layout node, its
 * drag, and every other gesture, so `whileHover` or `whileTap` on an item works as on Motion's, for
 * about 0.5 KB gzipped beside the drag's.
 */
const ITEM_BRINGS: ReadonlyArray<Feature> = [layout, drag, hover, press, focus, inView, pan]

const itemInternals = <V,>(group: ItemGroup<V>, value: V, element: Accessor<HTMLElement | undefined>, runtime: WardicRuntime, listens: boolean): SpineInternals => {
  // Its keys' input, the `drag` Feature's it brings (#511).
  const services = useBrought(ITEM_BRINGS)
  // A keyboard lift turns the item's `whileDrag` on (ADR-0037).
  const [lifted, setLifted] = createSignal(false)
  const driver = group.controller.item(value, () => Option.fromUndefinedOr(element()), setLifted)
  // An item unmounted mid-gesture gets no end sample: its disposal ends the gesture (and a lift).
  onCleanup(driver.dispose)
  // Its keys, blurs and presses (ADR-0037), watched in a Scope of their own for as long as the element
  // is this one, with no fiber at rest (#379).
  createEffect(
    on(element, (el) => {
      if (Predicate.isNotUndefined(el)) {
        runWatch(runtime, (onDefect) =>
          Effect.provideService(watchItemInput(el, driver, (effect) => void runtime.runFork(effect), onDefect), InputSource.InputSource, inputIn(services())),
        )
      }
    }),
  )
  return {
    brings: ITEM_BRINGS,
    dragAxis: () => dragAxisFor(driver.dragAxis()),
    onDragSample: driver.onSample,
    onLayoutHandle: (handle) => onCleanup(driver.register(handle)),
    raiseWhileDragged: true,
    keysTaken: true,
    lifted,
    baseStyle: touchActionOf(group, listens),
  }
}

/**
 * An item's internals: on a server, the drag defaults with its group's touch-action, joining no
 * controller (ADR-0021); on the client, `itemInternals`. A plain `if`, so a client build drops the
 * server's (#518).
 */
const internalsOf = <V,>(group: ItemGroup<V>, value: V, element: Accessor<HTMLElement | undefined>, listens: boolean): SpineInternals => {
  if (isServer) return { brings: ITEM_BRINGS, dragAxis: () => true, baseStyle: touchActionOf(group, listens) }
  return itemInternals(group, value, element, useWardicRuntime(), listens)
}

/**
 * What an item adds to its element for the keyboard reorder (ADR-0037): `tabindex="0"` while the
 * group's keyboard is on and the app gave no `tabIndex` of its own, and `aria-describedby` with
 * the group's instructions (`describedBy`, set on the client) after the app's own ids.
 */
const keyboardAttributes = (group: ItemGroup<never>, user: ReorderItemUserProps = NO_ITEM_PROPS, describedBy: Accessor<string | undefined>) => ({
  get tabindex() {
    return UndefinedOr.match(user.tabIndex, {
      onDefined: identity,
      onUndefined: () => Bool.match(group.keyboard(), { onTrue: () => 0, onFalse: constUndefined }),
    })
  },
  get "aria-describedby"() {
    const ids = Arr.filter([user["aria-describedby"], Bool.match(group.keyboard(), { onTrue: describedBy, onFalse: constUndefined })], Predicate.isNotUndefined)
    return Bool.match(ids.length === 0, { onTrue: () => undefined, onFalse: () => ids.join(" ") })
  },
})

/**
 * What an item's spread takes from the app: a ward's `ref` and `style`, plus its own `tabIndex`, which
 * wins over the keyboard reorder's, and its own `aria-describedby` ids, kept before the instructions'.
 */
export type ReorderItemUserProps = WardUserProps & {
  readonly tabIndex?: number | undefined
  readonly "aria-describedby"?: string | undefined
}

/** A `<Reorder>` item's spread: a {@link WardProps}, plus its keyboard reorder's `tabindex` and `aria-describedby`. */
export type ReorderItemSpread = WardProps & {
  readonly tabindex?: number | undefined
  readonly "aria-describedby"?: string | undefined
}

/** {@link createReorderItem}'s result: call it to spread onto the item's element, as a `Ward`. */
export type ReorderItemWard = ((userProps?: ReorderItemUserProps) => ReorderItemSpread) & Pick<Ward, "Provider">

/**
 * Makes an element an item of a Reorder group: spread it on the element, `{...row()}`, as a ward.
 * `value` is its value in the group's `values`, read once; the rest are its motion props, but
 * `layout` (`true` or `"position"`), `layoutId` and `drag`, which the group sets. It's a tab stop for
 * the keyboard reorder: give your own `tabIndex` and `aria-describedby` in the spread's props.
 *
 * @example
 * const row = createReorderItem(list, { value: item, whileDrag: { scale: 1.05 } })
 * <li {...row()}>{item.name}</li>
 * @see https://wardic.dev/reference/solid/reorder/reorder-item
 */
// ADR-0020, ADR-0037. The element takes the drag defaults, with the group's axis's touch-action, which
// its style can override.
export function createReorderItem<V>(group: ReorderGroup<V>, config: ReorderItemConfig<V> | Accessor<ReorderItemConfig<V>>): ReorderItemWard {
  const cfg: Accessor<ReorderItemConfig<V>> = accessorOf(config)
  const value = untrack(cfg).value
  const listens = untrack(cfg).dragListener !== false
  const [element, setElement] = createSignal<HTMLElement>()
  const internals = internalsOf(group, value, element, listens)
  const ward = createWardWith(() => ({ ...withoutValue(cfg()), layout: itemLayoutOf(cfg().layout) }), internals)
  // The instructions element exists on the client only, so `aria-describedby` waits for the mount.
  const [describedBy, setDescribedBy] = createSignal<string>()
  if (!isServer) {
    createEffect(on([element, group.instructions] as const, ([el, text]) => {
      if (Predicate.isNotUndefined(el)) setDescribedBy(DomAnnouncer.instructionsId(DomAnnouncer.documentOf(el), text))
    }))
  }
  // The item's element, for Auto-scroll's held scroll shift.
  // The user's style is passed on as a getter, so a live one stays live (WardUserProps).
  const item = (userProps: ReorderItemUserProps = NO_ITEM_PROPS): ReorderItemSpread =>
    mergeProps(
      ward({
        ref: mergeRefs(userProps.ref, setElement),
        get style() {
          return userProps.style
        },
      }),
      keyboardAttributes(group as unknown as ItemGroup<never>, userProps, describedBy),
    )
  return Object.assign(item, {
    Provider: ward.Provider,
  })
}

const noop = (): void => {}

/** A group's spread's user props when it's given none. */
const NO_GROUP_PROPS: ReorderGroupUserProps = {}
const NO_ITEM_PROPS: ReorderItemUserProps = {}

/** A Reorder item's drag axis for its gesture's axis: a grid's `xy` is a free drag. Built once, at module load. */
const dragAxisFor: (axis: CoreReorder.Axis) => true | "x" | "y" = Match.type<CoreReorder.Axis>().pipe(
  Match.when("xy", (): true => true),
  Match.orElse((axis) => axis as "x" | "y"),
)

/**
 * {@link createReorderGroup} during a server render (ADR-0021): the group's element style
 * (`overflow-anchor: none` under the user's) and the app's axis, else `"y"`; its `group`,
 * `move` and `controller` do nothing.
 */
const serverReorderGroup = <V,>(cfg: Accessor<ReorderGroupConfig<V>>): ReorderGroup<V> => {
  const spread = (userProps: ReorderGroupUserProps = NO_GROUP_PROPS): ReorderGroupSpread => ({
    ref: UndefinedOr.match(userProps.ref, { onUndefined: () => noop, onDefined: identity }),
    style: pipe(userProps.style, Style.over(ReorderController.GROUP_STYLE)) as JSX.CSSProperties,
  })
  const controller = ReorderController.inert as unknown as ReorderController.ReorderController<V>
  const axis = (): CoreReorder.Axis => UndefinedOr.match(cfg().axis, { onUndefined: () => "y" as const, onDefined: (a: CoreReorder.Axis) => a })
  return Object.assign(spread, { group: controller.group, axis, move: noop, controller, ...keyboardOf(cfg) })
}

const withoutValue = <V,>(config: ReorderItemConfig<V>): WardConfig => {
  const { value: _value, ...rest } = config
  return rest
}

/** `use:reorderItem`'s value: the item's `group` and its `value`, and its motion props. */
// The group of any value type, as an `ItemGroup<never>`.
export type ReorderItemDirectiveValue = {
  readonly group: ItemGroup<never>
  readonly value: unknown
  readonly layout?: ReorderItemLayout
} & Omit<WardConfig, "layout" | "layoutId" | "drag">

/**
 * `use:reorderItem`: makes an element an item of a Reorder group, as `use:wardic` makes it a Wardic
 * element: `<li use:reorderItem={{ group: list, value: item }}>`. In the browser only: its drag
 * defaults and `touch-action` are set as it mounts, not in the server's markup, so a server-rendered
 * item takes `createReorderItem` or `Reorder.Item`. Import `reorderItem` in the module that uses it.
 *
 * @see https://wardic.dev/reference/solid/reorder/reorder-item
 */
// ADR-0003: a directive is client-only. The import keeps `reorderItem` from being dropped as unused, as
// for `wardic`.
export function reorderItem(el: HTMLElement, value: Accessor<ReorderItemDirectiveValue>): void {
  const first = untrack(value)
  // Animation controls for its `animate` (#433): each change they make is its entry.
  const { cfg, controls } = controlledOf((): WardConfig => {
    const { group: _group, value: _value, ...rest } = value()
    return { ...rest, layout: itemLayoutOf(rest.layout) }
  })
  // As `use:wardic`: a Variant child joins the nearest variant context; it provides none (#50).
  const node = createVariantNode(cfg, useVariantContext(), UndefinedOr.map(controls, (c) => c.change))
  const runtime = useWardicRuntime()
  const group = first.group as ItemGroup<unknown>
  // The keyboard reorder's tab stop and instructions (ADR-0037), on the element itself: the app's
  // own `tabindex` wins, and its `aria-describedby` ids are kept.
  createEffect(() => {
    if (Bool.not(group.keyboard())) return
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0")
    const id = DomAnnouncer.instructionsId(DomAnnouncer.documentOf(el), group.instructions())
    const ids = Option.getOrElse(Option.fromNullishOr(el.getAttribute("aria-describedby")), () => "").split(" ").filter((t) => t !== "")
    if (!ids.includes(id)) el.setAttribute("aria-describedby", [...ids, id].join(" "))
  })
  runSpine({
    runtime,
    gate: useWardicGate(),
    id: createUniqueId(),
    el: () => el,
    cfg,
    controls,
    parent: node.inherited,
    extraDelay: node.extraDelay,
    byName: node.names,
    canStart: node.canStart,
    bindGestures: node.bindGestures,
    onFrame: node.onFrame,
    makeSink: (element) => ({ target: element }),
    internal: itemInternals(group, first.value, () => el, runtime, first.dragListener !== false),
  })
}

declare module "solid-js" {
  // biome-ignore lint/style/useNamingConvention: augmenting Solid's JSX namespace.
  namespace JSX {
    interface Directives {
      reorderItem: ReorderItemDirectiveValue
    }
  }
}

// --- Components (ADR-0020, D8: built on the headless API) --------------------------

const GroupContext = createContext<ReorderGroup<unknown>>()

/** An element tag a `<Reorder>` group or item can render. */
export type ReorderElementTag = keyof JSX.IntrinsicElements

/**
 * `Reorder.Group`'s props: its group's config, `as`, and the props of the element it renders, motion
 * props included.
 */
export type ReorderGroupProps<V, Tag extends ReorderElementTag = "ul"> = {
  /** The list's values, in order. Your app owns them. */
  readonly values: ReadonlyArray<V>
  /** Given each new order, as an item crosses another: set `values` from it. */
  readonly onReorder: (values: Array<V>) => void
  /** Called once at the end of a reorder that changed the order, with the order and the item that moved: what an app saves. */
  readonly onReorderEnd?: ((end: ReorderController.End<V>) => void) | undefined
  /** Called as an item is taken in hand, by a drag starting or a keyboard lift. */
  readonly onHoldStart?: ((start: ReorderController.HoldStart<V>) => void) | undefined
  /** Called once as an item in hand is let go, however; after `onReorderEnd` when it moved. */
  readonly onHoldEnd?: ((end: ReorderController.HoldEnd<V>) => void) | undefined
  /** The list's direction: `"y"`, a column, `"x"`, a row, or `"xy"`, a grid that wraps. Left out, it's found from the items' boxes. */
  readonly axis?: CoreReorder.Axis | undefined
  /** The keyboard reorder: on unless `false`. */
  readonly keyboard?: boolean | undefined
  /** What a screen reader hears at each step of a keyboard reorder, over the English defaults. */
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  /** What each item's `aria-describedby` reads, over the English default. */
  readonly instructions?: string | undefined
  /** The element it renders: `"ul"` by default. Read once. */
  readonly as?: Tag
} & Omit<WardicProps<Tag>, "onReorder">

/**
 * `Reorder.Item`'s props: its `value`, `as`, its `layout`, and the props of the element it renders,
 * motion props included, but `layoutId` and `drag`, which the group sets.
 */
export type ReorderItemProps<V, Tag extends ReorderElementTag = "li"> = {
  /** Its value in the group's `values`. Read once. */
  readonly value: V
  /** The element it renders: `"li"` by default. Read once. */
  readonly as?: Tag
  /** `true`, its place and size animating (the default), or `"position"`, its place alone. */
  readonly layout?: ReorderItemLayout
} & Omit<WardicProps<Tag>, "layout" | "layoutId" | "drag">

/**
 * The props a component body reads, as plain records: instantiating the public prop
 * types over every element tag (`WardicProps<keyof JSX.IntrinsicElements>`) makes a
 * type checker build a union of every element's props, which a consumer's checker
 * can run out of memory on.
 */
interface GroupLocal<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly onReorderEnd?: ((end: ReorderController.End<V>) => void) | undefined
  readonly onHoldStart?: ((start: ReorderController.HoldStart<V>) => void) | undefined
  readonly onHoldEnd?: ((end: ReorderController.HoldEnd<V>) => void) | undefined
  readonly axis?: CoreReorder.Axis | undefined
  readonly keyboard?: boolean | undefined
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  readonly instructions?: string | undefined
  readonly as?: string | undefined
  readonly ref?: ((el: HTMLElement) => void) | undefined
  readonly style?: JSX.CSSProperties | undefined
  readonly children?: JSX.Element
}
interface ItemLocal<V> {
  readonly value: V
  readonly as?: string | undefined
  readonly ref?: ((el: HTMLElement) => void) | undefined
  readonly style?: JSX.CSSProperties | undefined
  readonly children?: JSX.Element
  readonly tabIndex?: number | undefined
  readonly "aria-describedby"?: string | undefined
}

/**
 * The Wardic element for `tag`, typed as a plain component: a Slim element's (`w[tag]`, #511), so a
 * Reorder brings no Feature but its own (ADR-0067 decision 12) and renders under a `strict` section.
 */
const wardicTag = (tag: string): Component<Record<string, unknown>> =>
  UndefinedOr.getOrThrow((w as unknown as Record<string, Component<Record<string, unknown>> | undefined>)[tag])

/**
 * A list put in order by dragging its items, or from the keyboard, rendered as `as`, `"ul"` by
 * default. Your app owns `values`, and sets them from `onReorder`. Key its `Reorder.Item`s with `<For>`.
 *
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// ADR-0020: a `createReorderGroup` rendered as `w[as]`, the group in context for its items.
function Group<V, Tag extends ReorderElementTag = "ul">(props: ReorderGroupProps<V, Tag>): JSX.Element {
  const [local, rest] = splitProps(props as unknown as GroupLocal<V> & Record<string, unknown>, [
    "values",
    "onReorder",
    "onReorderEnd",
    "onHoldStart",
    "onHoldEnd",
    "axis",
    "keyboard",
    "announcements",
    "instructions",
    "as",
    "ref",
    "style",
    "children",
  ])
  const group = createReorderGroup<V>(() => ({
    values: local.values,
    onReorder: local.onReorder,
    ...UndefinedOr.match(local.onReorderEnd, { onUndefined: () => ({}), onDefined: (onReorderEnd) => ({ onReorderEnd }) }),
    ...UndefinedOr.match(local.onHoldStart, { onUndefined: () => ({}), onDefined: (onHoldStart) => ({ onHoldStart }) }),
    ...UndefinedOr.match(local.onHoldEnd, { onUndefined: () => ({}), onDefined: (onHoldEnd) => ({ onHoldEnd }) }),
    ...UndefinedOr.match(local.axis, { onUndefined: () => ({}), onDefined: (axis) => ({ axis }) }),
    ...UndefinedOr.match(local.keyboard, { onUndefined: () => ({}), onDefined: (keyboard) => ({ keyboard }) }),
    ...UndefinedOr.match(local.announcements, { onUndefined: () => ({}), onDefined: (announcements) => ({ announcements }) }),
    ...UndefinedOr.match(local.instructions, { onUndefined: () => ({}), onDefined: (instructions) => ({ instructions }) }),
  }))
  const Tag = wardicTag(UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "ul", onDefined: identity }))
  const userRef = local.ref
  const spread = group({
    ...UndefinedOr.match(userRef, { onUndefined: () => ({}), onDefined: (ref) => ({ ref }) }),
    get style() {
      return local.style
    },
  })
  return (
    <GroupContext.Provider value={group as ReorderGroup<unknown>}>
      <Tag {...rest} {...spread}>
        {local.children}
      </Tag>
    </GroupContext.Provider>
  )
}

/**
 * An item of the `Reorder.Group` around it, rendered as `as`, `"li"` by default. Outside a group it
 * throws, as Motion's does.
 *
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// ADR-0020: a `createReorderItem` on the nearest group.
function Item<V, Tag extends ReorderElementTag = "li">(props: ReorderItemProps<V, Tag>): JSX.Element {
  const group = useContext(GroupContext) as ReorderGroup<V> | undefined
  if (Predicate.isUndefined(group)) throw new Error("Reorder.Item must be a child of Reorder.Group")
  // The item consumes every motion prop name (layoutId / drag included, though its type
  // omits them), so none reaches the DOM.
  const [local, motion, rest] = splitProps(
    props as unknown as ItemLocal<V> & WardicMotionProps & Record<string, unknown>,
    ["value", "as", "ref", "style", "children", "tabIndex", "aria-describedby"],
    MOTION_PROPS,
  )
  const config = configOfMotion(motion as WardicMotionProps)
  const item = createReorderItem<V>(group, () => ({ ...config(), layout: itemLayoutOf(config().layout), value: local.value }))
  const tag = UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "li", onDefined: identity })
  const userRef = local.ref
  const spread = item({
    ...UndefinedOr.match(userRef, { onUndefined: () => ({}), onDefined: (ref) => ({ ref }) }),
    get style() {
      return local.style
    },
    get tabIndex() {
      return local.tabIndex
    },
    get "aria-describedby"() {
      return local["aria-describedby"]
    },
  })
  const element = (): JSX.Element => (
    <Dynamic component={tag} {...rest} {...spread}>
      {local.children}
    </Dynamic>
  )
  // An item that changes what its children read renders its variant context's Provider around
  // them (#50), as every Wardic element does; any other renders none.
  return Bool.match(changesContext(untrack(config)), {
    onFalse: element,
    onTrue: () => <item.Provider>{element()}</item.Provider>,
  })
}

/**
 * A list put in order by dragging its items, or from the keyboard: `Reorder.Group` and `Reorder.Item`.
 * Your app owns the order: the group takes it as `values`, and `onReorder` hands each new one back.
 * Motion's `Reorder`. A long list of items of one size reorders as one Batch: `Reorder.BatchGroup` and
 * `Reorder.BatchItem`.
 *
 * @example
 * <Reorder.Group values={items()} onReorder={setItems}>
 *   <For each={items()}>{(item) => <Reorder.Item value={item}>{item}</Reorder.Item>}</For>
 * </Reorder.Group>
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// ADR-0020; the Batch pair, ADR-0072 (#712).
export const Reorder = { Group, Item, BatchGroup, BatchItem } as const
