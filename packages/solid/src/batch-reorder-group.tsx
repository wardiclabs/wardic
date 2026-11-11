/**
 * `Reorder.BatchGroup` and `Reorder.BatchItem` on Solid 1 (#712, ADR-0072): a long list reordered as one
 * keyed Batch, each item at the place its index gives. Solid's half of `batch-reorder.ts`: its props,
 * its tracking and its elements.
 *
 * @module
 */
import type * as CoreReorder from "@wardic/core/Reorder"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Style from "@wardic/dom/Style"
import { mergeRefs } from "@solid-primitives/refs"
import * as Bool from "effect/Boolean"
import * as Arr from "effect/Array"
import { constUndefined, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { $PROXY, type Accessor, createComponent, createContext, createEffect, createMemo, createRenderEffect, createSignal, type JSX, on, onCleanup, sharedConfig, splitProps, untrack, useContext } from "solid-js"
import { Dynamic, getNextElement, insert, setAttribute, spread } from "solid-js/web"
import { configTransitionOf, type WardicBatchTransition } from "./batch.ts"
import { type BatchReorderBinding, type BatchReorderExit, type BatchReorderGesture, type BatchReorderInitial, type BatchReorderItem, type BatchReorderItems, serverBatchReorder, type BatchReorderRead, bindBatchReorder, describedByOf, geometryOf, GROUP_BRINGS, type ReorderBatchGap, type ReorderBatchItemSize, sameRead, tabStopOf } from "./batch-reorder.ts"
import { cssTextOf, sameStyle } from "./batch-reorder-places.ts"
import { usePresenceContext } from "./presence.tsx"
import { plainOrder } from "./reorder-values.ts"
import { useBrought, useWardicDefaultTransition, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import type { ReorderElementTag } from "./reorder.tsx"
import { isServer } from "./server.ts"
import { useWardicConfig } from "./wardic-config.tsx"

export type { ReorderBatchGap, ReorderBatchItemSize } from "./batch-reorder.ts"

/**
 * `Reorder.BatchGroup`'s props: `Reorder.Group`'s (its `values`, `onReorder`, events and keyboard), its
 * places' geometry, its items' motion, and the props of the element it renders.
 */
export type ReorderBatchGroupProps<V, Tag extends ReorderElementTag = "ul"> = {
  /** The list's values, in order, each its own: an item's key. Your app owns them. */
  readonly values: ReadonlyArray<V>
  /** Given each new order, as an item crosses another: set `values` from it. */
  readonly onReorder: (values: Array<V>) => void
  /** Called once at the end of a reorder that changed the order, with the order and the item that moved: what an app saves. */
  readonly onReorderEnd?: ((end: ReorderController.End<V>) => void) | undefined
  /** Called as an item is taken in hand, by a drag starting or a keyboard lift. */
  readonly onHoldStart?: ((start: ReorderController.HoldStart<V>) => void) | undefined
  /** Called once as an item in hand is let go, however; after `onReorderEnd` when it moved. */
  readonly onHoldEnd?: ((end: ReorderController.HoldEnd<V>) => void) | undefined
  /** The list's shape: `"y"`, a column (the default), `"x"`, a row, or `"xy"`, a grid that wraps. */
  readonly axis?: CoreReorder.Axis | undefined
  /** Every item's size, in px: the group places them by it. */
  readonly itemSize: ReorderBatchItemSize
  /** The space between places, in px: one for both axes, or `{ x, y }`. None by default. */
  readonly gap?: ReorderBatchGap | undefined
  /** A grid's columns: how many items a row holds. Left out, as many as the group's width holds, read again as it's resized. */
  readonly columns?: number | undefined
  /**
   * `"rtl"` mirrors a row's and a grid's places, from the group's right edge. Left out, the group's element's
   * computed direction, read as it mounts (a server render's `"ltr"`).
   */
  readonly direction?: "ltr" | "rtl" | undefined
  /** The keyboard reorder: on unless `false`. */
  readonly keyboard?: boolean | undefined
  /** What a screen reader hears at each step of a keyboard reorder, over the English defaults. */
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  /** What each item's `aria-describedby` reads, over the English default. */
  readonly instructions?: string | undefined
  /** Where each item starts: values, a function of its item and index, or `false` to start at its place. */
  readonly initial?: BatchReorderInitial<V> | undefined
  /** How the items move to their places: else the nearest `WardicConfig`'s, else each key's Default transition. */
  readonly transition?: WardicBatchTransition | undefined
  /**
   * Where an item goes while it's in hand, dragged or lifted from the keyboard: values with an optional
   * `transition`, or a function of its item and index. Back on the group's transition as it's let go.
   */
  readonly whileDrag?: BatchReorderGesture<V> | undefined
  /**
   * Where an item goes while the pointer is over it (touch never hovers): values with an optional
   * `transition`, or a function of its item and index, read as its hover starts.
   */
  readonly whileHover?: BatchReorderGesture<V> | undefined
  /**
   * Where an item goes while it's pressed, by a pointer, or by Enter or Space while it has focus and the
   * keyboard reorder is off (on, they lift it): values with an optional `transition`, or a function of its
   * item and index, read as its press starts.
   */
  readonly whileTap?: BatchReorderGesture<V> | undefined
  /**
   * Where an item leaving under `<AnimatePresence>` goes, at its last place, its element kept until it lands:
   * values with an optional `transition`, or a function of its item, its last index and the presence's `custom`.
   */
  readonly exit?: BatchReorderExit<V> | undefined
  /** The element it renders: `"ul"` by default. Read once. */
  readonly as?: Tag
  readonly style?: JSX.CSSProperties | undefined
} & Omit<JSX.IntrinsicElements[Tag], "style" | "onReorder">

/**
 * `Reorder.BatchItem`'s props: its `value`, `as`, and the props of the element it renders. It's a member
 * of its group's Batch, not a Wardic element: its motion is the group's.
 */
export type ReorderBatchItemProps<V, Tag extends ReorderElementTag = "li"> = {
  /** Its value in the group's `values`. Read once. */
  readonly value: V
  /** The element it renders: `"li"` by default. Read once. */
  readonly as?: Tag
  readonly style?: JSX.CSSProperties | undefined
  /** Its own tab stop, over the keyboard reorder's `0`. */
  readonly tabIndex?: number | undefined
  /** Its own ids, kept before the keyboard reorder's instructions'. */
  readonly "aria-describedby"?: string | undefined
} & Omit<JSX.IntrinsicElements[Tag], "style" | "tabIndex" | "aria-describedby">

/**
 * The props a component body reads, as plain records: instantiating the public prop types over every
 * element tag makes a type checker build a union of every element's props.
 */
interface GroupLocal<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
  readonly onReorderEnd?: ((end: ReorderController.End<V>) => void) | undefined
  readonly onHoldStart?: ((start: ReorderController.HoldStart<V>) => void) | undefined
  readonly onHoldEnd?: ((end: ReorderController.HoldEnd<V>) => void) | undefined
  readonly axis?: CoreReorder.Axis | undefined
  readonly itemSize: ReorderBatchItemSize
  readonly gap?: ReorderBatchGap | undefined
  readonly columns?: number | undefined
  readonly direction?: "ltr" | "rtl" | undefined
  readonly keyboard?: boolean | undefined
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  readonly instructions?: string | undefined
  readonly initial?: BatchReorderInitial<V> | undefined
  readonly transition?: WardicBatchTransition | undefined
  readonly whileDrag?: BatchReorderGesture<V> | undefined
  readonly whileHover?: BatchReorderGesture<V> | undefined
  readonly whileTap?: BatchReorderGesture<V> | undefined
  readonly exit?: BatchReorderExit<V> | undefined
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

const GROUP_OWN = [
  "values",
  "onReorder",
  "onReorderEnd",
  "onHoldStart",
  "onHoldEnd",
  "axis",
  "itemSize",
  "gap",
  "columns",
  "direction",
  "keyboard",
  "announcements",
  "instructions",
  "initial",
  "transition",
  "whileDrag",
  "whileHover",
  "whileTap",
  "exit",
  "as",
  "ref",
  "style",
  "children",
] as const
const ITEM_OWN = ["value", "as", "ref", "style", "children", "tabIndex", "aria-describedby"] as const

/** What a group's items read of it: its binding, its keyboard reorder's switch, and on a client what it writes on them. */
interface GroupForItems<V> {
  readonly binding: BatchReorderItems<V>
  readonly keyboard: () => boolean
  /** On a client, what the group writes on each item that gives none of its own; on a server, none. */
  readonly writes: GroupWrites | undefined
}

/**
 * What a group writes on each of its items that gives none of its own (#712, Q47): the same for them all, so
 * each item is written once as it's made, and the group writes a change on every one of them, with no
 * computation per item.
 */
interface GroupWrites {
  readonly style: SharedStyle
  readonly tabStop: SharedAttribute
  readonly describedBy: SharedAttribute
  /** An item gone: the group writes on it no more. */
  readonly forget: (el: HTMLElement) => void
}

/** The style a group writes on its items: its record, as CSS text for a new element, and the items that take it. */
interface SharedStyle {
  readonly record: Accessor<Style.Style>
  readonly css: Accessor<string>
  readonly items: Set<HTMLElement>
}

/** An attribute a group writes on its items: its name, its value, and the items that take it. */
interface SharedAttribute {
  readonly name: string
  readonly value: Accessor<string | undefined>
  readonly items: Set<HTMLElement>
}

/** An attribute every item without its own takes, each change written on them all. */
const sharedAttributeOf = (name: string, value: () => string | undefined): SharedAttribute => {
  const attribute: SharedAttribute = { name, value: createMemo(value), items: new Set() }
  createRenderEffect(on(attribute.value, (next) => Iter.forEach(attribute.items, (el) => attributeOn(el, name, next)), { defer: true }))
  return attribute
}

/** A group's {@link GroupWrites}: an item made later reads each as it's made. */
const groupWritesOf = (binding: BatchReorderBinding<unknown>, keyboard: () => boolean, instructionsId: Accessor<string | undefined>): GroupWrites => {
  const record = createMemo(binding.itemStyle, undefined, { equals: sameStyle })
  const style: SharedStyle = { record, css: createMemo(() => cssTextOf(record())), items: new Set() }
  createRenderEffect(
    on(
      record,
      (next, prev) => {
        const was = UndefinedOr.match(prev, { onUndefined: () => NO_STYLE, onDefined: identity })
        Iter.forEach(style.items, (el) => restyle(el, was, next))
      },
      { defer: true },
    ),
  )
  const tabStop = sharedAttributeOf("tabindex", () => UndefinedOr.map(tabStopOf(keyboard(), binding.pressable), String))
  const describedBy = sharedAttributeOf("aria-describedby", () => Bool.match(keyboard(), { onTrue: instructionsId, onFalse: constUndefined }))
  return {
    style,
    tabStop,
    describedBy,
    forget: (el) => {
      style.items.delete(el)
      tabStop.items.delete(el)
      describedBy.items.delete(el)
    },
  }
}

/** No style: a hydrated item's, before the group's is written key by key. */
const NO_STYLE: Style.Style = {}

/** Solid's `setAttribute`: none removes it, and while hydrating it writes nothing, as the server wrote it. */
const attributeOn = (el: Element, name: string, value: string | undefined): void => setAttribute(el, name, value as string)

/** `el`'s style taken from `prev` to `next`: each key `next` drops removed, each it changes set. */
const restyle = (el: HTMLElement, prev: Style.Style, next: Style.Style): void => {
  // Per element at mount (#540): statements.
  Arr.forEach(Rec.keys(prev), (key) => {
    if (Predicate.isNullish(next[key])) el.style.removeProperty(key)
  })
  Arr.forEach(Rec.keys(next), (key) => {
    const value = next[key]
    if (Predicate.isNotNullish(value) && value !== prev[key]) el.style.setProperty(key, String(value))
  })
}

/** The nearest `Reorder.BatchGroup`, for its items. */
const BatchGroupContext = createContext<GroupForItems<unknown>>()

/**
 * A long list put in order by dragging its items, or from the keyboard, as one Batch: every item one
 * size, at the place its index gives. Rendered as `as`, `"ul"` by default, sized to its places. Your app
 * owns `values`, and sets them from `onReorder`. Key its `Reorder.BatchItem`s with `<For>`.
 *
 * @example
 * <Reorder.BatchGroup values={items()} onReorder={setItems} itemSize={{ width: 240, height: 48 }} gap={8}>
 *   <For each={items()}>{(item) => <Reorder.BatchItem value={item}>{item}</Reorder.BatchItem>}</For>
 * </Reorder.BatchGroup>
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// #712, ADR-0072.
export function BatchGroup<V, Tag extends ReorderElementTag = "ul">(props: ReorderBatchGroupProps<V, Tag>): JSX.Element {
  const [local, rest] = splitProps(props as unknown as GroupLocal<V> & Record<string, unknown>, GROUP_OWN)
  const keyboard = (): boolean => local.keyboard !== false
  const instructions = (): string => UndefinedOr.match(local.instructions, { onUndefined: () => ReorderController.DEFAULT_INSTRUCTIONS, onDefined: identity })
  const tag = UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "ul", onDefined: identity })
  // On a server (Q39): its items' starts, and no runtime. A plain `if`, so a client build drops it (#518).
  if (isServer) {
    const server = serverBatchReorder<V>(
      { values: () => local.values, geometry: () => geometryOf(local, undefined), initial: () => local.initial, whileTap: () => local.whileTap },
      untrack,
    )
    return (
      <BatchGroupContext.Provider value={{ binding: server as BatchReorderItems<unknown>, keyboard, writes: undefined }}>
        <Dynamic component={tag} {...rest} style={server.groupStyle(local.style) as JSX.CSSProperties}>
          {local.children}
        </Dynamic>
      </BatchGroupContext.Provider>
    )
  }
  const runtime = useWardicRuntime()
  const services = useBrought(GROUP_BRINGS)
  // The order as a plain array (#721): a store's copied, so a store changed in place is a new order.
  const values = (): ReadonlyArray<V> => plainOrder(local.values, $PROXY)
  // What the group read of its element: the direction it inherits and a grid's width (Q35, Q36).
  const [read, setRead] = createSignal<BatchReorderRead | undefined>(undefined, { equals: sameRead })
  const binding = untrack(() =>
    bindBatchReorder<V>(
      {
        runtime,
        reducedMotion: useWardicReducedMotion(),
        skipAnimations: useWardicSkipAnimations(),
        positionalKeys: useWardicPositionalKeys(),
        defaultTransition: useWardicDefaultTransition(),
        configTransition: configTransitionOf(useWardicConfig()),
        untrack,
      },
      {
        values,
        geometryOf: (seen) => geometryOf(local, seen),
        read,
        onRead: setRead,
        initial: () => local.initial,
        transition: () => local.transition,
        whileDrag: () => local.whileDrag,
        whileHover: () => local.whileHover,
        whileTap: () => local.whileTap,
        exit: () => local.exit,
        onReorder: (values) => untrack(() => local.onReorder)(values),
        onReorderEnd: (end) => UndefinedOr.map(untrack(() => local.onReorderEnd), (tell) => tell(end)),
        onHoldStart: (start) => UndefinedOr.map(untrack(() => local.onHoldStart), (tell) => tell(start)),
        onHoldEnd: (end) => UndefinedOr.map(untrack(() => local.onHoldEnd), (tell) => tell(end)),
        keyboard: () => untrack(() => local.keyboard) !== false,
        announcements: () => Option.fromUndefinedOr(untrack(() => local.announcements)),
        brought: services,
      },
      { started: noop, landed: noop },
    ))
  // Its first places were read as it was made: a change of the list or the geometry from then on turns every item.
  createRenderEffect(on(binding.batch.targetsOf, binding.apply, { defer: true }))
  onCleanup(binding.dispose)
  // The keyboard instructions (ADR-0037), one element per document and text: its id, once the group's element
  // is on a page, every item's `aria-describedby`.
  const [element, setElement] = createSignal<Element>()
  const [instructionsId, setInstructionsId] = createSignal<string>()
  createEffect(on([element, instructions] as const, ([el, text]) => {
    if (Predicate.isNotUndefined(el)) setInstructionsId(DomAnnouncer.instructionsId(DomAnnouncer.documentOf(el), text))
  }))
  const writes = groupWritesOf(binding as BatchReorderBinding<unknown>, keyboard, instructionsId)
  return (
    <BatchGroupContext.Provider value={{ binding: binding as BatchReorderBinding<unknown>, keyboard, writes }}>
      <Dynamic component={tag} {...rest} ref={mergeRefs(local.ref, binding.attach, setElement)} style={binding.groupStyle(local.style) as JSX.CSSProperties}>
        {local.children}
      </Dynamic>
    </BatchGroupContext.Provider>
  )
}

/**
 * An item of the `Reorder.BatchGroup` around it, rendered as `as`, `"li"` by default: a member of its
 * group's Batch. Outside a group it throws.
 *
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// #712, ADR-0072.
export function BatchItem<V, Tag extends ReorderElementTag = "li">(props: ReorderBatchItemProps<V, Tag>): JSX.Element {
  const group = useContext(BatchGroupContext) as GroupForItems<V> | undefined
  if (Predicate.isUndefined(group)) throw new Error("Reorder.BatchItem must be a child of Reorder.BatchGroup")
  const [local, rest] = splitProps(props as unknown as ItemLocal<V> & Record<string, unknown>, ITEM_OWN)
  const item = group.binding.item(untrack(() => local.value), usePresenceContext())
  onCleanup(item.dispose)
  const tag = UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "li", onDefined: identity })
  // On a server, its element as `<Dynamic>` renders it, with no instructions: they're a client's. A plain `if` (#518).
  if (isServer) {
    return (
      <Dynamic
        component={tag}
        {...rest}
        style={item.style(local.style) as JSX.CSSProperties}
        draggable={Style.DRAG_DEFAULT_ATTRIBUTES.draggable}
        tabindex={UndefinedOr.match(local.tabIndex, { onDefined: identity, onUndefined: () => tabStopOf(group.keyboard(), group.binding.pressable) })}
        aria-describedby={describedByOf(local["aria-describedby"], undefined)}
      >
        {local.children}
      </Dynamic>
    )
  }
  // A component of its own, as `<Dynamic>` is on a server: hydrating, its element's key is the server's.
  return createComponent(ItemElement, { tag, local, rest, item, writes: UndefinedOr.getOrThrow(group.writes) })
}

/** What {@link ItemElement} makes an item's element from. */
interface ItemElementProps<V> {
  readonly tag: string
  readonly local: ItemLocal<V>
  readonly rest: Record<string, unknown>
  readonly item: BatchReorderItem
  readonly writes: GroupWrites
}

/**
 * An item's element on a client (#712, Q47), made as `<Dynamic>` makes one: its style, tab stop and
 * `aria-describedby` written on it directly, the group's unless it gives its own, and the rest of its
 * props through Solid's `spread`. Its style is written before its `ref`s run, where the Batch draws it.
 */
const ItemElement = <V,>({ tag, local, rest, item, writes }: ItemElementProps<V>): HTMLElement => {
  // Hydrating, the server's element, its attributes as the server wrote them.
  const hydrating = Predicate.isNotUndefined(sharedConfig.context)
  const el = elementFor(tag, hydrating)
  itemStyleOn(el, hydrating, local, item, writes.style)
  attributeOn(el, "draggable", Style.DRAG_DEFAULT_ATTRIBUTES.draggable)
  attributeFor(el, local, "tabIndex", writes.tabStop, ownTabStop)
  attributeFor(el, local, "aria-describedby", writes.describedBy, ownDescribedBy)
  onCleanup(() => writes.forget(el))
  spread(el, rest, false, true)
  insert(el, () => local.children)
  UndefinedOr.map(untrack(() => local.ref), (ref) => ref(el))
  item.ref(el)
  return el
}

/** A new element for `tag`, or, hydrating, the server's next one: Solid's `<Dynamic>`'s. */
const elementFor = (tag: string, hydrating: boolean): HTMLElement => {
  // Per element at mount (#540): statements.
  if (hydrating) return getNextElement() as HTMLElement
  return document.createElement(tag)
}

/**
 * An item's style: its own over the group's, a key at a time as either changes; or the group's alone, on a
 * new element as one CSS text (Q47), hydrating a key at a time, and from then on the group's to write.
 */
const itemStyleOn = <V,>(el: HTMLElement, hydrating: boolean, local: ItemLocal<V>, item: BatchReorderItem, shared: SharedStyle): void => {
  // Per element at mount (#540): statements.
  if ("style" in local) {
    createRenderEffect((prev: Style.Style) => {
      const next = item.style(local.style)
      restyle(el, prev, next)
      return next
    }, NO_STYLE)
    return
  }
  shared.items.add(el)
  if (hydrating) {
    restyle(el, NO_STYLE, shared.record())
    return
  }
  el.style.cssText = shared.css()
}

/** An item's `shared` attribute: from its own `key`, with the group's, as `own` reads it; else the group's, the group's to write. */
const attributeFor = <V,>(
  el: HTMLElement,
  local: ItemLocal<V>,
  key: "tabIndex" | "aria-describedby",
  shared: SharedAttribute,
  own: (local: ItemLocal<V>, shared: SharedAttribute) => string | undefined,
): void => {
  // Per element at mount (#540): statements.
  if (key in local) {
    createRenderEffect(() => attributeOn(el, shared.name, own(local, shared)))
    return
  }
  shared.items.add(el)
  attributeOn(el, shared.name, shared.value())
}

/** An item's own tab stop, else the group's. */
const ownTabStop = <V,>(local: ItemLocal<V>, shared: SharedAttribute): string | undefined =>
  UndefinedOr.match(local.tabIndex, { onDefined: String, onUndefined: shared.value })

/** An item's own ids, then the instructions'. */
const ownDescribedBy = <V,>(local: ItemLocal<V>, shared: SharedAttribute): string | undefined => describedByOf(local["aria-describedby"], shared.value())

const noop = (): void => {}

