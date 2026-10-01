/**
 * `<Reorder>` for Solid (ADR-0020): drag items to reorder a list, built headless first
 * (D8). `createReorderGroup` and `createReorderItem` are spreads for any elements and
 * `use:reorderItem` a directive, so a list outside JSX components (a web component, a
 * plain element) reorders the same way; `Reorder.Group` / `Reorder.Item` are built on
 * them.
 *
 * The **Reorder group** is core's `makeReorderGroup`: it reads each item's slot, drag
 * offset and layout version from its projection node's handle, runs the **Crossover**
 * on each drag sample, and calls the app's `onReorder`; the app owns `values` and keys
 * its items with `<For>`. Each item is a `layout` node with a drag the group's axis
 * decides per gesture, raised while dragged, and its group's scroller **Auto-scroll**s
 * while it's held near an edge. A `values` change re-measures, so a reorder the app
 * makes itself animates.
 *
 * Observability: the group's and the Auto-scroll's events are `wardic.reorder:` debug
 * logs (cold path: once per reorder, wait, gesture or edge, never per sample).
 */
import {
  autoScrollAxis,
  makeReorderGroup,
  type ReorderAxis,
  type ReorderGroup as CoreReorderGroup,
  type ReorderItemSource,
} from "@wardic/core"
import { type AutoScroller, makeAutoScroller, type ProjectionNodeHandle, reorderTouchAction } from "@wardic/dom"
import { mergeRefs } from "@solid-primitives/refs"
import * as Effect from "effect/Effect"
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
  onMount,
  splitProps,
  untrack,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { useWardicGate, useWardicProjection, useWardicRuntime, type WardicRuntime } from "./provider.tsx"
import { runSpine, type SpineInternals, useWardicWith, type Ward, type WardicConfig, type WardUserProps } from "./use-wardic.tsx"
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
  readonly axis?: ReorderAxis
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
  readonly group: CoreReorderGroup<V>
  readonly axis: Accessor<ReorderAxis>
  readonly move: (value: V, toIndex: number) => void
  /** @internal for the items: the group's Auto-scroll (after the group's element mounts) and its item hooks. */
  readonly items: ReorderItemsHooks<V>
}

/** @internal What a group gives its items. */
export interface ReorderItemsHooks<V> {
  readonly autoScroller: () => AutoScroller | undefined
  readonly register: (value: V, handle: ProjectionNodeHandle) => () => void
}

/** A `<Reorder>` item's config: its `value`, plus any motion config but `layout`, `layoutId` and `drag`. */
export type ReorderItemConfig<V> = { readonly value: V } & Omit<WardicConfig, "layout" | "layoutId" | "drag">

/** How many frames the axis re-resolve waits for the items' next Measure pass. */
const RESOLVE_FRAMES = 20

const debugOf = (runtime: WardicRuntime) => (event: string, annotations: Record<string, unknown>): void => {
  runtime.runFork(Effect.logDebug(`wardic.reorder: ${event}`).pipe(Effect.annotateLogs(annotations)))
}

/**
 * Create a **Reorder group** (ADR-0020). Spread the result onto the list's element
 * (`<ul {...group()}>`): it gives the element `overflow-anchor: none` (under the
 * user's style, as Motion's Group.tsx:187-195 at 16c6122 does), so the browser's
 * scroll anchoring doesn't shift the page as items move. Items are made with {@link createReorderItem}
 * or `use:reorderItem`, keyed with `<For>`.
 *
 * The group's `axis` is the config's, else detected from the items' boxes; it's
 * re-resolved after mount, after each `values` change and after a window width change,
 * once the items' next Measure pass is in (for their `touch-action`). A drag resolves
 * its own axis at its start.
 *
 * Client and server: on a server it renders the element's style and nothing else.
 */
