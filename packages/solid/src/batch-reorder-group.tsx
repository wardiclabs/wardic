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
import { constUndefined, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { createContext, createEffect, createRenderEffect, createSignal, type JSX, on, onCleanup, splitProps, untrack, useContext } from "solid-js"
import { Dynamic } from "solid-js/web"
import { configTransitionOf, type WardicBatchExit, type WardicBatchGesture, type WardicBatchTransition, type WardicBatchValues } from "./batch.ts"
import { type BatchReorderBinding, type BatchReorderItems, serverBatchReorder, type BatchReorderDirection, type BatchReorderMeasure, bindBatchReorder, describedByOf, geometryOf, GROUP_BRINGS, type ReorderBatchGap, type ReorderBatchItemSize, sameMeasure } from "./batch-reorder.ts"
import { usePresenceContext } from "./presence.tsx"
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
  readonly direction?: BatchReorderDirection | undefined
  /** The keyboard reorder: on unless `false`. */
  readonly keyboard?: boolean | undefined
  /** What a screen reader hears at each step of a keyboard reorder, over the English defaults. */
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  /** What each item's `aria-describedby` reads, over the English default. */
  readonly instructions?: string | undefined
  /** Where each item starts: values, a function of its item and index, or `false` to start at its place. */
  readonly initial?: false | WardicBatchValues | ((item: V, i: number) => WardicBatchValues) | undefined
  /** How the items move to their places: else the nearest `WardicConfig`'s, else each key's Default transition. */
  readonly transition?: WardicBatchTransition | undefined
  /**
   * Where an item goes while it's in hand, dragged or lifted from the keyboard: values with an optional
   * `transition`, or a function of its item and index. Back on the group's transition as it's let go.
   */
  readonly whileDrag?: WardicBatchGesture | ((item: V, i: number) => WardicBatchValues) | undefined
  /**
   * Where an item goes while the pointer is over it (touch never hovers): values with an optional
   * `transition`, or a function of its item and index, read as its hover starts.
   */
  readonly whileHover?: WardicBatchGesture | ((item: V, i: number) => WardicBatchValues) | undefined
  /**
   * Where an item goes while it's pressed, by a pointer, or by Enter or Space while it has focus and the
   * keyboard reorder is off (on, they lift it): values with an optional `transition`, or a function of its
   * item and index, read as its press starts.
   */
  readonly whileTap?: WardicBatchGesture | ((item: V, i: number) => WardicBatchValues) | undefined
  /**
   * Where an item leaving under `<AnimatePresence>` goes, at its last place, its element kept until it lands:
   * values with an optional `transition`, or a function of its item, its last index and the presence's `custom`.
   */
  readonly exit?: WardicBatchExit | ((item: V, i: number, custom: unknown) => WardicBatchValues) | undefined
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
  readonly direction?: BatchReorderDirection | undefined
  readonly keyboard?: boolean | undefined
  readonly announcements?: Partial<CoreReorder.Announcements<V>> | undefined
  readonly instructions?: string | undefined
  readonly initial?: false | WardicBatchValues | ((item: V, i: number) => WardicBatchValues) | undefined
  readonly transition?: WardicBatchTransition | undefined
  readonly whileDrag?: WardicBatchGesture | ((item: V, i: number) => WardicBatchValues) | undefined
  readonly whileHover?: WardicBatchGesture | ((item: V, i: number) => WardicBatchValues) | undefined
  readonly whileTap?: WardicBatchGesture | ((item: V, i: number) => WardicBatchValues) | undefined
  readonly exit?: WardicBatchExit | ((item: V, i: number, custom: unknown) => WardicBatchValues) | undefined
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

/** What a group's items read of it: its binding, and its keyboard reorder's settings. */
interface GroupForItems<V> {
  readonly binding: BatchReorderItems<V>
  readonly keyboard: () => boolean
  readonly instructions: () => string
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
      { values: () => local.values, geometry: () => geometryOf(local, undefined), direction: () => local.direction, initial: () => local.initial, whileTap: () => local.whileTap },
      untrack,
    )
    return (
      <BatchGroupContext.Provider value={{ binding: server as BatchReorderItems<unknown>, keyboard, instructions }}>
        <Dynamic component={tag} {...rest} style={server.groupStyle(local.style) as JSX.CSSProperties}>
          {local.children}
        </Dynamic>
      </BatchGroupContext.Provider>
    )
  }
  const runtime = useWardicRuntime()
  const services = useBrought(GROUP_BRINGS)
  // What the group read of its element: its direction and width (Q35, Q36).
  const [measured, setMeasured] = createSignal<BatchReorderMeasure | undefined>(undefined, { equals: sameMeasure })
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
        values: () => local.values,
        geometry: () => geometryOf(local, measured()),
        direction: () => local.direction,
        onMeasure: setMeasured,
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
  return (
    <BatchGroupContext.Provider value={{ binding: binding as BatchReorderBinding<unknown>, keyboard, instructions }}>
      <Dynamic component={tag} {...rest} ref={mergeRefs(local.ref, binding.attach)} style={binding.groupStyle(local.style) as JSX.CSSProperties}>
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
  const [element, setElement] = createSignal<HTMLElement>()
  // The instructions element exists on the client only, so `aria-describedby` waits for the mount.
  const [describedBy, setDescribedBy] = createSignal<string>()
  if (!isServer) {
    createEffect(on([element, group.instructions] as const, ([el, text]) => {
      if (Predicate.isNotUndefined(el)) setDescribedBy(DomAnnouncer.instructionsId(DomAnnouncer.documentOf(el), text))
    }))
  }
  const tag = UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "li", onDefined: identity })
  return (
    <Dynamic
      component={tag}
      {...rest}
      ref={mergeRefs(local.ref, item.ref, setElement)}
      style={item.style(local.style) as JSX.CSSProperties}
      draggable={Style.DRAG_DEFAULT_ATTRIBUTES.draggable}
      tabindex={UndefinedOr.match(local.tabIndex, { onDefined: identity, onUndefined: () => Bool.match(Bool.or(group.keyboard(), group.binding.pressable), { onTrue: () => 0, onFalse: constUndefined }) })}
      aria-describedby={describedByOf(local["aria-describedby"], Bool.match(group.keyboard(), { onTrue: describedBy, onFalse: constUndefined }))}
    >
      {local.children}
    </Dynamic>
  )
}

const noop = (): void => {}

