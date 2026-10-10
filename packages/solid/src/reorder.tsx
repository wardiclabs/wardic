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
 * Observability: the controller logs its own `wardic.reorder:` events through the
 * runtime (cold path: once per reorder, wait, gesture, edge or axis change, never per
 * sample); this file logs nothing.
 */
import * as CoreReorder from "@wardic/core/Reorder"
import { INERT_REORDER_CONTROLLER, makeReorderController, REORDER_GROUP_STYLE, type ReorderController, reorderTouchAction } from "@wardic/dom"
import { mergeRefs } from "@solid-primitives/refs"
import {
  type Accessor,
  type Component,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  onCleanup,
  splitProps,
  untrack,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { useWardicGate, useWardicProjection, useWardicRuntime } from "./provider.tsx"
import { runSpine, type SpineInternals, useWardicWith, type Ward, type WardicConfig, type WardUserProps } from "./use-wardic.tsx"
import { isServer } from "./server.ts"
import { useVariantContext } from "./variants.ts"
import { MOTION_PROPS, motionToConfig, wardic, type WardicMotionProps, type WardicProps } from "./wardic.tsx"

/**
 * A **Reorder group**'s config: the app's `values` in order, `onReorder` to receive a
 * new order (the app sets `values` from it), and an optional `axis` overriding the one
 * detected from the items' boxes. Static field types; pass an accessor for reactivity.
 */
export interface ReorderGroupConfig<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly axis?: CoreReorder.Axis
}

/** The spreadable props a {@link ReorderGroupWard} returns. */
export interface ReorderGroupWardProps {
  readonly ref: (el: HTMLElement) => void
  readonly style: JSX.CSSProperties
}

/**
 * {@link createReorderGroup}'s result: call it to spread onto the group's element
 * (with the user's ref and style merged), and read `group` (core's Reorder group),
 * `axis` (the resolved axis) and `move(value, toIndex)` (move a value in code).
 */
export type ReorderGroupWard<V> = ((userProps?: WardUserProps) => ReorderGroupWardProps) & {
  readonly group: CoreReorder.Group<V>
  readonly axis: Accessor<CoreReorder.Axis>
  readonly move: (value: V, toIndex: number) => void
  /** @internal for the items: the group's controller. */
  readonly controller: ReorderController<V>
}

/** A `<Reorder>` item's config: its `value`, plus any motion config but `layout`, `layoutId` and `drag`. */
export type ReorderItemConfig<V> = { readonly value: V } & Omit<WardicConfig, "layout" | "layoutId" | "drag">

/**
 * Create a **Reorder group** (ADR-0020). Spread the result onto the list's element
 * (`<ul {...group()}>`): it gives the element `overflow-anchor: none` (under the
 * user's style, as Motion's Group.tsx:187-195 at 16c6122 does), so the browser's
 * scroll anchoring doesn't shift the page as items move. Items are made with
 * {@link createReorderItem} or `use:reorderItem`, keyed with `<For>`.
 *
 * The group's `axis` is the config's, else detected from the items' boxes after every
 * Measure pass (for their `touch-action`). A drag resolves its own axis at its start.
 *
 * Client and server: on a server it renders the element's style and nothing else (no
 * controller, no runtime; its `group`, `move` and `controller` do nothing; ADR-0021).
 */
export function createReorderGroup<V>(config: ReorderGroupConfig<V> | Accessor<ReorderGroupConfig<V>>): ReorderGroupWard<V> {
  const cfg: Accessor<ReorderGroupConfig<V>> = typeof config === "function" ? config : () => config
  if (isServer) {
    useWardicRuntime()
    return serverReorderGroup(cfg)
  }
  const [detected, setDetected] = createSignal<CoreReorder.Axis>("y")
  const controller = makeReorderController<V>({
    runtime: useWardicRuntime(),
    projection: useWardicProjection(),
    values: () => untrack(cfg).values,
    onReorder: (values) => untrack(cfg).onReorder(values),
    axis: () => untrack(cfg).axis,
    onAxis: setDetected,
    keyedWith: "<For>",
  })
  onCleanup(controller.dispose)
  const axis: Accessor<CoreReorder.Axis> = () => cfg().axis ?? detected()

  // A `values` change re-measures, so the items animate to their new slots whoever
  // reordered them (as LayoutGroup's layoutDependency does).
  createEffect(on(() => cfg().values, () => controller.valuesChanged(), { defer: true }))
  // The app's axis cleared: no Measure pass comes with that, so detect now.
  createEffect(
    on(
      () => cfg().axis,
      (a) => {
        if (a === undefined) controller.resolve()
      },
      { defer: true },
    ),
  )

  const ward = (userProps?: WardUserProps): ReorderGroupWardProps => ({
    ref: mergeRefs(userProps?.ref, (el: HTMLElement) => controller.attach(el)),
    get style() {
      return { ...REORDER_GROUP_STYLE, ...userProps?.style } as JSX.CSSProperties
    },
  })

  const move = (value: V, toIndex: number): void => CoreReorder.move(controller.group, value, toIndex)
  return Object.assign(ward, { group: controller.group, axis, move, controller })
}

