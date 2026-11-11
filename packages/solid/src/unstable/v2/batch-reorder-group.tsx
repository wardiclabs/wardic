/**
 * `Reorder.BatchGroup` and `Reorder.BatchItem` on Solid 2 (#712, ADR-0072): Solid 1's, its props read per
 * key, its group handed to `groupRef` with `reorderGroup()`'s events, `move` and axis (Q25), and Solid
 * flushed inside `onReorder`, so the DOM follows within the controller's call, as `Reorder.Group`'s does.
 *
 * @module
 */
import type * as CoreReorder from "@wardic/core/Reorder"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Bool from "effect/Boolean"
import { constUndefined, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { JSX } from "@solidjs/web"
import { createContext, createEffect, createMemo, createSignal, flush, omit, onCleanup, untrack, useContext } from "solid-js"
import { configTransitionOf, type WardicBatchExit, type WardicBatchGesture, type WardicBatchTransition, type WardicBatchValues } from "../../batch.ts"
import { type BatchReorderBinding, type BatchReorderDirection, type BatchReorderMeasure, bindBatchReorder, describedByOf, geometryOf, GROUP_BRINGS, type ReorderBatchGap, type ReorderBatchItemSize, sameMeasure } from "../../batch-reorder.ts"
import { refsOf, staticElementOf } from "./element.tsx"
import { usePresenceContext } from "./presence.tsx"
import { useBrought, useWardicDefaultTransition, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import type { ReorderElementTag, ReorderGroup, ReorderGroupEvents } from "./reorder.tsx"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"
import { eachOf, Waiters, whenOf } from "./waiters.ts"
import { useWardicConfig } from "./wardic-config.tsx"

export type { ReorderBatchGap, ReorderBatchItemSize } from "../../batch-reorder.ts"

/**
 * A `Reorder.BatchGroup`'s group, handed to its `groupRef` (Q25): `reorderGroup()`'s events (`next`, `each`
 * and `when` of `reorderEnd`, `holdStart` and `holdEnd`), `move` and its axis.
 */
export type ReorderBatchGroup<V> = Pick<ReorderGroup<V>, "axis" | "move" | "next" | "each" | "when">

/**
 * `Reorder.BatchGroup`'s props: `Reorder.Group`'s (its `values`, `onReorder` and keyboard), its places'
 * geometry, its items' motion, `groupRef`, and the props of the element it renders.
 */
export type ReorderBatchGroupProps<V, Tag extends ReorderElementTag = "ul"> = {
  /** The list's values, in order, each its own: an item's key. Your app owns them. */
  readonly values: ReadonlyArray<V>
  /** Given each new order, as an item crosses another: set `values` from it. */
  readonly onReorder: (values: Array<V>) => void
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
  /** Given the group once, as it's made, as `Reorder.Group`'s `groupRef` is: for its events and `move`. */
  readonly groupRef?: ((group: ReorderBatchGroup<V>) => void) | undefined
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
  readonly tabindex?: number | undefined
  /** Its own ids, kept before the keyboard reorder's instructions'. */
  readonly "aria-describedby"?: string | undefined
} & Omit<JSX.IntrinsicElements[Tag], "style" | "tabindex" | "aria-describedby">

/**
 * The props a component body reads, as plain records: instantiating the public prop types over every
 * element tag makes a type checker build a union of every element's props.
 */
interface GroupLocal<V> {
  readonly values: ReadonlyArray<V>
  readonly onReorder: (values: Array<V>) => void
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
  readonly groupRef?: ((group: ReorderBatchGroup<V>) => void) | undefined
  readonly as?: string | undefined
  readonly ref?: unknown
  readonly style?: JSX.CSSProperties | undefined
  readonly children?: JSX.Element
}
interface ItemLocal<V> {
  readonly value: V
  readonly as?: string | undefined
  readonly ref?: unknown
  readonly style?: JSX.CSSProperties | undefined
  readonly children?: JSX.Element
  readonly tabindex?: number | undefined
  readonly "aria-describedby"?: string | undefined
}

const GROUP_OWN = [
  "values",
  "onReorder",
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
  "groupRef",
  "as",
  "ref",
  "style",
  "children",
] as const
const ITEM_OWN = ["value", "as", "ref", "style", "children", "tabindex", "aria-describedby"] as const

/** The `AbortError`'s message for a group's `next` its disposal cut off. */
const GROUP_GONE = "The Reorder group was disposed before its next event."

/** What a group's items read of it: its binding, and its keyboard reorder's settings. */
interface GroupForItems<V> {
  readonly binding: BatchReorderBinding<V>
  readonly keyboard: () => boolean
  readonly instructions: () => string
}

/** The nearest `Reorder.BatchGroup`, for its items: `null` for none (Solid 2's contexts). */
const BatchGroupContext = createContext<GroupForItems<unknown> | null>(null)

/**
 * A long list put in order by dragging its items, or from the keyboard, as one Batch: every item one
 * size, at the place its index gives. Rendered as `as`, `"ul"` by default, sized to its places. Your app
 * owns `values`, and sets them from `onReorder`; `groupRef` hands out its events and `move`. Key its
 * `Reorder.BatchItem`s with `<For>`.
 *
 * @example
 * <Reorder.BatchGroup values={items()} onReorder={setItems} itemSize={{ width: 240, height: 48 }} gap={8}>
 *   <For each={items()}>{(item) => <Reorder.BatchItem value={item()}>{item()}</Reorder.BatchItem>}</For>
 * </Reorder.BatchGroup>
 * @see https://wardic.dev/reference/solid/reorder/reorder
 */
// #712, ADR-0072.
export function BatchGroup<V, Tag extends ReorderElementTag = "ul">(props: ReorderBatchGroupProps<V, Tag>): JSX.Element {
  const local = props as unknown as GroupLocal<V>
  const runtime = useWardicRuntime()
  const services = useBrought(GROUP_BRINGS)
  // What the group read of its element: its direction and width (Q35, Q36).
  const [measured, setMeasured] = createSignal<BatchReorderMeasure | undefined>(undefined, { equals: sameMeasure })
  // Its events (#257 item 3), ended with it.
  const events = new Waiters<ReorderGroupEvents<V>>(GROUP_GONE)
  onCleanup(() => events.dispose())
  // Whether the app's `move` is the call under way: its reorder isn't flushed.
  let moving = false
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
        // The DOM and the Batch follow a reorder within the controller's call, as `Reorder.Group`'s do: the
        // controller keeps focus on a lifted item right after. A `move` the app calls doesn't flush: the
        // app may call it inside an `action`, where Solid refuses a flush (#257 item 12).
        onReorder: (values) => {
          const onReorder = untrack(() => local.onReorder)
          if (moving) return onReorder(values)
          flush(() => onReorder(values))
        },
        onReorderEnd: (end) => events.tell("reorderEnd", () => end),
        onHoldStart: (start) => events.tell("holdStart", () => start),
        onHoldEnd: (end) => events.tell("holdEnd", () => end),
        keyboard: () => untrack(() => local.keyboard) !== false,
        announcements: () => Option.fromUndefinedOr(untrack(() => local.announcements)),
        brought: services,
      },
      { started: noop, landed: noop },
    ))
  // Its first places were read as it was made: from then on the compute reads them, and the apply, which
  // Solid runs only for a compute it keeps, turns every item.
  createEffect(binding.batch.targetsOf, binding.apply, CLIENT_ONLY_DEFERRED)
  onCleanup(binding.dispose)
  const keyboard = (): boolean => local.keyboard !== false
  const instructions = (): string => UndefinedOr.match(local.instructions, { onUndefined: () => ReorderController.DEFAULT_INSTRUCTIONS, onDefined: identity })
  const controller = binding.controller
  const group: ReorderBatchGroup<V> = {
    axis: () => geometryOf(local, untrack(measured)).axis,
    move: (value, toIndex) => {
      moving = true
      try {
        controller.move(value, toIndex)
      } finally {
        moving = false
      }
    },
    next: (name) => events.wait(name),
    each: (name) => eachOf(events, name),
    when: (name) => whenOf(events, name),
  }
  // The group, to its `groupRef`, read once, untracked, as `ref` is.
  UndefinedOr.map(untrack(() => local.groupRef), (give) => give(group))
  const Element = staticElementOf(UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "ul", onDefined: identity }))
  const rest = omit(props as unknown as Record<string, unknown>, ...GROUP_OWN)
  return (
    <BatchGroupContext value={{ binding: binding as BatchReorderBinding<unknown>, keyboard, instructions }}>
      <Element {...rest} style={binding.groupStyle(local.style)} ref={refsOf(local, [binding.attach])}>
        {local.children}
      </Element>
    </BatchGroupContext>
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
  const group = useContext(BatchGroupContext) as GroupForItems<V> | null
  if (Predicate.isNull(group)) throw new Error("Reorder.BatchItem must be a child of Reorder.BatchGroup")
  const local = props as unknown as ItemLocal<V>
  const item = group.binding.item(untrack(() => local.value), usePresenceContext())
  onCleanup(item.dispose)
  // The instructions' id (ADR-0037), derived, so the element renders with its `aria-describedby`: the
  // page's document's, until the element's own replaces it (an iframe's). An effect adds the instructions
  // element, writing nothing (#320).
  const [document, setDocument] = createSignal<Document>(globalThis.document)
  const describedBy = createMemo(() => DomAnnouncer.instructionsIdOf(document(), group.instructions()), CLIENT_ONLY)
  createEffect(
    () => ({ doc: document(), text: group.instructions() }),
    ({ doc, text }) => DomAnnouncer.showInstructions(doc, text),
    CLIENT_ONLY,
  )
  const Element = staticElementOf(UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "li", onDefined: identity }))
  const rest = omit(props as unknown as Record<string, unknown>, ...ITEM_OWN)
  const onElement = (el: HTMLElement): void => {
    item.ref(el)
    setDocument(DomAnnouncer.documentOf(el))
  }
  return (
    <Element
      {...rest}
      style={item.style(local.style)}
      tabindex={UndefinedOr.match(local.tabindex, { onDefined: identity, onUndefined: () => Bool.match(Bool.or(group.keyboard(), group.binding.pressable), { onTrue: () => 0, onFalse: constUndefined }) })}
      aria-describedby={describedByOf(local["aria-describedby"], Bool.match(group.keyboard(), { onTrue: describedBy, onFalse: constUndefined }))}
      ref={refsOf(local, [onElement])}
    >
      {local.children}
    </Element>
  )
}

const noop = (): void => {}