export function createReorderGroup<V>(config: ReorderGroupConfig<V> | Accessor<ReorderGroupConfig<V>>): ReorderGroupWard<V> {
  const cfg: Accessor<ReorderGroupConfig<V>> = typeof config === "function" ? config : () => config
  const runtime = useWardicRuntime()
  const projection = useWardicProjection()
  const debug = debugOf(runtime)

  let element: HTMLElement | undefined
  let autoScroller: AutoScroller | undefined
  const group = makeReorderGroup<V>({
    values: () => untrack(cfg).values,
    onReorder: (values) => untrack(cfg).onReorder(values),
    axis: () => untrack(cfg).axis,
    // Read once per drag start (Motion reads it on every sample, Group.tsx:142-147 at 16c6122).
    direction: () => (element !== undefined && getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr"),
    debug,
  })

  // The items' handles by value, for the re-resolve and the `.map` warning.
  const handles = new Map<V, ProjectionNodeHandle>()
  // Values whose item was disposed in this task, and whether the `.map` warning fired.
  const disposedThisTask = new Set<V>()
  let warned = false

  const [detected, setDetected] = createSignal<ReorderAxis>("y")
  const axis: Accessor<ReorderAxis> = () => cfg().axis ?? detected()

  // The re-resolve (Q4): wait, frame by frame, until every item's layoutVersion moves
  // past where it was at the trigger (its next Measure pass is in), then read the axis.
  let resolveFrame = 0
  const scheduleResolve = (): void => {
    if (typeof requestAnimationFrame === "undefined") return
    if (resolveFrame !== 0) cancelAnimationFrame(resolveFrame)
    const at = new Map<V, number>()
    for (const [value, handle] of handles) at.set(value, handle.layoutVersion())
    let frames = 0
    const check = (): void => {
      resolveFrame = 0
      frames++
      let ready = true
      for (const [value, handle] of handles) {
        const before = at.get(value)
        if (before !== undefined && handle.layoutVersion() <= before) ready = false
      }
      if (ready || frames >= RESOLVE_FRAMES) {
        setDetected(group.resolveAxis())
        return
      }
      resolveFrame = requestAnimationFrame(check)
    }
    resolveFrame = requestAnimationFrame(check)
  }

  onMount(() => {
    scheduleResolve()
    let width = window.innerWidth
    const onResize = (): void => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      scheduleResolve()
    }
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      window.removeEventListener("resize", onResize)
      if (resolveFrame !== 0) cancelAnimationFrame(resolveFrame)
    })
  })

  // A `values` change re-measures, so the items animate to their new slots whoever
  // reordered them (as LayoutGroup's layoutDependency does).
  createEffect(
    on(
      () => cfg().values,
      () => {
        projection.notify()
        scheduleResolve()
      },
      { defer: true },
    ),
  )

  const items: ReorderItemsHooks<V> = {
    autoScroller: () => autoScroller,
    register: (value, handle) => {
      if (disposedThisTask.has(value) && !warned) {
        warned = true
        runtime.runFork(
          Effect.logWarning("wardic.reorder: an item remounted with the same value in one task (key items with <For>)").pipe(
            Effect.annotateLogs({ value: String(value) }),
          ),
        )
      }
      handles.set(value, handle)
      const unregister = group.register(value, handle satisfies ReorderItemSource)
      return () => {
        unregister()
        if (handles.get(value) === handle) handles.delete(value)
        if (disposedThisTask.size === 0) queueMicrotask(() => disposedThisTask.clear())
        disposedThisTask.add(value)
      }
    },
  }

  const ward = (userProps?: WardUserProps): ReorderGroupWardProps => ({
    ref: mergeRefs(userProps?.ref, (el: HTMLElement) => {
      element = el
      autoScroller = makeAutoScroller(el, debug)
    }),
    get style() {
      return { "overflow-anchor": "none", ...userProps?.style } as JSX.CSSProperties
    },
  })

  return Object.assign(ward, { group, axis, move: group.move, items })
}

/**
 * The spine additions of an item with `value` in `group` (D8: shared by
 * {@link createReorderItem} and `use:reorderItem`): a `layout` node registered with the
 * group, raised while dragged, whose drag takes the group's axis at each start, feeds
 * the group's Crossover and its Auto-scroll, and whose `touch-action` follows the
 * group's axis.
 */
const itemInternals = <V,>(group: ReorderGroupWard<V>, value: V, element: Accessor<HTMLElement | undefined>): SpineInternals => {
  // The gesture's axis (core's, fixed at its start) for Auto-scroll's axis.
  let gestureAxis: ReorderAxis = "y"
  // Whether a gesture is between its start and end samples. An item unmounted mid-gesture
  // gets no end sample, so its cleanup ends the gesture (the group's and Auto-scroll's).
  let inGesture = false
  const endGesture = (): void => {
    inGesture = false
    group.group.dragEnd(value)
    group.items.autoScroller()?.reset()
  }
  onCleanup(() => {
    if (inGesture) endGesture()
  })
  return {
    dragAxis: () => {
      const a = group.group.resolveAxis()
      return a === "xy" ? true : a
    },
    onDragSample: (sample) => {
      if (sample.phase === "start") {
        inGesture = true
        gestureAxis = group.group.dragStart(value, sample.point, sample.timeStamp)
        return
      }
      if (sample.phase === "move") {
        const velocity = group.group.dragMove(value, sample.point, sample.timeStamp)
        const scroller = group.items.autoScroller()
        if (scroller !== undefined) {
          const on = autoScrollAxis(gestureAxis, velocity)
          scroller.update(sample.point, on, velocity[on], element())
        }
        return
      }
      endGesture()
    },
    onLayoutHandle: (handle) => onCleanup(group.items.register(value, handle)),
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
  const ward = useWardicWith(() => ({ ...withoutValue(cfg()), layout: true }), itemInternals(group, value, element))
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

const withoutValue = <V,>(config: ReorderItemConfig<V>): WardicConfig => {
  const { value: _value, ...rest } = config
  return rest
}

/**
 * `use:reorderItem`'s value: the item's group (of any value type: a group's value type
 * only appears in its parameters, so `never` accepts every group) and value, plus its
 * motion config.
 */
export type ReorderItemDirectiveValue = { readonly group: ReorderGroupWard<never>; readonly value: unknown } & Omit<
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
    internal: itemInternals(first.group as ReorderGroupWard<unknown>, first.value, () => el),
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
  readonly axis?: ReorderAxis | undefined
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
  readonly axis?: ReorderAxis | undefined
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
