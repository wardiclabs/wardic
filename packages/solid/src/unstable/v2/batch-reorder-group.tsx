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
import * as Style from "@wardic/dom/Style"
import * as Bool from "effect/Boolean"
import { constUndefined, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { isServer, type JSX } from "@solidjs/web"
import { $PROXY, createContext, createEffect, createMemo, createSignal, flush, omit, onCleanup, untrack, useContext } from "solid-js"
import { configTransitionOf, type WardicBatchTransition } from "../../batch.ts"
import { type BatchReorderBinding, type BatchReorderExit, type BatchReorderGesture, type BatchReorderInitial, type BatchReorderItems, serverBatchReorder, type BatchReorderRead, bindBatchReorder, describedByOf, geometryOf, GROUP_BRINGS, type ReorderBatchGap, type ReorderBatchItemSize, sameRead, tabStopOf } from "../../batch-reorder.ts"
import { refsOf, staticElementOf } from "./element.tsx"
import { usePresenceContext } from "./presence.tsx"
import { plainOrder } from "../../reorder-values.ts"
import { useBrought, useWardicDefaultTransition, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import type { ReorderElementTag, ReorderGroup, ReorderGroupEvents } from "./reorder.tsx"
import { CLIENT_ONLY, CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"
import { eachOf, neverLands, NO_EVENTS, serverWhen, Waiters, whenOf } from "./waiters.ts"
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
  readonly binding: BatchReorderItems<V>
  readonly keyboard: () => boolean
  /** The keyboard instructions' id, the same for every item: the group's document's (#712, Q47). */
  readonly instructionsId: () => string | undefined
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
  const keyboard = (): boolean => local.keyboard !== false
  const instructions = (): string => UndefinedOr.match(local.instructions, { onUndefined: () => ReorderController.DEFAULT_INSTRUCTIONS, onDefined: identity })
  const Element = staticElementOf(UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "ul", onDefined: identity }))
  const rest = omit(props as unknown as Record<string, unknown>, ...GROUP_OWN)
  // On a server (Q39): its items' starts, no runtime, and a group whose events never come, as
  // `Reorder.Group`'s there. A plain `if`, so a client build drops it (#518).
  if (isServer) {
    const server = serverBatchReorder<V>(
      { values: () => local.values, geometry: () => geometryOf(local, undefined), initial: () => local.initial, whileTap: () => local.whileTap },
      untrack,
    )
    UndefinedOr.map(untrack(() => local.groupRef), (give) =>
      give({ axis: () => geometryOf(local, undefined).axis, move: constUndefined, next: neverLands, each: () => NO_EVENTS, when: serverWhen }))
    // eslint-disable-next-line solid/components-return-once -- `isServer` is a constant: the component takes one path for its life
    return (
      <BatchGroupContext value={{ binding: server as BatchReorderItems<unknown>, keyboard, instructionsId: constUndefined }}>
        <Element {...rest} style={server.groupStyle(local.style)}>
          {local.children}
        </Element>
      </BatchGroupContext>
    )
  }
  const runtime = useWardicRuntime()
  const services = useBrought(GROUP_BRINGS)
  // The order as a plain array (#721): a store's copied, so a store changed in place is a new order.
  const values = (): ReadonlyArray<V> => plainOrder(local.values, $PROXY)
  // What the group read of its element: the direction it inherits and a grid's width (Q35, Q36).
  const [read, setRead] = createSignal<BatchReorderRead | undefined>(undefined, { equals: sameRead })
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
        values,
        geometryOf: (seen) => geometryOf(local, seen),
        read,
        // Its places from what it read land within the read, before the page paints (Q35–Q37): Solid 2 runs
        // the effect that places them at its next flush, which may come after a paint, so it's flushed now.
        onRead: (seen) => {
          setRead(seen)
          flush()
        },
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
  const controller = binding.controller
  const group: ReorderBatchGroup<V> = {
    axis: () => geometryOf(local, untrack(read)).axis,
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
  // The keyboard instructions, once for every item (Q47): the page's document's, until the group's element's
  // own replaces it (an iframe's).
  const [document, setDocument] = createSignal<Document>(globalThis.document)
  const onElement = (el: HTMLElement): void => {
    setDocument(DomAnnouncer.documentOf(el))
  }
  // eslint-disable-next-line solid/reactivity -- the accessor itself is handed on, read where its memo tracks it
  const instructionsId = instructionsIdOn(document, instructions)
  return (
    <BatchGroupContext value={{ binding: binding as BatchReorderBinding<unknown>, keyboard, instructionsId }}>
      <Element {...rest} style={binding.groupStyle(local.style)} ref={refsOf(local, [binding.attach, onElement])}>
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
  const Element = staticElementOf(UndefinedOr.match(untrack(() => local.as), { onUndefined: () => "li", onDefined: identity }))
  const rest = omit(props as unknown as Record<string, unknown>, ...ITEM_OWN)
  return (
    <Element
      {...rest}
      style={item.style(local.style)}
      draggable={Style.DRAG_DEFAULT_ATTRIBUTES.draggable}
      tabindex={UndefinedOr.match(local.tabindex, { onDefined: identity, onUndefined: () => tabStopOf(group.keyboard(), group.binding.pressable) })}
      aria-describedby={describedByOf(local["aria-describedby"], Bool.match(group.keyboard(), { onTrue: group.instructionsId, onFalse: constUndefined }))}
      ref={refsOf(local, [item.ref])}
    >
      {local.children}
    </Element>
  )
}

const noop = (): void => {}

/**
 * The keyboard instructions' id (ADR-0037), derived, so each item renders with its `aria-describedby`: the
 * page's document's, until the group's element's own replaces it (an iframe's); an effect adds the
 * instructions element, writing nothing (#320). The element exists on the client only: on a server, none.
 * A plain `if` (#518).
 */
const instructionsIdOn = (document: () => Document, instructions: () => string): (() => string | undefined) => {
  if (isServer) return constUndefined
  createEffect(
    () => ({ doc: document(), text: instructions() }),
    ({ doc, text }) => DomAnnouncer.showInstructions(doc, text),
    CLIENT_ONLY,
  )
  return createMemo(() => DomAnnouncer.instructionsIdOf(document(), instructions()), CLIENT_ONLY)
}