/**
 * The spine additions of an item with `value` in `group` (D8: shared by
 * {@link createReorderItem} and `use:reorderItem`): a `layout` node registered with the
 * group, raised while dragged, whose drag takes the group's axis at each start and
 * feeds the controller its samples, and whose `touch-action` follows the group's axis.
 */
/**
 * What an item reads from its group: its controller's driver for the item, and the group's
 * axis. Any {@link ReorderGroupWard} is one. Its value type appears only in `item`'s
 * parameters, so `ItemGroup<never>` accepts a group of any value type.
 */
type ItemGroup<V> = { readonly controller: Pick<ReorderController<V>, "item">; readonly axis: Accessor<CoreReorder.Axis> }

const itemInternals = <V,>(group: ItemGroup<V>, value: V, element: Accessor<HTMLElement | undefined>): SpineInternals => {
  const driver = group.controller.item(value, element)
  // An item unmounted mid-gesture gets no end sample: its disposal ends the gesture.
  onCleanup(driver.dispose)
  return {
    dragAxis: () => {
      const a = driver.dragAxis()
      return a === "xy" ? true : a
    },
    onDragSample: driver.onSample,
    onLayoutHandle: (handle) => onCleanup(driver.register(handle)),
    raiseWhileDragged: true,
    baseStyle: () => ({ "touch-action": reorderTouchAction(group.axis()) }),
  }
}

/**
 * Create a `<Reorder>` item in `group` (ADR-0020): spread the result onto the item's
 * element (`<li {...item()}>`), as with `useWardic`. `value` is the item's value in the
 * group's `values` (static, read once); the rest is ordinary motion config, except
 * `layout` (the item is one), `layoutId` and `drag` (the group decides the axis).
 * The element gets the drag defaults, with the group's axis's `touch-action`
 * (overridable by its style).
 */
export function createReorderItem<V>(group: ReorderGroupWard<V>, config: ReorderItemConfig<V> | Accessor<ReorderItemConfig<V>>): Ward {
  const cfg: Accessor<ReorderItemConfig<V>> = typeof config === "function" ? config : () => config
  const value = untrack(cfg).value
  const [element, setElement] = createSignal<HTMLElement>()
  // On a server the item renders the drag defaults with its group's touch-action and
  // joins no controller (ADR-0021).
  const internals: SpineInternals = isServer
    ? { dragAxis: () => true, baseStyle: () => ({ "touch-action": reorderTouchAction(group.axis()) }) }
    : itemInternals(group, value, element)
  const ward = useWardicWith(() => ({ ...withoutValue(cfg()), layout: true }), internals)
  // The item's element, for Auto-scroll's held scroll shift.
  // The user's style is passed on as a getter, so a live one stays live (WardUserProps).
  const item = (userProps?: WardUserProps) =>
    ward({
      ref: mergeRefs(userProps?.ref, setElement),
      get style() {
        return userProps?.style
      },
    })
  return Object.assign(item, {
    Provider: ward.Provider,
  }) as Ward
}

const noop = (): void => {}

/**
 * {@link createReorderGroup} during a server render (ADR-0021): the group's element style
 * (`overflow-anchor: none` under the user's) and the app's axis, else `"y"`; its `group`,
 * `move` and `controller` do nothing.
 */
const serverReorderGroup = <V,>(cfg: Accessor<ReorderGroupConfig<V>>): ReorderGroupWard<V> => {
  const ward = (userProps?: WardUserProps): ReorderGroupWardProps => ({
    ref: userProps?.ref ?? noop,
    style: { ...REORDER_GROUP_STYLE, ...userProps?.style } as JSX.CSSProperties,
  })
  const controller = INERT_REORDER_CONTROLLER as unknown as ReorderController<V>
  return Object.assign(ward, { group: controller.group, axis: () => cfg().axis ?? ("y" as const), move: noop, controller })
}

const withoutValue = <V,>(config: ReorderItemConfig<V>): WardicConfig => {
  const { value: _value, ...rest } = config
  return rest
}

/**
 * `use:reorderItem`'s value: the item's group (of any value type, as an `ItemGroup<never>`)
 * and value, plus its motion config.
 */
export type ReorderItemDirectiveValue = { readonly group: ItemGroup<never>; readonly value: unknown } & Omit<
  WardicConfig,
  "layout" | "layoutId" | "drag"
>

/**
 * `use:reorderItem` — make an element a `<Reorder>` item (commit sink, like `use:ward`):
 * `<li use:reorderItem={{ group, value }}>`. CLIENT-ONLY (ADR-0003): its drag
 * defaults and `touch-action` are set at mount, not in server markup; use
 * {@link createReorderItem} or `Reorder.Item` for server-rendered items.
 *
 * IMPORTANT (use:-import retention): import `reorderItem` from `@wardic/solid` where
 * the directive is used, as for `ward`.
 */
export function reorderItem(el: HTMLElement, value: Accessor<ReorderItemDirectiveValue>): void {
  const first = untrack(value)
  runSpine({
    runtime: useWardicRuntime(),
    gate: useWardicGate(),
    id: createUniqueId(),
    el: () => el,
    cfg: () => {
      const { group: _group, value: _value, ...rest } = value()
      return { ...rest, layout: true }
    },
    parent: useVariantContext(),
    makeSink: (element) => ({ kind: "commit", target: element }),
    internal: itemInternals(first.group as ItemGroup<unknown>, first.value, () => el),
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

const GroupContext = createContext<ReorderGroupWard<unknown>>()

/** An element tag a `<Reorder>` group or item can render. */
export type ReorderElementTag = keyof JSX.IntrinsicElements

/**
 * `Reorder.Group`'s props: the group's `values`, `onReorder` and optional `axis`
 * (plain values, reactive through Solid's prop getters), `as` (the tag, `"ul"` by
 * default, static), and the tag's own and motion props.
 */
export type ReorderGroupProps<V, Tag extends ReorderElementTag = "ul"> = {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly axis?: CoreReorder.Axis | undefined
  readonly as?: Tag
} & Omit<WardicProps<Tag>, "onReorder">

/**
 * `Reorder.Item`'s props: its `value` (static), `as` (the tag, `"li"` by default,
 * static), and the tag's own and motion props, except `layout`, `layoutId` and `drag`.
 */
export type ReorderItemProps<V, Tag extends ReorderElementTag = "li"> = {
  readonly value: V
  readonly as?: Tag
} & Omit<WardicProps<Tag>, "layout" | "layoutId" | "drag">

/**
 * `Reorder.Group` (ADR-0020): a {@link createReorderGroup} rendered as `wardic[as]`, with
 * the group in context for its `Reorder.Item`s. Key the items with `<For>`.
 */
/**
 * The props a component body reads, as plain records: instantiating the public prop
 * types over every element tag (`WardicProps<keyof JSX.IntrinsicElements>`) makes a
 * type checker build a union of every element's props, which a consumer's checker
 * can run out of memory on.
 */
interface GroupLocal<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly axis?: CoreReorder.Axis | undefined
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
}

/** The motion element for `tag` (`wardic[tag]`), typed as a plain component. */
const wardicTag = (tag: string): Component<Record<string, unknown>> =>
  (wardic as unknown as Record<string, Component<Record<string, unknown>>>)[tag]!

export function ReorderGroup<V, Tag extends ReorderElementTag = "ul">(props: ReorderGroupProps<V, Tag>): JSX.Element {
  const [local, rest] = splitProps(props as unknown as GroupLocal<V> & Record<string, unknown>, [
    "values",
    "onReorder",
    "axis",
    "as",
    "ref",
    "style",
    "children",
  ])
  const group = createReorderGroup<V>(() => ({
    values: local.values,
    onReorder: local.onReorder,
    ...(local.axis !== undefined ? { axis: local.axis } : {}),
  }))
  const Tag = wardicTag(untrack(() => local.as) ?? "ul")
  const userRef = local.ref
  const spread = group({
    ...(userRef !== undefined ? { ref: userRef } : {}),
    get style() {
      return local.style
    },
  })
  return (
    <GroupContext.Provider value={group as ReorderGroupWard<unknown>}>
      <Tag {...rest} {...spread}>
        {local.children}
      </Tag>
    </GroupContext.Provider>
  )
}

/**
 * `Reorder.Item` (ADR-0020): a {@link createReorderItem} on the nearest `Reorder.Group`,
 * rendered as `as` (`"li"` by default). Outside a group it throws, as Motion's does.
 */
export function ReorderItem<V, Tag extends ReorderElementTag = "li">(props: ReorderItemProps<V, Tag>): JSX.Element {
  const group = useContext(GroupContext) as ReorderGroupWard<V> | undefined
  if (group === undefined) throw new Error("Reorder.Item must be a child of Reorder.Group")
  // The item consumes every motion prop name (layout / layoutId / drag included, though
  // its type omits them), so none reaches the DOM.
  const [local, motion, rest] = splitProps(
    props as unknown as ItemLocal<V> & WardicMotionProps & Record<string, unknown>,
    ["value", "as", "ref", "style", "children"],
    MOTION_PROPS,
  )
  const config = motionToConfig(motion as WardicMotionProps)
  const item = createReorderItem<V>(group, () => ({ ...config(), value: local.value }))
  const tag = untrack(() => local.as) ?? "li"
  const userRef = local.ref
  const spread = item({
    ...(userRef !== undefined ? { ref: userRef } : {}),
    get style() {
      return local.style
    },
  })
  return (
    <Dynamic component={tag} {...rest} {...spread}>
      {local.children}
    </Dynamic>
  )
}

/** `<Reorder>`: `Reorder.Group` and `Reorder.Item` (ADR-0020), as Motion's `Reorder`. */
export const Reorder = { Group: ReorderGroup, Item: ReorderItem } as const
